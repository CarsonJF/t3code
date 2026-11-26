import { describe, expect, it } from "vite-plus/test";

import { claudeReadOnlyBashHook, readOnlyShellRefusal } from "./claudeReadOnlyShell.ts";

describe("readOnlyShellRefusal", () => {
  it.each([
    "docker logs x > /tmp/f",
    "docker logs x >> /tmp/f",
    "git status; rm -rf x",
    "gh pr list | sh",
    "gh pr view $(rm -rf x)",
    "gh pr view `rm -rf x`",
    "git status && rm -rf x",
    "git status || rm -rf x",
    "docker ps &",
    "docker logs x < /etc/passwd",
    "git status\nrm -rf x",
    "GH_TOKEN=x gh pr list",
    "(gh pr list)",
    "{ gh pr list; }",
    "gh pr list --search 'a>b'",
    "docker logs x tee /tmp/f",
    "gh pr list -o /tmp/f",
    "gh run view 1 --output=/tmp/f",
    "gh pr view 'open",
    "rm -rf x",
    "gh pr merge 101",
    "gh api repos/x/y -X POST",
    "git push",
    "",
  ])("refuses %j", (command) => {
    expect(readOnlyShellRefusal(command)).not.toBeNull();
  });

  it.each([
    "gh pr list",
    "gh pr list --state open --json number,title",
    'gh pr view 101 --json "statusCheckRollup"',
    "gh run list --workflow custom-nightly.yml --limit 5",
    "gh run view 123 --log-failed",
    "gh issue list",
    "git status --short",
    "docker ps -a",
    "docker logs --tail 50 system-call",
    "docker compose ps",
    "systemctl status asuna-git-sync.timer",
  ])("allows %j", (command) => {
    expect(readOnlyShellRefusal(command)).toBeNull();
  });
});

describe("claudeReadOnlyBashHook", () => {
  const run = (command: string) =>
    claudeReadOnlyBashHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
        tool_use_id: "tool-1",
        session_id: "session",
        transcript_path: "/tmp/t",
        cwd: "/tmp",
      } as never,
      "tool-1",
      { signal: new AbortController().signal },
    );

  it("denies a write with a reason the agent can read, and allows a plain read", async () => {
    const denied = await run("docker logs x > /tmp/f");
    expect(denied).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
    expect(JSON.stringify(denied)).toContain("This turn is read-only.");
    expect(await run("docker ps")).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
  });

  it("leaves other tools to Claude's own rules", async () => {
    const other = await claudeReadOnlyBashHook(
      { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} } as never,
      undefined,
      { signal: new AbortController().signal },
    );
    expect(other).toEqual({});
  });
});
