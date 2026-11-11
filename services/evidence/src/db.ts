import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export type Db = PGlite;

/** In-process Postgres (PGlite) persisted under `dir`, or in memory when `dir` is undefined. */
export async function openDb(dir?: string): Promise<Db> {
  if (dir) mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  const migrations = new URL("../db/migrations/", import.meta.url);
  for (const f of readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(new URL(f, migrations), "utf8"));
  return db;
}
