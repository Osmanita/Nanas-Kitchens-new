import type { ReactNode } from "react";
import Icon from "./Icon";
import styles from "../marketplace.module.css";

export function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={styles.intro}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.subtitle}>{description}</p>}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon name="bowl" width={28} height={28} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  );
}

const labels: Record<string, string> = {
  pending: "Awaiting payment",
  confirmed: "Waiting for the kitchen",
  accepted: "Accepted",
  preparing: "Being prepared",
  ready: "Ready",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};
export function OrderStatus({ status }: { status: string }) {
  return (
    <span className={styles.status} data-status={status}>
      {labels[status] ?? status}
    </span>
  );
}
