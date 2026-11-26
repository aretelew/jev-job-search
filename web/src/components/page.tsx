import type { ReactNode } from "react";

/** A screen's heading, the line under it, and what sits at its right. */
export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl leading-7 font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A titled group of cards on one screen. */
export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        {count !== undefined ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}
