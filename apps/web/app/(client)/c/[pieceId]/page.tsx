import { Room } from "@/components/room/Room";

export default async function CommissionRoom({ params }: { params: Promise<{ pieceId: string }> }) {
  return <Room pieceId={(await params).pieceId} />;
}
