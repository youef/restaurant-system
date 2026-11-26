import type { ReactNode, ButtonHTMLAttributes } from "react";

export interface Metric {
  label: string;
  value: string;
  detail?: string;
}

interface PortalFrameProps {
  eyebrow: string;
  title: string;
  description: string;
  metrics?: Metric[];
  children?: ReactNode;
}

export function PortalFrame({ eyebrow, title, description, metrics = [], children }: PortalFrameProps) {
  return (
    <main className="portal" dir="rtl">
      <header className="portal-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="description">{description}</p>
        </div>
        <span className="brand-mark" aria-label="منصة الطلب">طَلَب</span>
      </header>
      {metrics.length > 0 && (
        <section className="metric-grid" aria-label="ملخص">
          {metrics.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail && <small>{metric.detail}</small>}
            </article>
          ))}
        </section>
      )}
      <section className="portal-content">{children}</section>
    </main>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">✦</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function ActionButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={["action-button", props.className].filter(Boolean).join(" ")} />;
}
