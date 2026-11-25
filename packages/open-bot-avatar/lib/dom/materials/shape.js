/** Front-to-back half extent of a body or state mark. */
export function halfDepth(shape) {
    return 'radius' in shape ? shape.radius : Math.max(0.5, ...shape.parts.map((part) => part.depth / 2));
}
