"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm({ destination = "/admin" }: { destination?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(data.error ?? "Não foi possível entrar.");
      setLoading(false);
      return;
    }

    router.replace(destination.startsWith("/admin") ? destination : "/admin");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="password">Senha administrativa</label>
      <div className="password-field">
        <LockKeyhole aria-hidden="true" />
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoFocus
        />
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary" type="submit" disabled={loading}>
        {loading ? "Validando..." : "Acessar painel"} <ArrowRight aria-hidden="true" />
      </button>
    </form>
  );
}
