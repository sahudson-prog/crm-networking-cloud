import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger" | "positive";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  tone?: ButtonTone;
  square?: boolean;
  children?: ReactNode;
};

export function Button({
  icon,
  tone = "secondary",
  square = false,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const label = typeof children === "string" ? children : props["aria-label"];
  return (
    <button
      className={`button ${tone} ${square ? "square" : ""} ${className}`}
      title={label}
      type="button"
      {...props}
    >
      {icon ? <Icon name={icon} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
