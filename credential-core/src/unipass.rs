use aes::Aes128;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use cipher::{BlockDecryptMut, KeyInit, block_padding::Pkcs7};
use ecb::Decryptor;

use crate::secret::{SecretBytes, reconstruct};

const U_PART_A: [u8; 16] = [
    0x3b, 0x91, 0x52, 0xe7, 0x0c, 0x4a, 0x2d, 0xb4, 0x71, 0xc8, 0x36, 0x05, 0xa9, 0x6f, 0x1c, 0xd2,
];
const U_PART_B: [u8; 16] = [
    0x6d, 0xc4, 0x90, 0xaf, 0x94, 0x71, 0x85, 0x5a, 0xcb, 0xf8, 0xec, 0xc9, 0x99, 0xf7, 0xb7, 0x0c,
];

pub(crate) fn decrypt(input: &[u8]) -> Option<SecretBytes> {
    let encoded = std::str::from_utf8(input).ok()?;
    let ciphertext = zeroize::Zeroizing::new(STANDARD.decode(encoded).ok()?);
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        return None;
    }

    let key = reconstruct::<16>(&U_PART_A, &U_PART_B);
    let decryptor = Decryptor::<Aes128>::new_from_slice(key.as_ref()).ok()?;
    let plaintext = zeroize::Zeroizing::new(
        decryptor
            .decrypt_padded_vec_mut::<Pkcs7>(ciphertext.as_ref())
            .ok()?,
    );
    if plaintext.is_empty() || std::str::from_utf8(plaintext.as_ref()).is_err() {
        return None;
    }
    Some(SecretBytes::from_zeroizing(plaintext))
}

pub(crate) fn available(input: &[u8]) -> Option<bool> {
    let plaintext = decrypt(input)?;
    let text = std::str::from_utf8(plaintext.as_ref()).ok()?;
    Some(!text.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::{available, decrypt};

    #[test]
    fn decrypt_known_vectors() {
        assert_eq!(
            decrypt(b"qXQ6Dp8ayFvr6nTNcQFSTA==").as_deref(),
            Some(b"secret".as_slice())
        );
        assert_eq!(
            decrypt(b"Pmk6dj+RntHdqMPur13rffREbLL31Ehmd+QutyJOvXA=").as_deref(),
            Some("密碼-テスト-🔐".as_bytes()),
        );
    }

    #[test]
    fn rejects_malformed_ciphertext_and_bad_padding() {
        assert!(decrypt(b"").is_none());
        assert!(decrypt(b"not-base64").is_none());
        assert!(decrypt(b"AAAAAAAAAAAAAAAAAAAAAA==").is_none());
        assert!(decrypt(&[0xff, 0xfe]).is_none());
    }

    #[test]
    fn availability_distinguishes_empty_unicode_and_invalid_values() {
        assert_eq!(available(b"qXQ6Dp8ayFvr6nTNcQFSTA=="), Some(true));
        assert_eq!(available(b"2+AUDpl4nB2/MyEs+o1Uwg=="), Some(false));
        assert!(available(b"AAAAAAAAAAAAAAAAAAAAAA==").is_none());
    }
}
