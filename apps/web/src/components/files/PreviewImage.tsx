import { lazy, Suspense } from "react";

import { FileSurfaceLoading } from "./fileSurfaceChrome";

const PreviewImageContent = lazy(() => import("./PreviewImageContent"));

export function PreviewImage(props: {
  readonly src: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly onError?: () => void;
  /** Controlled expanded preview; the host owns it when `onExpandedChange` is provided. */
  readonly expanded?: boolean;
  readonly onExpandedChange?: (expanded: boolean) => void;
}) {
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <PreviewImageContent {...props} />
    </Suspense>
  );
}
