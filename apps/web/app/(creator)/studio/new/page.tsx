import { OfferBuilder } from "@/components/studio/OfferBuilder";

export default async function NewPiece({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "standalone" ? "standalone" : "commission";
  return (
    <div className="pt-12">
      <h1 className="font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-none tracking-[-0.015em]">{mode === "commission" ? "New commission" : "New piece"}</h1>
      <OfferBuilder mode={mode} />
    </div>
  );
}
