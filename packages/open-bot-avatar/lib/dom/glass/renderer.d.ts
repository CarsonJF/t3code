import type { SurfaceEye, ViewBasis } from '../../render.ts';
import { type MaterialShape } from '../materials/shape.ts';
export type GlassShape = MaterialShape;
export interface GlassLook {
    color: string;
    ink: string;
    eyes: SurfaceEye[];
}
export interface GlassImage {
    canvas: HTMLCanvasElement;
    x: number;
    y: number;
    size: number;
    cx: number;
    cy: number;
    radius: number;
}
export declare function renderGlass(shape: GlassShape, view: ViewBasis, look: GlassLook, scale: number): GlassImage | null;
