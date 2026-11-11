import { Pay } from "@/components/holder/Pay";

export default async function Page({ params }: { params: Promise<{ pieceId: string }> }) {
  return <Pay pieceId={(await params).pieceId} />;
}
