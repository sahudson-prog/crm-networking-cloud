import type { ReactNode } from "react";
import { Button } from "./Button";
import type { IconName } from "./Icon";
import { OperationStatus } from "./OperationStatus";
import type { OperationState } from "../../lib/operationState";

type PanelProps = {
  title: string;
  icon?: ReactNode;
  caption?: ReactNode;
  action?: {
    label: string;
    icon: IconName;
  };
  children: ReactNode;
  className?: string;
  status?: OperationState;
};

export function Panel({ title, icon, caption, action, children, className = "", status }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{icon}{title}{status ? <OperationStatus label={title} {...status} /> : null}</h2>
          {caption ? <span className="panel-caption">{caption}</span> : null}
        </div>
        {action ? <Button icon={action.icon} square aria-label={action.label} /> : null}
      </div>
      {children}
    </section>
  );
}
