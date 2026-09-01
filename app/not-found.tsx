import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="not-found shell">
        <span>404</span>
        <h1>Esta rota saiu da órbita.</h1>
        <p>O conteúdo pode ter mudado de endereço ou ainda não foi publicado.</p>
        <Link className="button button-primary" href="/"><ArrowLeft aria-hidden="true" /> Voltar ao início</Link>
      </main>
      <Footer />
    </>
  );
}
