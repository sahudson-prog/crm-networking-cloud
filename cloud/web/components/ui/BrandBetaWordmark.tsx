export const BRAND_BETA_ENABLED: boolean = true;
export const BRAND_ACCESSIBLE_NAME = BRAND_BETA_ENABLED ? "Coffeecito Beta" : "Coffeecito";

export function BrandBetaWordmark({ className = "" }: { className?: string }) {
  if (!BRAND_BETA_ENABLED) {
    return <span className={className || undefined}>Coffeecito</span>;
  }

  return (
    <span aria-hidden="true" className={`brand-beta-wordmark ${className}`.trim()}>
      Coffeecito
      <span className="brand-beta-mark">BETA</span>
    </span>
  );
}
