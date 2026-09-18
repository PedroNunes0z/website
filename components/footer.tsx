import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-grid">
        <div>
          <p className="footer-brand">Pedro Nunes<span>.</span></p>
          <p className="footer-note">Software Engineering · Full Stack Development · Cloud Computing</p>
        </div>
        <div className="footer-links">
          <a href="https://github.com/PedroNunes0z" target="_blank" rel="noreferrer">GitHub <ArrowUpRight aria-hidden="true" /></a>
          <a href="https://www.linkedin.com/in/pedro-nunes-dev-contato" target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight aria-hidden="true" /></a>
          <a href="mailto:contato.pedronunes.dev@gmail.com">E-mail <ArrowUpRight aria-hidden="true" /></a>
          <Link href="/admin">Admin</Link>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© {new Date().getFullYear()} Pedro Nunes</span>
        <span>
          Modelo 3D: <a href="https://skfb.ly/SZJ8" target="_blank" rel="noreferrer">The Universe!</a> por <a href="https://sketchfab.com/stark3d" target="_blank" rel="noreferrer">Stark</a>, licenciado sob <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noreferrer">CC BY 4.0</a>
        </span>
      </div>
    </footer>
  );
}
