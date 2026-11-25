import { TotTemplate } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import blank from "./totTemplates/blank.json" with { type: "json" };
import ciBabysitter from "./totTemplates/ci-babysitter.json" with { type: "json" };
import homeStackWatcher from "./totTemplates/home-stack-watcher.json" with { type: "json" };
import inboxTriage from "./totTemplates/inbox-triage.json" with { type: "json" };
import prReviewer from "./totTemplates/pr-reviewer.json" with { type: "json" };
import rebaseMonitor from "./totTemplates/rebase-monitor.json" with { type: "json" };

/**
 * The built-in templates "New Tot" offers, in menu order. To add one, drop a JSON file
 * in `totTemplates/` and list it here; the schema checks it when this module loads.
 */
export const TOT_TEMPLATES: ReadonlyArray<TotTemplate> = Schema.decodeUnknownSync(
  Schema.Array(TotTemplate),
)([blank, ciBabysitter, prReviewer, rebaseMonitor, homeStackWatcher, inboxTriage]);

export const findTotTemplate = (id: string): TotTemplate | undefined =>
  TOT_TEMPLATES.find((template) => template.id === id);
