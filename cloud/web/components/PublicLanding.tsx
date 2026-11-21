"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductSlideshow, type ProductSlide } from "./ProductSlideshow";
import { BRAND_ACCESSIBLE_NAME, BrandBetaWordmark } from "./ui/BrandBetaWordmark";
import { PublicSiteLinks } from "./PublicSiteLinks";
import { usePublicRegistrationStatus } from "./PublicRegistrationStatus";

const slides: ProductSlide[] = [
  { id: "kanban", src: "/landing/kanban.svg", alt: "Tres columnas del tablero real de contactos: Pendiente, Contactado y Agendado, con contactos ficticios." },
  { id: "coach", src: "/landing/coach.svg", alt: "Coach de Coffeecito con recomendaciones ficticias para avanzar en tus conversaciones." },
  { id: "inicio", src: "/landing/inicio.svg", alt: "Tu networking en cifras, metas de la semana y racha de networking de Coffeecito, con datos ficticios." }
];

const features = [
  { icon: "kanban", title: "Tu red, en un kanban", body: 'De "pendiente" a "café concretado": arrastra contactos y nunca pierdas un seguimiento.' },
  { icon: "coach", title: "Coach que te lleva la gestión", body: "Ordena y automatiza tus avances." },
  { icon: "growth", title: "Networking con foco y basado en datos", body: "Para ir directo al grano." }
];

export function PublicLanding() {
  const registration = usePublicRegistrationStatus();
  return <main className="public-landing">
    <div className="auth-landing-background" aria-hidden="true" />
    <header className="public-landing-header landing-inner">
      <div className="public-landing-brand" role="img" aria-label={BRAND_ACCESSIBLE_NAME}>
        <img src="/brand/coffeecito-isotipo.svg" alt="" width={48} height={48} />
        <BrandBetaWordmark />
      </div>
      <Link className="button primary landing-enter" href="/ingresar">Entrar</Link>
    </header>
    <section className="landing-hero landing-inner" aria-labelledby="landing-title">
      <div className="landing-proposal">
        <h1 id="landing-title">Conseguir pega se hace <span>tomando cafés.</span> Nosotros los ordenamos.</h1>
        <p className="landing-description">Organizar tu red no debería quitarte tiempo para conectar. Coffeecito ordena tus contactos, recuerda cada conversación y orienta tus próximos pasos.</p>
        <div className="landing-invitation">
          <Link href="/ingresar" className="button landing-cta">{registration.enabled ? "Crear mi cuenta" : "Entrar con mi invitación"} <ArrowRight aria-hidden="true" size={22} /></Link>
          {!registration.enabled ? <p>¿Sin invitación? La mejor recomendación es la de alguien que ya la usa: pídésela.</p> : null}
        </div>
      </div>
      <ProductSlideshow slides={slides} />
    </section>
    <section className="landing-features landing-inner" aria-label="Tu networking con Coffeecito">
      {features.map(feature => <article key={feature.icon}>
        <img src={`/landing/${feature.icon}-icon.svg`} alt="" width={60} height={60} />
        <h2>{feature.title}</h2><p>{feature.body}</p>
      </article>)}
    </section>
    <footer className="landing-inner landing-footer"><PublicSiteLinks /></footer>
  </main>;
}
