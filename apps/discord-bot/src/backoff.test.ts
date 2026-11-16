import { describe, expect, it } from "vite-plus/test";

import { nextReconnectDelay, planLoginRetry } from "./backoff.ts";

describe("nextReconnectDelay", () => {
  it("starts at the base delay and doubles", () => {
    expect(nextReconnectDelay(0, { random: () => 1 })).toBe(1_000);
    expect(nextReconnectDelay(1, { random: () => 1 })).toBe(2_000);
    expect(nextReconnectDelay(3, { random: () => 1 })).toBe(8_000);
  });

  it("jitters down but never below half", () => {
    expect(nextReconnectDelay(2, { random: () => 0 })).toBe(2_000);
    expect(nextReconnectDelay(2, { random: () => 0.5 })).toBe(3_000);
  });

  it("caps the wait so a long outage retries at a steady pace", () => {
    expect(nextReconnectDelay(20, { random: () => 1 })).toBe(60_000);
    expect(nextReconnectDelay(20, { random: () => 0 })).toBe(30_000);
  });

  it("clamps a negative or non-finite attempt", () => {
    expect(nextReconnectDelay(-4, { random: () => 1 })).toBe(1_000);
    expect(nextReconnectDelay(Number.NaN, { random: () => 1 })).toBe(1_000);
  });
});

describe("planLoginRetry", () => {
  it("retries a transient failure with backoff", () => {
    expect(planLoginRetry({ attempt: 2, fatal: false, random: () => 1 })).toEqual({
      retry: true,
      delayMs: 4_000,
    });
  });

  it("does not retry a rejected token", () => {
    expect(planLoginRetry({ attempt: 0, fatal: true, random: () => 1 })).toEqual({
      retry: false,
      delayMs: 0,
    });
  });
});
