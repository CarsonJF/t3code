import { AvatarLibraryExport, type TotAvatar } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeExport = Schema.decodeUnknownOption(Schema.fromJsonString(AvatarLibraryExport));

/** The file "Export" downloads: the same shape `t3_avatar_library` export writes. */
export const avatarExportFile = (item: AvatarLibraryExport) => {
  const id = item.kind === "figure" ? item.figure.id : item.theme.id;
  return {
    name: `${id}.${item.kind}.json`,
    text: `${JSON.stringify(item, null, 2)}\n`,
  };
};

/** An export file's item, or null when the text is not one. */
export const parseAvatarExport = (text: string): AvatarLibraryExport | null => {
  const decoded = decodeExport(text);
  return decoded._tag === "Some" ? decoded.value : null;
};

/** A Tot's face with this open-bot figure, keeping its color and finish. */
export const withOpenBotFigure = (avatar: TotAvatar, figure: string): TotAvatar => ({
  ...avatar,
  style: "open-bot",
  openBot: { ...avatar.openBot, figure },
});

/** A library id from a name: lowercase words joined by dashes. */
export const avatarIdOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
