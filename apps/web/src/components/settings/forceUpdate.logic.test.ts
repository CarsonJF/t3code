import { describe, expect, it, vi } from "vite-plus/test";

import {
  fetchLatestReleaseBuild,
  fetchLatestReleaseVersion,
  fetchReleaseBuild,
  planForceUpdate,
  type ForceUpdateSubject,
} from "./forceUpdate.logic";

const VERSION = "0.1.10-nightly.20261114.4695";
const OLD = "0.1.10-nightly.20261113.4000";

const environment = (overrides: Partial<NonNullable<ForceUpdateSubject["environment"]>> = {}) => ({
  connected: true,
  canMaintain: true,
  updating: false,
  selfUpdate: "boot-service" as const,
  desktopAppUpdate: false,
  ...overrides,
});

const subject = (
  current: ForceUpdateSubject["current"],
  overrides: Partial<ForceUpdateSubject> = {},
): ForceUpdateSubject => ({
  kind: "environment",
  label: "Asuna",
  current,
  environment: environment(),
  ...overrides,
});

describe("fetchReleaseBuild", () => {
  it("reads the publish time, commit and platform digest", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/commits/")
        ? Response.json({ sha: "2222222222222222222222222222222222222222" })
        : Response.json({
            published_at: "2026-11-14T10:00:00Z",
            assets: [
              {
                name: `t3-${VERSION}-linux-x64.tar.gz`,
                digest: "sha256:abcd",
              },
            ],
          }),
    );
    await expect(
      fetchReleaseBuild(VERSION, {
        fetchImpl: fetchImpl as typeof fetch,
        platformKey: "linux-x64",
      }),
    ).resolves.toMatchObject({
      version: VERSION,
      commit: "2222222222222222222222222222222222222222",
      publishedAt: "2026-11-14T10:00:00Z",
      digest: "sha256:abcd",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the publish time when the commit lookup fails", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/commits/")
        ? new Response(null, { status: 403 })
        : Response.json({ published_at: "2026-11-14T10:00:00Z", assets: [] }),
    );
    await expect(
      fetchReleaseBuild(VERSION, { fetchImpl: fetchImpl as typeof fetch }),
    ).resolves.toEqual({
      version: VERSION,
      publishedAt: "2026-11-14T10:00:00Z",
      releaseUrl: expect.stringContaining("releases/tag/v"),
    });
  });

  it("reports a missing release instead of claiming it is current", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      fetchReleaseBuild(VERSION, { fetchImpl: fetchImpl as typeof fetch }),
    ).rejects.toThrow("404");
  });

  it("finds the newest release on the requested channel", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/releases?")
        ? Response.json([
            { tag_name: "v0.1.10-nightly.20261114.1-custom" },
            { tag_name: "v0.1.9-nightly.20261113.1-custom" },
            { tag_name: "v0.1.10-nightly.20261115.1-custom", draft: true },
          ])
        : Response.json({ sha: "222222222222" }),
    );
    await expect(
      fetchLatestReleaseVersion("nightly", { fetchImpl: fetchImpl as typeof fetch }),
    ).resolves.toBe("0.1.10-nightly.20261114.1");
  });

  it("combines the newest release with its build identity", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/releases?")) {
        return Response.json([{ tag_name: `v${VERSION}-custom` }]);
      }
      if (url.includes("/commits/")) return Response.json({ sha: "222222222222" });
      return Response.json({ published_at: "2026-11-14T10:00:00Z", assets: [] });
    });
    await expect(
      fetchLatestReleaseBuild({
        channel: "nightly",
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toMatchObject({ version: VERSION, commit: "222222222222" });
  });
});

describe("planForceUpdate", () => {
  const available = {
    version: VERSION,
    commit: "222222222222",
    publishedAt: "2026-11-14T10:00:00Z",
    releaseUrl: "https://github.com/CarsonJF/t3code/releases/tag/v1",
  };

  it("offers a same-version rebuild for a desktop-managed environment", () => {
    const plan = planForceUpdate(
      subject(
        { version: VERSION, commit: "111111111111" },
        { environment: environment({ selfUpdate: "desktop-managed", desktopAppUpdate: true }) },
      ),
      available,
    );
    expect(plan).toMatchObject({ installable: true, sameVersion: true, blockReason: null });
    expect(plan.comparison).toMatchObject({ verdict: "different-build", force: true });
  });

  it("blocks a same-version rebuild on a background service", () => {
    const plan = planForceUpdate(subject({ version: VERSION, commit: "111111111111" }), available);
    expect(plan.installable).toBe(false);
    expect(plan.blockReason).toContain("same version");
  });

  it("does not offer the build that is already running", () => {
    const plan = planForceUpdate(
      subject(
        { version: VERSION, commit: "222222222222" },
        { environment: environment({ selfUpdate: "desktop-managed", desktopAppUpdate: true }) },
      ),
      available,
    );
    expect(plan.installable).toBe(false);
    expect(plan.comparison.verdict).toBe("same-build");
  });

  it("offers a newer release through the ordinary path", () => {
    const plan = planForceUpdate(subject({ version: OLD }), available);
    expect(plan).toMatchObject({ installable: true, sameVersion: false });
    expect(plan.comparison.verdict).toBe("newer-version");
  });

  it("never offers an older release", () => {
    const plan = planForceUpdate(subject({ version: VERSION }), {
      ...available,
      version: OLD,
    });
    expect(plan.installable).toBe(false);
    expect(plan.comparison.verdict).toBe("downgrade");
  });

  it("blocks an offline or unpermitted machine", () => {
    const current = { version: VERSION, commit: "111111111111" };
    expect(
      planForceUpdate(
        subject(current, { environment: environment({ connected: false }) }),
        available,
      ).blockReason,
    ).toContain("not connected");
    expect(
      planForceUpdate(
        subject(current, { environment: environment({ canMaintain: false }) }),
        available,
      ).blockReason,
    ).toContain("permission");
  });
});
