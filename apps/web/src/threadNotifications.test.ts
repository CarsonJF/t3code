import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SOUND_SECONDS = 0.6;

const audio = { currentTime: 0, started: 0, tones: 0, gains: [] as number[] };

class FakeAudioContext {
  state = "running";
  destination = {};
  get currentTime() {
    return audio.currentTime;
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: SOUND_SECONDS });
  }
  createGain() {
    const node = {
      gain: {
        set value(next: number) {
          audio.gains.push(next);
        },
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect: () => node,
    };
    return node;
  }
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start() {
        audio.tones += 1;
      },
      stop() {},
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start() {
        audio.started += 1;
      },
    };
  }
}

async function loadUnlocked() {
  const notifications = await import("./threadNotifications");
  notifications.unlockNotificationAudio();
  return notifications;
}

beforeEach(() => {
  vi.resetModules();
  audio.currentTime = 0;
  audio.started = 0;
  audio.tones = 0;
  audio.gains = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playNotificationSound", () => {
  it("preloads both sounds on unlock and reuses them for playback", async () => {
    const { unlockNotificationAudio, playNotificationSound } = await loadUnlocked();
    expect(fetch).toHaveBeenCalledTimes(2);
    unlockNotificationAudio();
    await playNotificationSound("completion", () => true);
    await playNotificationSound("input", () => true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(audio.started).toBe(2);
  });

  it("retries failed preloads on an alert rather than every gesture", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const { unlockNotificationAudio, playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => true);
    expect(fetch).toHaveBeenCalledTimes(2);

    unlockNotificationAudio();
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.mocked(fetch).mockResolvedValue(new Response(new ArrayBuffer(0)));
    await playNotificationSound("completion", () => true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(audio.started).toBe(1);
  });

  it("plays one sound for threads that complete together", async () => {
    const { playNotificationSound } = await loadUnlocked();

    await Promise.all(
      Array.from({ length: 4 }, () => playNotificationSound("completion", () => true)),
    );

    expect(audio.started).toBe(1);
  });

  it("still plays an input alert over a completion sound", async () => {
    const { playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => true);

    await playNotificationSound("input", () => true);

    expect(audio.started).toBe(2);
  });

  it("leaves the slot free when a sound is turned off before it plays", async () => {
    const { playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => false);

    await playNotificationSound("completion", () => true);

    expect(audio.started).toBe(1);
  });

  it("plays nothing for the None sound or a zero volume", async () => {
    const { playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => true, { sound: "none", volume: 50 });
    await playNotificationSound("completion", () => true, { sound: "classic", volume: 0 });
    await playNotificationSound("completion", () => true, { sound: "chime", volume: 0 });
    expect(audio.started + audio.tones).toBe(0);
  });

  it("applies the volume as gain and clamps out-of-range values", async () => {
    const { playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => true, { sound: "classic", volume: 25 });
    audio.currentTime = 10;
    await playNotificationSound("completion", () => true, { sound: "classic", volume: 400 });
    expect(audio.gains).toEqual([0.25, 1]);
  });

  it("synthesizes the soft sounds without fetching audio files", async () => {
    const { playNotificationSound } = await loadUnlocked();
    vi.mocked(fetch).mockClear();
    await playNotificationSound("input", () => true, { sound: "chime", volume: 40 });
    expect(audio.tones).toBe(3);
    expect(audio.started).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
