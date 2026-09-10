use cipher::{BlockEncryptMut, KeyInit, block_padding::Pkcs7};
use des::Des;
use ecb::Encryptor;
use md5::{Digest, Md5};
use zeroize::Zeroizing;

use crate::generated_material::j_key;
use crate::secret::SecretBytes;
use crate::unipass;
const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";
const HEX_UPPER: &[u8; 16] = b"0123456789ABCDEF";

pub(crate) fn transform(input: &[u8]) -> Option<SecretBytes> {
    let mut hasher = Md5::new();
    hasher.update(input);
    let mut digest_result = hasher.finalize_reset();
    let mut digest = Zeroizing::new([0u8; 16]);
    digest.copy_from_slice(&digest_result);
    digest_result.iter_mut().for_each(|byte| *byte = 0);

    let mut digest_hex = Zeroizing::new([0u8; 32]);
    for (index, byte) in digest.iter().copied().enumerate() {
        digest_hex[index * 2] = HEX_LOWER[(byte >> 4) as usize];
        digest_hex[index * 2 + 1] = HEX_LOWER[(byte & 0x0f) as usize];
    }

    let key = j_key();
    let encryptor = Encryptor::<Des>::new_from_slice(key.as_ref()).ok()?;
    let encrypted = Zeroizing::new(encryptor.encrypt_padded_vec_mut::<Pkcs7>(digest_hex.as_ref()));
    let mut output = Zeroizing::new(vec![0u8; encrypted.len() * 2]);
    for (index, byte) in encrypted.iter().copied().enumerate() {
        output[index * 2] = HEX_UPPER[(byte >> 4) as usize];
        output[index * 2 + 1] = HEX_UPPER[(byte & 0x0f) as usize];
    }
    Some(SecretBytes::from_zeroizing(output))
}

pub(crate) fn transform_ciphertext(input: &[u8]) -> Option<SecretBytes> {
    let plaintext = unipass::decrypt(input)?;
    transform(plaintext.as_ref())
}

#[cfg(test)]
mod tests {
    use super::{transform, transform_ciphertext};

    #[test]
    fn transform_known_vectors() {
        assert_eq!(
            transform(b"jupiter-vector").as_deref(),
            Some(
                b"B62B2541A86858225F71CC0DCDEB18A7E85D2AC9C256100F2FA6060D73D617B21E18896ECEC80C84"
                    .as_slice()
            ),
        );
        assert_eq!(
            transform("密碼-テスト-🔐".as_bytes()).as_deref(),
            Some(
                b"B7274339ED75BE2F4F61B5350D1B71D723EE463D67762CD224E3C09B8A9ED9671E18896ECEC80C84"
                    .as_slice()
            ),
        );
    }

    #[test]
    fn combined_transform_matches_the_two_stage_protocol() {
        assert_eq!(
            transform_ciphertext(b"qXQ6Dp8ayFvr6nTNcQFSTA==").as_deref(),
            Some(
                b"0A98F2E95077EA703D622EF7F27392D9FC95129137121CA21F52D036DFCE81F81E18896ECEC80C84"
                    .as_slice()
            ),
        );
        assert!(transform_ciphertext(b"not-base64").is_none());
    }
}
