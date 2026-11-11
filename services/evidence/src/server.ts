/** Evidence service HTTP API (Plan 2 Task 3). */
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { sha256 } from "@noble/hashes/sha256";
import * as ed from "@noble/ed25519";
import {
  anchorMessage, b64, batchMessage, challengeAckMessage, eq, hex, nearPublicKey, parseNearPublicKey, verifyChain, type FrameMeta,
} from "@soulprint/proof";
import { authenticate, AuthError } from "./auth.ts";
import { BlobStore } from "./blob.ts";
import type { ChainReader, PieceWithSegments } from "./chain.ts";
import { openDb, type Db } from "./db.ts";
import type { Sender } from "./sender.ts";
import { newCode, nonceHashOf } from "./challenge.ts";

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
    for (const m of fresh) {
      const other = await db.query("SELECT 1 FROM frames WHERE jpeg_hash = $1 AND piece_id <> $2 LIMIT 1", [m.jpegHash, p.pieceId]);
      if (other.rows.length) throw new HttpError(409, "frame_reused", { index: m.index });
    }
    for (const m of fresh) {
      const blob = m.jpeg ? await blobs.put(p.pieceId, `${keyHex}-${m.index}.jpg`, m.jpeg) : null;
      await db.query(
        `INSERT INTO frames (piece_id, key_hex, idx, session_id, device_ts, jpeg_hash, link, width, height, blob_key, discarded, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [p.pieceId, keyHex, m.index, String(m.raw.sessionId ?? ""), m.deviceTs, m.jpegHash, m.link, m.raw.width | 0, m.raw.height | 0, blob, !m.jpeg, d.now()],
      );
    }
    await db.query("INSERT INTO anchor_sigs (piece_id, key_hex, count, head, sig) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [p.pieceId, keyHex, to + 1, head, anchorSig]);
    const newCount = Math.max(count, to + 1);
    const anchored = await maybeAnchor(p.pieceId, seg.key, newCount, false);
    return { stored: fresh.length, count: newCount, anchored };
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
    visibility: r.visibility, discarded: r.discarded,
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

  app.get("/health", async () => ({ ok: true }));
  return app;
}
