"use client";
import { useState, type CSSProperties, type ImgHTMLAttributes } from "react";

/**
 * A picture whose proportions are only known once it loads (an artist's preview): it hangs at the
 * cell height until then, and from its natural size onwards it is sized from its aspect ratio, so
 * it fills its frame with no bands whether it must grow or shrink.
 */
export function FitImg(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [ar, setAr] = useState<number | null>(null);
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...props}
      style={ar ? ({ ...props.style, "--ar": ar } as CSSProperties) : props.style}
      onLoad={(e) => {
        const i = e.currentTarget;
        if (i.naturalWidth && i.naturalHeight) setAr(i.naturalWidth / i.naturalHeight);
      }}
      ref={(i) => {
        // already decoded before hydration (cached): read it now
        if (i && !ar && i.complete && i.naturalWidth && i.naturalHeight) setAr(i.naturalWidth / i.naturalHeight);
      }}
    />
  );
}
