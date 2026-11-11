import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";

describe("db", () => {
  it("opens a persisted database in a directory that does not exist yet, and reopens it", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "evdb-")), "nested", "pg");
    const a = await openDb(dir);
    await a.query("INSERT INTO nonces (nonce, at) VALUES ($1, $2)", [new Uint8Array(32).fill(1), 1]);
    await a.close();
    const b = await openDb(dir);
    expect((await b.query<{ n: number }>("SELECT count(*)::int AS n FROM nonces")).rows[0]!.n).toBe(1);
    await b.close();
  });
});
