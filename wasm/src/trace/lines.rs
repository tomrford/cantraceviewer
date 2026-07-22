#[cfg(feature = "simd-newlines")]
use std::simd::{Simd, cmp::SimdPartialEq};

#[cfg(any(feature = "simd-newlines", test))]
const SIMD_BYTES: usize = 16;

#[cfg(not(feature = "simd-newlines"))]
pub(crate) fn byte_lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes.split(|&byte| byte == b'\n')
}

#[cfg(feature = "simd-newlines")]
pub(crate) fn byte_lines(bytes: &[u8]) -> ByteLines<'_> {
    ByteLines {
        remaining: Some(bytes),
    }
}

#[cfg(feature = "simd-newlines")]
pub(crate) struct ByteLines<'a> {
    remaining: Option<&'a [u8]>,
}

#[cfg(feature = "simd-newlines")]
impl<'a> Iterator for ByteLines<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<Self::Item> {
        let remaining = self.remaining.take()?;
        if let Some(newline) = find_newline(remaining) {
            self.remaining = Some(&remaining[newline + 1..]);
            return Some(&remaining[..newline]);
        }

        Some(remaining)
    }
}

#[cfg(feature = "simd-newlines")]
fn find_newline(bytes: &[u8]) -> Option<usize> {
    let needle = Simd::<u8, SIMD_BYTES>::splat(b'\n');
    let mut offset = 0;

    while offset + SIMD_BYTES <= bytes.len() {
        let chunk = Simd::<u8, SIMD_BYTES>::from_slice(&bytes[offset..offset + SIMD_BYTES]);
        let matches = chunk.simd_eq(needle).to_bitmask();
        if matches != 0 {
            return Some(offset + matches.trailing_zeros() as usize);
        }
        offset += SIMD_BYTES;
    }

    bytes[offset..]
        .iter()
        .position(|&byte| byte == b'\n')
        .map(|index| offset + index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_slice_split_for_parser_relevant_inputs() {
        for bytes in [
            &b""[..],
            &b"one"[..],
            &b"one\n"[..],
            &b"\none\n\ntwo"[..],
            &b"0123456789abcdef\n0123456789abcdefg"[..],
        ] {
            assert_eq!(
                byte_lines(bytes).collect::<Vec<_>>(),
                bytes.split(|&byte| byte == b'\n').collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn finds_newlines_at_every_simd_alignment() {
        for newline in 0..SIMD_BYTES * 4 {
            let mut bytes = vec![b'x'; SIMD_BYTES * 4];
            bytes[newline] = b'\n';
            assert_eq!(
                byte_lines(&bytes).collect::<Vec<_>>(),
                bytes.split(|&byte| byte == b'\n').collect::<Vec<_>>()
            );
        }
    }
}
