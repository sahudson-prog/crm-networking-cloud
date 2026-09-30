"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Swiper as SwiperInstance } from "swiper";
import { A11y, Keyboard, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import { Button } from "./ui/Button";

const SLIDE_COUNT = 3;

export function OnboardingIntroSlides() {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <section className="onboarding-intro-slideshow" aria-label="Introducción a Coffeecito">
      <Swiper
        a11y={{
          enabled: true,
          firstSlideMessage: "Esta es la primera diapositiva",
          lastSlideMessage: "Esta es la última diapositiva",
          nextSlideMessage: "Mostrar la diapositiva siguiente",
          prevSlideMessage: "Mostrar la diapositiva anterior"
        }}
        autoHeight
        className="onboarding-intro-swiper"
        grabCursor
        keyboard={{ enabled: true, onlyInViewport: true }}
        modules={[A11y, Keyboard, Pagination]}
        onSlideChange={(swiper) => setActiveIndex(swiper.activeIndex)}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
          setActiveIndex(swiper.activeIndex);
        }}
        pagination={{ type: "progressbar" }}
        slidesPerView={1}
        speed={420}
      >
        <SwiperSlide>
          <OnboardingIntroSlide className="onboarding-intro-slide-concept">
            <div className="onboarding-intro-slide-opening">
              <h2>
                Networking no es acumular contactos. Es construir relaciones que amplían tu acceso a información,
                personas y oportunidades relevantes.
              </h2>
              <p>
                Bien hecho, puede ayudarte a encontrar una nueva posición, desarrollar negocios, entrar a nuevos círculos
                profesionales o fortalecer tu posicionamiento. Su valor no está sólo en cuántos contactos tienes, sino en la
                relevancia de esas relaciones, los círculos a los que te conectan y tu capacidad de movilizarlas cuando importa.
              </p>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>

        <SwiperSlide>
          <OnboardingIntroSlide className="onboarding-intro-slide-benefits">
            <div className="onboarding-intro-slide-benefits-content">
              <h2>Una buena red profesional amplía tu alcance y abre nuevas posibilidades.</h2>
              <div className="onboarding-intro-benefits">
                <article>
                  <h3>Más efectividad en procesos de selección</h3>
                  <p>
                    Los candidatos referidos tienen más probabilidades de llegar a entrevistas y recibir ofertas - incluso hasta{" "}
                    <strong>7x</strong> según benchmarks
                  </p>
                </article>
                <article>
                  <h3>Más negocios y alianzas</h3>
                  <p>Las relaciones correctas pueden abrir puertas a nuevos clientes, alianzas y oportunidades fuera de tu círculo directo.</p>
                </article>
                <article>
                  <h3>Más crecimiento y posicionamiento</h3>
                  <p>Una red relevante puede ampliar tu movilidad, desarrollo y visibilidad profesional.</p>
                </article>
              </div>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>

        <SwiperSlide>
          <OnboardingIntroSlide className="onboarding-intro-slide-practice">
            <div className="onboarding-intro-slide-practice-content">
              <h2>Gestionar tu red no debería convertirse en otro trabajo.</h2>
              <p>
                A medida que tu red crece, también crecen los contactos, conversaciones y pendientes. Coffeecito mantiene
                esa información ordenada y visible para que puedas responder:
              </p>
              <div className="onboarding-intro-questions" aria-label="Preguntas para gestionar tu red">
                <p>¿Con quién debería reconectar?</p>
                <p>¿Estoy expandiendo mi círculo actual?</p>
                <p>¿Qué objetivos todavía no están cubiertos por mi red?</p>
                <p>¿Qué conversaciones o compromisos quedaron pendientes?</p>
                <p>¿Estoy haciendo networking de forma efectiva?</p>
              </div>
              <strong className="onboarding-intro-closing">
                Coffeecito se encarga de la gestión. Tú del café y la conversación.
              </strong>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>
      </Swiper>

      <div className="onboarding-intro-slide-navigation">
        <div>
          <Button
            disabled={activeIndex === 0}
            icon="arrowLeft"
            onClick={() => swiperRef.current?.slidePrev()}
          >
            Anterior
          </Button>
          <Button
            disabled={activeIndex === SLIDE_COUNT - 1}
            icon="arrowRight"
            onClick={() => swiperRef.current?.slideNext()}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </section>
  );
}

function OnboardingIntroSlide({ children, className }: { children: ReactNode; className: string }) {
  return (
    <article className={`onboarding-intro-slide ${className}`}>
      <div aria-hidden="true" className="onboarding-intro-slide-background" />
      <div aria-hidden="true" className="onboarding-intro-slide-overlay" />
      <div className="onboarding-intro-slide-content">{children}</div>
    </article>
  );
}
