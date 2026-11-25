import type { FramePath, SurfaceEye, ViewBasis } from '../../render.ts';
import type { RenderOptions } from '../../types.ts';
import type { Volume } from '../../volume.ts';
/** An image valid until the next render; the canvas painter copies it immediately. */
export interface MaterialImage {
    canvas: HTMLCanvasElement;
    x: number;
    y: number;
    size: number;
    cx: number;
    cy: number;
    radius: number;
    /** Whether the image already holds the eyes. False: the painter draws the live eyes over it. Default true. */
    eyes?: boolean;
}
export interface MaterialLook {
    color: string;
    ink: string;
    eyes: SurfaceEye[];
}
/** A canvas finish supplied by the caller. Importing DOM mounting never imports a material. */
export interface CanvasMaterial {
    readonly id: string;
    /** Extra room outside the body's projected bounds, in viewBox units. */
    readonly margin?: number;
    /** Render options the material needs in every frame, live or still (e.g. soft's ramp and front-facing pose). */
    readonly frame?: Pick<RenderOptions, 'soft'>;
    /**
     * Return null where unavailable; the painter falls back to flat paths and eyes.
     * `outline` is the definition's body path in the 0 0 100 100 viewBox.
     */
    render(shape: Volume, view: ViewBasis, look: MaterialLook, scale: number, outline: string): MaterialImage | null;
    /** Optional thinking/blocked marks. False leaves the original flat mark in place. */
    paintMark?(ctx: CanvasRenderingContext2D, box: FramePath['box'], scale: number, color: string): boolean;
}
