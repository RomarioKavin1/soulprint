import { OfferBuilder } from "@/components/studio/OfferBuilder";

export default async function NewPiece({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "standalone" ? "standalone" : "commission";
  return (
    <div className="pt-8">
      <p className="label">Studio</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">{mode === "commission" ? "New commission" : "New piece"}</h1>
      <OfferBuilder mode={mode} />
    </div>
  );
}
