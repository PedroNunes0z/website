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

export function CopyCodeBlock({ children }: { children: ReactNode }) {
  const text = Children.toArray(children).map(plainText).join("").replace(/\n$/, "");
  return <div className="article-code-block"><CopyContent text={text} label="Copiar código" className="article-code-copy" /><pre>{children}</pre></div>;
}
