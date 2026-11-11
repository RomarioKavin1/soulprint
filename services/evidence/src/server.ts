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
import { authenticate, AuthError } from "./auth.ts";
import { BlobStore } from "./blob.ts";
import type { ChainReader, PieceWithSegments } from "./chain.ts";
import { openDb, type Db } from "./db.ts";
import type { Sender } from "./sender.ts";
import { evaluateChallenge, newCode, nonceHashOf, TesseractOcr, type Ocr } from "./challenge.ts";
import { jcs } from "./jcs.ts";
import { computeMetrics } from "./metrics/index.ts";
import { band, CLOCK_SKEW_MS } from "./metrics/activity.ts";
import { THRESHOLDS } from "./metrics/thresholds.ts";
import { decideLevel, signReport } from "./report.ts";
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
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.code ?? "bad_request", message: e.message });
    app.log.error(e);
    console.error(`[evidence] ${_req.method} ${_req.url} failed:`, e?.stack ?? e);
    return reply.code(500).send({ error: "internal" });
  });

  const useNonce = async (nonce: Uint8Array) => {
    const r = await db.query("INSERT INTO nonces (nonce, at) VALUES ($1, $2) ON CONFLICT DO NOTHING", [nonce, d.now()]);
    return (r.affectedRows ?? 0) === 1;
  };
  const who = (req: FastifyRequest) =>
    authenticate({ chain: d.chain, recipient: d.recipient, now: d.now, useNonce }, req.headers.authorization, req.method, req.url, (req as any).rawBody ?? "");
  const maybeWho = async (req: FastifyRequest) => (req.headers.authorization ? who(req) : null);

  const piece = async (id: string): Promise<PieceWithSegments> => {
    const p = await d.chain.piece(id);
    if (!p) throw new HttpError(404, "unknown_piece");
    return p;
  };
  const role = (p: PieceWithSegments, account: string | null) =>
    account === p.artist ? "artist" : account === p.owner ? "owner" : "other";
  const requireRole = (p: PieceWithSegments, account: string, allowed: ("artist" | "owner")[]) => {
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
    const from = Number(b.fromIndex), to = Number(b.toIndex);
    if (!frames.length || frames.length > MAX_BATCH || to - from + 1 !== frames.length || frames.some((f, i) => f.index !== from + i))
      throw new HttpError(400, "bad_batch");
    const metas: (FrameMeta & { raw: any; jpeg: Uint8Array | null })[] = frames.map((f) => ({
      index: f.index, deviceTs: Number(f.deviceTs), jpegHash: b64.decode(f.jpegHash), link: b64.decode(f.link),
      jpeg: f.jpeg ? b64.decode(f.jpeg) : null, raw: f,
    }));
    const head = metas.at(-1)!.link;
    if (!ed.verify(b64.decode(b.sig), batchMessage({ pieceId: p.pieceId, key: seg.key, fromIndex: from, toIndex: to, head }), seg.key))
      throw new HttpError(401, "bad_signature");
    const anchorSig = b64.decode(b.anchorSig);
    if (!ed.verify(anchorSig, anchorMessage({ pieceId: p.pieceId, head, count: to + 1 }), seg.key))
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
    return { stored: fresh.length, count: newCount, anchored, reused: [...reused] };
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
    if (!ed.verify(b64.decode(String(body(req).sig ?? "")), msg, seg.key)) throw new HttpError(401, "bad_signature");
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
  app.get<{ Params: { id: string }; Querystring: { from?: string; limit?: string; images?: string } }>("/pieces/:id/progress", async (req) => {
    const p = await piece(req.params.id);
    const r = role(p, await who(req));
    if (r === "other") throw new HttpError(403, "forbidden");
    const limit = Math.min(Number(req.query.limit ?? 200), 500), from = Number(req.query.from ?? 0);
    const rows = await db.query<any>(
      `SELECT * FROM frames WHERE piece_id = $1 ${r === "owner" ? "AND visibility IN ('client','public')" : ""}
       ORDER BY key_hex, idx OFFSET $2 LIMIT $3`, [p.pieceId, from, limit]);
    const images = req.query.images !== "0";
    return { role: r, frames: await Promise.all(rows.rows.map((x) => frameJson(p.pieceId, x, images))) };
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
    const data = b64.decode(String(body(req).data ?? ""));
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
    const sig = b64.decode(String(body(req).sig ?? ""));
    const msg = challengeAckMessage({ pieceId: p.pieceId, challengeId: cid, nonceHash: c.nonceHash });
    if (!p.segments.some((s) => ed.verify(sig, msg, s.key))) throw new HttpError(401, "bad_signature");
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
        finalMatch: m.finalMatch, source, timeNote: "device time, limited to when the service received each frame", timeAnomalies: await timeAnomalies(p.pieceId, primary!.key_hex),
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
    const r = await db.query("UPDATE reports SET published = $1 WHERE piece_id = $2 RETURNING piece_id", [body(req).published === true, p.pieceId]);
    if (!r.rows.length) throw new HttpError(409, "no_report");
    return { published: body(req).published === true };
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

  app.get("/health", async () => ({ ok: true }));
  return app;
}
