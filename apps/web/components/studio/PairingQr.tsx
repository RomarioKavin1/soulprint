"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A QR code that opens a piece's recording page on a phone or tablet. */
export function PairingQr({ pieceId }: { pieceId: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = `${window.location.origin}/capture/${pieceId}`;
    setUrl(u);
    QRCode.toString(u, { type: "svg", margin: 1, color: { dark: "#1a1814", light: "#ffffff" } }).then(setSvg).catch(() => setSvg(null));
  }, [pieceId]);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      {svg && <span className="block h-32 w-32 border border-rule bg-white p-1" aria-label={`QR code for ${url}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />}
      <p className="max-w-[36ch] text-ink-2">
        Scan this with the phone or tablet, or open <code className="break-all font-mono text-xs">{url || `/capture/${pieceId}`}</code>. It shows a pairing key with a Copy button — paste it below.
      </p>
    </div>
  );
}
