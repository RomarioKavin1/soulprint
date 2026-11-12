/** Evidence service HTTP API (Plan 2 Task 3). */
import { join } from "node:path";
import sharp from "sharp";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
import * as ed from "@noble/ed25519";
import {
  anchorMessage, b64, batchMessage, challengeAckMessage, eq, hex, nearPublicKey, parseNearPublicKey, verifyChain, type FrameMeta,
} from "@soulprint/proof";
import { authenticate, AuthError, issueSession, sessionKey, verifySession } from "./auth.ts";
import { BlobStore } from "./blob.ts";
import type { ChainReader, PieceWithSegments } from "./chain.ts";

type Piece = PieceWithSegments & { client: string | null };
import { openDb, type Db } from "./db.ts";
import type { Sender } from "./sender.ts";
import { evaluateChallenge, newCode, nonceHashOf, TesseractOcr, type Ocr } from "./challenge.ts";
import { jcs } from "./jcs.ts";
import { computeMetrics } from "./metrics/index.ts";
import { band, CLOCK_SKEW_MS } from "./metrics/activity.ts";
import { THRESHOLDS } from "./metrics/thresholds.ts";
import { decideLevel, signReport } from "./report.ts";
import { NOTE_RULES, NoteError, SHOWN_SQL, noteStatus, validateNote, validateRating, validateResponse } from "./context-notes.ts";
import { nobleSigner, segmentsDigest, tokenIdOf } from "@soulprint/proof";

export interface Deps {
  chain: ChainReader;
  sender: Sender;
  /** Data directory for the database and blobs; database is in-memory when `memoryDb`. */
  dataDir: string;
  memoryDb?: boolean;
  masterKey: Uint8Array;
  /** NEP-413 recipient this service accepts. */
  recipient: string;
  now: () => number;
  /** Anchor cadence (Plan 2): every N frames or T ms, whichever first. */
  anchorEveryFrames?: number;
  anchorEveryMs?: number;
  /** NEAR network name written into ReportMessage (must equal the collection's). */
  network: string;
  collection: string;
  /** Verifier key registered in the collection (A7). */
  verifier: { seed: Uint8Array; keyId: number };
  ocr?: Ocr;
  challengeWindowMs?: number;
  /** Reader notes one account may add per rolling 24 h (default NOTE_RULES.maxNotesPerDay). */
  maxNotesPerDay?: number;
}

export const MAX_BATCH = 100;
const OPEN_STATUSES = new Set(["Offered", "InProgress"]);

/** Parsed JSON body (shape is checked field by field in each handler). */
const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, any>;

class HttpError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

/** Plan 2 review M1: client-supplied base64 → bytes, or 400 (optionally of an exact length). */
function bytesOf(v: unknown, code: string, len?: number): Uint8Array {
  let out: Uint8Array;
  try {
    out = b64.decode(String(v ?? ""));
  } catch {
    throw new HttpError(400, code);
  }
  if (len != null && out.length !== len) throw new HttpError(400, code);
  return out;
}
/** ed25519 verify that answers false (→ 401) instead of throwing on malformed input. */
function verifySig(sig: Uint8Array, msg: Uint8Array, key: Uint8Array): boolean {
  try {
    return ed.verify(sig, msg, key);
  } catch {
    return false;
  }
}
async function decodes(img: Uint8Array): Promise<boolean> {
  try {
    await sharp(img).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export interface App extends FastifyInstance {
  db: Db;
  blobs: BlobStore;
}

export async function buildApp(d: Deps): Promise<App> {
  const db = await openDb(d.memoryDb === false ? join(d.dataDir, "pg") : undefined);
  const blobs = new BlobStore(join(d.dataDir, "blobs"), d.masterKey, db);
  const everyFrames = d.anchorEveryFrames ?? 20;
  const everyMs = d.anchorEveryMs ?? 30 * 60_000;
  const app = Fastify({ bodyLimit: 64 * 1024 * 1024 }) as unknown as App;
  app.decorate("db", db);
  app.decorate("blobs", blobs);

  // Keep the raw body: NEP-413 auth signs its hash.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body === "" ? {} : JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.setErrorHandler((e: any, _req, reply) => {
    if (e instanceof HttpError) return reply.code(e.status).send({ error: e.code, ...e.extra });
    if (e instanceof AuthError) return reply.code(e.status).send({ error: e.code });
    if (e instanceof NoteError) return reply.code(e.status).send({ error: e.code });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.code ?? "bad_request", message: e.message });
    if (e.statusCode === 503) return reply.code(503).send({ error: e.code ?? "unavailable" });
    app.log.error(e);
    console.error(`[evidence] ${_req.method} ${_req.url} failed:`, e?.stack ?? e);
    return reply.code(500).send({ error: "internal" });
  });

  const useNonce = async (nonce: Uint8Array) => {
    const r = await db.query("INSERT INTO nonces (nonce, at) VALUES ($1, $2) ON CONFLICT DO NOTHING", [nonce, d.now()]);
    return (r.affectedRows ?? 0) === 1;
  };
  const sessions = sessionKey(d.masterKey);
  const signed = (req: FastifyRequest) =>
    authenticate({ chain: d.chain, recipient: d.recipient, now: d.now, useNonce }, req.headers.authorization, req.method, req.url, (req as any).rawBody ?? "");
  /** NEP-413 per request, or a session minted by one (Plan 3 review I2). */
  const who = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith("Session ") ? verifySession(sessions, h, d.now()) : signed(req);
  };
  const maybeWho = async (req: FastifyRequest) => (req.headers.authorization ? who(req) : null);

  /**
   * Plan 2 review I7: on a commission the private side (brief, messages, client-visible frames,
   * the private report) belongs to the artist and the commissioning client. The client is pinned
   * the first time the service sees the piece while the commission is live; later owners (resale)
   * do not inherit it. Standalone pieces have no commission client: the current owner stands in.
   */
  const LIVE = ["InProgress", "Delivered", "Disputed"];
  const piece = async (id: string): Promise<Piece> => {
    const p = await d.chain.piece(id);
    if (!p) throw new HttpError(404, "unknown_piece");
    if (p.mode !== "Commission") return { ...p, client: p.owner };
    let client = (await db.query<{ account: string }>("SELECT account FROM piece_clients WHERE piece_id = $1", [p.pieceId])).rows[0]?.account ?? null;
    if (!client && LIVE.includes(p.status) && p.owner !== p.artist) {
      await db.query("INSERT INTO piece_clients (piece_id, account) VALUES ($1, $2) ON CONFLICT DO NOTHING", [p.pieceId, p.owner]);
      client = p.owner;
    }
    return { ...p, client };
  };
  /** "owner" here means the client side of the commission (see `piece`). */
  const role = (p: Piece, account: string | null) =>
    account === p.artist ? "artist" : account !== null && account === p.client ? "owner" : "other";
  const requireRole = (p: Piece, account: string, allowed: ("artist" | "owner")[]) => {
    if (!allowed.includes(role(p, account) as "artist")) throw new HttpError(403, "forbidden");
  };
  const segmentFor = (p: PieceWithSegments, keyStr: string) => {
    let key: Uint8Array;
    try {
      key = parseNearPublicKey(keyStr);
    } catch {
      throw new HttpError(400, "bad_key");
    }
    const seg = p.segments.find((s) => eq(s.key, key));
    if (!seg) throw new HttpError(401, "unknown_key");
    return seg;
  };

  // ---------------- frames ----------------

  app.post<{ Params: { id: string }; Body: any }>("/pieces/:id/frames", async (req) => {
    const p = await piece(req.params.id);
    const b = body(req);
    if (!OPEN_STATUSES.has(p.status)) throw new HttpError(409, "capture_closed", { status: p.status });
    const seg = segmentFor(p, b.key);
    const keyHex = hex.encode(seg.key);
    const frames: any[] = Array.isArray(b.frames) ? b.frames : [];
    const from = b.fromIndex, to = b.toIndex;
    if (!isIndex(from) || !isIndex(to) || !frames.length || frames.length > MAX_BATCH || to - from + 1 !== frames.length
      || frames.some((f, i) => typeof f !== "object" || f === null || f.index !== from + i || !Number.isFinite(Number(f.deviceTs))))
      throw new HttpError(400, "bad_batch");
    const metas: (FrameMeta & { raw: any; jpeg: Uint8Array | null })[] = frames.map((f) => ({
      index: f.index, deviceTs: Number(f.deviceTs), jpegHash: bytesOf(f.jpegHash, "bad_frame", 32), link: bytesOf(f.link, "bad_frame", 32),
      jpeg: f.jpeg ? bytesOf(f.jpeg, "bad_frame") : null, raw: f,
    }));
    const head = metas.at(-1)!.link;
    if (!verifySig(bytesOf(b.sig, "bad_signature_format", 64), batchMessage({ pieceId: p.pieceId, key: seg.key, fromIndex: from, toIndex: to, head }), seg.key))
      throw new HttpError(401, "bad_signature");
    const anchorSig = bytesOf(b.anchorSig, "bad_signature_format", 64);
    if (!verifySig(anchorSig, anchorMessage({ pieceId: p.pieceId, head, count: to + 1 }), seg.key))
      throw new HttpError(401, "bad_anchor_signature");
    for (const m of metas) if (m.jpeg && !eq(sha256(m.jpeg), m.jpegHash)) throw new HttpError(409, "image_hash_mismatch", { index: m.index });

    const count = Number((await db.query<{ n: number | null }>("SELECT max(idx) + 1 AS n FROM frames WHERE piece_id = $1 AND key_hex = $2", [p.pieceId, keyHex])).rows[0]?.n ?? 0);
    if (from > count) throw new HttpError(409, "gap", { expectedFrom: count });
    const prev = from === 0
      ? seg.genesis
      : (await db.query<{ link: Uint8Array }>("SELECT link FROM frames WHERE piece_id = $1 AND key_hex = $2 AND idx = $3", [p.pieceId, keyHex, from - 1])).rows[0]!.link;
    const v = verifyChain(metas, prev);
    if (!v.ok) throw new HttpError(409, "chain_break", { index: from + v.brokenAt });
    const known = await db.query<{ idx: number; link: Uint8Array }>(
      "SELECT idx, link FROM frames WHERE piece_id = $1 AND key_hex = $2 AND idx BETWEEN $3 AND $4", [p.pieceId, keyHex, from, to]);
    for (const k of known.rows) if (!eq(k.link, metas[k.idx - from]!.link)) throw new HttpError(409, "conflict", { index: k.idx });
    const fresh = metas.filter((m) => m.index >= count);
    const reused = new Set<number>();
    for (const m of fresh) {
      const other = await db.query("SELECT 1 FROM frames WHERE jpeg_hash = $1 AND piece_id <> $2 LIMIT 1", [m.jpegHash, p.pieceId]);
      if (other.rows.length) reused.add(m.index);
    }
    // Review M8: flag images that do not decode (kept: the hash chain is valid; the report skips
    // and counts them) so the capture app can warn while the artist is still recording.
    const undecodable: number[] = [];
    for (const m of fresh) {
      if (m.jpeg && !(await decodes(m.jpeg))) undecodable.push(m.index);
    }
    for (const m of fresh) {
      const blob = m.jpeg ? await blobs.put(p.pieceId, `${keyHex}-${m.index}.jpg`, m.jpeg) : null;
      await db.query(
        `INSERT INTO frames (piece_id, key_hex, idx, session_id, device_ts, jpeg_hash, link, width, height, blob_key, discarded, received_at, reused)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
        [p.pieceId, keyHex, m.index, String(m.raw.sessionId ?? ""), m.deviceTs, m.jpegHash, m.link, m.raw.width | 0, m.raw.height | 0, blob, !m.jpeg, d.now(), reused.has(m.index)],
      );
    }
    await db.query("INSERT INTO anchor_sigs (piece_id, key_hex, count, head, sig) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [p.pieceId, keyHex, to + 1, head, anchorSig]);
    const newCount = Math.max(count, to + 1);
    const anchored = await maybeAnchor(p.pieceId, seg.key, newCount, false);
    return { stored: fresh.length, count: newCount, anchored, reused: [...reused], undecodable };
  });

  /** Submit the newest signed head if the cadence (or `force`) says so. Never fails the caller. */
  async function maybeAnchor(pieceId: string, key: Uint8Array, count: number, force: boolean) {
    const keyHex = hex.encode(key);
    const last = (await db.query<{ count: number; at: number }>(
      "SELECT count, at FROM anchors WHERE piece_id = $1 AND key_hex = $2 ORDER BY count DESC LIMIT 1", [pieceId, keyHex])).rows[0];
    const since = last ? Number(last.at)
      : Number((await db.query<{ t: number }>("SELECT min(received_at) AS t FROM frames WHERE piece_id = $1 AND key_hex = $2", [pieceId, keyHex])).rows[0]?.t ?? d.now());
    const lastCount = last?.count ?? 0;
    if (count <= lastCount) return null;
    if (!force && count - lastCount < everyFrames && d.now() - since < everyMs) return null;
    // Review I2: a built report names the anchored head; a cadence anchor would move it before delivery.
    if (!force && (await db.query("SELECT 1 FROM reports WHERE piece_id = $1", [pieceId])).rows.length) return null;
    const cand = (await db.query<{ count: number; head: Uint8Array; sig: Uint8Array }>(
      "SELECT count, head, sig FROM anchor_sigs WHERE piece_id = $1 AND key_hex = $2 AND count <= $3 ORDER BY count DESC LIMIT 1",
      [pieceId, keyHex, count])).rows[0];
    if (!cand || cand.count <= lastCount) return null;
    try {
      const { txHash } = await d.sender.anchor({ pieceId, key: nearPublicKey(key), head: b64.encode(cand.head), count: cand.count, sig: b64.encode(cand.sig) });
      await db.query("INSERT INTO anchors (piece_id, key_hex, count, tx_hash, at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [pieceId, keyHex, cand.count, txHash, d.now()]);
      return { count: cand.count, txHash };
    } catch (e) {
      app.log.warn({ e, pieceId }, "anchor failed; will retry on next batch");
      if (force) throw new HttpError(502, "anchor_failed");
      return null;
    }
  }

  app.post<{ Params: { id: string } }>("/pieces/:id/anchor/final", async (req) => {
    const p = await piece(req.params.id);
    requireRole(p, await who(req), ["artist"]);
    const anchored = [];
    for (const s of p.segments) {
      const keyHex = hex.encode(s.key);
      const n = Number((await db.query<{ n: number | null }>("SELECT max(idx) + 1 AS n FROM frames WHERE piece_id = $1 AND key_hex = $2", [p.pieceId, keyHex])).rows[0]?.n ?? 0);
      const r = n > 0 ? await maybeAnchor(p.pieceId, s.key, n, true) : null;
      anchored.push({ key: nearPublicKey(s.key), count: n, txHash: r?.txHash ?? null });
    }
    return { anchored };
  });

  app.post<{ Params: { id: string }; Body: any }>("/pieces/:id/discard", async (req) => {
    const p = await piece(req.params.id);
    const seg = segmentFor(p, body(req).key);
    const indices: number[] = (body(req).indices ?? []).map(Number);
    const msg = new TextEncoder().encode(`soulprint-discard-v1:${p.pieceId}:${indices.join(",")}`);
    if (!indices.every(isIndex)) throw new HttpError(400, "bad_indices");
    if (!verifySig(bytesOf(body(req).sig, "bad_signature_format", 64), msg, seg.key)) throw new HttpError(401, "bad_signature");
    const keyHex = hex.encode(seg.key);
    const rows = await db.query<{ idx: number; blob_key: string | null }>(
      "SELECT idx, blob_key FROM frames WHERE piece_id = $1 AND key_hex = $2 AND idx = ANY($3::int[])", [p.pieceId, keyHex, indices]);
    for (const r of rows.rows) if (r.blob_key) blobs.del(r.blob_key);
    await db.query("UPDATE frames SET discarded = true, blob_key = NULL WHERE piece_id = $1 AND key_hex = $2 AND idx = ANY($3::int[])", [p.pieceId, keyHex, indices]);
    return { discarded: rows.rows.map((r) => r.idx) };
  });

  app.post<{ Params: { id: string }; Body: any }>("/pieces/:id/visibility", async (req) => {
    const p = await piece(req.params.id);
    requireRole(p, await who(req), ["artist"]);
    const level = String(body(req).level);
    if (!["private", "client", "public"].includes(level)) throw new HttpError(400, "bad_level");
    const seg = body(req).key ? segmentFor(p, body(req).key) : p.segments[0];
    if (!seg) throw new HttpError(409, "no_capture_key");
    const indices: number[] = (body(req).indices ?? []).map(Number);
    await db.query("UPDATE frames SET visibility = $1 WHERE piece_id = $2 AND key_hex = $3 AND idx = ANY($4::int[])", [level, p.pieceId, hex.encode(seg.key), indices]);
    return { ok: true };
  });

  const frameJson = async (pieceId: string, r: any, withImage: boolean) => ({
    key: nearPublicKey(hex.decode(r.key_hex)), index: r.idx, sessionId: r.session_id, deviceTs: Number(r.device_ts),
    jpegHash: b64.encode(r.jpeg_hash), link: b64.encode(r.link), width: r.width, height: r.height,
    visibility: r.visibility, discarded: r.discarded, reused: r.reused,
    jpeg: withImage && r.blob_key ? b64.encode((await blobs.get(pieceId, r.blob_key)) ?? new Uint8Array()) : null,
  });

  /** Client progress (approved frames) or the artist's full view, decrypted for authorised viewers. */
  /** Paged (Plan 3 review I6): `total` for pagers, `order=desc` for "newest first". */
  app.get<{ Params: { id: string }; Querystring: { from?: string; limit?: string; images?: string; order?: string } }>("/pieces/:id/progress", async (req) => {
    const p = await piece(req.params.id);
    const r = role(p, await who(req));
    if (r === "other") throw new HttpError(403, "forbidden");
    const limit = Math.max(0, Math.min(Number(req.query.limit ?? 200) || 0, 500)), from = Math.max(0, Number(req.query.from ?? 0) || 0);
    const where = `piece_id = $1 ${r === "owner" ? "AND visibility IN ('client','public')" : ""}`;
    const dir = req.query.order === "desc" ? "DESC" : "ASC";
    const rows = await db.query<any>(`SELECT * FROM frames WHERE ${where} ORDER BY key_hex ${dir}, idx ${dir} OFFSET $2 LIMIT $3`, [p.pieceId, from, limit]);
    const total = Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM frames WHERE ${where}`, [p.pieceId])).rows[0]!.n);
    const images = req.query.images !== "0";
    return { role: r, total, frames: await Promise.all(rows.rows.map((x) => frameJson(p.pieceId, x, images))) };
  });

  app.get<{ Params: { id: string; key: string; index: string } }>("/pieces/:id/frames/:key/:index", async (req, reply: FastifyReply) => {
    const p = await piece(req.params.id);
    let key: Uint8Array;
    try {
      key = req.params.key.startsWith("ed25519:") ? parseNearPublicKey(req.params.key) : b64.decode(req.params.key);
    } catch {
      throw new HttpError(400, "bad_key");
    }
    const row = (await db.query<any>("SELECT * FROM frames WHERE piece_id = $1 AND key_hex = $2 AND idx = $3", [p.pieceId, hex.encode(key), Number(req.params.index)])).rows[0];
    if (!row) throw new HttpError(404, "unknown_frame");
    if (row.visibility !== "public") {
      const r = role(p, await maybeWho(req));
      const ok = r === "artist" || (r === "owner" && row.visibility === "client");
      if (!ok) throw new HttpError(403, "forbidden");
    }
    if (row.discarded || !row.blob_key) throw new HttpError(410, "discarded");
    const img = await blobs.get(p.pieceId, row.blob_key);
    if (!img) throw new HttpError(410, "discarded");
    return reply.header("content-type", "image/jpeg").header("cache-control", "private, max-age=3600").send(Buffer.from(img));
  });

  // ---------------- files and notes ----------------

  const FILE_KINDS: Record<string, ("artist" | "owner")[]> = { final: ["artist"], source: ["artist"], story_audio: ["artist"], reference: ["artist", "owner"] };
  app.post<{ Params: { id: string }; Body: any }>("/pieces/:id/files", async (req) => {
    const p = await piece(req.params.id);
    const account = await who(req);
    const kind = String(body(req).kind);
    const allowed = FILE_KINDS[kind];
    if (!allowed) throw new HttpError(400, "bad_kind");
    requireRole(p, account, allowed);
    const data = bytesOf(body(req).data, "bad_data");
    if (kind === "final") {
      // The report compares the final file with the last frames; it must decode the same way.
      try {
        await sharp(data).raw().toBuffer();
      } catch {
        throw new HttpError(400, "not_an_image");
      }
    }
    const hash = sha256(data);
    const name = String(body(req).name ?? kind).slice(0, 200);
    const blob = await blobs.put(p.pieceId, `${kind}-${hex.encode(hash)}`, data);
    const r = await db.query<{ id: number }>("INSERT INTO files (piece_id, kind, name, sha256, blob_key, author, at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [p.pieceId, kind, name, hash, blob, account, d.now()]);
    return { id: r.rows[0]!.id, sha256: b64.encode(hash) };
  });

  // Plan 3 review I5: references are read back by the artist and the commissioning client.
  const READABLE_FILES = new Set(["reference"]);
  app.get<{ Params: { id: string }; Querystring: { kind?: string } }>("/pieces/:id/files", async (req) => {
    const p = await piece(req.params.id);
    const kind = String(req.query.kind ?? "");
    if (!READABLE_FILES.has(kind)) throw new HttpError(400, "bad_kind");
    requireRole(p, await who(req), ["artist", "owner"]);
    const rows = (await db.query<any>("SELECT id, name, sha256, author, at FROM files WHERE piece_id = $1 AND kind = $2 ORDER BY id", [p.pieceId, kind])).rows;
    return { items: rows.map((r) => ({ id: r.id, name: r.name, sha256: b64.encode(r.sha256), author: r.author, at: Number(r.at) })) };
  });
  app.get<{ Params: { id: string; fid: string } }>("/pieces/:id/files/:fid", async (req, reply: FastifyReply) => {
    const p = await piece(req.params.id);
    requireRole(p, await who(req), ["artist", "owner"]);
    const row = (await db.query<any>("SELECT kind, name, blob_key FROM files WHERE piece_id = $1 AND id = $2", [p.pieceId, Number(req.params.fid) || 0])).rows[0];
    if (!row || !READABLE_FILES.has(row.kind)) throw new HttpError(404, "unknown_file");
    const data = await blobs.get(p.pieceId, row.blob_key);
    if (!data) throw new HttpError(410, "gone");
    return reply.header("content-type", "application/octet-stream").header("cache-control", "private, max-age=3600").send(Buffer.from(data));
  });

  const NOTES: Record<string, { write: ("artist" | "owner")[]; read: ("artist" | "owner")[] }> = {
    story: { write: ["artist"], read: ["artist", "owner"] },
    brief: { write: ["artist", "owner"], read: ["artist", "owner"] },
    messages: { write: ["artist", "owner"], read: ["artist", "owner"] },
  };
  for (const [kind, rules] of Object.entries(NOTES)) {
    app.post<{ Params: { id: string }; Body: any }>(`/pieces/:id/${kind}`, async (req) => {
      const p = await piece(req.params.id);
      const account = await who(req);
      requireRole(p, account, rules.write);
      const text = String(body(req).text ?? "").slice(0, 20_000);
      if (!text) throw new HttpError(400, "empty");
      await db.query("INSERT INTO notes (piece_id, kind, author, body, at) VALUES ($1,$2,$3,$4,$5)", [p.pieceId, kind, account, text, d.now()]);
      return { ok: true };
    });
    app.get<{ Params: { id: string } }>(`/pieces/:id/${kind}`, async (req) => {
      const p = await piece(req.params.id);
      requireRole(p, await who(req), rules.read);
      const rows = await db.query<any>("SELECT author, body, at FROM notes WHERE piece_id = $1 AND kind = $2 ORDER BY id", [p.pieceId, kind]);
      const items = rows.rows.map((r) => ({ author: r.author, text: r.body, at: Number(r.at) }));
      return kind === "story" ? { story: items.at(-1) ?? null } : { items };
    });
  }

  // ---------------- challenges (A28) ----------------

  const mayChallenge = (p: PieceWithSegments, account: string) =>
    (p.mode === "Commission" && account === p.owner && p.owner !== p.artist) || p.invites.includes(account);

  app.post<{ Params: { id: string } }>("/pieces/:id/challenges", async (req) => {
    const p = await piece(req.params.id);
    const account = await who(req);
    if (!mayChallenge(p, account)) throw new HttpError(403, "not_challenger");
    const code = newCode(), salt = crypto.getRandomValues(new Uint8Array(16));
    const nonceHash = nonceHashOf(code, salt);
    await db.query("INSERT INTO challenges (piece_id, nonce_hash, code, salt, issuer, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [p.pieceId, nonceHash, code, salt, account, d.now()]);
    // The issuer now calls piece.issue_challenge(nonce_hash) from their own wallet (A48).
    return { nonceHash: b64.encode(nonceHash) };
  });

  app.get<{ Params: { id: string } }>("/pieces/:id/challenges", async (req) => {
    const p = await piece(req.params.id);
    const account = await who(req);
    const isArtist = account === p.artist;
    if (!isArtist && !mayChallenge(p, account)) throw new HttpError(403, "forbidden");
    const rows = (await db.query<any>("SELECT * FROM challenges WHERE piece_id = $1", [p.pieceId])).rows;
    const items = [];
    for (const c of p.challenges) {
      const row = rows.find((r) => eq(r.nonce_hash, c.nonceHash));
      if (!row || (!isArtist && c.issuer !== account)) continue;
      items.push({
        chainId: c.id, nonceHash: b64.encode(c.nonceHash), issuer: c.issuer, issuedAt: c.issuedAt, ackedAt: c.ackedAt,
        ...(isArtist ? { code: row.code } : {}),
      });
    }
    return { items };
  });

  app.post<{ Params: { id: string; cid: string } }>("/pieces/:id/challenges/:cid/ack", async (req) => {
    const p = await piece(req.params.id);
    const cid = Number(req.params.cid);
    const c = p.challenges.find((x) => x.id === cid);
    if (!c) throw new HttpError(404, "unknown_challenge");
    const sig = bytesOf(body(req).sig, "bad_signature_format", 64);
    const msg = challengeAckMessage({ pieceId: p.pieceId, challengeId: cid, nonceHash: c.nonceHash });
    if (!p.segments.some((s) => verifySig(sig, msg, s.key))) throw new HttpError(401, "bad_signature");
    return d.sender.ackChallenge({ pieceId: p.pieceId, challengeId: cid, sig: b64.encode(sig) });
  });

  // ---------------- report and attestation (Task 6) ----------------

  const ocr = d.ocr ?? new TesseractOcr(join(d.dataDir, "ocr"));
  const verifier = await nobleSigner(d.verifier.seed);
  const windowMs = d.challengeWindowMs ?? 10 * 60_000;

  async function* frameStream(pieceId: string, keyHex: string) {
    let from = 0;
    for (;;) {
      const rows = (await db.query<any>("SELECT idx, device_ts, received_at, width, height, blob_key, reused FROM frames WHERE piece_id = $1 AND key_hex = $2 AND idx >= $3 ORDER BY idx LIMIT 50", [pieceId, keyHex, from])).rows;
      if (!rows.length) return;
      for (const r of rows) {
        from = r.idx + 1;
        if (!r.blob_key || r.reused) continue; // discarded (hash only) or reused from another piece
        const jpeg = await blobs.get(pieceId, r.blob_key);
        if (jpeg) yield { jpeg, deviceTs: Number(r.device_ts), receivedAt: Number(r.received_at) };
      }
    }
  }

  /** Review C2 / DESIGN §6.3: frames stamped in the future or earlier than the previous frame. */
  async function timeAnomalies(pieceId: string, keyHex: string): Promise<number> {
    const rows = (await db.query<{ device_ts: string; received_at: string }>(
      "SELECT device_ts, received_at FROM frames WHERE piece_id = $1 AND key_hex = $2 ORDER BY idx", [pieceId, keyHex])).rows;
    let n = 0, prev = -Infinity;
    for (const r of rows) {
      const t = Number(r.device_ts);
      if (t > Number(r.received_at) + CLOCK_SKEW_MS || t < prev) n++;
      prev = Math.max(prev, t);
    }
    return n;
  }

  app.post<{ Params: { id: string } }>("/pieces/:id/report", async (req) => {
    const p = await piece(req.params.id);
    requireRole(p, await who(req), ["artist"]);
    // Review I2: once delivered, the report is the one on chain; rebuilding cannot change it.
    if (["Delivered", "Settled"].includes(p.status) && p.reportHash) {
      const r = (await db.query<any>("SELECT public_json, report_hash, final_file_hash, level FROM reports WHERE piece_id = $1", [p.pieceId])).rows[0];
      if (!r || b64.encode(r.report_hash) !== p.reportHash) throw new HttpError(409, "delivered_report_unknown");
      return { public: JSON.parse(r.public_json), level: r.level, reportHash: p.reportHash, finalFileHash: b64.encode(r.final_file_hash) };
    }
    const final = (await db.query<any>("SELECT sha256, blob_key FROM files WHERE piece_id = $1 AND kind = 'final' ORDER BY id DESC LIMIT 1", [p.pieceId])).rows[0];
    if (!final) throw new HttpError(409, "final_file_missing");
    const finalBytes = (await blobs.get(p.pieceId, final.blob_key))!;
    // Primary capture segment: the key with the most frames.
    const counts = (await db.query<{ key_hex: string; n: number }>("SELECT key_hex, max(idx) + 1 AS n FROM frames WHERE piece_id = $1 GROUP BY key_hex ORDER BY n DESC", [p.pieceId])).rows;
    const primary = counts[0];
    const seg = primary ? p.segments.find((s) => hex.encode(s.key) === primary.key_hex) : undefined;
    if (primary && seg && seg.count < Number(primary.n)) {
      await maybeAnchor(p.pieceId, seg.key, Number(primary.n), true);
      throw new HttpError(409, "anchor_pending", { anchoring: Number(primary.n) });
    }
    // Review I2: the chain must hold our head at that count, not just the count.
    const localHead = primary && seg && seg.count > 0
      ? (await db.query<{ link: Uint8Array }>("SELECT link FROM frames WHERE piece_id = $1 AND key_hex = $2 AND idx = $3", [p.pieceId, primary.key_hex, seg.count - 1])).rows[0]?.link
      : undefined;
    const anchored = !!(primary && seg && seg.count === Number(primary.n) && seg.count > 0 && localHead && eq(localHead, seg.head));
    const source = body(req).source === "camera" ? "camera" : "screen";
    const reusedFrames = primary ? Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM frames WHERE piece_id = $1 AND key_hex = $2 AND reused", [p.pieceId, primary.key_hex])).rows[0]!.n) : 0;
    const m = primary ? await computeMetrics(frameStream(p.pieceId, primary.key_hex), { finalFile: finalBytes, source }) : null;
    const rows = (await db.query<any>("SELECT * FROM challenges WHERE piece_id = $1", [p.pieceId])).rows;
    const challenges = [];
    for (const c of p.challenges) {
      const row = rows.find((r) => eq(r.nonce_hash, c.nonceHash));
      if (!row) continue;
      const result = c.ackedAt == null || !primary ? "not_acknowledged"
        : await evaluateChallenge(frameStream(p.pieceId, primary.key_hex), row.code, c.ackedAt, windowMs, ocr);
      challenges.push({ chainId: c.id, issuerClass: p.invites.includes(c.issuer) ? "invited" : "client", issuer: c.issuer, result, code: row.code, salt: b64.encode(row.salt) });
    }
    const level = decideLevel({
      anchored, frames: m?.frames ?? 0, coverage: m?.coverage ?? 0, largestJump: m?.largestJump ?? 1, activeMs: m?.activeMs ?? 0,
      finalMatch: m?.finalMatch ?? null, passedChallengesByOthers: challenges.filter((c) => c.result === "passed" && c.issuer !== p.artist).length,
    });
    const segments = p.segments.map((s) => ({ key: s.key, head: s.head, count: s.count }));
    const pub = {
      version: "soulprint-report-v1", pieceId: p.pieceId, network: d.network, level, thresholds: THRESHOLDS.id, verifier: "server-not-TEE",
      finalFileHash: b64.encode(final.sha256),
      capture: m && seg ? {
        key: nearPublicKey(seg.key), anchoredHead: b64.encode(seg.head), anchoredCount: seg.count, frames: m.frames, reusedFrames,
        sessions: m.sessions, spanDays: Math.round(m.spanDays * 10) / 10, activeBand: band(m.activeMs),
        coverage: Math.round(m.coverage * 1000) / 1000, largestJump: Math.round(m.largestJump * 1000) / 1000,
        undecodableFrames: m.undecodable, finalMatch: m.finalMatch, source, timeNote: "device time, limited to when the service received each frame", timeAnomalies: await timeAnomalies(p.pieceId, primary!.key_hex),
      } : null,
      challenges: challenges.map(({ issuer: _i, ...c }) => c),
      segmentsDigest: b64.encode(segmentsDigest(segments)),
    };
    const text = jcs(pub);
    const reportHash = sha256(new TextEncoder().encode(text));
    await db.query(
      `INSERT INTO reports (piece_id, public_json, report_hash, final_file_hash, level, capture_key, anchor_head, anchor_count, built_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (piece_id) DO UPDATE SET public_json = EXCLUDED.public_json, report_hash = EXCLUDED.report_hash,
       final_file_hash = EXCLUDED.final_file_hash, level = EXCLUDED.level, capture_key = EXCLUDED.capture_key, anchor_head = EXCLUDED.anchor_head,
       anchor_count = EXCLUDED.anchor_count, built_at = EXCLUDED.built_at`,
      [p.pieceId, text, reportHash, final.sha256, level, seg?.key ?? null, seg?.head ?? null, seg?.count ?? null, d.now()]);
    // The artist now calls deliver(final_file_hash, report_hash).
    return { public: pub, level, reportHash: b64.encode(reportHash), finalFileHash: b64.encode(final.sha256) };
  });

  app.get<{ Params: { id: string } }>("/pieces/:id/report", async (req) => {
    const p = await piece(req.params.id);
    if (role(p, await who(req)) === "other") throw new HttpError(403, "forbidden");
    const r = (await db.query<any>("SELECT public_json, report_hash FROM reports WHERE piece_id = $1", [p.pieceId])).rows[0];
    if (!r) throw new HttpError(404, "no_report");
    return { public: JSON.parse(r.public_json), reportHash: b64.encode(r.report_hash) };
  });

  app.post<{ Params: { id: string } }>("/pieces/:id/attest", async (req) => {
    const p = await piece(req.params.id);
    if (role(p, await who(req)) === "other") throw new HttpError(403, "forbidden");
    if (!["Delivered", "Settled"].includes(p.status) || !p.reportHash) throw new HttpError(409, "not_delivered");
    const r = (await db.query<any>("SELECT * FROM reports WHERE piece_id = $1", [p.pieceId])).rows[0];
    if (!r || b64.encode(r.report_hash) !== p.reportHash || b64.encode(r.final_file_hash) !== p.finalFileHash) throw new HttpError(409, "report_mismatch");
    const capture = r.capture_key ? { key: r.capture_key as Uint8Array, head: r.anchor_head as Uint8Array, count: r.anchor_count as number } : null;
    const signed = await signReport(verifier, {
      network: d.network, pieceId: p.pieceId, finalFileHash: r.final_file_hash, reportHash: r.report_hash, level: r.level,
      capture, segments: p.segments.map((s) => ({ key: s.key, head: s.head, count: s.count })), issuedAt: BigInt(d.now()) * 1_000_000n,
    });
    return d.sender.attest({ collection: d.collection, argsJson: signed.argsJson(tokenIdOf(p.pieceId), d.verifier.keyId) });
  });

  // ---------------- holder vault (Plan 3 Task 5) ----------------

  const VAULT_TTL_MS = 300_000;
  const vaultKey = sha256(new Uint8Array([...d.masterKey, ...new TextEncoder().encode("soulprint-vault-v1")]));
  const vaultSig = (pieceId: string, fileId: number, seq: number, exp: number) =>
    b64url(hmac(sha256, vaultKey, new TextEncoder().encode(`${pieceId}|${fileId}|${seq}|${exp}`)));
  const tokenIdOfPiece = (pieceId: string) => /^p(\d+)\./.exec(pieceId)?.[1] ?? "";

  /** Owner only, read from the piece itself: settled, no transfer in flight (Plan 3 Global Constraints). */
  app.post<{ Params: { id: string } }>("/pieces/:id/vault", async (req) => {
    const p = await piece(req.params.id);
    const account = await who(req);
    const o = await d.chain.ownerInfo(p.pieceId);
    if (!o) throw new HttpError(404, "unknown_piece");
    if (o.owner !== account) throw new HttpError(403, "not_owner");
    if (o.status !== "Settled") throw new HttpError(403, "not_settled");
    if (o.transferPending) throw new HttpError(409, "transfer_pending");
    const tokenId = tokenIdOfPiece(p.pieceId);
    const indexed = await d.chain.indexOwner(d.collection, tokenId).catch(() => null);
    if (indexed !== o.owner) await d.sender.syncOwner({ collection: d.collection, tokenId }).catch(() => undefined); // lag: fix, don't deny
    const exp = d.now() + VAULT_TTL_MS;
    const rows = (await db.query<any>("SELECT id, kind, name, sha256 FROM files WHERE piece_id = $1 AND kind IN ('final','source') ORDER BY id", [p.pieceId])).rows;
    return {
      expiresIn: VAULT_TTL_MS / 1000,
      seq: o.seq,
      files: rows.map((f) => ({
        id: f.id, kind: f.kind, name: f.name, sha256: b64.encode(f.sha256),
        url: `/pieces/${p.pieceId}/vault/${f.id}?seq=${o.seq}&exp=${exp}&sig=${vaultSig(p.pieceId, f.id, o.seq, exp)}`,
      })),
    };
  });

  app.get<{ Params: { id: string; fid: string }; Querystring: { seq?: string; exp?: string; sig?: string } }>("/pieces/:id/vault/:fid", async (req, reply: FastifyReply) => {
    const fileId = Number(req.params.fid), seq = Number(req.query.seq), exp = Number(req.query.exp);
    const expect = vaultSig(req.params.id, fileId, seq, exp);
    if (!req.query.sig || req.query.sig.length !== expect.length || !eq(new TextEncoder().encode(req.query.sig), new TextEncoder().encode(expect))) throw new HttpError(403, "bad_link");
    if (d.now() > exp) throw new HttpError(403, "link_expired");
    const o = await d.chain.ownerInfo(req.params.id);
    if (!o || o.seq !== seq || o.status !== "Settled" || o.transferPending) throw new HttpError(403, "owner_changed");
    const f = (await db.query<any>("SELECT name, blob_key FROM files WHERE id = $1 AND piece_id = $2", [fileId, req.params.id])).rows[0];
    if (!f) throw new HttpError(404, "unknown_file");
    const data = await blobs.get(req.params.id, f.blob_key);
    if (!data) throw new HttpError(410, "gone");
    return reply
      .header("content-type", "application/octet-stream")
      .header("content-disposition", `attachment; filename="${String(f.name).replace(/[^\w.\- ]/g, "_")}"`)
      .header("cache-control", "no-store")
      .send(Buffer.from(data));
  });

  // ---------------- public proof page (Plan 3 Task 4) ----------------

  app.post<{ Params: { id: string } }>("/pieces/:id/publish", async (req) => {
    const p = await piece(req.params.id);
    requireRole(p, await who(req), ["artist"]);
    const on = body(req).published === true;
    const r = await db.query(
      "UPDATE reports SET published = $1, artist = $3, published_at = CASE WHEN $1 THEN $4::bigint ELSE published_at END WHERE piece_id = $2 RETURNING piece_id",
      [on, p.pieceId, p.artist, d.now()],
    );
    if (!r.rows.length) throw new HttpError(409, "no_report");
    return { published: on };
  });

  /**
   * Unauthenticated: published pieces, newest first (the showcase gallery), optionally one artist's.
   * Facts only (level, coverage, sessions), the latest frame the artist made public as a cover, a
   * story excerpt. Never the price.
   */
  app.get<{ Querystring: { artist?: string; limit?: string; before?: string } }>("/gallery", async (req) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 24) || 24, 60));
    // Rows published before the gallery existed have no artist yet: fill them from the chain once.
    for (const r of (await db.query<{ piece_id: string }>("SELECT piece_id FROM reports WHERE published AND artist IS NULL LIMIT 20")).rows) {
      const p = await d.chain.piece(r.piece_id).catch(() => null);
      if (p) await db.query("UPDATE reports SET artist = $1, published_at = COALESCE(published_at, built_at) WHERE piece_id = $2", [p.artist, r.piece_id]);
    }
    const args: unknown[] = [limit];
    let where = "r.published AND r.artist IS NOT NULL";
    if (req.query.artist) {
      args.push(String(req.query.artist));
      where += ` AND r.artist = $${args.length}`;
    }
    if (req.query.before) {
      args.push(Number(req.query.before) || 0);
      where += ` AND r.published_at < $${args.length}`;
    }
    const rows = (await db.query<any>(
      `SELECT r.piece_id, r.artist, r.level, r.public_json, r.published_at,
         (SELECT body FROM notes n WHERE n.piece_id = r.piece_id AND n.kind = 'story' ORDER BY n.id DESC LIMIT 1) AS story,
         (SELECT count(*)::int FROM frames f WHERE f.piece_id = r.piece_id AND f.visibility = 'public' AND NOT f.discarded) AS public_frames,
         (SELECT count(*)::int FROM (
            SELECT (SELECT count(*) FROM context_note_ratings x WHERE x.note_id = c.id AND x.helpful) AS h,
                   (SELECT count(*) FROM context_note_ratings x WHERE x.note_id = c.id) AS t
            FROM context_notes c WHERE c.piece_id = r.piece_id) q WHERE ${SHOWN_SQL("q.h", "q.t")}) AS shown_notes,
         (SELECT f.key_hex || ':' || f.idx FROM frames f WHERE f.piece_id = r.piece_id AND f.visibility = 'public' AND NOT f.discarded AND f.blob_key IS NOT NULL
            ORDER BY f.device_ts DESC, f.idx DESC LIMIT 1) AS cover
       FROM reports r WHERE ${where} ORDER BY r.published_at DESC NULLS LAST LIMIT $1`,
      args,
    )).rows;
    return {
      pieces: rows.map((r) => {
        const pub = JSON.parse(r.public_json);
        const cap = pub.capture ?? null;
        const [keyHex, idx] = r.cover ? String(r.cover).split(":") : [];
        return {
          pieceId: r.piece_id as string,
          artist: r.artist as string,
          level: r.level as 0 | 2 | 3,
          publishedAt: Number(r.published_at ?? 0),
          capture: cap ? { coverage: cap.coverage, activeBand: cap.activeBand, sessions: cap.sessions, spanDays: cap.spanDays, source: cap.source } : null,
          challengesPassed: (pub.challenges ?? []).filter((c: any) => c.result === "passed").length,
          publicFrames: r.public_frames as number,
          cover: keyHex ? { key: nearPublicKey(hex.decode(keyHex)), index: Number(idx) } : null,
          story: r.story ? String(r.story).slice(0, 280) : null,
          contextNotes: r.shown_notes as number,
        };
      }),
    };
  });

  /** Unauthenticated: the published report, the public frames (metadata) and the story. Never the price. */
  app.get<{ Params: { id: string } }>("/pieces/:id/public", async (req) => {
    const p = await piece(req.params.id);
    const r = (await db.query<any>("SELECT public_json, report_hash, published FROM reports WHERE piece_id = $1", [p.pieceId])).rows[0];
    if (!r?.published) throw new HttpError(404, "not_published");
    const frames = (await db.query<any>("SELECT key_hex, idx, device_ts, width, height FROM frames WHERE piece_id = $1 AND visibility = 'public' AND NOT discarded ORDER BY key_hex, idx", [p.pieceId])).rows;
    const story = (await db.query<any>("SELECT body FROM notes WHERE piece_id = $1 AND kind = 'story' ORDER BY id DESC LIMIT 1", [p.pieceId])).rows[0];
    return {
      public: JSON.parse(r.public_json),
      reportHash: b64.encode(r.report_hash),
      frames: frames.map((f) => ({ key: nearPublicKey(hex.decode(f.key_hex)), index: f.idx, deviceTs: Number(f.device_ts), width: f.width, height: f.height })),
      story: story?.body ?? null,
    };
  });

  // ---------------- context notes (community notes on a published record) ----------------

  const publicFrames = async (pieceId: string) =>
    Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM frames WHERE piece_id = $1 AND visibility = 'public' AND NOT discarded", [pieceId])).rows[0]!.n);
  const published = async (pieceId: string) =>
    (await db.query<{ ok: boolean }>("SELECT published AS ok FROM reports WHERE piece_id = $1", [pieceId])).rows[0]?.ok === true;
  const NOTE_SELECT = `SELECT n.*, r.body AS response, r.at AS response_at, r.public_frames_at_response,
      (SELECT count(*)::int FROM context_note_ratings x WHERE x.note_id = n.id AND x.helpful) AS helpful,
      (SELECT count(*)::int FROM context_note_ratings x WHERE x.note_id = n.id) AS total
    FROM context_notes n LEFT JOIN context_note_responses r ON r.note_id = n.id`;
  const noteJson = (r: any, mine?: { helpful: boolean; reason: string } | null) => ({
    id: r.id as number,
    pieceId: r.piece_id as string,
    author: r.author as string,
    concern: r.concern as string,
    body: r.body as string,
    asksEvidence: r.asks_evidence as boolean,
    createdAt: Number(r.created_at),
    status: noteStatus(r.helpful, r.total),
    ratings: { helpful: r.helpful as number, total: r.total as number },
    publicFramesAtNote: r.public_frames_at_note as number,
    response: r.response ? { body: r.response as string, at: Number(r.response_at), publicFramesAtResponse: r.public_frames_at_response as number } : null,
    ...(mine !== undefined ? { myRating: mine } : {}),
  });

  /** Anyone signed in (not the artist) raises a question about a published record. */
  app.post<{ Params: { id: string } }>("/pieces/:id/context-notes", async (req) => {
    const p = await piece(req.params.id);
    const author = await who(req);
    if (author === p.artist) throw new HttpError(403, "artist_cannot_note_own_piece");
    if (!(await published(p.pieceId))) throw new HttpError(409, "not_published");
    const n = validateNote(body(req));
    if ((await db.query("SELECT 1 FROM context_notes WHERE piece_id = $1 AND author = $2", [p.pieceId, author])).rows.length)
      throw new HttpError(409, "already_noted");
    const recent = Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM context_notes WHERE author = $1 AND created_at > $2", [author, d.now() - 86_400_000])).rows[0]!.n);
    if (recent >= (d.maxNotesPerDay ?? NOTE_RULES.maxNotesPerDay)) throw new HttpError(429, "too_many_notes");
    const r = await db.query<{ id: number }>(
      "INSERT INTO context_notes (piece_id, author, concern, body, asks_evidence, created_at, public_frames_at_note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [p.pieceId, author, n.concern, n.body, n.asksEvidence, d.now(), await publicFrames(p.pieceId)],
    );
    return { id: r.rows[0]!.id };
  });

  /** Public: every note on the piece with its status (visitors' pages show only `shown`). */
  app.get<{ Params: { id: string } }>("/pieces/:id/context-notes", async (req) => {
    const viewer = await maybeWho(req).catch(() => null);
    const rows = (await db.query<any>(`${NOTE_SELECT} WHERE n.piece_id = $1 ORDER BY n.id`, [req.params.id])).rows;
    const mine = new Map<number, { helpful: boolean; reason: string }>();
    if (viewer)
      for (const r of (await db.query<any>("SELECT note_id, helpful, reason FROM context_note_ratings WHERE rater = $1 AND note_id = ANY($2::int[])", [viewer, rows.map((x) => x.id)])).rows)
        mine.set(r.note_id, { helpful: r.helpful, reason: r.reason });
    return { notes: rows.map((r) => noteJson(r, viewer ? (mine.get(r.id) ?? null) : undefined)), publicFrames: await publicFrames(req.params.id), rules: NOTE_RULES };
  });

  /** Public: notes that still need ratings, newest first (the rating queue). */
  app.get<{ Querystring: { limit?: string } }>("/context-notes/needs-ratings", async (req) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 30) || 30, 100));
    const rows = (await db.query<any>(`${NOTE_SELECT} ORDER BY n.id DESC LIMIT 500`)).rows.filter((r) => noteStatus(r.helpful, r.total) === "needs_ratings").slice(0, limit);
    return { notes: rows.map((r) => noteJson(r)) };
  });

  /** Rate someone else's note (not your own, not on your own piece). Changing your rating is allowed. */
  app.post<{ Params: { nid: string } }>("/context-notes/:nid/ratings", async (req) => {
    const note = (await db.query<any>("SELECT * FROM context_notes WHERE id = $1", [Number(req.params.nid) || 0])).rows[0];
    if (!note) throw new HttpError(404, "unknown_note");
    const p = await piece(note.piece_id);
    const rater = await who(req);
    if (rater === note.author) throw new HttpError(403, "cannot_rate_own_note");
    if (rater === p.artist) throw new HttpError(403, "artist_cannot_rate");
    const r = validateRating(body(req));
    await db.query(
      "INSERT INTO context_note_ratings (note_id, rater, helpful, reason, at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (note_id, rater) DO UPDATE SET helpful = $3, reason = $4, at = $5",
      [note.id, rater, r.helpful, r.reason, d.now()],
    );
    const row = (await db.query<any>(`${NOTE_SELECT} WHERE n.id = $1`, [note.id])).rows[0];
    return noteJson(row, r);
  });

  /** The artist answers a note (once; may be edited). Shown next to the note wherever it appears. */
  app.post<{ Params: { nid: string } }>("/context-notes/:nid/response", async (req) => {
    const note = (await db.query<any>("SELECT * FROM context_notes WHERE id = $1", [Number(req.params.nid) || 0])).rows[0];
    if (!note) throw new HttpError(404, "unknown_note");
    const p = await piece(note.piece_id);
    requireRole(p, await who(req), ["artist"]);
    const text = validateResponse(body(req));
    await db.query(
      "INSERT INTO context_note_responses (note_id, body, at, public_frames_at_response) VALUES ($1, $2, $3, $4) ON CONFLICT (note_id) DO UPDATE SET body = $2, at = $3, public_frames_at_response = $4",
      [note.id, text, d.now(), await publicFrames(p.pieceId)],
    );
    return { ok: true };
  });

  /** One wallet signature → a 30-minute session token. A session cannot mint another one. */
  app.post("/session", async (req) => issueSession(sessions, await signed(req), d.now()));

  app.get("/health", async () => ({ ok: true }));
  return app;
}
