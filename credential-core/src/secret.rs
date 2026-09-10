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

pub(crate) fn reconstruct<const N: usize, const F: usize>(
    fragments: &[[u8; N]; F],
    order: &[u8; N],
    rotate: &[u8; N],
    offset: &[u8; N],
) -> Zeroizing<[u8; N]> {
    let mut material = Zeroizing::new([0u8; N]);
    for index in 0..N {
        let slot = order[index] as usize;
        let mut encoded = 0u8;
        for fragment in fragments {
            encoded ^= black_box(fragment[slot]);
        }
        material[index] = encoded
            .wrapping_sub(black_box(offset[index]))
            .rotate_right(u32::from(black_box(rotate[index])));
    }
    material
}
