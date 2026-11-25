import { renderGlass } from '../glass/renderer.js';
import { paintGlassMark } from '../glass/marks.js';
/** Opt-in glass finish. No WebGL context is created until the first render. */
export const glass = {
    id: 'glass',
    margin: 3,
    render: (shape, view, look, scale) => renderGlass(shape, view, look, scale),
    paintMark: (...args) => paintGlassMark(...args),
};
