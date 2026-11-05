"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Swiper as SwiperInstance } from "swiper";
import { A11y, Keyboard, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import { Button } from "./ui/Button";

const SLIDE_COUNT = 4;

export function OnboardingIntroSlides({ onExit, onStart }: { onExit?: () => void; onStart: () => void }) {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <section className="onboarding-intro-slideshow-area" aria-label="Introducción a Coffeecito">
      <div className="onboarding-intro-slideshow">
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
                Hay un diamante en bruto en tu red.
              </h2>
              <p>
                Tus contactos pueden ser el punto de partida de tu próximo trabajo, negocio o marca profesional.
                El networking te ayuda a descubrir y desarrollar ese potencial. Coffeecito está para acompañarte en ese camino.
              </p>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>

        <SwiperSlide>
          <OnboardingIntroSlide className="onboarding-intro-slide-benefits">
            <div className="onboarding-intro-slide-benefits-content">
              <h2>Una red bien cultivada abre oportunidades.</h2>
              <ul className="onboarding-intro-benefits">
                <li>
                  <h3>Encontrar tu próximo trabajo:</h3>
                  <p>enterarte de oportunidades laborales y conectar con quienes pueden recomendarte.</p>
                </li>
                <li>
                  <h3>Generar nuevos negocios:</h3>
                  <p>acercarte a nuevos clientes y aliados.</p>
                </li>
                <li>
                  <h3>Fortalecer tu posicionamiento:</h3>
                  <p>compartir lo que haces y ampliar tu alcance profesional.</p>
                </li>
              </ul>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>

        <SwiperSlide>
          <OnboardingIntroSlide className="onboarding-intro-slide-practice">
            <div className="onboarding-intro-slide-practice-content">
              <h2>Que organizar tu red no te quite tiempo para conectar.</h2>
              <p>
                Coffeecito reúne tus contactos, conversaciones y pendientes para que no tengas que llevar todo en la cabeza.
              </p>
              <p>Así puedes dedicar menos tiempo a ordenar información y más a saber con quién hablar y dar el siguiente paso.</p>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>

        <SwiperSlide>
          <OnboardingIntroSlide className="onboarding-intro-slide-final">
            <div className="onboarding-intro-slide-final-content">
              <strong>Coffeecito se encarga de la gestión. Tú del café y la conversación.</strong>
            </div>
          </OnboardingIntroSlide>
        </SwiperSlide>
        </Swiper>

        <div className="onboarding-intro-slide-navigation">
          <Button
            disabled={activeIndex === 0}
            icon="arrowLeft"
            onClick={() => swiperRef.current?.slidePrev()}
          >
            Anterior
          </Button>
          {activeIndex < SLIDE_COUNT - 1 ? (
            <Button icon="arrowRight" onClick={() => swiperRef.current?.slideNext()}>
              Siguiente
            </Button>
          ) : (
            <Button className="onboarding-intro-start" icon="arrowRight" onClick={onStart} tone="primary">
              Empecemos
            </Button>
          )}
        </div>
      </div>
      {onExit ? (
        <div className="onboarding-intro-replay-exit">
          <Button onClick={onExit} tone="ghost">Salir del tutorial</Button>
        </div>
      ) : null}
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
