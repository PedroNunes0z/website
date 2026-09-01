import type { Metadata } from "next";
import { JetBrains_Mono, Tektur } from "next/font/google";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

const tektur = Tektur({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Pedro Nunes | Full Stack Developer",
    template: "%s | Pedro Nunes",
  },
  description:
    "Portfólio de Pedro Nunes, Full Stack Developer especializado em Java, Spring Boot, React, Next.js e arquiteturas escaláveis.",
  keywords: [
    "Pedro Nunes",
    "Full Stack Developer",
    "Java",
    "Spring Boot",
    "React",
    "Next.js",
    "Software Engineering",
  ],
  authors: [{ name: "Pedro Nunes" }],
  creator: "Pedro Nunes",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    title: "Pedro Nunes | Full Stack Developer",
    description: "Software com engenharia, clareza e escala.",
    siteName: "Pedro Nunes",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Pedro Nunes, Full Stack Developer" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pedro Nunes | Full Stack Developer",
    description: "Software com engenharia, clareza e escala.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${tektur.variable} ${jetBrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
