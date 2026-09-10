#![forbid(unsafe_op_in_unsafe_fn)]

mod abi;
mod generated_material {
    include!(concat!(env!("OUT_DIR"), "/generated_material.rs"));
}
#[path = "engine.rs"]
mod jupiter;
mod secret;
#[path = "decoder.rs"]
mod unipass;
