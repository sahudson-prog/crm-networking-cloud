import Link from "next/link";

export function LegalAcceptanceCheckbox({
  checked,
  id,
  onChange
}: {
  checked: boolean;
  id: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="legal-acceptance-checkbox">
      <input
        checked={checked}
        id={id}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <label htmlFor={id}>
        Acepto los{" "}
        <Link href="/terminos" rel="noreferrer" target="_blank">Términos de Servicio</Link>
        {" "}y declaro haber leído la{" "}
        <Link href="/privacidad" rel="noreferrer" target="_blank">Política de Privacidad</Link>.
      </label>
    </div>
  );
}
