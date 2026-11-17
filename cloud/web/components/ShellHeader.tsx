import Link from "next/link";
import type { ReactNode } from "react";
import { BrandBetaWordmark, BRAND_ACCESSIBLE_NAME } from "./ui/BrandBetaWordmark";

/** Shared visual header; onboarding omits navigation without changing the brand. */
export function ShellHeader({ actions, linkedBrand = true }: { actions?: ReactNode; linkedBrand?: boolean }) {
  const brand = <><img src="/brand/coffeecito-isotipo.svg" alt="" aria-hidden="true" /><BrandBetaWordmark /></>;
  return <header className="shell-header-v2">
    {linkedBrand
      ? <Link href="/" aria-label={BRAND_ACCESSIBLE_NAME} className="shell-brand-lockup">{brand}</Link>
      : <div aria-label={BRAND_ACCESSIBLE_NAME} className="shell-brand-lockup">{brand}</div>}
    {actions ? <div className="shell-header-actions">{actions}</div> : null}
  </header>;
}
