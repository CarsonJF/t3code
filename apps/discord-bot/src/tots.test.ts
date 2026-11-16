import { describe, expect, it } from "vite-plus/test";

import type { T3Client } from "./t3Client.ts";
import { listTotFaces } from "./tots.ts";

const clientOf = (tots: ReadonlyArray<unknown>): T3Client => ({
  call: async <A>(): Promise<A> => ({ tots }) as A,
  close: async () => undefined,
});

describe("listTotFaces", () => {
  it("reads each Tot's face from the list", async () => {
    const client = clientOf([
      { id: "home", name: "Home", avatar: { color: "#0a7ea4", shape: "squircle" } },
      { id: "squirt", name: "Squirt", avatar: { color: "#e879f9", antenna: true } },
    ]);

    await expect(listTotFaces(client)).resolves.toEqual([
      { id: "home", name: "Home", avatar: { color: "#0a7ea4", shape: "squircle" } },
      { id: "squirt", name: "Squirt", avatar: { color: "#e879f9", antenna: true } },
    ]);
  });

  it("wears Home's colour on a server older than the avatar field", async () => {
    const client = clientOf([{ id: "home", name: "Home" }]);

    await expect(listTotFaces(client)).resolves.toEqual([
      { id: "home", name: "Home", avatar: { color: "#0a7ea4" } },
    ]);
  });
});
