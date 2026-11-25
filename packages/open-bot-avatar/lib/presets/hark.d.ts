/**
 * The Hark roster: eight bot mascots tuned for the Hark design system (Rev 8).
 *
 * Geometry follows the avatar contract v1 and the open-bot-avatar gallery (MIT,
 * Dominik Scholz); colour and material follow Hark's "two inks, one sky" rule —
 * every body colour is either a sky stop at a phase of the day or one of the three
 * system accents, rendered with the `soft` subsurface material instead of a flat
 * fill. `sky` carries the four zenith-to-horizon stops of the phase behind the bot,
 * for hosts that paint the Hark sky gradient.
 */
import type { AvatarDefinition } from '../types.ts';
import type { SoftMaterial } from '../material.ts';
/** Hark DS Rev 8 tokens used by the roster. */
export declare const HARK: {
    readonly ink: '#1D1D1F';
    readonly paper: '#F5F5F7';
    readonly skyDay: '#ABC1DB';
    readonly skyNight: '#2A3256';
    readonly systemOrange: '#FF4D00';
    readonly systemGreen: '#00A665';
    readonly systemRed: '#DA2F35';
    /** Raw live dusk stop (DS §6 table), the bunny's violet. */
    readonly duskGlow: '#5B6CB4';
    /** Success capsule surface (DS §3.5), the analysis bot's mint sky. */
    readonly successSurface: '#C9F9DA';
    /** Opaque secondary surface (DS §3.2). */
    readonly surfaceSecondary: '#F3F5FA';
};
/** Zenith-to-horizon sky stops per phase (Hark DS §6, shown values). */
export declare const HARK_SKY: {
    readonly day: readonly ['#3F78B1', '#65A3DD', '#A0D3F4', '#DAE6E1'];
    readonly golden: readonly ['#3E6B8C', '#6D94B4', '#BEC2AB', '#FEC768'];
    readonly sunset: readonly ['#446787', '#7489B8', '#C5AEAB', '#FF9E7B'];
    readonly dusk: readonly ['#2E5077', '#4E63A2', '#8485AE', '#D08E6F'];
    readonly night: readonly ['#0C1227', '#111830', '#192039', '#252B43'];
    readonly overcast: readonly ['#8498AB', '#9FB1C4', '#ADB7BB'];
    readonly auth: readonly ['#B6CFE7', '#FFEED9'];
};
export type HarkSkyPhase = keyof typeof HARK_SKY;
export interface HarkBot {
    /** The avatar definition (contract v1). */
    definition: AvatarDefinition;
    /** What the bot does in the product. */
    role: string;
    /** Body colour: a sky stop or a system accent. */
    color: string;
    /** Soft-material tuning for this colour. */
    soft: SoftMaterial;
    /** The sky phase the bot lives in. */
    phase: HarkSkyPhase;
    /** Zenith-to-horizon stops of that sky, for the host background. */
    sky: readonly string[];
}
/**
 * Eight bots, eight silhouettes, eight live colours. Pale bodies (the cloud) use a
 * denser, lower-ambient material so the volume reads; saturated bodies use the
 * gentle default so the hue stays vivid.
 */
export declare const HARK_ROSTER: HarkBot[];
/** A roster bot by definition id, e.g. `harkBot('ghost')`. */
export declare function harkBot(id: string): HarkBot | undefined;
/** The sky gradient stops of a phase, zenith to horizon. */
export declare function harkSky(phase: HarkSkyPhase): readonly string[];
