/**
 * A DM or a Tot channel is a full agent on the host. The allowlist is the whole
 * security model, so every path (DM, channel message, command, autocomplete)
 * asks this one function.
 */
export interface Author {
  readonly userId: string | null | undefined;
  readonly bot: boolean;
}

export const isAllowedAuthor = (author: Author, allowed: ReadonlySet<string>): boolean => {
  if (author.bot) return false;
  const userId = author.userId?.trim();
  if (userId === undefined || userId.length === 0) return false;
  return allowed.has(userId);
};
