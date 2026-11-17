import { TOT_ACCESSORY_LABELS, totAccessoryColor } from "@t3tools/client-runtime/tots/accessories";
import {
  TOT_SKIN_SERIES,
  totSkinsIn,
  type TotSkinSeries,
} from "@t3tools/client-runtime/tots/skins";
import {
  TOT_ACCESSORY_KINDS,
  TOT_SHAPES,
  type TotAccessory,
  type TotAccessoryKind,
  type TotAvatar,
  type TotShape,
} from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { TotAvatar as TotFace } from "./TotAvatar";

const COLOR_CHOICES = ["#0A7EA4", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#475569"];
export const TOT_FACE_COLORS = COLOR_CHOICES;

export const totFaceOf = (
  color: string,
  skin: number | null,
  shape: TotShape,
  antenna: boolean,
  accessories: ReadonlyArray<TotAccessory> = [],
): TotAvatar => ({
  color,
  ...(skin === null ? {} : { skin }),
  ...(shape === "round" ? {} : { shape }),
  ...(antenna ? { antenna } : {}),
  ...(accessories.length === 0 ? {} : { accessories }),
});

/** The face controls from the Tot editor, shared with the Tot settings panel. */
export function TotFaceEditor(props: {
  readonly value: TotAvatar;
  readonly onChange: (value: TotAvatar) => void;
  readonly skinSeries: TotSkinSeries;
  readonly onSkinSeriesChange: (series: TotSkinSeries) => void;
  readonly error?: string | undefined;
  readonly children?: ReactNode;
}) {
  const { value, skinSeries } = props;
  const color = value.color;
  const skin = value.skin ?? null;
  const shape = value.shape ?? "round";
  const antenna = value.antenna === true;
  const accessories = value.accessories ?? [];
  const worn = (kind: TotAccessoryKind) => accessories.find((entry) => entry.kind === kind);
  const wearing = (kind: TotAccessoryKind, accessory: TotAccessory | null): TotAccessory[] => [
    ...accessories.filter((entry) => entry.kind !== kind),
    ...(accessory === null ? [] : [accessory]),
  ];
  const face = (overrides: {
    color?: string;
    skin?: number | null;
    shape?: TotShape;
    antenna?: boolean;
    accessories?: ReadonlyArray<TotAccessory>;
  }): TotAvatar =>
    totFaceOf(
      overrides.color ?? color,
      overrides.skin === undefined ? skin : overrides.skin,
      overrides.shape ?? shape,
      overrides.antenna === undefined ? antenna : overrides.antenna,
      overrides.accessories ?? accessories,
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {COLOR_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-label={`Color ${choice}`}
            aria-pressed={color === choice}
            className="size-6 rounded-full border border-border aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-ring"
            style={{ backgroundColor: choice }}
            onClick={() => props.onChange(face({ color: choice }))}
          />
        ))}
        <Input
          aria-label="Color"
          className="w-24"
          value={color}
          aria-invalid={props.error !== undefined}
          onChange={(event) => props.onChange(face({ color: event.target.value }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Shape" role="group">
        {TOT_SHAPES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-label={`Shape ${choice}`}
            aria-pressed={shape === choice}
            className="rounded-md border border-transparent p-0.5 aria-pressed:border-ring"
            onClick={() => props.onChange(face({ shape: choice }))}
          >
            <TotFace
              avatar={totFaceOf(color, skin, choice, antenna, accessories)}
              state="idle"
              animation="still"
              size={28}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Accessories" role="group">
        {TOT_ACCESSORY_KINDS.map((kind) => {
          const accessory = worn(kind);
          return (
            <div
              key={kind}
              className="flex items-center gap-1 rounded-md border border-border p-0.5"
            >
              <button
                type="button"
                aria-label={
                  accessory === undefined
                    ? `Wear ${TOT_ACCESSORY_LABELS[kind]}`
                    : `Remove ${TOT_ACCESSORY_LABELS[kind]}`
                }
                aria-pressed={accessory !== undefined}
                className="rounded px-1.5 py-1 text-xs aria-pressed:bg-muted aria-pressed:text-foreground"
                onClick={() =>
                  props.onChange(
                    face({
                      accessories: wearing(kind, accessory === undefined ? { kind } : null),
                    }),
                  )
                }
              >
                {TOT_ACCESSORY_LABELS[kind]}
              </button>
              {accessory === undefined ? null : (
                <input
                  type="color"
                  aria-label={`${TOT_ACCESSORY_LABELS[kind]} color`}
                  className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                  value={totAccessoryColor(accessory)}
                  onChange={(event) =>
                    props.onChange(
                      face({ accessories: wearing(kind, { kind, color: event.target.value }) }),
                    )
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {props.children}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Antenna</span>
        <Switch
          aria-label="Antenna"
          checked={antenna}
          onCheckedChange={(checked) => props.onChange(face({ antenna: checked }))}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Skin</span>
        <Select
          value={String(skinSeries.series)}
          onValueChange={(series) =>
            props.onSkinSeriesChange(
              TOT_SKIN_SERIES.find((entry) => String(entry.series) === series) ?? skinSeries,
            )
          }
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Skin series">
            <SelectValue>{skinSeries.title}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {TOT_SKIN_SERIES.map((entry) => (
              <SelectItem key={entry.series} value={String(entry.series)}>
                {entry.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[null, ...totSkinsIn(skinSeries)].map((choice) => (
          <button
            key={choice ?? "flat"}
            type="button"
            aria-label={choice === null ? "No skin" : `Skin ${choice}`}
            aria-pressed={skin === choice}
            className="rounded-md border border-transparent p-0.5 aria-pressed:border-ring"
            onClick={() => props.onChange(face({ skin: choice }))}
          >
            <TotFace
              avatar={totFaceOf(color, choice, shape, antenna, accessories)}
              state="idle"
              animation="still"
              size={28}
            />
          </button>
        ))}
      </div>
      {props.error ? <p className="text-destructive-foreground text-xs">{props.error}</p> : null}
    </div>
  );
}
