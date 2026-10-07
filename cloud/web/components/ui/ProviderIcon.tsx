export type ProviderIconName = "google" | "gmail" | "googleCalendar" | "apple" | "microsoft";

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
  if (name === "gmail") return <GmailIcon />;
  if (name === "googleCalendar") return <GoogleCalendarIcon />;
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

function GmailIcon() {
  return (
    <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6.5 12 13l9-6.5V19H3V6.5Z" fill="#fff" />
      <path d="M3 6.5 7 9.4V19H3V6.5Z" fill="#4285f4" />
      <path d="M17 9.4 21 6.5V19h-4V9.4Z" fill="#34a853" />
      <path d="M3 6.5 5.3 4.8 12 9.7l6.7-4.9L21 6.5 12 13 3 6.5Z" fill="#ea4335" />
      <path d="M3 6.5V19" stroke="#c5221f" strokeWidth="1.6" />
      <path d="M21 6.5V19" stroke="#fbbc04" strokeWidth="1.6" />
    </svg>
  );
}

function GoogleCalendarIcon() {
  return (
    <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v15H4V5Z" fill="#fff" />
      <path d="M4 5h16v4H4V5Z" fill="#4285f4" />
      <path d="M4 9h4v11H4V9Z" fill="#34a853" />
      <path d="M8 16h12v4H8v-4Z" fill="#fbbc04" />
      <path d="M16 9h4v7h-4V9Z" fill="#ea4335" />
      <text x="12" y="15.2" fill="#4285f4" fontSize="7.5" fontWeight="800" textAnchor="middle">31</text>
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
