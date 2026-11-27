import type { ReactNode } from "react";

/** What a section is for, at the top of its card, under the section's own title. */
export function SettingsSectionIntro(props: { readonly children: ReactNode }) {
  return (
    <p className="px-3 py-3 text-muted-foreground text-xs leading-relaxed sm:px-4">
      {props.children}
    </p>
  );
}
