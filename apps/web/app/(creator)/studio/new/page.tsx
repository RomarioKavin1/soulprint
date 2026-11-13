import { OfferBuilder } from "@/components/studio/OfferBuilder";

export default async function NewPiece({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "standalone" ? "standalone" : "commission";
  return (
    <div className="page-top">
      <h1 className="title-page">{mode === "commission" ? "New commission" : "New piece"}</h1>
      <OfferBuilder mode={mode} />
    </div>
  );
}
