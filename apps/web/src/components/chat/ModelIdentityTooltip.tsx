/** The identity a picker row or the composer trigger truncates: name, provider, channel, slug. */
export function ModelIdentityTooltipContent(props: {
  name: string;
  /** The provider instance's display name, such as "OpenCode". */
  providerDisplayName?: string | undefined;
  /** The channel inside that provider, such as "OpenCode Go". */
  source?: string | undefined;
  /** The model id people paste into configs, when the provider reports one. */
  slug?: string | undefined;
}) {
  const provider = [props.providerDisplayName, props.source].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-model-identity-tooltip="true">
      <span className="font-medium text-foreground">{props.name}</span>
      {provider ? <span className="text-muted-foreground">{provider}</span> : null}
      {props.slug ? (
        <span className="font-mono text-3xs text-muted-foreground/70">{props.slug}</span>
      ) : null}
    </div>
  );
}
