export type ProviderIconName = "google" | "apple" | "microsoft";

type ProviderButtonProps = {
  disabled?: boolean;
  label: string;
  name: ProviderIconName;
  onClick?: () => void;
};

export function ProviderButton({ disabled = false, label, name, onClick }: ProviderButtonProps) {
  return (
    <button
      aria-disabled={disabled}
      aria-label={label}
      className={`provider-sync-button ${disabled ? "disabled" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <ProviderIcon name={name} />
    </button>
  );
}

export function ProviderIcon({ name }: { name: ProviderIconName }) {
  if (name === "google") return <GoogleIcon />;
  if (name === "apple") return <AppleIcon />;
  return <MicrosoftIcon />;
}

function GoogleIcon() {
  return (
    <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4a4.7 4.7 0 0 1-2 3.1v2.6h3.2c1.9-1.7 3-4.2 3-7.4Z"
        fill="#4285f4"
      />
      <path
        d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 .9-3.4.9a6 6 0 0 1-5.7-4.1H3v2.7A10 10 0 0 0 12 22Z"
        fill="#34a853"
      />
      <path
        d="M6.3 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9l3.3-2.7Z"
        fill="#fbbc05"
      />
      <path
        d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2a10 10 0 0 0-9 5.5l3.3 2.7A6 6 0 0 1 12 6.1Z"
        fill="#ea4335"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="provider-icon provider-icon-mono" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.8 13.1c0-2 1.7-3 1.8-3.1-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.5-.7-1.3 0-2.5.8-3.2 1.9-1.4 2.5-.4 6.1 1 8.1.7 1 1.5 2.1 2.5 2 .9 0 1.3-.6 2.4-.6s1.5.6 2.5.6 1.7-1 2.4-2c.8-1.1 1.1-2.2 1.1-2.3 0 0-2.2-.9-2.2-3Zm-1.9-6c.6-.7 1-1.6.9-2.6-.9 0-1.8.6-2.4 1.2-.5.6-1 1.6-.9 2.5.9.1 1.8-.4 2.4-1.1Z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3h8.5v8.5H3V3Z" fill="#f25022" />
      <path d="M12.5 3H21v8.5h-8.5V3Z" fill="#7fba00" />
      <path d="M3 12.5h8.5V21H3v-8.5Z" fill="#00a4ef" />
      <path d="M12.5 12.5H21V21h-8.5v-8.5Z" fill="#ffb900" />
    </svg>
  );
}
