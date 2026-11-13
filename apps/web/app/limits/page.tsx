export default function Limits() {
  return (
    <article className="page-top max-w-3xl">
      <h1 className="title-display">What a record does and does not show</h1>
      <p className="mt-6 max-w-[62ch] text-lg text-ink-2">
        A record is evidence about how a piece was made. It is never proof that a person, and not a machine, made it — and this site never says it is.
      </p>
      <section className="card mt-12 space-y-8">
        <div>
          <h2 className="title-section">What it shows</h2>
          <p className="mt-3">
            That a sequence of images was captured on the artist&apos;s device, signed there frame by frame, and anchored on NEAR while the work was
            made — and how gradually that sequence builds up to the finished file.
          </p>
        </div>
        <div>
          <h2 className="title-section">Where it can be fooled</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>A finished picture revealed patch by patch on camera, by a script or by hand, can read as gradual. Someone could also trace over an existing image, including one made by AI, while recording.</li>
            <li>A live code written into the work proves someone was there and working at that moment. It does not prove who made the rest.</li>
            <li>Times come from the artist&apos;s device and are bounded by on-chain anchors, not by a trusted clock.</li>
          </ul>
        </div>
        <div>
          <h2 className="title-section">Where it is unfair to honest work</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Zooming, panning, flipping or rotating the canvas reads as a large jump, so an honest painter can end up at <i>Declared</i>.</li>
            <li>Short sessions and work done off camera show as less gradual than they were.</li>
          </ul>
        </div>
        <div>
          <h2 className="title-section">Who you are trusting</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>The evidence service computes the facts and signs the report. It is a server, not tamper-proof hardware; withdrawing its key turns its records back into <i>Declared by the artist</i>.</li>
            <li>Frames the artist keeps private still count towards the facts; only their fingerprints are public.</li>
            <li>Readers&apos; questions are counted, not weighed by who asks; a group of accounts can push one up or down.</li>
          </ul>
        </div>
      </section>
    </article>
  );
}
