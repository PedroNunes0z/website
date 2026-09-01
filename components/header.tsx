"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const links = [
  { href: "/#skills", label: "Skills" },
  { href: "/#sobre", label: "Sobre" },
  { href: "/artigos", label: "Artigos" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="Pedro Nunes, página inicial">
          Pedro Nunes<span>.</span>
        </Link>

        <button
          className="menu-button"
          type="button"
          aria-expanded={open}
          aria-controls="primary-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sr-only">{open ? "Fechar menu" : "Abrir menu"}</span>
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>

        <nav id="primary-navigation" className={open ? "nav nav-open" : "nav"} aria-label="Principal">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <a className="nav-cta" href="mailto:contato.pedronunes.dev@gmail.com">
            Vamos conversar
          </a>
        </nav>
      </div>
    </header>
  );
}
