import { Workspace } from "@/components/studio/Workspace";

export default async function PiecePage({ params }: { params: Promise<{ pieceId: string }> }) {
  return <Workspace pieceId={(await params).pieceId} />;
}
