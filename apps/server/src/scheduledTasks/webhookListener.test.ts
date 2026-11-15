import { describe, expect, it } from "@effect/vitest";

import {
  MAX_WEBHOOK_NOTICE_CHARS,
  defaultWebhookWakePrompt,
  renderWebhookNotice,
  webhookPayloadSummary,
} from "./webhookListener.ts";
import type { WebhookRequest } from "./webhookTemplate.ts";

const request = (bodyText: string, overrides: Partial<WebhookRequest> = {}): WebhookRequest => ({
  method: "POST",
  path: "/api/hooks/front-door",
  query: "",
  headers: { "content-type": "application/json" },
  bodyText,
  ...overrides,
});

describe("renderWebhookNotice", () => {
  it("renders the default line from a message field", () => {
    expect(
      renderWebhookNotice({
        title: "front-door-motion",
        time: "18:42",
        template: undefined,
        request: request(JSON.stringify({ message: "Someone is at the front door" })),
      }),
    ).toBe("Webhook: front-door-motion · 18:42 · Someone is at the front door");
  });

  it("summarizes plain fields, skipping credentials and collapsing newlines", () => {
    const summary = webhookPayloadSummary(
      request(
        JSON.stringify({
          state: "on",
          token: "must-not-leak",
          area: "Porch\nupstairs",
          battery: 91,
        }),
      ),
    );
    expect(summary).toBe("on");
    const pairs = webhookPayloadSummary(
      request(
        JSON.stringify({
          token: "must-not-leak",
          area: "Porch\nupstairs",
          battery: 91,
        }),
      ),
    );
    expect(pairs).toBe("area=Porch upstairs · battery=91");
    expect(pairs).not.toContain("must-not-leak");
  });

  it("fills templates from the request, listener name and time", () => {
    expect(
      renderWebhookNotice({
        title: "front-door-motion",
        time: "18:42",
        template:
          "{{listener.name}} at {{time}}: {{body.door}} ({{headers.x-event}}) {{body.missing}}",
        request: request(JSON.stringify({ door: "front" }), {
          headers: { "content-type": "application/json", "x-event": "motion" },
        }),
      }),
    ).toBe("front-door-motion at 18:42: front (motion)");
  });

  it("reads form bodies and falls back to the query", () => {
    expect(
      webhookPayloadSummary(
        request("door=front&state=open", {
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
      ),
    ).toBe("open");
    expect(
      webhookPayloadSummary(request("", { method: "GET", query: "state=on&secret=nope" })),
    ).toBe("state=on");
    expect(webhookPayloadSummary(request("", { method: "GET" }))).toBe("no payload");
  });

  it("keeps one line and caps its length", () => {
    const part = "a\nb".repeat(30);
    const line = renderWebhookNotice({
      title: "long",
      time: "18:42",
      template: "{{body.a}} {{body.b}} {{body.c}} {{body.d}}",
      request: request(JSON.stringify({ a: part, b: part, c: part, d: part })),
    });
    expect(line).not.toContain("\n");
    expect(line.length).toBe(MAX_WEBHOOK_NOTICE_CHARS);
    expect(line.endsWith("…")).toBe(true);
  });

  it("names the listener and frames the request as data for a wake turn", () => {
    const prompt = defaultWebhookWakePrompt("front-door-motion");
    expect(prompt).toContain('"front-door-motion"');
    expect(prompt).toContain("untrusted data");
    expect(prompt.endsWith("{{request}}")).toBe(true);
  });
});
