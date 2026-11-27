import type { ReactNode } from "react";

/** One section of a Tot's settings: the same header everywhere they show. */
export function TotSettingsSection(props: {
  /** An anchor, so a link can open the settings at this section. */
  readonly id?: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** A switch or button beside the title. */
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <section id={props.id} className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground text-sm">{props.title}</h3>
          {props.description ? (
            <p className="text-muted-foreground text-xs">{props.description}</p>
          ) : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/** What a Tot settings list says when it has nothing in it. */
export function TotSettingsEmpty(props: { readonly children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border/60 px-2.5 py-2 text-muted-foreground text-xs">
      {props.children}
    </p>
  );
}
