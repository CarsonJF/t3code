import { describe, expect, it } from "vite-plus/test";

import { compareBuildIdentities, describeBuildIdentity } from "./buildIdentity.ts";

const OLD = "0.1.10-nightly.20261113.4000";
const NEW = "0.1.10-nightly.20261114.4695";

describe("compareBuildIdentities", () => {
  it("offers a same-version rebuild when the commits differ", () => {
    expect(
      compareBuildIdentities(
        { version: NEW, commit: "111111111111" },
        { version: NEW, commit: "222222222222" },
      ),
    ).toMatchObject({ verdict: "different-build", offer: true, force: true });
  });

  it("does not offer the build it already runs", () => {
    expect(
      compareBuildIdentities(
        { version: NEW, commit: "abcdef1234567890" },
        { version: NEW, commit: "abcdef123456" },
      ),
    ).toMatchObject({ verdict: "same-build", offer: false });
  });

  it("uses publish time when an older build records no commit", () => {
    expect(
      compareBuildIdentities(
        { version: NEW, builtAt: "2026-11-13T10:00:00Z" },
        { version: NEW, publishedAt: "2026-11-14T10:00:00Z" },
      ),
    ).toMatchObject({ verdict: "different-build", offer: true, force: true });
    expect(
      compareBuildIdentities(
        { version: NEW, builtAt: "2026-11-14T12:00:00Z" },
        { version: NEW, publishedAt: "2026-11-14T10:00:00Z" },
      ),
    ).toMatchObject({ verdict: "same-build", offer: false });
  });

  it("keeps version ordering for newer and older releases", () => {
    const available = { version: NEW, commit: "222222222222" };
    expect(compareBuildIdentities({ version: OLD }, available)).toMatchObject({
      verdict: "newer-version",
      offer: true,
      force: false,
    });
    expect(compareBuildIdentities({ version: NEW }, { version: OLD })).toMatchObject({
      verdict: "downgrade",
      offer: false,
    });
  });

  it("offers a downgrade only when explicitly allowed", () => {
    expect(
      compareBuildIdentities({ version: NEW }, { version: OLD }, { allowDowngrade: true }),
    ).toMatchObject({ verdict: "downgrade", offer: true });
  });

  it("does not guess when neither side records an identity", () => {
    expect(compareBuildIdentities({ version: NEW }, { version: NEW })).toMatchObject({
      verdict: "same-build",
      offer: false,
    });
  });

  it("describes the running build for the update UI", () => {
    expect(describeBuildIdentity({ version: NEW, commit: "abcdef1234567890" })).toBe(
      "Build abcdef123456",
    );
    expect(
      describeBuildIdentity({ version: NEW, commit: "abcdef1234567890", builtAt: "2026-11-14" }),
    ).toContain("built");
    expect(describeBuildIdentity({ version: NEW })).toBe("Build unknown");
  });
});
