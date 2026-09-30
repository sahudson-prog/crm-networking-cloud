"use client";

import { useEffect } from "react";

let activeLocks = 0;
let bodyOverflow = "";
let documentOverflow = "";

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    return lockBodyScroll();
  }, [active]);
}

export function lockBodyScroll() {
  if (typeof document === "undefined") return () => {};
  if (activeLocks === 0) {
    bodyOverflow = document.body.style.overflow;
    documentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  activeLocks += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks !== 0) return;
    document.body.style.overflow = bodyOverflow;
    document.documentElement.style.overflow = documentOverflow;
  };
}
