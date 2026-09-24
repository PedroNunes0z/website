import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Footer } from "@/components/footer";
import { GameExperience } from "@/components/game-experience";
import { Header } from "@/components/header";
import { gameFromString } from "@/lib/games";

type Props = { params: Promise<{ game: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = gameFromString((await params).game);
  if (!game) return {};
  const title = game === "haxball" ? "Haxball" : "Hóquei";
  return { title: `${title} | Games | Pedro Nunes`, description: `Jogue ${title} contra bots ou em salas públicas online.` };
}

export default async function GamePage({ params }: Props) {
  const game = gameFromString((await params).game);
  if (!game) notFound();
  return <><Header /><GameExperience game={game} /><Footer /></>;
}
