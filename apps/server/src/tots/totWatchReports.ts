import type { TotWatchReason, TotWatchReports } from "@t3tools/contracts";

/**
 * Whether a change on one thread becomes a report for this Tot. Watches are
 * stored in every mode, so turning reports back on resumes them.
 */
export const deliversWatchReport = (options: {
  readonly mode: TotWatchReports;
  readonly reasons: ReadonlyArray<TotWatchReason>;
  readonly viaAll: boolean;
}): boolean => {
  if (options.mode === "explicit") return true;
  if (options.mode === "off") return false;
  return options.viaAll || options.reasons.includes("launched") || options.reasons.includes("sent");
};
