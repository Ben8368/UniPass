use std::hint::black_box;
use std::ops::{Deref, DerefMut};
use zeroize::Zeroizing;

pub(crate) struct SecretBytes(Vec<u8>);

impl SecretBytes {
    pub(crate) fn from_zeroizing(mut bytes: Zeroizing<Vec<u8>>) -> Self {
        Self(std::mem::take(&mut *bytes))
    }

    pub(crate) fn into_vec(mut self) -> Vec<u8> {
        std::mem::take(&mut self.0)
    }
}

impl AsRef<[u8]> for SecretBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Deref for SecretBytes {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for SecretBytes {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Drop for SecretBytes {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.0);
    }
}

pub(crate) fn reconstruct<const N: usize>(left: &[u8; N], right: &[u8; N]) -> Zeroizing<[u8; N]> {
    let mut material = Zeroizing::new([0u8; N]);
    for index in 0..N {
        // Keep the public fragments separate in optimized output. The final key is
        // reconstructed only at runtime and remains owned by a zeroizing buffer.
        material[index] = black_box(left[index]) ^ black_box(right[index]);
    }
    material
}
