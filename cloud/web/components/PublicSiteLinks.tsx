import Link from "next/link";

export function PublicSiteLinks() {
  return (
    <nav aria-label="Información pública" className="public-site-links">
      <Link href="/terminos">Términos</Link>
      <Link href="/privacidad">Privacidad</Link>
      <Link href="/contacto">Contacto</Link>
    </nav>
  );
}
