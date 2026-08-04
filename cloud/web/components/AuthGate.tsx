"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase, supabaseConfigError } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) setLoading(false);
    }, 3500);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
      })
      .catch(() => {
        if (!active) return;
        setMessage("No se pudo revisar la sesion. Intenta recargar la pagina.");
      })
      .finally(() => {
        if (!active) return;
        window.clearTimeout(timeout);
        setLoading(false);
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setLoading(false);
    });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setMessage("Enviando link de acceso...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });
    setMessage(error ? error.message : "Listo. Revisa tu correo para entrar.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (loading) {
    return <main className="app-shell">Cargando...</main>;
  }

  if (!session) {
    return (
      <main className="app-shell">
        <section className="panel" style={{ maxWidth: 460, margin: "64px auto" }}>
          <p className="panel-caption">CRM Networking Cloud</p>
          <h1 className="brand-title">Entrar a la replica cloud</h1>
          {supabaseConfigError ? (
            <div className="banner" style={{ marginTop: 12 }}>
              <strong>Falta conectar Supabase.</strong>
              <br />
              Crea el archivo <code>.env.local</code> con la URL del proyecto y la anon key publica.
              Despues reinicia esta app web.
            </div>
          ) : null}
          <p className="brand-subtitle" style={{ marginTop: 8 }}>
            Esta primera version es solo lectura. Sirve para comparar la nube contra la app local.
          </p>
          {!supabaseConfigError ? (
            <form onSubmit={signIn} className="grid" style={{ marginTop: 18 }}>
              <input
                className="search"
                type="email"
                required
                placeholder="tu correo"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button className="button primary" type="submit">
                Enviar link de acceso
              </button>
              {message ? <span className="meta">{message}</span> : null}
            </form>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <>
      {children}
      <div className="app-shell" style={{ paddingTop: 0 }}>
        <button className="button ghost" onClick={signOut} type="button">
          Salir
        </button>
      </div>
    </>
  );
}
