import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformEffect({
      decode: (raw) => {
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined && raw.options !== null) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          instanceId: value.instanceId,
          model: value.model,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

// `claude` is what people call the default Claude instance, whose id is its driver's.
const ACCOUNT_SHORTHAND_INSTANCE_ALIASES: Readonly<Record<string, string>> = {
  claude: "claudeAgent",
};
const ACCOUNT_SHORTHAND_PATTERN =
  /^([a-zA-Z][a-zA-Z0-9_-]*)(?:@([a-zA-Z0-9][a-zA-Z0-9_-]*))?:(\S(?:.*\S)?)$/;

/**
 * `<instance>[@<account>]:<model>` as a model selection, or null when it is not one. Another
 * account of an instance is the instance `<instance>_<account>`, the id adding an account named
 * `<account>` gives it; `@default` is the instance itself.
 */
const parseAccountModelShorthand = (
  text: string,
): { readonly instanceId: string; readonly model: string } | null => {
  const match = ACCOUNT_SHORTHAND_PATTERN.exec(text.trim());
  if (match === null) return null;
  const [, rawBase = "", account, model = ""] = match;
  const base = ACCOUNT_SHORTHAND_INSTANCE_ALIASES[rawBase] ?? rawBase;
  const instanceId =
    account === undefined || account.toLowerCase() === "default" ? base : `${base}_${account}`;
  return instanceId.length > 64 ? null : { instanceId, model };
};

const AccountModelShorthand = Schema.String.check(
  Schema.makeFilter((text) => parseAccountModelShorthand(text) !== null, {
    identifier: "AccountModelShorthand",
    description: "<instance>[@<account>]:<model>, such as claude@acct2:claude-opus-5-5",
  }),
).pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transform({
      decode: (text) => {
        const parsed = parseAccountModelShorthand(text)!;
        return { instanceId: parsed.instanceId, model: parsed.model };
      },
      encode: (selection) => `${selection.instanceId}:${selection.model}`,
    }),
  ),
);

/** A usage-limit fallback: a model selection, or the shorthand that can name an account. */
export const UsageLimitFallbackModel = Schema.Union([ModelSelection, AccountModelShorthand]);
