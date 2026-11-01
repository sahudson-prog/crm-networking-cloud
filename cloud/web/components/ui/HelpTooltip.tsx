"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Small hover/focus help; Escape dismisses it without moving keyboard focus. */
export function HelpTooltip({ text, children, className = "", style, label, floating = false }: {
  text: string; children: ReactNode; className?: string; style?: CSSProperties; label?: string; floating?: boolean;
}) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!floating || !open || dismissed) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const help = popup.current?.getBoundingClientRect();
      if (!rect || !help) return;
      const left = Math.max(8, Math.min(rect.left + (rect.width - help.width) / 2, window.innerWidth - help.width - 8));
      const above = rect.top - help.height - 6;
      const top = Math.max(8, Math.min(above >= 8 ? above : rect.bottom + 6, window.innerHeight - help.height - 8));
      setPosition({ left, top });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [floating, open, dismissed, text]);
  const show = () => { setDismissed(false); setPosition(null); setOpen(true); };
  const visible = open && !dismissed;
  return <>
    <span ref={anchor} className={`help-tooltip ${className}`} style={style} tabIndex={0}
      aria-label={label} aria-describedby={visible ? id : undefined} data-dismissed={dismissed || undefined}
      onMouseEnter={show} onMouseLeave={() => { if (document.activeElement !== anchor.current) setOpen(false); }}
      onFocus={show} onBlur={() => setOpen(false)}
      onKeyDown={e => { if (e.key === "Escape") { setDismissed(true); setOpen(false); e.stopPropagation(); } }}>
      {children}{!floating ? <span id={id} role="tooltip" className="help-tooltip-content">{text}</span> : null}
    </span>
    {floating && visible && typeof document !== "undefined" ? createPortal(
      <span ref={popup} id={id} role="tooltip" className="help-tooltip-content help-tooltip-floating"
        style={position ?? { visibility: "hidden", left: 0, top: 0 }}>{text}</span>, document.body) : null}
  </>;
}
