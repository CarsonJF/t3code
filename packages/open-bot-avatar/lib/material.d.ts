/**
 * The `soft` material: a subsurface-scattering colour ramp for the body's cross-sections,
 * ported from the soft-shape fragment shader used in the Hark design study.
 *
 * The renderer already implies volume as stacked cross-sections; this module gives each
 * slice a colour by how deep it sits in that volume, instead of one flat body colour.
 * Light entering the body is absorbed per channel by `density * (1 - linear(color))`,
 * so a slice's colour is the body colour times the light that survives the travel to it:
 * the surface keeps the exact body colour, deeper slices sink into a richer, saturated
 * version of the same hue — never toward gray. Pale bodies absorb little and stay airy;
 * saturated bodies glow from within. An optional `lift` screens a floor colour over the
 * result (the night-floor trick) so near-black bodies keep a readable volume.
 *
 * Pure and dependency-free: a ramp is a small lookup table computed once per colour and
 * material, then indexed by each slice's `tone` (0 = surface, 1 = deepest).
 */
import type { Rgb } from './color.ts';
import type { VolumePart, VolumeSlice } from './volume.ts';
export interface SoftMaterial {
    /** Absorption strength of the body. Higher = deeper, richer shadows. Default 2.2. */
    density?: number;
    /** Share of ambient (undirected) light, 0..1. Higher = flatter, brighter volume. Default 0.5. */
    ambient?: number;
    /** Optical travel across the full depth. Higher = stronger falloff. Default 2.4. */
    spread?: number;
    /** Key-light cone width in degrees (source shader u_softness). Default 14. */
    softness?: number;
    /** Night-floor lift 0..1: screen a floor colour over the result so dark bodies read. Default 0. */
    lift?: number;
    /** Floor colour for `lift`, #rgb or #rrggbb. Default #5B698D (a night-sky stop). */
    liftColor?: string;
}
export declare const DEFAULT_SOFT: {
    readonly density: 2.2;
    readonly ambient: 0.5;
    readonly spread: 2.4;
    readonly lift: 0;
    readonly liftColor: '#5B698D';
};
/** Ramp resolution: slices index it by tone, so 24 steps are far below one visible band. */
export declare const RAMP_STEPS = 24;
/**
 * The soft-material colours of a body, surface first (index 0 = the exact body colour)
 * and deepest last. Normalized so the surface reads as the body itself, not a tint of it.
 */
export declare function softRamp(color: Rgb, material?: SoftMaterial, steps?: number): Rgb[];
/** The ramp colour at tone `t` (0..1), linearly between steps. */
export declare function rampAt(ramp: Rgb[], t: number): Rgb;
/** rampAt for a ramp of hex stops (as AvatarFrame.ramp carries), cached per ramp. */
export declare function rampHexAt(ramp: string[], t: number): string;
/**
 * Where a cross-section sits in its part's volume, 0 (surface) .. 1 (deepest).
 * z-slices run front (+depth/2) to back; x-slices (the side stack) approximate travel
 * by distance from the silhouette edge, so side views keep a lit rim and a deep core.
 */
export declare function sliceTone(part: Pick<VolumePart, 'depth' | 'thickness'>, slice: VolumeSlice): number;
