//! Soulprint piece: one account per artwork. Logic lives in the pure `core`; `contract` adapts it to NEAR.
pub mod contract;
pub mod core;
pub mod views;

#[cfg(test)]
mod contract_tests;
