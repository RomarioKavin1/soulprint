/**
 * Capture keys live on this device (Plan 2 amendment): WebCrypto Ed25519 non-extractable where
 * supported, else a noble key whose seed is wrapped by a non-extractable AES-GCM key. Keyed by
 * public key, because the key exists before the piece does.
 */
import { hex, nearPublicKey, nobleSigner, signerFromKeyPair, webCryptoSigner, type Signer } from "@soulprint/proof";

const DB = "soulprint-keys";
const STORE = "keys";

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(v: any) {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(v);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function get(id: string): Promise<any> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE).objectStore(STORE).get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function wrapKey(): Promise<CryptoKey> {
  const w = await get("wrap");
  if (w) return w.key;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await put({ id: "wrap", key });
  return key;
}

/** A new capture key, stored on this device. Returns its `ed25519:…` public key and signer. */
export async function newCaptureKey(): Promise<{ publicKey: string; signer: Signer }> {
  const wc = await webCryptoSigner().catch(() => null);
  if (wc) {
    const publicKey = nearPublicKey(wc.signer.publicKey);
    await put({ id: publicKey, kind: "webcrypto", keyPair: wc.keyPair, pub: hex.encode(wc.signer.publicKey) });
    return { publicKey, signer: wc.signer };
  }
  return importSeed(crypto.getRandomValues(new Uint8Array(32)));
}

/** Sandbox only: store a known seed (the demo capture key from config). */
export async function importSeed(seed: Uint8Array): Promise<{ publicKey: string; signer: Signer }> {
  const signer = await nobleSigner(seed);
  const publicKey = nearPublicKey(signer.publicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(), seed as Uint8Array<ArrayBuffer>));
  await put({ id: publicKey, kind: "noble", iv, ct });
  return { publicKey, signer };
}

/** The signer for a capture key held on this device, or null. */
export async function loadCaptureKey(publicKey: string): Promise<Signer | null> {
  const r = await get(publicKey).catch(() => null);
  if (!r) return null;
  if (r.kind === "webcrypto") return signerFromKeyPair(r.keyPair, hex.decode(r.pub));
  const seed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv }, await wrapKey(), r.ct));
  return nobleSigner(seed);
}
