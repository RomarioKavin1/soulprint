"use client";
import { useState } from "react";
import { ErrorNote, Section, useAction, usePoll, when } from "@/components/ui";
import { useEvidence, bytesToB64 } from "@/lib/evidence";
import { useNear } from "@/components/NearProvider";

/** Brief, references and messages live in the evidence service (private, not on-chain). */
export function Notes({ pieceId, artist }: { pieceId: string; artist: string }) {
  const evidence = useEvidence();
  const { accountId } = useNear();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"messages" | "brief">("messages");
  const { busy, error, run } = useAction();
  const msgs = usePoll(() => evidence<{ items: { author: string; text: string; at: number }[] }>("GET", `/pieces/${pieceId}/messages`), 5000, [pieceId, accountId]);
  const brief = usePoll(() => evidence<{ items: { author: string; text: string; at: number }[] }>("GET", `/pieces/${pieceId}/brief`), 15000, [pieceId, accountId]);
  const latestBrief = brief.data?.items.at(-1);

  return (
    <Section title="Brief and messages">
      {latestBrief ? (
        <div className="mb-5 rounded-xl bg-paper-2/70 p-4">
          <p className="label">Brief · {latestBrief.author === artist ? "artist" : "client"} · {new Date(latestBrief.at).toLocaleDateString()}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{latestBrief.text}</p>
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink-2">No brief yet. Describe what you want — subject, size, style, references.</p>
      )}
      <ul className="max-h-80 space-y-3 overflow-y-auto">
        {(msgs.data?.items ?? []).map((m, i) => (
          <li key={i} className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.author === accountId ? "ml-auto bg-ink text-paper" : "bg-paper-2"}`}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            <p className={`mt-1 text-[10px] ${m.author === accountId ? "text-paper/60" : "text-ink-3"}`}>{m.author === artist ? "artist" : m.author} · {when(String(BigInt(m.at) * 1_000_000n))}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-2 text-sm">
          <button className={kind === "messages" ? "font-medium underline" : "text-ink-3"} onClick={() => setKind("messages")}>Message</button>
          <button className={kind === "brief" ? "font-medium underline" : "text-ink-3"} onClick={() => setKind("brief")}>Update the brief</button>
        </div>
        <textarea className="field min-h-20" value={text} onChange={(e) => setText(e.target.value)} aria-label={kind === "brief" ? "Brief" : "Message"} placeholder={kind === "brief" ? "What should the piece be?" : "Write a message"} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={!text.trim() || !!busy}
            onClick={() => run("Sending", async () => { await evidence("POST", `/pieces/${pieceId}/${kind}`, { text }); setText(""); await (kind === "brief" ? brief.reload() : msgs.reload()); })}
          >
            {kind === "brief" ? "Save brief" : "Send"}
          </button>
          <label className="text-sm text-ink-2">
            Add a reference image{" "}
            <input
              type="file"
              accept="image/*"
              className="text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) run("Uploading", async () => {
                  const data = new Uint8Array(await f.arrayBuffer());
                  await evidence("POST", `/pieces/${pieceId}/files`, { kind: "reference", name: f.name, data: bytesToB64(data) });
                  await evidence("POST", `/pieces/${pieceId}/messages`, { text: `Added a reference: ${f.name}` });
                  await msgs.reload();
                });
              }}
            />
          </label>
        </div>
      </div>
      <ErrorNote error={error} />
    </Section>
  );
}
