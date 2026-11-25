import { EnvironmentId, TotId, type AvatarFigure, type AvatarLibrary } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { serverEnvironment } from "../../state/server";
import { setAvatarLibrary } from "../tots/avatarLibraryStore";
import { loadOpenBot } from "../tots/OpenBotFace";
import { AvatarLibraryPage } from "./AvatarLibrarySettings";

const environmentId = EnvironmentId.make("environment:avatar-library-page");
const lighthouse: AvatarFigure = {
  version: 1,
  id: "lighthouse",
  name: "Lighthouse",
  body: { path: "M38 30 L62 30 L68 88 L32 88 Z M42 14 L58 14 L60 30 L40 30 Z" },
  eyes: { x: 50, y: 56, spacing: 14, scale: 1 },
};
const fairy: AvatarFigure = {
  version: 1,
  id: "fairy",
  name: "Fairy",
  body: {
    path: "M50 24C62 24 70 33 70 46V70C70 80 62 86 50 86C38 86 30 80 30 70V46C30 33 38 24 50 24Z",
  },
  eyes: { x: 50, y: 50, spacing: 15, scale: 1 },
};
const home = {
  id: TotId.make("home"),
  name: "Home",
  avatar: {
    color: "#16A34A",
    style: "open-bot" as const,
    openBot: { figure: "chat", material: "glass" as const },
  },
};

const state = vi.hoisted(() => ({
  calls: [] as Array<{ command: unknown; input: unknown }>,
  replies: new Map<unknown, unknown>(),
  downloads: [] as Array<{ name: string; text: string }>,
}));

vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) => async (args: { readonly input: unknown }) => {
    state.calls.push({ command, input: args.input });
    return { _tag: "Success", value: state.replies.get(command) };
  }) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((_id: unknown, select: (settings: { tots: unknown[] }) => unknown) =>
    select({ tots: [home] })) as never,
}));
vi.mock(import("../../proposedPlan"), async (original) => ({
  ...(await original()),
  downloadPlanAsTextFile: (name: string, text: string) => {
    state.downloads.push({ name, text });
  },
}));

const library = (figures: ReadonlyArray<AvatarFigure>): AvatarLibrary => ({ figures, themes: [] });
const callsTo = (command: unknown) =>
  state.calls.filter((call) => call.command === command).map((call) => call.input);

const reset = async () => {
  await loadOpenBot();
  state.calls = [];
  state.downloads = [];
  // Replies a test set before rendering stay; reads always answer with the starting library.
  state.replies.set(serverEnvironment.readAvatarLibrary, library([lighthouse]));
  setAvatarLibrary(environmentId, library([lighthouse]));
};

const renderPage = async (canWrite = true) => {
  await reset();
  return render(<AvatarLibraryPage environmentId={environmentId} canWrite={canWrite} />, {
    router: false /* the page body needs no routes */,
  });
};

describe("AvatarLibraryPage", () => {
  it("shows your figures and the built-in ones as large tiles with a badge", async () => {
    await using screen = await renderPage();
    const tile = (name: string) => screen.container.querySelector(`[data-avatar-tile="${name}"]`);
    await expect.poll(() => tile("Lighthouse")?.textContent).toContain("Mine");
    expect(tile("Mug")?.textContent).toContain("Built-in");
    await userEvent.click(screen.getByRole("button", { name: "Glass" }));
    await expect
      .element(screen.getByRole("button", { name: "Glass" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("designs a shape from a description, shows every finish, and saves it with its new name", async () => {
    state.replies.set(serverEnvironment.describeAvatarFigure, {
      figure: fairy,
      previewSvg: "<svg/>",
    });
    state.replies.set(serverEnvironment.saveAvatarLibraryItem, library([fairy, lighthouse]));
    await using screen = await renderPage();

    await userEvent.fill(
      screen.getByRole("textbox", { name: "Describe a shape" }),
      "A pink fairy with butterfly wings",
    );
    await userEvent.click(screen.getByRole("button", { name: "Design it" }));
    expect(callsTo(serverEnvironment.describeAvatarFigure)).toEqual([
      { description: "A pink fairy with butterfly wings" },
    ]);
    const generated = screen.getByLabelText("Generated shape");
    await expect.element(generated).toBeVisible();
    expect(generated.element().querySelectorAll("[data-figure-finish]")).toHaveLength(4);

    await userEvent.fill(screen.getByRole("textbox", { name: "Shape name" }), "Pink Fairy");
    await userEvent.click(screen.getByRole("button", { name: "Save to library" }));
    expect(callsTo(serverEnvironment.saveAvatarLibraryItem)).toEqual([
      { kind: "figure", figure: { ...fairy, name: "Pink Fairy" } },
    ]);
    await expect.element(screen.getByLabelText("Generated shape")).not.toBeInTheDocument();
  });

  it("renames, exports, applies and deletes your own figure", async () => {
    state.replies.set(serverEnvironment.saveAvatarLibraryItem, library([lighthouse]));
    state.replies.set(serverEnvironment.removeAvatarLibraryItem, library([]));
    await using screen = await renderPage();
    const actions = () => screen.getByRole("button", { name: "Actions for Lighthouse" });

    await userEvent.click(actions());
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "Name" }), "Beacon");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(callsTo(serverEnvironment.saveAvatarLibraryItem)).toEqual([
      { kind: "figure", figure: { ...lighthouse, name: "Beacon" } },
    ]);

    await userEvent.click(actions());
    await userEvent.click(screen.getByRole("menuitem", { name: "Export to a file" }));
    expect(state.downloads).toHaveLength(1);
    expect(state.downloads[0]!.name).toBe("lighthouse.figure.json");
    expect(JSON.parse(state.downloads[0]!.text)).toEqual({ kind: "figure", figure: lighthouse });

    await userEvent.click(actions());
    await userEvent.click(screen.getByRole("menuitem", { name: "Apply to Home" }));
    expect(callsTo(serverEnvironment.updateTot)).toEqual([
      {
        id: home.id,
        avatar: {
          color: "#16A34A",
          style: "open-bot",
          openBot: { figure: "lighthouse", material: "glass" },
        },
      },
    ]);

    await userEvent.click(actions());
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await expect.element(screen.getByText("Delete Lighthouse?")).toBeVisible();
    expect(callsTo(serverEnvironment.removeAvatarLibraryItem)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
    expect(callsTo(serverEnvironment.removeAvatarLibraryItem)).toEqual([
      { kind: "figure", id: "lighthouse" },
    ]);
  });

  it("imports an export file into the library", async () => {
    state.replies.set(serverEnvironment.saveAvatarLibraryItem, library([fairy, lighthouse]));
    await using screen = await renderPage();
    const file = new File(
      [JSON.stringify({ kind: "figure", figure: fairy })],
      "fairy.figure.json",
      {
        type: "application/json",
      },
    );
    await userEvent.upload(screen.getByLabelText("Import file"), file);
    await expect
      .poll(() => callsTo(serverEnvironment.saveAvatarLibraryItem))
      .toEqual([{ kind: "figure", figure: fairy }]);
  });

  it("only lets you look when this client may not change the library", async () => {
    await using screen = await renderPage(false);
    await expect
      .poll(() => screen.container.querySelector('[data-avatar-tile="Lighthouse"]'))
      .not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Describe a shape" }).query()).toBeNull();
    expect(screen.getByRole("button", { name: "Import…" }).query()).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for Lighthouse" }).query()).toBeNull();
  });
});
