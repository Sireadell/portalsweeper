"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

// A scannable picture of a link, drawn in the browser. Nothing is sent anywhere.
export default function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: "#14110F", light: "#F2EDE4" } })
      .then((u) => { if (live) setSrc(u); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [text, size]);
  if (!src) return <div style={{ width: size, height: size }} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="QR code for the challenge link" className="rounded-xl" />;
}
