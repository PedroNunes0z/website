import type { Metadata } from "next";
import { ArrowUpRight, Disc3, Goal } from "lucide-react";
import Link from "next/link";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Games | Pedro Nunes",
  description: "Haxball e hóquei em partidas contra bots ou salas públicas online.",
};

const games = [
  { href: "/games/haxball", number: "01", title: "Haxball", subtitle: "Futebol de arena", detail: "Física de bola, chute carregado e equipes de até cinco jogadores.", icon: Goal },
  { href: "/games/hoquei", number: "02", title: "Hóquei", subtitle: "Duelo sobre gelo", detail: "Disco veloz, colisões e partidas individuais de sete gols.", icon: Disc3 },
];

export default function GamesPage() {
  return (
    <>
      <Header />
      <main className="games-page shell">
        <div className="games-intro">
          <p className="eyebrow"><span /> Playground / 01—02</p>
          <h1>Jogos com <em>código</em> e competição.</h1>
          <p>Dois jogos de arena para enfrentar bots ou entrar em salas públicas. Escolha um campo e comece a partida.</p>
        </div>
        <div className="games-grid">
          {games.map((game) => <Link className="game-card" href={game.href} key={game.href}>
            <div className="game-card-top"><span>{game.number} / GAME</span><ArrowUpRight aria-hidden="true" /></div>
            <div className="game-card-icon"><game.icon aria-hidden="true" strokeWidth={1.3} /></div>
            <div><span className="game-card-subtitle">{game.subtitle}</span><h2>{game.title}</h2><p>{game.detail}</p></div>
            <div className="game-card-bottom"><span>Bot + online</span><span>Explorar <ArrowUpRight aria-hidden="true" /></span></div>
          </Link>)}
        </div>
      </main>
      <Footer />
    </>
  );
}
