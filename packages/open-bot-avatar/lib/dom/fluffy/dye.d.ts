/**
 * How a fluffy coat takes its color: one row of colors per dye, from the darkest recess to the
 * brightest lit tip. The shader works out how much light a fiber catches and looks the color up
 * here, so every dye keeps its hue through the same range of shading.
 */
import { type Rgb } from '../../color.ts';
/** Colors in a ramp. */
export declare const DYE_RAMP_SIZE = 96;
/** Exposure at the bright end of a ramp; 1 is the dye's own color. */
export declare const DYE_RAMP_RANGE = 2.4;
/**
 * The ramp for a body color, as RGBA bytes. RGB is the color at each exposure. Alpha, the same
 * along the row, is how far the shader replaces it with its separate response for yellow fibers.
 */
export declare function dyeRamp(rgb: Rgb): Uint8Array<ArrayBuffer>;
