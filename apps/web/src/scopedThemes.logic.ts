import * as Schema from "effect/Schema";

/** Themes a user assigned to a part of the app, by the id of what they belong to. */
export const ScopedThemes = Schema.Struct({
  projects: Schema.Record(Schema.String, Schema.String),
  groups: Schema.Record(Schema.String, Schema.String),
  tots: Schema.Record(Schema.String, Schema.String),
});
export type ScopedThemes = typeof ScopedThemes.Type;

export const EMPTY_SCOPED_THEMES: ScopedThemes = { projects: {}, groups: {}, tots: {} };

export type ScopedThemeKind = keyof ScopedThemes;

export const scopedThemeKey = (environmentId: string, id: string) => `${environmentId}:${id}`;

/**
 * The theme a thread shows: its Tot's, else its project's, else its thread group's, else none,
 * which leaves the app's own theme. A group's theme only reaches projects with none of their own.
 */
export function resolveScopedThemeId(
  scoped: ScopedThemes,
  scopes: {
    readonly tot?: string | null;
    readonly project?: string | null;
    readonly group?: string | null;
  },
): string | null {
  return (
    (scopes.tot == null ? undefined : scoped.tots[scopes.tot]) ??
    (scopes.project == null ? undefined : scoped.projects[scopes.project]) ??
    (scopes.group == null ? undefined : scoped.groups[scopes.group]) ??
    null
  );
}

/** `themeId: null` goes back to inheriting. */
export function withScopedTheme(
  scoped: ScopedThemes,
  kind: ScopedThemeKind,
  key: string,
  themeId: string | null,
): ScopedThemes {
  const { [key]: _removed, ...rest } = scoped[kind];
  return { ...scoped, [kind]: themeId === null ? rest : { ...rest, [key]: themeId } };
}
