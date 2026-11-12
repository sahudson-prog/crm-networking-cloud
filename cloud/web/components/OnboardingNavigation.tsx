"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TRACKING_QUERY_KEY, useTrackingViewFilters } from "./useTrackingViewFilters";

const destinations = [
  ["/", "Inicio"],
  ["/registrar-avances", "Registrar avances"],
  ["/planificar", "Planificar"],
  ["/contactos", "Contactos"],
  ["/objetivos", "Objetivos y prioridades"]
] as const;

/** Temporary links only: existing shell, utilities and global Actualizar stay intact. */
export function OnboardingNavigation() {
  const pathname = usePathname();
  const { query } = useTrackingViewFilters();
  const suffix = query ? `?${new URLSearchParams({ [TRACKING_QUERY_KEY]: query })}` : "";
  return <nav className="nav-primary structural-navigation" aria-label="Navegacion principal">
    {destinations.map(([href, label]) => {
      const active = pathname === href || (href === "/" && pathname === "/dashboard")
        || (href === "/objetivos" && pathname === "/onboarding/objetivos")
        || (href === "/contactos" && (pathname === "/onboarding/contactos" || pathname === "/onboarding/contacto"));
      return <Link key={href} href={`${href}${suffix}`} className={`nav-link ${active ? "active" : ""}`}
        aria-current={active ? "page" : undefined}>{label}</Link>;
    })}
  </nav>;
}
