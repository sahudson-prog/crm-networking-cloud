import { Button } from "./ui/Button";

type ContactDeactivationConfirmDialogProps = {
  busy?: boolean;
  contactCount: number;
  contactName?: string;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ContactDeactivationConfirmDialog({
  busy = false,
  contactCount,
  contactName,
  error,
  onCancel,
  onConfirm
}: ContactDeactivationConfirmDialogProps) {
  const isSingleContact = contactCount === 1;
  const title = isSingleContact ? "Eliminar contacto" : "Eliminar contactos";
  const description = isSingleContact
    ? `¿Quieres quitar a ${contactName || "este contacto"} de tu red activa? Su historial se conservará.`
    : `¿Quieres quitar ${contactCount} contactos de tu red activa? Su historial se conservará.`;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card contact-deactivation-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-deactivation-title">
        <header className="modal-head">
          <div>
            <h2 id="contact-deactivation-title">{title}</h2>
            <p>{description}</p>
          </div>
          <Button aria-label="Cerrar confirmacion" disabled={busy} icon="close" onClick={onCancel} square />
        </header>
        {error ? <p className="danger-text" role="alert">{error}</p> : null}
        <footer className="modal-actions">
          <Button disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button className="contact-deactivation-confirm-action" disabled={busy} icon="trash" onClick={onConfirm}>
            {busy ? "Eliminando..." : isSingleContact ? "Eliminar contacto" : "Eliminar seleccion"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
