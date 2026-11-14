import type { Metadata } from "next";
import { Deck } from "@/components/pitch/Deck";

export const metadata: Metadata = {
  title: "Manmade — pitch",
  description: "Real art, hung with its making. A short pitch.",
};

export default function PitchPage() {
  return <Deck />;
}
