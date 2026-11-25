import type { SoftMaterial } from './material.ts';
import type { Rim } from './effects.ts';
import type { Pose } from './motion.ts';
import type { Bounds, Point } from './path.ts';
import type { Vec3, Volume } from './volume.ts';
import type { AvatarDefinition, RenderOptions } from './types.ts';
export declare const DEFAULT_COLOR = "#ff6a1a";
export declare const DEFAULT_EYE_COLOR = "#151515";
/** `depth` option value that maps to the natural inferred volume. */
export declare const DEFAULT_DEPTH = 6;
/**
 * How far the body reaches from the middle of its box, for a working turn's hoop and for a
 * celebration's cage. The hoops' centre hops and stretches with the body (see ribbonsFollow) but
 * does not lean or sway with it, so each is measured over the leans its state takes, the body
 * stretched about the centre: a working bot leans 2.4° to 6.6° and squashes to 98%; a celebrating
 * one sways ±1.7° and stretches up to 5.5%. The hoops stand just outside that, so the body never
 * moves through a point where a ribbon passes behind it.
 */
export declare function ribbonRims(polys: Point[][], b: Bounds): {
    work: Rim;
    cage: Rim;
};
/**
 * The rim moved to where the hoops' centre is in this pose: it hops and stretches with the body
 * (the root motion's lift and scale about the base) but does not lean or sway with it.
 */
export declare function ribbonsFollow(rim: Rim, pose: Pick<Pose, 'lift' | 'sx' | 'sy'>, b: Bounds): Rim;
/** The validated definition and its cached volume, exactly as the renderers use them. Throws if invalid. */
export declare function preparedVolume(definition: AvatarDefinition, depth?: number): {
    def: AvatarDefinition;
    vol: Volume;
};
type M = Matrix;
export interface ViewBasis {
    cY: number;
    sY: number;
    cP: number;
    sP: number;
    /** cos(yaw)·cos(pitch): > 0 when the front faces the viewer. */
    facing: number;
}
export declare function viewBasis(yaw: number, pitch: number): ViewBasis;
/** Toward-viewer component of a model-space direction under this view (1 = straight at the viewer). */
export declare function facingOf(v: ViewBasis, [x, y, z]: Vec3): number;
/** Which slice stack faces the viewer more: front-facing z-planes or side-facing x-planes. */
export declare function activeStack(v: ViewBasis): 'z' | 'x';
/**
 * Orthographic projection of the plane at depth z, pivoting on `pivot` at z = 0.
 * Yaw turns about the vertical axis, then pitch tips about the horizontal axis.
 */
export declare function planeMatrix(v: ViewBasis, z: number, pivot: Point): M;
/** Projection of the side plane x = x0, whose local coordinates are (u = -z, y). */
export declare function sidePlaneMatrix(v: ViewBasis, x0: number, pivot: Point): M;
/** Project a 3D point: screen x, screen y and depth toward the viewer. */
export declare function projectPoint(v: ViewBasis, [x, y, z]: Vec3, pivot: Point): Vec3;
/**
 * A square of viewBox units that holds the avatar at every view and pose. Throws if invalid. The
 * canvas renderer uses it only as an upper bound: it sizes each bitmap to what is actually painted.
 */
export declare function avatarExtent(definition: AvatarDefinition, depth?: number): {
    x: number;
    y: number;
    size: number;
};
/** 2D affine matrix in SVG order (a b c d e f). */
export type Matrix = [number, number, number, number, number, number];
/**
 * How one eye is drawn, in its face plane's coordinates (viewBox units): the plain pill, the
 * plain happy arc (stroked, round caps), or for every other look a filled outline (a waiting
 * bot's slits, and every shape on the way from one look to the next).
 */
export type EyeMark = {
    shape: 'pill';
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
} | {
    shape: 'arc';
    d: string;
    strokeWidth: number;
} | {
    shape: 'path';
    d: string;
};
export type FrameShape = {
    kind: 'slice';
    /** Stable across frames for the same cross-section: use it as a key in retained renderers. */
    key: string;
    /** Id of an entry in AvatarFrame.paths. */
    path: string;
    matrix: Matrix;
    /** Depth in the part's volume, 0 (surface) .. 1 (deepest); indexes AvatarFrame.ramp. */
    tone: number;
} | {
    kind: 'eye';
    key: 'eye-0' | 'eye-1';
    matrix: Matrix;
    mark: EyeMark;
} | {
    /**
     * A piece of a ribbon: fill `d` in `fill`. Each ribbon has a hue of its own, set apart from
     * the body's; a piece `front` of the body is lighter than one behind it.
     */
    kind: 'ribbon';
    key: string;
    d: string;
    box: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    matrix: Matrix;
    front: boolean;
    /** The ribbon's colour where it is plainest (the middle of its gradient). */
    fill: string;
    /**
     * A linear gradient along the whole ribbon, in the same coordinates as `d`: from its tail
     * (x1, y1) to its head (x2, y2), the stops evenly spaced. Every piece of a ribbon shares it.
     */
    gradient: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        stops: string[];
    };
};
/** One cross-section outline, shared by every shape that draws it. */
export interface FramePath {
    id: string;
    d: string;
    evenOdd: boolean;
    box: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
}
/**
 * One frame of the avatar flattened onto the screen: every cross-section the
 * view draws with its projection, and the visible eyes, sorted back to front,
 * between the ribbons behind the body and those in front of it. The marks of
 * `thinking` and `blocked` are listed as slices too, in place of the body.
 * Painting them in order (body paths in `color`, eyes in `ink`) inside the
 * `root` transform and a 0 0 100 100 viewBox gives the avatar exactly as
 * renderAvatarSvg draws it. Plain numbers and path strings, so any vector
 * renderer (SVG, canvas, Skia, react-native-svg) can draw it.
 */
export interface AvatarFrame {
    name: string;
    color: string;
    ink: string;
    /**
     * Distinct cross-section paths this frame uses; ids are stable for equal geometry and depth.
     * `box` bounds `d` in its own coordinates, before a shape's matrix.
     */
    paths: FramePath[];
    /** 2D motion (hop, roll, squash) about the base of the body, applied to every shape. */
    root: Matrix;
    /** Back to front. */
    shapes: FrameShape[];
    /**
     * The body as one surface, for a renderer that draws it in 3D instead of as slices (the fluffy
     * material): the view's rotation, the body's scale as it gives way to a mark, and both eyes,
     * including an eye `shapes` leaves out because its spot faces away.
     */
    surface: {
        view: ViewBasis;
        scale: number;
        eyes: SurfaceEye[];
    };
    /**
     * The soft material's colour ramp, surface first, as hex stops — present only when
     * `soft` is set and the body colour is hex. Slice shapes index it by `tone`;
     * vector renderers paint it per slice, the canvas renderer prefers softBody.
     */
    ramp?: string[];
    /**
     * The soft material's per-pixel body: the outline to shade with the soft-shape
     * subsurface integral (see softsprite.ts), its material, and the matrix to draw it
     * under (the body's shrink about its pivot, before the frame root). The canvas
     * renderer paints one cached sprite in place of the slice stack; the body faces
     * front in this mode — gaze, 2D motion, states and moods stay live.
     */
    softBody?: {
        d: string;
        evenOdd: boolean;
        material: SoftMaterial;
        matrix: Matrix;
    };
}
/**
 * An eye on the body's surface, in face coordinates: its mark where it rests, and how far its
 * gaze has moved it from there. Apart, so a renderer can tell a moving eye from a changing one.
 */
export interface SurfaceEye {
    mark: EyeMark;
    dx: number;
    dy: number;
}
/** Compute one flat frame of a definition. Throws if the definition is invalid. */
export declare function avatarFrame(definition: AvatarDefinition, options?: RenderOptions): AvatarFrame;
/**
 * avatarFrame for a live avatar drawn `options.size` CSS pixels wide: like the scene, it skips
 * cross-sections that would sit less than a pixel apart. Internal to the live renderers, so
 * `size` never changes what avatarFrame returns to custom renderers.
 */
export declare function liveFrame(definition: AvatarDefinition, options?: RenderOptions): AvatarFrame;
/** Render a definition to a standalone SVG string. Throws if the definition is invalid. */
export declare function renderAvatarSvg(definition: AvatarDefinition, options?: RenderOptions): string;
/**
 * Static markup of the live scene for a definition and depth. Mount it once,
 * then apply `sceneFrame` every frame. Body color comes from CSS `color` on
 * an ancestor, eye ink from `--avatar-ink`.
 */
export declare function renderAvatarScene(definition: AvatarDefinition, options?: Pick<RenderOptions, 'depth'>): string;
export interface SceneFrame {
    /** Identifies the static markup this frame belongs to. */
    scene: string;
    /** 2D motion (hop, roll, squash) about the base of the body. */
    motion: string;
    /** 3D view rotation about the body center, scaled down while the body gives way to a mark. */
    view: string;
    /** How much of its size the body keeps, 0..1; at 0 the view needs no layers. */
    body: number;
    /** Markup for the scene's two overlays (`data-fx`): ribbons behind the body; ribbons and marks in front. */
    back: string;
    front: string;
    stack: 'z' | 'x';
    /** Per slice of the active stack, in markup order: whether it shows. Hidden ones need no layer. */
    slices: boolean[];
    /** `d` is set while the eye is between the pill and the arc: it then shows the `data-morph` path alone. */
    eyes: {
        visible: boolean;
        happy: boolean;
        transform: string;
        pill: string;
        d: string;
    }[];
}
/** Per-frame CSS for a mounted scene. Pure and cheap: no geometry is rebuilt. */
export declare function sceneFrame(definition: AvatarDefinition, options?: RenderOptions): SceneFrame;
export {};
