import { renderFluffy } from '../fluffy/renderer.js';
import { paintFluffyMark } from '../fluffy/marks.js';
/** Opt-in fluffy finish. No WebGL context is created until the first render. */
export const fluffy = {
    id: 'fluffy',
    margin: 3,
    render: (shape, view, look, scale) => renderFluffy(shape, view, look, scale),
    paintMark: (...args) => paintFluffyMark(...args),
};
