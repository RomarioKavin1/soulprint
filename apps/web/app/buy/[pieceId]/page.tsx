import { Buy } from "@/components/holder/Buy";

export default async function Page({ params }: { params: Promise<{ pieceId: string }> }) {
  return <Buy pieceId={(await params).pieceId} />;
}
