import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

/** Commands a read-only turn may run, as leading words. Each one only reads. */
const READ_ONLY_COMMANDS: ReadonlyArray<ReadonlyArray<string>> = [
  ["gh", "pr", "list"],
  ["gh", "pr", "view"],
  ["gh", "pr", "checks"],
  ["gh", "pr", "diff"],
  ["gh", "run", "list"],
  ["gh", "run", "view"],
  ["gh", "issue", "list"],
  ["gh", "issue", "view"],
  ["git", "status"],
  ["docker", "ps"],
  ["docker", "inspect"],
  ["docker", "logs"],
  ["docker", "compose", "ps"],
  ["docker", "compose", "ls"],
  ["docker", "compose", "logs"],
  ["systemctl", "status"],
  ["systemctl", "list-units"],
];

/** The same list as Claude allow rules, so a plain read runs without asking. */
export const CLAUDE_READ_ONLY_BASH_RULES: ReadonlyArray<string> = READ_ONLY_COMMANDS.map(
  (words) => `Bash(${words.join(" ")}:*)`,
);

// Anything that redirects, chains, substitutes, escapes or groups. Checked inside quotes too.
const SHELL_SYNTAX = /[><|;&`$\\(){}\n\r]/;

/** Splits words, joining quoted parts literally; null when a quote is left open. */
function words(command: string): ReadonlyArray<string> | null {
  const out: Array<string> = [];
  let current = "";
  let inWord = false;
  let quote: string | null = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) out.push(current);
      current = "";
      inWord = false;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (quote !== null) return null;
  if (inWord) out.push(current);
  return out;
}

/**
 * Why a read-only turn may not run `command`, or null when it may: one plain command from the
 * allowlist, with no shell syntax, variable assignment, `tee` or output-file flag.
 */
export function readOnlyShellRefusal(command: string): string | null {
  if (SHELL_SYNTAX.test(command)) {
    return "Shell operators, redirects, substitutions and subshells are not allowed.";
  }
  const parts = words(command);
  if (parts === null) return "The command has an unclosed quote.";
  if (parts.length === 0) return "The command is empty.";
  if (parts[0]?.includes("=")) return "Setting environment variables is not allowed.";
  if (parts.includes("tee")) return "`tee` writes files.";
  if (parts.some((part) => part === "-o" || part.startsWith("--output"))) {
    return "Writing output to a file is not allowed.";
  }
  const allowed = READ_ONLY_COMMANDS.some((prefix) =>
    prefix.every((word, index) => parts[index] === word),
  );
  return allowed ? null : "Only the read commands listed for Look around are allowed.";
}

const ALLOWED_SUMMARY = READ_ONLY_COMMANDS.map((words) => words.join(" ")).join(", ");

/**
 * Decides every Bash call in a read-only turn before Claude's own rules see it. A refusal is a
 * tool error the agent reads, so the turn goes on.
 */
export const claudeReadOnlyBashHook: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") return {};
  const toolInput = input.tool_input;
  const command =
    typeof toolInput === "object" &&
    toolInput !== null &&
    "command" in toolInput &&
    typeof toolInput.command === "string"
      ? toolInput.command
      : "";
  const refusal = readOnlyShellRefusal(command);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: refusal === null ? "allow" : "deny",
      permissionDecisionReason:
        refusal === null
          ? "A read command this read-only turn may run."
          : `This turn is read-only. ${refusal} Run one plain command from: ${ALLOWED_SUMMARY}.`,
    },
  };
};
