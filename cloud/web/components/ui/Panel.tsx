import type { ReactNode } from "react";
import { Button } from "./Button";
import type { IconName } from "./Icon";

type PanelProps = {
  title: string;
  caption?: string;
  action?: {
    label: string;
    icon: IconName;
  };
  children: ReactNode;
  className?: string;
};

export function Panel({ title, caption, action, children, className = "" }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          {caption ? <span className="panel-caption">{caption}</span> : null}
        </div>
        {action ? <Button icon={action.icon} square aria-label={action.label} /> : null}
      </div>
      {children}
    </section>
  );
}
