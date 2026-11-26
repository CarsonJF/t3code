import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ModelSelection, UsageLimitFallbackModel } from "./modelSelection.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);
const decodeFallbacks = Schema.decodeUnknownEffect(Schema.Array(UsageLimitFallbackModel));
const encodeFallbacks = Schema.encodeUnknownEffect(Schema.Array(UsageLimitFallbackModel));

it.effect("ModelSelection migrates legacy `provider` field to `instanceId`", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex"));
    assert.strictEqual(parsed.model, "gpt-5-codex");
    assert.deepStrictEqual(parsed.options, [{ id: "reasoningEffort", value: "high" }]);
  }),
);

it.effect("ModelSelection prefers explicit instanceId over legacy provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect("ModelSelection treats null options as omitted", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      instanceId: "codex",
      model: "gpt-5",
      options: null,
    });
    assert.deepStrictEqual(parsed, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    });
  }),
);

it.effect(
  "ModelSelection decodes unknown driver kinds via legacy provider (rollback / fork invariant)",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeModelSelection({
        provider: "ollama",
        model: "llama3:70b",
        options: [{ id: "temperature", value: "0.4" }],
      });
      assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("ollama"));
      assert.strictEqual(parsed.model, "llama3:70b");
    }),
);

it.effect(
  "normalizes legacy object-shaped options on decode and re-encodes as a canonical array",
  () =>
    Effect.gen(function* () {
      const decoded = yield* decodeModelSelection({
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: {
          effort: "max",
          fastMode: true,

          emptyStr: "   ",
          nullish: null,
          nested: { foo: 1 },
        },
      });
      assert.deepStrictEqual(decoded.options, [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ]);
      const encoded = yield* encodeModelSelection(decoded);
      assert.deepStrictEqual(encoded.options, decoded.options);
    }),
);

it.effect(
  "a usage-limit fallback can name an account with the instance@account:model shorthand",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeFallbacks([
        "claude@acct2:claude-opus-5-5",
        "claudeAgent@default:claude-opus-5-5",
        "codex:gpt-5.5",
        "opencode:ollama/llama3:8b",
        { instanceId: "codex_work", model: "gpt-5.5" },
      ]);
      assert.deepStrictEqual(parsed, [
        { instanceId: ProviderInstanceId.make("claudeAgent_acct2"), model: "claude-opus-5-5" },
        { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" },
        { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
        { instanceId: ProviderInstanceId.make("opencode"), model: "ollama/llama3:8b" },
        { instanceId: ProviderInstanceId.make("codex_work"), model: "gpt-5.5" },
      ]);
      // Saved settings keep the object form.
      const encoded = yield* encodeFallbacks(parsed);
      assert.deepStrictEqual(encoded[0], {
        instanceId: "claudeAgent_acct2",
        model: "claude-opus-5-5",
      });
      for (const bad of ["claude-opus-5-5", "@acct2:model", "claude@:model", "claude@a b:model"]) {
        const result = yield* Effect.result(decodeFallbacks([bad]));
        assert.isTrue(result._tag === "Failure", bad);
      }
    }),
);
