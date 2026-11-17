"use client";

import { useEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Autoplay, Keyboard } from "swiper/modules";
import type { Swiper as SwiperInstance } from "swiper";

export type ProductSlide = { id: string; src: string; alt: string };

export function ProductSlideshow({ slides }: { slides: ProductSlide[] }) {
  const swiper = useRef<SwiperInstance | null>(null);
  const [reduced, setReduced] = useState(true);
  const [instance, setInstance] = useState<SwiperInstance | null>(null);
  const multiple = slides.length > 1;
  const interaction = useRef({ hover: false, focus: false, touch: false });
  const policy = useRef({ reduced, multiple });
  const engine = useRef({ reset: true, changing: false });
  policy.current = { reduced, multiple };

  function stop(s: SwiperInstance) {
    engine.current.changing = true;
    // Swiper retains paused across stop/start. Resume while still running to clear it.
    if (s.autoplay.running && s.autoplay.paused) s.autoplay.resume();
    s.autoplay.stop();
    engine.current.changing = false;
  }
  function syncAutoplay(reset = false) {
    const s = swiper.current, p = policy.current;
    if (!s || s.destroyed || engine.current.changing) return;
    if (reset) engine.current.reset = true;
    if (!p.multiple || p.reduced) { stop(s); engine.current.reset = true; return; }
    const blocked = document.hidden || interaction.current.hover || interaction.current.focus || interaction.current.touch;
    if (blocked || s.animating) {
      if (engine.current.reset) stop(s);
      else if (s.autoplay.running && !s.autoplay.paused) s.autoplay.pause();
      return;
    }
    if (engine.current.reset || !s.autoplay.running) {
      stop(s); engine.current.reset = false; s.autoplay.start();
    } else if (s.autoplay.paused) s.autoplay.resume();
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visibility = () => syncAutoplay();
    motion(); visibility();
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    syncAutoplay(true);
  }, [instance, multiple, reduced, slides]);

  return <div className="landing-product-viewport" role="region" aria-roledescription="carrusel" aria-label="Coffeecito en acción" tabIndex={0}
    onPointerEnter={event => { if (event.pointerType === "mouse") { interaction.current.hover = true; syncAutoplay(); } }}
    onPointerLeave={event => { if (event.pointerType === "mouse") { interaction.current.hover = false; syncAutoplay(); } }}
    onFocusCapture={() => { interaction.current.focus = true; swiper.current?.keyboard.enable(); syncAutoplay(); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { interaction.current.focus = false; swiper.current?.keyboard.disable(); syncAutoplay(); } }}>
    <Swiper key={slides.map(slide => slide.id).join("|")} className="landing-product-swiper" modules={[A11y, Autoplay, Keyboard]} slidesPerView={1}
      speed={reduced ? 0 : 420} loop={multiple} allowTouchMove={multiple} simulateTouch grabCursor={multiple}
      keyboard={{ enabled: false, onlyInViewport: true }}
      autoplay={{ enabled: false, delay: 5000, disableOnInteraction: false, pauseOnMouseEnter: true }}
      onSwiper={value => { swiper.current = value; setInstance(value); syncAutoplay(); }}
      onSlideChange={s => {
        engine.current.reset = true; stop(s);
        // Loop/resize can change the active slide without emitting transitionEnd.
        queueMicrotask(() => syncAutoplay());
      }}
      onTransitionEnd={() => syncAutoplay()} onAutoplayResume={() => syncAutoplay()}
      onTouchStart={() => { interaction.current.touch = true; syncAutoplay(); }}
      onTouchEnd={() => { interaction.current.touch = false; syncAutoplay(); }}
      a11y={{ enabled: true, slideLabelMessage: "Diapositiva {{index}} de {{slidesLength}}" }}>
      {slides.map(slide => <SwiperSlide key={slide.id}><img src={slide.src} alt={slide.alt} width={1280} height={700} draggable={false} /></SwiperSlide>)}
    </Swiper>
  </div>;
}
