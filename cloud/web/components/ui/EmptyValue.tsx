import type { ReactNode } from "react";

export function EmptyValue({ children }: { children: ReactNode }) {
  return <span className="empty-value">{children}</span>;
}
