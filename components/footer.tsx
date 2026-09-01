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
          Modelo 3D: <a href="https://sketchfab.com/3d-models/sun-model-b9e1dfd765984d9b8f998bd4a6be97b5" target="_blank" rel="noreferrer">Sun Model</a> por Black Hole, CC BY 4.0
        </span>
      </div>
    </footer>
  );
}
