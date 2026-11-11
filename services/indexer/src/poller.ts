/** Follow the chain from a start height, ingesting each final block once. */
import type { Db } from "./db.ts";
import { ingestBlock, type IngestConfig } from "./ingest.ts";
import type { BlockSource } from "./source.ts";

export async function pollOnce(db: Db, cfg: IngestConfig, src: BlockSource, startHeight: number, maxBlocks = 200) {
  const meta = (await db.query<{ v: string }>("SELECT v FROM meta WHERE k = 'height'")).rows[0];
  let next = meta ? Number(meta.v) + 1 : startHeight;
  const head = await src.head();
  let n = 0;
  while (next <= head.height && n < maxBlocks) {
    const b = await src.block(next);
    if (b) await ingestBlock(db, cfg, b);
    else await db.query("INSERT INTO meta (k, v) VALUES ('height', $1) ON CONFLICT (k) DO UPDATE SET v = $1", [String(next)]);
    next++;
    n++;
  }
  return { indexed: next - 1, head: head.height };
}

export function follow(db: Db, cfg: IngestConfig, src: BlockSource, startHeight: number, onError: (e: unknown) => void) {
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const r = await pollOnce(db, cfg, src, startHeight);
        if (r.indexed >= r.head) await new Promise((res) => setTimeout(res, 1000));
      } catch (e) {
        onError(e);
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  })();
  return () => {
    stopped = true;
  };
}
