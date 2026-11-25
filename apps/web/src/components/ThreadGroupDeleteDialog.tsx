import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export interface ThreadGroupDeleteMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

type Request = {
  readonly groupName: string;
  readonly projectCount: number;
  readonly threadCount: number;
  /** Every machine holding the group; the first is the one the delete was chosen in. */
  readonly machines: ReadonlyArray<ThreadGroupDeleteMachine>;
  readonly resolve: (environmentIds: EnvironmentId[] | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/** Resolves with the machines to delete the group from, or null when cancelled. */
export function requestThreadGroupDelete(
  options: Omit<Request, "resolve">,
): Promise<EnvironmentId[] | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { ...options, resolve } }));
}

function finish(environmentIds: EnvironmentId[] | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(environmentIds);
}

export function ThreadGroupDeleteDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- settles a pending prompt if the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupDeleteDialog request={request} /> : null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function describeThreadGroupContents(projectCount: number, threadCount: number) {
  return `It holds ${plural(projectCount, "project", "projects")} and ${plural(threadCount, "thread", "threads")}. They stay; they become ungrouped.`;
}

function ThreadGroupDeleteDialog({ request }: { request: Request }) {
  const [allMachines, setAllMachines] = useState(false);
  const [chosen, ...others] = request.machines;
  const targets = allMachines ? request.machines : request.machines.slice(0, 1);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{`Delete group "${request.groupName}"?`}</DialogTitle>
          <DialogDescription>
            {describeThreadGroupContents(request.projectCount, request.threadCount)}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3 text-sm">
            <p data-testid="thread-group-delete-targets">
              {`Removes it from ${targets.map((machine) => machine.label).join(", ")}.`}
            </p>
            {others.length > 0 && chosen ? (
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={allMachines} onCheckedChange={setAllMachines} />
                <span>{`All machines (also ${others.map((machine) => machine.label).join(", ")})`}</span>
              </label>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => finish(targets.map((machine) => machine.environmentId))}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
