"use client";
import {useEffect, useRef, useState} from "react";
import type {Swiper as SwiperInstance} from "swiper";
import {canRotate} from "../lib/gamificationModel";

/** Shared Inicio policy. A manual gesture pauses until the view unmounts. */
export function useHomeCarousel(enabled = true, blocked = false) {
  const engine = useRef<SwiperInstance|null>(null);
  const changing = useRef(false);
  const policy = useRef({hover:false, focus:false, manual:false, reduced:true, enabled, blocked});
  const [reduced, setReduced] = useState(true);
  policy.current.enabled = enabled;
  policy.current.blocked = blocked;
  function sync() {
    const s = engine.current, p = policy.current;
    if (!s || s.destroyed || changing.current) return;
    const run = p.enabled && !p.blocked && !p.focus && canRotate({reduced:p.reduced, paused:p.manual, hover:p.hover, hidden:document.hidden});
    if (run) {
      if (!s.autoplay.running) s.autoplay.start();
      else if (s.autoplay.paused) s.autoplay.resume();
    } else {
      changing.current=true;
      if (s.autoplay.running && s.autoplay.paused) s.autoplay.resume();
      s.autoplay.stop();
      changing.current=false;
    }
  }
  function manual() { policy.current.manual = true; sync(); }
  function select(index:number) { manual(); engine.current?.slideToLoop(index, policy.current.reduced?0:280); }
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {policy.current.reduced=media.matches;setReduced(media.matches);sync();};
    change();media.addEventListener("change",change);document.addEventListener("visibilitychange",sync);
    return () => {media.removeEventListener("change",change);document.removeEventListener("visibilitychange",sync);};
  }, []);
  useEffect(sync, [enabled,blocked]);
  return {engine, reduced, sync, manual, select,
    bind(s:SwiperInstance) {engine.current=s;sync();},
    hover(value:boolean) {policy.current.hover=value;sync();},
    focus(value:boolean) {policy.current.focus=value;sync();},
  };
}
