import { useEffect, useState } from "react";
import { create } from "zustand";

import { threadGroupActions } from "../threadGroupsStore";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

type Request = {
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName: string;
  readonly resolve: (name: string | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestThreadGroupName(options: Omit<Request, "resolve">): Promise<string | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { ...options, resolve } }));
}

export async function createThreadGroupFromPrompt(): Promise<string | null> {
  const name = await requestThreadGroupName({
    title: "New group",
    submitLabel: "Create",
    initialName: "",
  });
  return name === null ? null : threadGroupActions.create(name);
}

function finish(name: string | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(name);
}

export function ThreadGroupNameDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/react-effect-budget -- settles a pending prompt if the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupNameDialog request={request} /> : null;
}

function ThreadGroupNameDialog({ request }: { request: Request }) {
  const [name, setName] = useState(request.initialName);
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0) finish(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Input
              nativeInput
              autoFocus
              aria-label="Group name"
              placeholder="Group name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed.length === 0}>
              {request.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
