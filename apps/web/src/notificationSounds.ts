import type { NotificationSound } from "@t3tools/contracts/settings";

export const NOTIFICATION_SOUND_LABELS = {
  classic: "Classic",
  chime: "Chime",
  bubble: "Bubble",
  "soft-bell": "Soft bell",
  gentle: "Gentle",
  none: "None",
} satisfies Record<NotificationSound, string>;

type SynthSound = Exclude<NotificationSound, "classic" | "none">;
type Note = { freq: number; start: number; duration: number; peak: number };
type SynthKind = "completion" | "input";

// Short sine tones with a soft attack and exponential decay; "input" is a rising pair so it
// stays distinguishable from "completion".
const SYNTH_NOTES: Record<SynthSound, Record<SynthKind, readonly Note[]>> = {
  chime: {
    completion: [
      { freq: 784, start: 0, duration: 0.5, peak: 0.5 },
      { freq: 1175, start: 0.12, duration: 0.7, peak: 0.4 },
    ],
    input: [
      { freq: 659, start: 0, duration: 0.4, peak: 0.5 },
      { freq: 880, start: 0.14, duration: 0.4, peak: 0.5 },
      { freq: 1319, start: 0.28, duration: 0.6, peak: 0.4 },
    ],
  },
  bubble: {
    completion: [{ freq: 520, start: 0, duration: 0.18, peak: 0.6 }],
    input: [
      { freq: 440, start: 0, duration: 0.15, peak: 0.6 },
      { freq: 660, start: 0.13, duration: 0.2, peak: 0.6 },
    ],
  },
  "soft-bell": {
    completion: [{ freq: 988, start: 0, duration: 1.1, peak: 0.45 }],
    input: [
      { freq: 988, start: 0, duration: 0.9, peak: 0.45 },
      { freq: 988, start: 0.35, duration: 1.1, peak: 0.45 },
    ],
  },
  gentle: {
    completion: [{ freq: 392, start: 0, duration: 0.6, peak: 0.55 }],
    input: [
      { freq: 392, start: 0, duration: 0.4, peak: 0.55 },
      { freq: 494, start: 0.25, duration: 0.6, peak: 0.55 },
    ],
  },
};

export function isSynthSound(sound: NotificationSound): sound is SynthSound {
  return sound !== "classic" && sound !== "none";
}

/** Linear 0-1 gain from a 0-100 volume; out-of-range or non-finite values clamp. */
export function notificationGain(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, volume)) / 100;
}

export function synthDuration(sound: SynthSound, kind: SynthKind): number {
  return Math.max(...SYNTH_NOTES[sound][kind].map((note) => note.start + note.duration));
}

export function playSynthSound(
  context: AudioContext,
  sound: SynthSound,
  kind: SynthKind,
  output: AudioNode,
) {
  const now = context.currentTime;
  for (const note of SYNTH_NOTES[sound][kind]) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const start = now + note.start;
    oscillator.type = "sine";
    oscillator.frequency.value = note.freq;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(note.peak, start + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
    oscillator.connect(envelope).connect(output);
    oscillator.start(start);
    oscillator.stop(start + note.duration + 0.05);
  }
}
