import { Vault } from "@/components/holder/Vault";

export default async function Page({ params }: { params: Promise<{ pieceId: string }> }) {
  return <Vault pieceId={(await params).pieceId} />;
}
