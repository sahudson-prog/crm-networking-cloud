"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ActivitySyncButton } from "./ActivitySyncButton";
import { Icon } from "./ui/Icon";

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isSystem = pathname.startsWith("/sistema");
  const isAccount = pathname.startsWith("/cuenta");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1 className="brand-title">CRM Networking</h1>
          <p className="brand-subtitle">Replica cloud - beta espejo</p>
        </div>
        <nav className="nav" aria-label="Navegacion principal">
          <Link className={`nav-link ${pathname === "/" ? "active" : ""}`} href="/">
            <Icon name="sparkles" />
            Dashboard
          </Link>
          <Link className={`nav-link ${pathname === "/contactos" ? "active" : ""}`} href="/contactos">
            <Icon name="users" />
            Contactos
          </Link>
          <Link className={`nav-link ${isSystem ? "active" : ""}`} href="/sistema">
            <Icon name="settings" />
            Sistema
          </Link>
          <Link className={`nav-link ${isAccount ? "active" : ""}`} href="/cuenta">
            <Icon name="user" />
            Cuenta
          </Link>
          <ActivitySyncButton variant="focus_incremental" />
        </nav>
      </header>
      <div className="banner">
        Modo espejo: esta app usa la copia importada en Supabase. Google Contacts esta en beta con confirmacion previa;
        el Coach ya puede actualizar y cerrar sugerencias dentro de esta copia cloud.
      </div>
      {children}
    </main>
  );
}
