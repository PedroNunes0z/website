import type { Metadata } from "next";
import { GameExperience } from "@/components/game-experience";

export const metadata: Metadata = {
  title: "FutBR | Pedro Nunes",
  description: "O futebol brasileiro de arena: jogue contra bots ou em salas públicas online.",
};

/**
 * Página própria do FutBR, fora do layout do portfólio: sem Header/Footer,
 * só o jogo em tela cheia com a identidade verde e amarela.
 */
export default function FutBRPage() {
  return (
    <div className="futbr-page">
      <GameExperience game="haxball" />
    </div>
  );
}
