import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Footer } from "@/components/footer";
import { GameExperience } from "@/components/game-experience";
import { Header } from "@/components/header";
import { gameFromString } from "@/lib/games";

type Props = {
  params: Promise<{ game: string }>;
  searchParams: Promise<{ room?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = gameFromString((await params).game);
  if (!game) return {};
  if (game === "haxball") {
    return { title: "FutBR | Pedro Nunes", description: "O futebol brasileiro de arena em página própria." };
  }
  return { title: "Hóquei | Games | Pedro Nunes", description: "Jogue Hóquei contra bots ou em salas públicas online." };
}

export default async function GamePage({ params, searchParams }: Props) {
  const game = gameFromString((await params).game);
  if (!game) notFound();
  // O FutBR mora em página própria (/futbr), fora do layout do portfólio.
  // Links antigos continuam válidos e levam o código da sala junto.
  if (game === "haxball") {
    const room = (await searchParams).room ?? "";
    redirect(/^[A-Z0-9]{8}$/.test(room.toUpperCase()) ? `/futbr?room=${room.toUpperCase()}` : "/futbr");
  }
  return <><Header /><GameExperience game={game} /><Footer /></>;
}
