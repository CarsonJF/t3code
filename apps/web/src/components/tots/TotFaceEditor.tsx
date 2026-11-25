import {
  TOT_ACCESSORY_FALLBACK,
  totAccessoryBareId,
  totAccessoryChoices,
  totAccessoryColor,
  type TotAccessoryChoice,
} from "@t3tools/client-runtime/tots/accessories";
import {
  TOT_SKIN_SERIES,
  totSkinsIn,
  type TotSkinSeries,
} from "@t3tools/client-runtime/tots/skins";
import {
  TOT_BUILT_IN_THEMES,
  TOT_OPEN_BOT_MAX_DEPTH,
  TOT_SHAPES,
  type TotAccessory,
  type TotAvatar,
  type TotOpenBotAvatar,
  type TotOpenBotMaterial,
  type TotShape,
} from "@t3tools/contracts";
import { useEffect, useState, type ReactNode } from "react";

import type { AvatarDefinition } from "open-bot-avatar";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useAvatarLibrary } from "./avatarLibraryStore";
import { DEFAULT_OPEN_BOT, useOpenBotKit } from "./OpenBotFace";
import { loadBoopFace, TotAvatar as TotFace } from "./TotAvatar";

const OPEN_BOT_FINISHES: ReadonlyArray<{ id: TotOpenBotMaterial; label: string }> = [
  { id: "flat", label: "Flat" },
  { id: "fluffy", label: "Fluffy" },
  { id: "glass", label: "Glass" },
  { id: "soft", label: "Soft" },
];
/** open-bot-avatar's own ink, then a light one for dark bodies. */
const OPEN_BOT_EYE_COLORS = [
  { color: "#151515", label: "Dark" },
  { color: "#f8fafc", label: "Light" },
];

const COLOR_CHOICES = ["#0A7EA4", "#7C3AED", "#DB2777", "#EA580C", "#16A34A", "#475569"];
export const TOT_FACE_COLORS = COLOR_CHOICES;

/** The style fields of a face, kept apart from BoopFace's so switching back loses nothing. */
export type TotFaceLook = Pick<TotAvatar, "style" | "openBot">;

export const totFaceLookOf = (avatar: TotFaceLook | undefined): TotFaceLook => ({
  ...(avatar?.style === "open-bot" ? { style: avatar.style } : {}),
  ...(avatar?.openBot === undefined ? {} : { openBot: avatar.openBot }),
});

export const totFaceOf = (
  color: string,
  skin: number | null,
  shape: TotShape,
  antenna: boolean,
  accessories: ReadonlyArray<TotAccessory> = [],
  look: TotFaceLook = {},
): TotAvatar => ({
  color,
  ...(skin === null ? {} : { skin }),
  ...(shape === "round" ? {} : { shape }),
  ...(antenna ? { antenna } : {}),
  ...(accessories.length === 0 ? {} : { accessories }),
  ...totFaceLookOf(look),
});

/** The face controls from the Tot editor, shared with the Tot settings panel. */
export function TotFaceEditor(props: {
  readonly value: TotAvatar;
  readonly onChange: (value: TotAvatar) => void;
  readonly skinSeries: TotSkinSeries;
  readonly onSkinSeriesChange: (series: TotSkinSeries) => void;
  readonly error?: string | undefined;
  /** Opens Settings → Avatar library, where shapes are made and managed. */
  readonly onManageShapes?: (() => void) | undefined;
  readonly children?: ReactNode;
}) {
  const { value, skinSeries } = props;
  const color = value.color;
  const skin = value.skin ?? null;
  const shape = value.shape ?? "round";
  const antenna = value.antenna === true;
  const accessories = value.accessories ?? [];
  const look = totFaceLookOf(value);
  const openBot = value.style === "open-bot" ? (value.openBot ?? DEFAULT_OPEN_BOT) : null;
  const library = useAvatarLibrary();
  const themes = [
    ...TOT_BUILT_IN_THEMES.map((theme) => ({ theme, custom: false })),
    ...library.themes.map((theme) => ({ theme, custom: true })),
  ];
  const kit = useOpenBotKit(openBot !== null);
  const eyeColor = (openBot?.eyeColor ?? OPEN_BOT_EYE_COLORS[0]!.color).toLowerCase();
  const [accessoryChoices, setAccessoryChoices] =
    useState<ReadonlyArray<TotAccessoryChoice>>(TOT_ACCESSORY_FALLBACK);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the accessory catalog the loaded component ships
  useEffect(() => {
    let cancelled = false;
    void loadBoopFace()
      .then((module) => {
        if (!cancelled) setAccessoryChoices(totAccessoryChoices(module.listAccessories()));
      })
      .catch(() => {
        // The built-in list stays when the catalog cannot be read.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const worn = (choice: TotAccessoryChoice) =>
    accessories.find((entry) => totAccessoryBareId(entry.kind) === totAccessoryBareId(choice.id));
  const wearing = (choice: TotAccessoryChoice, accessory: TotAccessory | null): TotAccessory[] => [
    ...accessories.filter(
      (entry) => totAccessoryBareId(entry.kind) !== totAccessoryBareId(choice.id),
    ),
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
      look,
    );
  const boopFace = (): TotAvatar =>
    totFaceOf(
      color,
      skin,
      shape,
      antenna,
      accessories,
      value.openBot === undefined ? {} : { openBot: value.openBot },
    );
  const openBotFace = (next: TotOpenBotAvatar): TotAvatar =>
    totFaceOf(color, skin, shape, antenna, accessories, { style: "open-bot", openBot: next });
  const openBotWith = (overrides: Partial<TotOpenBotAvatar>): TotOpenBotAvatar => {
    const merged = { ...(openBot ?? DEFAULT_OPEN_BOT), ...overrides };
    return {
      figure: merged.figure,
      ...(merged.material === undefined || merged.material === "flat"
        ? {}
        : { material: merged.material }),
      ...(merged.depth === undefined ? {} : { depth: merged.depth }),
      ...(merged.eyeColor === undefined ? {} : { eyeColor: merged.eyeColor }),
    };
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5" aria-label="Style" role="group">
        <button
          type="button"
          aria-pressed={openBot === null}
          className="rounded-md border border-border px-2 py-1 text-muted-foreground text-xs aria-pressed:border-ring aria-pressed:bg-muted aria-pressed:text-foreground"
          onClick={() => props.onChange(boopFace())}
        >
          BoopFace
        </button>
        <button
          type="button"
          aria-pressed={openBot !== null}
          className="rounded-md border border-border px-2 py-1 text-muted-foreground text-xs aria-pressed:border-ring aria-pressed:bg-muted aria-pressed:text-foreground"
          onClick={() => props.onChange(openBotFace(openBot ?? value.openBot ?? DEFAULT_OPEN_BOT))}
        >
          Open Bot
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Face themes" role="group">
        {themes.map(({ theme, custom }) => (
          <button
            key={theme.id}
            type="button"
            aria-label={`Face theme ${theme.name}${custom ? " (custom)" : ""}`}
            className="flex items-center gap-1 rounded-md border border-border py-0.5 pr-2 pl-0.5 text-muted-foreground text-xs hover:text-foreground data-[custom-theme]:border-dashed"
            data-custom-theme={custom ? "" : undefined}
            onClick={() => props.onChange(theme.avatar)}
          >
            <TotFace avatar={theme.avatar} state="idle" animation="still" size={20} />
            {theme.name}
          </button>
        ))}
      </div>
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
      {openBot === null ? (
        <>
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
          <div
            className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto"
            aria-label="Accessories"
            role="group"
          >
            {accessoryChoices.map((choice) => {
              const accessory = worn(choice);
              return (
                <div
                  key={choice.id}
                  className="flex items-center gap-1 rounded-md border border-border p-0.5"
                >
                  <button
                    type="button"
                    aria-label={`${accessory === undefined ? "Wear" : "Remove"} ${choice.label}`}
                    aria-pressed={accessory !== undefined}
                    className="rounded px-1.5 py-1 text-xs aria-pressed:bg-muted aria-pressed:text-foreground"
                    onClick={() =>
                      props.onChange(
                        face({
                          accessories: wearing(
                            choice,
                            accessory === undefined ? { kind: choice.id } : null,
                          ),
                        }),
                      )
                    }
                  >
                    {choice.label}
                  </button>
                  {accessory === undefined ? null : (
                    <input
                      type="color"
                      aria-label={`${choice.label} color`}
                      className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      value={totAccessoryColor(accessory, accessoryChoices)}
                      onChange={(event) =>
                        props.onChange(
                          face({
                            accessories: wearing(choice, {
                              kind: choice.id,
                              color: event.target.value,
                            }),
                          }),
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
              <TotFace avatar={value} state="idle" animation="still" size={72} />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <FigurePicker
                color={color}
                selected={openBot.figure}
                figures={[
                  ...(kit?.figures ?? []).map((figure) => ({ figure, custom: false })),
                  ...library.figures.map((figure) => ({ figure, custom: true })),
                ]}
                onPick={(figure) => props.onChange(openBotFace(openBotWith({ figure })))}
              />
              {props.onManageShapes === undefined ? null : (
                <button
                  type="button"
                  className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
                  onClick={props.onManageShapes}
                >
                  Manage shapes…
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {props.children}
      {openBot === null ? (
        <>
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
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">Finish</span>
            <div className="flex items-center gap-1" aria-label="Finish" role="group">
              {OPEN_BOT_FINISHES.map((finish) => (
                <button
                  key={finish.id}
                  type="button"
                  aria-pressed={(openBot.material ?? "flat") === finish.id}
                  className="rounded-md border border-border px-2 py-1 text-muted-foreground text-xs aria-pressed:border-ring aria-pressed:bg-muted aria-pressed:text-foreground"
                  onClick={() => props.onChange(openBotFace(openBotWith({ material: finish.id })))}
                >
                  {finish.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">Depth</span>
            <input
              type="range"
              aria-label="Depth"
              className="w-48 accent-primary"
              min={0}
              max={TOT_OPEN_BOT_MAX_DEPTH}
              step={1}
              value={openBot.depth ?? 6}
              onChange={(event) =>
                props.onChange(openBotFace(openBotWith({ depth: Number(event.target.value) })))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">Eyes</span>
            <div className="flex items-center gap-1.5" aria-label="Eyes" role="group">
              {OPEN_BOT_EYE_COLORS.map((choice) => (
                <button
                  key={choice.color}
                  type="button"
                  aria-label={`${choice.label} eyes`}
                  aria-pressed={eyeColor === choice.color}
                  className="size-6 rounded-full border-2 border-muted-foreground/50 aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-ring"
                  style={{ backgroundColor: choice.color }}
                  onClick={() =>
                    props.onChange(openBotFace(openBotWith({ eyeColor: choice.color })))
                  }
                />
              ))}
              <label
                aria-pressed={!OPEN_BOT_EYE_COLORS.some((choice) => choice.color === eyeColor)}
                className="relative size-6 cursor-pointer rounded-full border-2 border-muted-foreground/50 aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-ring"
                style={{
                  background: `radial-gradient(circle, ${eyeColor} 0 38%, transparent 40%), conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)`,
                }}
              >
                <input
                  type="color"
                  aria-label="Eye color"
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                  value={eyeColor}
                  onChange={(event) =>
                    props.onChange(openBotFace(openBotWith({ eyeColor: event.target.value })))
                  }
                />
              </label>
            </div>
          </div>
        </>
      )}
      {props.error ? <p className="text-destructive-foreground text-xs">{props.error}</p> : null}
    </div>
  );
}

/** A searchable list of every figure, each drawn small and flat in the face's color. */
function FigurePicker(props: {
  readonly color: string;
  readonly selected: string;
  readonly figures: ReadonlyArray<{ readonly figure: AvatarDefinition; readonly custom: boolean }>;
  readonly onPick: (figure: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = props.figures.find((entry) => entry.figure.id === props.selected)?.figure;
  const needle = query.trim().toLowerCase();
  const shown = props.figures.filter(
    ({ figure }) =>
      needle === "" || figure.name.toLowerCase().includes(needle) || figure.id.includes(needle),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            aria-label={`Figure: ${current?.name ?? props.selected}`}
          />
        }
      >
        {current?.name ?? props.selected}
        <span aria-hidden="true" className="text-muted-foreground">
          ▾
        </span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-64">
        <Input
          aria-label="Search figures"
          placeholder="Search figures"
          size="sm"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && shown[0] !== undefined) {
              props.onPick(shown[0].figure.id);
              setOpen(false);
            }
          }}
        />
        <div
          className="mt-1.5 flex max-h-64 flex-col overflow-y-auto"
          role="listbox"
          aria-label="Figures"
        >
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">No figure matches.</p>
          ) : (
            shown.map(({ figure, custom }) => (
              <button
                key={`${custom ? "mine" : "built-in"}:${figure.id}`}
                type="button"
                role="option"
                aria-selected={figure.id === props.selected}
                aria-label={`Figure ${figure.name}${custom ? " (mine)" : ""}`}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent aria-selected:bg-muted"
                onClick={() => {
                  props.onPick(figure.id);
                  setOpen(false);
                }}
              >
                <TotFace
                  avatar={{ color: props.color, style: "open-bot", openBot: { figure: figure.id } }}
                  state="idle"
                  animation="still"
                  size={24}
                />
                <span className="min-w-0 flex-1 truncate">{figure.name}</span>
                {custom ? <span className="text-muted-foreground text-xs">Mine</span> : null}
              </button>
            ))
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
