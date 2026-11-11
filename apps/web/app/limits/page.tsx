export default function Limits() {
  return (
    <article className="max-w-2xl space-y-5 pt-10">
      <p className="label">Limits</p>
      <h1 className="font-display text-4xl">What a record does and does not show</h1>
      <p>A Soulprint record shows that a sequence of images was captured on the artist&apos;s device, signed there frame by frame, and anchored on the network while the work was made — and that this sequence builds up gradually to the final file.</p>
      <p>It is evidence, not proof. Someone could trace over an existing image, including one made by AI, while recording. Coverage (how much of the final image appeared gradually) and live codes requested by others make that slower and harder; they do not make it impossible.</p>
      <ul className="list-disc space-y-2 pl-5 text-ink-2">
        <li>Times come from the artist&apos;s device and are bounded by on-chain anchors, not by a trusted clock.</li>
        <li>The evidence service computes the facts and signs the report; it is a server, not tamper-proof hardware.</li>
        <li>Frames the artist keeps private still count towards the facts; only their fingerprints are public.</li>
        <li>A withdrawn service key turns a record back into &ldquo;declared by the artist&rdquo; on this site.</li>
      </ul>
    </article>
  );
}
