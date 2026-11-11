import { PhoneCapture } from "@/components/studio/PhoneCapture";

export const metadata = { manifest: "/manifest.webmanifest" };

export default async function CapturePage({ params }: { params: Promise<{ pieceId: string }> }) {
  return <PhoneCapture pieceId={(await params).pieceId} />;
}
