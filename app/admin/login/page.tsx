import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/app/admin/login/login-form";

export const metadata: Metadata = {
  title: "Administração",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-panel">
        <Link className="brand" href="/">Pedro Nunes<span>.</span></Link>
        <div>
          <p className="admin-eyebrow">Área restrita</p>
          <h1>Conteúdo em órbita.</h1>
          <p>Entre para criar, revisar e publicar artigos.</p>
        </div>
        <LoginForm destination={from} />
        <Link className="back-link" href="/">Voltar ao site</Link>
      </section>
      <aside className="login-art" aria-hidden="true">
        <span className="login-sun" />
        <span className="login-orbit login-orbit-one" />
        <span className="login-orbit login-orbit-two" />
        <strong>ADMIN<br />CONSOLE</strong>
      </aside>
    </main>
  );
}
