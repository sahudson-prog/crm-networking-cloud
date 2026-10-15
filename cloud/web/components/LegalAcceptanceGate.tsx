import { LegalAcceptanceCheckbox } from "./LegalAcceptanceCheckbox";
import { Button } from "./ui/Button";

export function LegalAcceptanceGate({
  accepting,
  checked,
  error,
  onAccept,
  onCheckedChange,
  onSignOut
}: {
  accepting: boolean;
  checked: boolean;
  error?: string;
  onAccept: () => void;
  onCheckedChange: (checked: boolean) => void;
  onSignOut: () => void;
}) {
  return (
    <main className="legal-acceptance-shell">
      <div aria-hidden="true" className="onboarding-intro-background" />
      <section aria-labelledby="legal-acceptance-title" className="legal-acceptance-panel">
        <div aria-label="Coffeecito" className="onboarding-brand-lockup legal-acceptance-brand">
          <img alt="" aria-hidden="true" src="/brand/coffeecito-isotipo.svg" />
          <span>Coffeecito</span>
        </div>
        <div className="legal-acceptance-copy">
          <h1 id="legal-acceptance-title">Antes de continuar</h1>
          <p>
            Para usar Coffeecito, debes aceptar los Términos de Servicio. También te pedimos confirmar que has leído la
            Política de Privacidad, donde explicamos cómo tratamos datos personales y cómo puedes ejercer tus derechos.
          </p>
        </div>
        <LegalAcceptanceCheckbox
          checked={checked}
          id="post-auth-legal-acceptance"
          onChange={onCheckedChange}
        />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="legal-acceptance-actions">
          <Button disabled={!checked || accepting} onClick={onAccept} tone="primary">
            {accepting ? "Registrando..." : "Aceptar y continuar"}
          </Button>
          <Button disabled={accepting} icon="close" onClick={onSignOut} tone="ghost">
            Cerrar sesión
          </Button>
        </div>
      </section>
    </main>
  );
}
