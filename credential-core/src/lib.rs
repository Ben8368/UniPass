use aes::Aes128;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use cipher::{
    block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyInit,
};
use des::Des;
use md5::{Digest, Md5};
use std::{mem, ptr, slice};
use zeroize::{Zeroize, Zeroizing};

const U_PART_A: [u8; 16] = [
    0x3b, 0x91, 0x52, 0xe7, 0x0c, 0x4a, 0x2d, 0xb4, 0x71, 0xc8, 0x36, 0x05, 0xa9, 0x6f,
    0x1c, 0xd2,
];
const U_PART_B: [u8; 16] = [
    0x6d, 0xc4, 0x90, 0xaf, 0x94, 0x71, 0x85, 0x5a, 0xcb, 0xf8, 0xec, 0xc9, 0x99, 0xf7,
    0xb7, 0x0c,
];
const J_PART_A: [u8; 8] = [0x19, 0xa4, 0x2d, 0x73, 0x88, 0x0c, 0xe1, 0x4a];
const J_PART_B: [u8; 8] = [0x69, 0xcc, 0x42, 0x16, 0xe6, 0x65, 0x99, 0x15];
const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";
const HEX_UPPER: &[u8; 16] = b"0123456789ABCDEF";

#[no_mangle]
pub extern "C" fn c_a(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let mut buffer = vec![0u8; length as usize].into_boxed_slice();
    let pointer = buffer.as_mut_ptr() as u32;
    mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn c_f(pointer: u32, length: u32) {
    if pointer == 0 || length == 0 {
        return;
    }
    let raw = ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize);
    let mut buffer = Box::from_raw(raw);
    buffer.zeroize();
}

#[no_mangle]
pub unsafe extern "C" fn c_u(pointer: u32, length: u32) -> u64 {
    let Some(input) = input_slice(pointer, length) else {
        return 0;
    };
    match unipass_plaintext(input) {
        Some(plaintext) => leak_result(&plaintext),
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn c_j(pointer: u32, length: u32) -> u64 {
    let Some(input) = input_slice(pointer, length) else {
        return 0;
    };
    match jupiter_transform(input) {
        Some(transformed) => leak_result(&transformed),
        None => 0,
    }
}

unsafe fn input_slice(pointer: u32, length: u32) -> Option<&'static [u8]> {
    if pointer == 0 || length == 0 {
        return None;
    }
    Some(slice::from_raw_parts(pointer as *const u8, length as usize))
}

fn unipass_plaintext(input: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    let encoded = std::str::from_utf8(input).ok()?;
    let ciphertext = Zeroizing::new(STANDARD.decode(encoded).ok()?);
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        return None;
    }

    let key = reconstruct::<16>(&U_PART_A, &U_PART_B);
    let decryptor = ecb::Decryptor::<Aes128>::new_from_slice(key.as_ref()).ok()?;
    let plaintext = Zeroizing::new(
        decryptor
            .decrypt_padded_vec_mut::<Pkcs7>(ciphertext.as_ref())
            .ok()?,
    );
    if plaintext.is_empty() || std::str::from_utf8(plaintext.as_ref()).is_err() {
        return None;
    }
    Some(plaintext)
}

fn jupiter_transform(input: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    let digest = Md5::digest(input);
    let mut digest_bytes = Zeroizing::new([0u8; 16]);
    digest_bytes.copy_from_slice(&digest);
    let mut digest_hex = Zeroizing::new([0u8; 32]);
    for (index, byte) in digest_bytes.iter().copied().enumerate() {
        digest_hex[index * 2] = HEX_LOWER[(byte >> 4) as usize];
        digest_hex[index * 2 + 1] = HEX_LOWER[(byte & 0x0f) as usize];
    }

    let key = reconstruct::<8>(&J_PART_A, &J_PART_B);
    let encryptor = ecb::Encryptor::<Des>::new_from_slice(key.as_ref()).ok()?;
    let encrypted = Zeroizing::new(encryptor.encrypt_padded_vec_mut::<Pkcs7>(digest_hex.as_ref()));
    let mut output = Zeroizing::new(vec![0u8; encrypted.len() * 2]);
    for (index, byte) in encrypted.iter().copied().enumerate() {
        output[index * 2] = HEX_UPPER[(byte >> 4) as usize];
        output[index * 2 + 1] = HEX_UPPER[(byte & 0x0f) as usize];
    }
    Some(output)
}

fn reconstruct<const N: usize>(left: &[u8; N], right: &[u8; N]) -> Zeroizing<[u8; N]> {
    let mut material = Zeroizing::new([0u8; N]);
    for index in 0..N {
        unsafe {
            material[index] = ptr::read_volatile(&left[index]) ^ ptr::read_volatile(&right[index]);
        }
    }
    material
}

fn leak_result(bytes: &[u8]) -> u64 {
    if bytes.is_empty() || bytes.len() > u32::MAX as usize {
        return 0;
    }
    let mut output = bytes.to_vec().into_boxed_slice();
    let pointer = output.as_mut_ptr() as u32;
    let length = output.len() as u32;
    mem::forget(output);
    ((pointer as u64) << 32) | length as u64
}

