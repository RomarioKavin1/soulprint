import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export type Db = PGlite;

/** In-process Postgres (PGlite) persisted under `dir`, or in memory when `dir` is undefined. */
export async function openDb(dir?: string): Promise<Db> {
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.exec(readFileSync(new URL("../db/migrations/001_frames.sql", import.meta.url), "utf8"));
  return db;
}
