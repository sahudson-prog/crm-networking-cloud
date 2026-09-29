import { Button } from "./ui/Button";

type ContactDeactivationButtonProps = {
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

export function ContactDeactivationButton({ disabled, label, onClick }: ContactDeactivationButtonProps) {
  return (
    <Button
      aria-label={label}
      className="contact-deactivation-button"
      disabled={disabled}
      icon="trash"
      onClick={onClick}
      square
    />
  );
}
