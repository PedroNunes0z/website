"use client";

import { Children, isValidElement, type ReactNode, useState } from "react";
import { Check, Copy } from "lucide-react";

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return "";
}

export function CopyContent({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2200);
    } catch { setStatus("failed"); }
  };
  return <button className={className} type="button" onClick={() => void copy()} aria-label={status === "copied" ? "Copiado" : status === "failed" ? "Falha ao copiar" : label}>
    {status === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    <span aria-live="polite">{status === "copied" ? "Copiado" : status === "failed" ? "Falha ao copiar" : label}</span>
  </button>;
}

const languageNames: Record<string, string> = {
  bash: "Bash", c: "C", cpp: "C++", cs: "C#", css: "CSS", go: "Go", html: "HTML",
  java: "Java", js: "JavaScript", json: "JSON", jsx: "React JSX", md: "Markdown",
  markdown: "Markdown", py: "Python", python: "Python", sh: "Shell", sql: "SQL",
  ts: "TypeScript", tsx: "React TSX", typescript: "TypeScript", xml: "XML", yaml: "YAML", yml: "YAML",
};

export function CopyCodeBlock({ children, language }: { children: ReactNode; language?: string }) {
  const text = Children.toArray(children).map(plainText).join("").replace(/\n$/, "");
  const label = languageNames[language?.toLowerCase() ?? ""] ?? (language ? `${language.slice(0, 1).toUpperCase()}${language.slice(1)}` : "Código");
  return <div className="article-code-block"><span className="article-code-language">{label}</span><CopyContent text={text} label="Copiar código" className="article-code-copy" /><pre>{children}</pre></div>;
}
