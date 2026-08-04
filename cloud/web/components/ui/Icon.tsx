type IconName =
  | "arrowLeft"
  | "arrowRight"
  | "check"
  | "close"
  | "collapse"
  | "edit"
  | "expand"
  | "plus"
  | "sync"
  | "settings"
  | "sparkles"
  | "mail"
  | "phone"
  | "chat"
  | "calendar"
  | "target"
  | "users"
  | "trash"
  | "search"
  | "link"
  | "history"
  | "user";

const paths: Record<IconName, string> = {
  arrowLeft: "M19 12H5m0 0 6-6m-6 6 6 6",
  arrowRight: "M5 12h14m0 0-6-6m6 6-6 6",
  check: "m5 12 4 4L19 6",
  close: "M6 6l12 12M18 6 6 18",
  collapse: "M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5",
  edit: "M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Zm11-13 2 2",
  expand: "M3 9V4h5m8 0h5v5M3 15v5h5m13-5v5h-5",
  plus: "M12 5v14M5 12h14",
  sync: "M20 12a8 8 0 0 1-14.7 4.4M4 12a8 8 0 0 1 14.7-4.4M7 17H5v-2M17 7h2v2",
  settings:
    "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Zm7.4-3.5a7.3 7.3 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1l-.3-2.6h-4l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.3 7.3 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1Z",
  sparkles: "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Zm6 10 1 2.2 2 1-2 1-1 2.2-1-2.2-2-1 2-1 1-2.2ZM5 13l.8 1.7L7.5 15l-1.7.8L5 17.5l-.8-1.7L2.5 15l1.7-.8L5 13Z",
  mail: "M4 6h16v12H4V6Zm0 1 8 6 8-6",
  phone: "M7 4h4l1 5-2.5 1.5a11 11 0 0 0 4 4L15 12l5 1v4c0 1-1 2-2 2A15 15 0 0 1 5 6c0-1 1-2 2-2Z",
  chat: "M5 6h14v9H9l-4 3V6Z",
  calendar: "M7 4v3m10-3v3M5 8h14M6 6h12v14H6V6Z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 5v2h14v-2c0-3-3-5-7-5Zm8-1a3 3 0 1 0 0-6m0 8c2.8 0 5 1.4 5 3.5V20h-4",
  trash: "M5 7h14M10 11v6m4-6v6M8 7l1-3h6l1 3m-9 0 1 13h8l1-13",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4",
  link: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  history: "M3 12a9 9 0 1 0 3-6.7M3 5v5h5M12 7v5l3 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z"
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export type { IconName };
