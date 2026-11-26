import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import type { HttpServerRequest } from "effect/http";

import { requestPeerAddress } from "../auth/utils.ts";

// Every proxy that fronts T3 on this machine (Tailscale Serve, cloudflared, a dev proxy) connects
// from loopback, so the peer address alone cannot tell a local caller from a forwarded one.
const FORWARDING_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "tailscale-user-login",
  "via",
];

const isLoopback = (address: string) =>
  (NodeNet.isIPv4(address) && address.startsWith("127.")) || address === "::1";

const hostnameOf = (host: string | undefined) => {
  if (host === undefined) return undefined;
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(1, trimmed.indexOf("]"));
  return trimmed.split(":")[0];
};

const ownAddresses = () =>
  new Set(
    Object.values(NodeOS.networkInterfaces()).flatMap((entries) =>
      (entries ?? []).map((entry) => entry.address.toLowerCase()),
    ),
  );

/**
 * Whether a request comes straight from a process on this machine: from loopback or one of this
 * machine's own addresses, to a loopback or own-address Host, through no proxy.
 */
export const isSameMachineRequest = (
  request: HttpServerRequest.HttpServerRequest,
  addresses: () => ReadonlySet<string> = ownAddresses,
): boolean => {
  if (FORWARDING_HEADERS.some((header) => request.headers[header] !== undefined)) return false;
  const peer = requestPeerAddress(request)?.toLowerCase();
  const host = hostnameOf(request.headers.host);
  if (peer === undefined || host === undefined) return false;
  const own = addresses();
  const local = (address: string) => isLoopback(address) || own.has(address);
  const hostIsLocal =
    host === "localhost" || (NodeNet.isIP(host) !== 0 && local(host.replace(/^::ffff:/, "")));
  return local(peer) && hostIsLocal;
};
