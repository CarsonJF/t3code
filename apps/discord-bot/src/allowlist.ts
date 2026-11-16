/**
 * A DM is a full agent on the host. The allowlist is the whole security model,
 * so every path (message, command, autocomplete, button) asks this one function.
 */
export interface DmAuthor {
  readonly userId: string | null | undefined;
  readonly bot: boolean;
}

export const isAllowedDmAuthor = (author: DmAuthor, allowed: ReadonlySet<string>): boolean => {
  if (author.bot) return false;
  const userId = author.userId?.trim();
  if (userId === undefined || userId.length === 0) return false;
  return allowed.has(userId);
};
