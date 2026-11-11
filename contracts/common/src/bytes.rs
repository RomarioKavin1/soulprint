use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{de, Deserialize, Deserializer, Serialize, Serializer};

macro_rules! fixed_bytes {
    ($name:ident, $n:expr) => {
        /// Fixed-size bytes: borsh as a raw array, JSON as a base64 string (length checked, A34).
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize)]
        #[borsh(crate = "near_sdk::borsh")]
        pub struct $name(pub [u8; $n]);

        impl $name {
            pub const ZERO: Self = Self([0u8; $n]);
        }

        impl Default for $name {
            fn default() -> Self {
                Self::ZERO
            }
        }

        impl core::fmt::Debug for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                write!(f, "{}(", stringify!($name))?;
                for b in &self.0[..4] {
                    write!(f, "{b:02x}")?;
                }
                write!(f, "…)")
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(&STANDARD.encode(self.0))
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let s = <String as Deserialize>::deserialize(d)?;
                let v = STANDARD.decode(s.as_bytes()).map_err(de::Error::custom)?;
                let arr: [u8; $n] = v
                    .try_into()
                    .map_err(|v: Vec<u8>| de::Error::custom(format!("expected {} bytes, got {}", $n, v.len())))?;
                Ok(Self(arr))
            }
        }

    };
}

fixed_bytes!(Bytes32, 32);
fixed_bytes!(Bytes64, 64);
