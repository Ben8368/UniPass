use std::mem;
use std::slice;
use std::sync::{Mutex, OnceLock};
use zeroize::{Zeroize, Zeroizing};

use crate::jupiter;
use crate::secret::SecretBytes;
use crate::unipass;

pub(crate) const MAX_ABI_ALLOCATION: usize = 64 * 1024;
pub(crate) const MAX_LIVE_ALLOCATIONS: usize = 64;
const MAX_OUTPUT_LENGTH: usize = 64 * 1024;
const STATUS_ERROR: u32 = 0;
const STATUS_FALSE: u32 = 1;
const STATUS_TRUE: u32 = 2;

#[derive(Clone, Copy)]
#[repr(u8)]
enum AllocationKind {
    Input,
    Output,
}

#[derive(Clone, Copy)]
struct Allocation {
    pointer: usize,
    length: usize,
    capacity: usize,
    kind: AllocationKind,
}

static ALLOCATIONS: OnceLock<Mutex<Vec<Allocation>>> = OnceLock::new();

#[unsafe(no_mangle)]
pub extern "C" fn c_a(length: u32) -> u32 {
    let length = length as usize;
    if length == 0 || length > MAX_ABI_ALLOCATION {
        return 0;
    }

    let mut buffer = vec![0u8; length];
    let pointer = buffer.as_mut_ptr() as usize;
    let capacity = buffer.capacity();
    if pointer == 0 || pointer > u32::MAX as usize || !range_is_valid(pointer, length) {
        buffer.zeroize();
        return 0;
    }
    if !register_allocation(Allocation {
        pointer,
        length,
        capacity,
        kind: AllocationKind::Input,
    }) {
        buffer.zeroize();
        return 0;
    }
    mem::forget(buffer);
    pointer as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn c_f(pointer: u32, length: u32) {
    let pointer = pointer as usize;
    let length = length as usize;
    let Some(capacity) = take_allocation(pointer, length) else {
        return;
    };

    // The allocation registry proves that this pointer/capacity pair originated in
    // c_a or into_abi_output. Invalid ABI pointers are ignored instead of becoming
    // Box/Vec ownership and causing undefined behavior.
    let raw = unsafe { Vec::from_raw_parts(pointer as *mut u8, length, capacity) };
    let mut secret = Zeroizing::new(raw);
    secret.zeroize();
}

#[unsafe(no_mangle)]
pub extern "C" fn c_u(pointer: u32, length: u32) -> u64 {
    if !input_is_valid(pointer, length) {
        return 0;
    }
    let input = unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) };
    match unipass::decrypt(input) {
        Some(plaintext) => into_abi_output(plaintext),
        None => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn c_v(pointer: u32, length: u32) -> u32 {
    if !input_is_valid(pointer, length) {
        return STATUS_ERROR;
    }
    let input = unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) };
    match unipass::available(input) {
        Some(true) => STATUS_TRUE,
        Some(false) => STATUS_FALSE,
        None => STATUS_ERROR,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn c_k(pointer: u32, length: u32) -> u64 {
    if !input_is_valid(pointer, length) {
        return 0;
    }
    let input = unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) };
    match jupiter::transform_ciphertext(input) {
        Some(transformed) => into_abi_output(transformed),
        None => 0,
    }
}

fn input_is_valid(pointer: u32, length: u32) -> bool {
    let pointer = pointer as usize;
    let length = length as usize;
    length > 0
        && length <= MAX_ABI_ALLOCATION
        && range_is_valid(pointer, length)
        && is_registered_input(pointer, length)
}

fn range_is_valid(pointer: usize, length: usize) -> bool {
    pointer > 0
        && length > 0
        && pointer
            .checked_add(length)
            .is_some_and(|end| end <= linear_memory_bytes())
}

#[cfg(target_arch = "wasm32")]
fn linear_memory_bytes() -> usize {
    (core::arch::wasm32::memory_size(0) as usize).saturating_mul(64 * 1024)
}

#[cfg(not(target_arch = "wasm32"))]
fn linear_memory_bytes() -> usize {
    usize::MAX
}

fn allocation_store() -> &'static Mutex<Vec<Allocation>> {
    ALLOCATIONS.get_or_init(|| Mutex::new(Vec::new()))
}

fn register_allocation(allocation: Allocation) -> bool {
    let Ok(mut allocations) = allocation_store().lock() else {
        return false;
    };
    if allocations.len() >= MAX_LIVE_ALLOCATIONS
        || allocations
            .iter()
            .any(|entry| entry.pointer == allocation.pointer)
    {
        return false;
    }
    allocations.push(allocation);
    true
}

fn is_registered_input(pointer: usize, length: usize) -> bool {
    allocation_store().lock().ok().is_some_and(|allocations| {
        allocations.iter().any(|entry| {
            entry.pointer == pointer
                && entry.length == length
                && matches!(entry.kind, AllocationKind::Input)
        })
    })
}

fn take_allocation(pointer: usize, length: usize) -> Option<usize> {
    let mut allocations = allocation_store().lock().ok()?;
    let index = allocations
        .iter()
        .position(|entry| entry.pointer == pointer && entry.length == length)?;
    Some(allocations.swap_remove(index).capacity)
}

fn into_abi_output(secret: SecretBytes) -> u64 {
    let mut bytes = secret.into_vec();
    let length = bytes.len();
    let capacity = bytes.capacity();
    let pointer = bytes.as_mut_ptr() as usize;
    if length == 0
        || length > MAX_OUTPUT_LENGTH
        || capacity < length
        || pointer == 0
        || pointer > u32::MAX as usize
        || !range_is_valid(pointer, length)
    {
        bytes.zeroize();
        return 0;
    }

    if !register_allocation(Allocation {
        pointer,
        length,
        capacity,
        kind: AllocationKind::Output,
    }) {
        bytes.zeroize();
        return 0;
    }
    let (raw_pointer, raw_length, _) = bytes.into_raw_parts();
    debug_assert_eq!(raw_pointer as usize, pointer);
    debug_assert_eq!(raw_length, length);
    ((pointer as u64) << 32) | length as u64
}
