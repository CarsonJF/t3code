import type { EnvironmentId } from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { EyeIcon } from "lucide-react";

import { MarkdownThreadLink } from "./MarkdownThreadLink";
import { TimelineSystemDivider } from "./TimelineSystemDivider";
import type { WatchReportLine, WatchReportSegment } from "./watchReport.logic";

function segmentKey(segment: WatchReportSegment): string {
  return segment.kind === "text"
    ? `text:${segment.text}`
    : `link:${segment.href}:${segment.label ?? ""}`;
}

function WatchReportDetail(props: {
  readonly segments: ReadonlyArray<WatchReportSegment>;
  readonly environmentId: EnvironmentId;
}) {
  return (
    <span>
      {props.segments.map((segment) => {
        const key = segmentKey(segment);
        if (segment.kind === "text") return <span key={key}>{segment.text}</span>;
        const link = parseThreadLinkHref(segment.href);
        return link === null ? (
          <a
            key={key}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-transparent underline-offset-2 hover:decoration-current"
          >
            {segment.label ?? segment.href}
          </a>
        ) : (
          <MarkdownThreadLink
            key={key}
            environmentId={props.environmentId}
            link={link}
            label={segment.label}
          />
        );
      })}
    </span>
  );
}

/** Watch reports read as timeline markers instead of user bubbles. */
export function WatchReportRow(props: {
  readonly lines: ReadonlyArray<WatchReportLine>;
  readonly environmentId: EnvironmentId;
}) {
  return (
    <>
      {props.lines.map((line) => (
        <TimelineSystemDivider
          key={`line:${line.label}:${line.detail.map(segmentKey).join("|")}`}
          label={line.label}
          icon={EyeIcon}
          detail={
            line.detail.length === 0 ? null : (
              <WatchReportDetail segments={line.detail} environmentId={props.environmentId} />
            )
          }
        />
      ))}
    </>
  );
}
