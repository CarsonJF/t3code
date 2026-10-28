import { isNamedProjectColor, projectColorStop } from "@t3tools/client-runtime/thread-groups";
import { CustomColor, type ProjectColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { PROJECT_ICON_COLORS } from "../projectIconOptions";
import { cn } from "~/lib/utils";
import { Input } from "./ui/input";

const isCustomColor = Schema.is(CustomColor);

const toHex = (hex: string, alpha: number) =>
  alpha >= 1
    ? hex
    : `${hex}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0")}`;

const swatchClassName =
  "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Palette swatches plus a free RGBA color: a picker, an alpha slider and a hex field. */
export function ColorPicker(props: {
  readonly label: string;
  readonly value: ProjectColor | null;
  readonly onChange: (color: ProjectColor) => void;
}) {
  const { value, onChange } = props;
  const custom = value !== null && !isNamedProjectColor(value);
  const stop = custom ? projectColorStop(value) : null;
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const baseHex = stop?.hex ?? "#3b82f6";
  const alpha = stop?.alpha ?? 1;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={props.label}>
        {PROJECT_ICON_COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={value === option.value}
            className={cn(swatchClassName, value === option.value && "border-foreground/64")}
            onClick={() => onChange(option.value)}
          >
            <span className={cn("size-4 rounded-full", option.swatchClassName)} />
          </button>
        ))}
        <button
          type="button"
          aria-label="Custom color"
          aria-pressed={custom}
          className={cn(swatchClassName, custom && "border-foreground/64")}
          onClick={() => onChange(toHex(baseHex, alpha))}
        >
          <span
            className="size-4 rounded-full"
            style={{
              background: custom
                ? value
                : "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #d946ef, #ef4444)",
            }}
          />
        </button>
      </div>
      {custom ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${props.label}, pick color`}
            className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
            value={baseHex}
            onChange={(event) => onChange(toHex(event.target.value, alpha))}
          />
          <input
            type="range"
            aria-label={`${props.label}, opacity`}
            className="min-w-0 flex-1"
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            onChange={(event) => onChange(toHex(baseHex, Number(event.target.value) / 100))}
          />
          <Input
            nativeInput
            aria-label={`${props.label}, hex`}
            className="w-28"
            maxLength={9}
            value={hexDraft ?? value}
            onChange={(event) => {
              const next = event.target.value;
              setHexDraft(next);
              if (isCustomColor(next)) onChange(next);
            }}
            onBlur={() => setHexDraft(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
