export default async function CommissionRoom({ params }: { params: Promise<{ pieceId: string }> }) {
  const { pieceId } = await params;
  return (
    <div className="pt-8">
      <p className="label">Commission</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">{pieceId.split(".")[0]}</h1>
    </div>
  );
}
