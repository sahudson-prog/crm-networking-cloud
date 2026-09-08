"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ActivitySyncButton } from "./ActivitySyncButton";
import { Icon } from "./ui/Icon";

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  const pathname = usePathname();
  const isSystem = pathname.startsWith("/sistema");
  const isAccount = pathname.startsWith("/cuenta");
  const isObjectives = pathname.startsWith("/objetivos");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1 className="brand-title">CRM Networking</h1>
        </div>
        <nav className="nav" aria-label="Navegacion principal">
          <div className="nav-primary">
            <Link className={`nav-link ${pathname === "/" ? "active" : ""}`} href="/">
              <Icon name="sparkles" />
              Dashboard
            </Link>
            <Link className={`nav-link ${pathname === "/contactos" ? "active" : ""}`} href="/contactos">
              <Icon name="users" />
              Contactos
            </Link>
            <Link className={`nav-link ${isObjectives ? "active" : ""}`} href="/objetivos">
              <Icon name="target" />
              Objetivos
            </Link>
          </div>
          <div className="nav-utility">
            <Link
              aria-label="Sistema"
              className={`nav-link nav-link-icon ${isSystem ? "active" : ""}`}
              href="/sistema"
              title="Sistema"
            >
              <Icon name="settings" />
              <span className="sr-only">Sistema</span>
            </Link>
            <Link
              aria-label="Cuenta"
              className={`nav-link nav-link-icon ${isAccount ? "active" : ""}`}
              href="/cuenta"
              title="Cuenta"
            >
              <Icon name="user" />
              <span className="sr-only">Cuenta</span>
            </Link>
            <ActivitySyncButton variant="focus_incremental" square />
            {onSignOut ? (
              <button
                aria-label="Cerrar sesión"
                className="nav-link nav-link-icon"
                onClick={onSignOut}
                title="Cerrar sesión"
                type="button"
              >
                <Icon name="close" />
                <span className="sr-only">Cerrar sesión</span>
              </button>
            ) : null}
          </div>
        </nav>
      </header>
      {children}
    </main>
  );
}
