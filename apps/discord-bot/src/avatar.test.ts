// @effect-diagnostics nodeBuiltinImport:off - The face cache is tested against a real temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vite-plus/test";

import { AVATAR_SIZE, avatarSpecKey, createAvatarStore, renderTotFace } from "./avatar.ts";

const read = (bytes: Buffer): PNG => PNG.sync.read(bytes);

const pixelAt = (png: PNG, x: number, y: number): ReadonlyArray<number> => {
  const offset = (y * png.width + x) * 4;
  return [
    png.data[offset] ?? -1,
    png.data[offset + 1] ?? -1,
    png.data[offset + 2] ?? -1,
    png.data[offset + 3] ?? -1,
  ];
};

const home = { color: "#0a7ea4" };

const temporaryDir = (): string => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tot-faces-"));

describe("renderTotFace", () => {
  it("draws a 128 square in the Tot's colour with the two-eye face", () => {
    const png = read(renderTotFace(home));

    expect([png.width, png.height]).toEqual([AVATAR_SIZE, AVATAR_SIZE]);
    // Head at the centre, eyes either side of it, nothing outside the head.
    expect(pixelAt(png, 64, 30)).toEqual([10, 126, 164, 255]);
    expect(pixelAt(png, 41, 72)).toEqual([248, 250, 252, 255]);
    expect(pixelAt(png, 86, 72)).toEqual([248, 250, 252, 255]);
    expect(pixelAt(png, 0, 0)[3]).toBe(0);
  });

  it("keeps the head transparent where a corner is not rounded", () => {
    const png = read(renderTotFace(home));

    expect(pixelAt(png, 8, 21)[3]).toBe(0);
    expect(pixelAt(png, 64, 24)[3]).toBe(255);
  });

  it("adds the antenna dot only when the Tot has one", () => {
    const plain = read(renderTotFace(home));
    const antenna = read(renderTotFace({ ...home, antenna: true }));

    expect(pixelAt(plain, 64, 11)[3]).toBe(0);
    expect(pixelAt(antenna, 64, 11)).toEqual([10, 126, 164, 255]);
  });

  it("falls back to Home's colour for a spec it cannot read", () => {
    const png = read(renderTotFace({ color: "not-a-colour" }));

    expect(pixelAt(png, 64, 30)).toEqual([10, 126, 164, 255]);
  });
});

describe("avatarSpecKey", () => {
  it("stays the same for the same face and changes with any part of it", () => {
    expect(avatarSpecKey(home)).toBe(avatarSpecKey({ color: "#0a7ea4" }));
    expect(avatarSpecKey(home)).not.toBe(avatarSpecKey({ color: "#ff0000" }));
    expect(avatarSpecKey(home)).not.toBe(avatarSpecKey({ ...home, skin: 305 }));
    expect(avatarSpecKey(home)).not.toBe(avatarSpecKey({ ...home, shape: "flower" }));
    expect(avatarSpecKey(home)).not.toBe(avatarSpecKey({ ...home, antenna: true }));
  });
});

describe("createAvatarStore", () => {
  it("renders once, then serves the cached PNG for the same face", () => {
    const dir = temporaryDir();
    let renders = 0;
    try {
      const store = createAvatarStore({
        dir,
        render: (avatar) => {
          renders += 1;
          return renderTotFace(avatar);
        },
      });

      const first = store.ensure("home", home);
      const second = store.ensure("home", home);

      expect(renders).toBe(1);
      expect(second.key).toBe(first.key);
      expect(second.path).toBe(NodePath.join(dir, "home.png"));
      expect(NodeFS.readFileSync(second.path)).toEqual(first.bytes);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders again when the face changed", () => {
    const dir = temporaryDir();
    try {
      const store = createAvatarStore({ dir });

      const first = store.ensure("home", home);
      const changed = store.ensure("home", { color: "#ff0000" });

      expect(changed.key).not.toBe(first.key);
      expect(NodeFS.readFileSync(changed.path)).toEqual(changed.bytes);
      expect(NodeFS.readFileSync(changed.path)).not.toEqual(first.bytes);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a face file that was deleted under the index", () => {
    const dir = temporaryDir();
    try {
      const store = createAvatarStore({ dir });
      const first = store.ensure("home", home);

      NodeFS.rmSync(first.path);
      const rewritten = store.ensure("home", home);

      expect(NodeFS.readFileSync(rewritten.path)).toEqual(first.bytes);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
