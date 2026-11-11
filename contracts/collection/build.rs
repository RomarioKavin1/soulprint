//! A5: the piece code hash is a compile-time constant of the collection wasm.
//! `scripts/build.sh` builds `res/piece.wasm` before the collection. Without it (plain
//! `cargo test`) the hash is all zeros, which no published global contract can match.
use std::{env, fs, path::Path};

fn main() {
    let wasm = Path::new(env!("CARGO_MANIFEST_DIR")).join("../res/piece.wasm");
    println!("cargo:rerun-if-changed={}", wasm.display());
    let hash: [u8; 32] = match fs::read(&wasm) {
        Ok(bytes) => {
            use sha2::Digest;
            sha2::Sha256::digest(&bytes).into()
        }
        Err(_) => [0u8; 32],
    };
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("piece_code_hash.rs");
    fs::write(out, format!("pub const PIECE_CODE_HASH: [u8; 32] = {hash:?};\n")).unwrap();
}
