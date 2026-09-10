use std::env;
use std::fs;
use std::path::PathBuf;

const U_PART_A: [u8; 16] = [
    0x3b, 0x91, 0x52, 0xe7, 0x0c, 0x4a, 0x2d, 0xb4, 0x71, 0xc8, 0x36, 0x05, 0xa9, 0x6f, 0x1c, 0xd2,
];
const U_PART_B: [u8; 16] = [
    0x6d, 0xc4, 0x90, 0xaf, 0x94, 0x71, 0x85, 0x5a, 0xcb, 0xf8, 0xec, 0xc9, 0x99, 0xf7, 0xb7, 0x0c,
];
const J_PART_A: [u8; 8] = [0x19, 0xa4, 0x2d, 0x73, 0x88, 0x0c, 0xe1, 0x4a];
const J_PART_B: [u8; 8] = [0x69, 0xcc, 0x42, 0x16, 0xe6, 0x65, 0x99, 0x15];

struct Stream(u64);

impl Stream {
    fn new(seed: &str) -> Self {
        let mut state = 0xcbf2_9ce4_8422_2325u64;
        for byte in seed.as_bytes() {
            state ^= u64::from(*byte);
            state = state.wrapping_mul(0x1000_0000_01b3);
        }
        Self(state.max(1))
    }

    fn next(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value.max(1);
        value
    }

    fn byte(&mut self) -> u8 {
        self.next() as u8
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=UNIPASS_HARDEN_SEED");
    println!("cargo:rerun-if-changed=build.rs");

    let seed = env::var("UNIPASS_HARDEN_SEED").unwrap_or_else(|_| "stable-v1".to_owned());
    let mut stream = Stream::new(&seed);
    let strategy = (stream.next() % 4) as usize;
    let unipass = generate_material(&mut stream, &U_PART_A, &U_PART_B, "U", strategy);
    let jupiter = generate_material(&mut stream, &J_PART_A, &J_PART_B, "J", strategy);

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    fs::write(
        out.join("generated_material.rs"),
        format!("{unipass}\n{jupiter}\n"),
    )
    .expect("write generated credential material");
}

fn generate_material<const N: usize>(
    stream: &mut Stream,
    left: &[u8; N],
    right: &[u8; N],
    prefix: &str,
    strategy: usize,
) -> String {
    let fragment_count = 3 + (stream.next() % 3) as usize;
    let mut encoded = [0u8; N];
    let mut rotate = [0u8; N];
    let mut offset = [0u8; N];
    let mut order = [0u8; N];
    for index in 0..N {
        let raw = left[index] ^ right[index];
        rotate[index] = stream.byte() % 8;
        offset[index] = stream.byte();
        encoded[index] = match strategy {
            1 => raw
                .wrapping_add(offset[index])
                .rotate_left(u32::from(rotate[index])),
            3 => raw.rotate_left(u32::from(rotate[index])) ^ offset[index],
            _ => raw
                .rotate_left(u32::from(rotate[index]))
                .wrapping_add(offset[index]),
        };
        order[index] = index as u8;
    }
    for index in (1..N).rev() {
        let swap = (stream.next() as usize) % (index + 1);
        order.swap(index, swap);
    }

    let mut fragments = vec![vec![0u8; N]; fragment_count];
    for fragment in fragments.iter_mut().take(fragment_count - 1) {
        for byte in fragment.iter_mut() {
            *byte = stream.byte();
        }
    }
    for index in 0..N {
        let slot = order[index] as usize;
        let value = match strategy {
            1 => {
                let sum = fragments
                    .iter()
                    .take(fragment_count - 1)
                    .fold(0u8, |acc, fragment| acc.wrapping_add(fragment[slot]));
                encoded[index].wrapping_sub(sum)
            }
            _ => {
                let mut value = encoded[index];
                for fragment in fragments.iter().take(fragment_count - 1) {
                    value ^= fragment[slot];
                }
                value
            }
        };
        fragments[fragment_count - 1][slot] = value;
    }

    let mut output = String::new();
    output.push_str(&format!(
        "const {prefix}_FRAGMENTS: [[u8; {N}]; {fragment_count}] = [\n"
    ));
    for fragment in &fragments {
        output.push_str("    [");
        for byte in fragment {
            output.push_str(&format!("0x{byte:02x}, "));
        }
        output.push_str("],\n");
    }
    output.push_str("];\n");
    output.push_str(&format!("const {prefix}_ORDER: [u8; {N}] = ["));
    for byte in order {
        output.push_str(&format!("{byte}, "));
    }
    output.push_str("];\n");
    output.push_str(&format!("const {prefix}_ROTATE: [u8; {N}] = ["));
    for byte in rotate {
        output.push_str(&format!("{byte}, "));
    }
    output.push_str("];\n");
    output.push_str(&format!("const {prefix}_OFFSET: [u8; {N}] = ["));
    for byte in offset {
        output.push_str(&format!("0x{byte:02x}, "));
    }
    output.push_str("];\n");
    output.push_str(&format!(
        "pub(crate) fn {prefix_lower}_key() -> zeroize::Zeroizing<[u8; {N}]> {{\n    crate::secret::reconstruct::<{strategy}, {N}, {fragment_count}>(&{prefix}_FRAGMENTS, &{prefix}_ORDER, &{prefix}_ROTATE, &{prefix}_OFFSET)\n}}\n",
        prefix_lower = prefix.to_lowercase(),
    ));
    output
}
