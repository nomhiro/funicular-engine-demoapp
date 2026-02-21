/**
 * Catenary curve physics engine for the funicular experiment simulator.
 *
 * A catenary is the curve formed by a chain/rope hanging under its own weight
 * between two fixed points. The equation is: y = a * cosh((x - x0) / a) + y0
 *
 * For chains with additional weights, we use a piecewise approach:
 * the chain is divided into segments, each forming its own catenary
 * between attachment points, with the weight positions determined by
 * force equilibrium.
 */

const CatenaryEngine = (() => {

    /**
     * Solve for the catenary parameter 'a' given two endpoints and chain length.
     * Uses Newton's method on: sqrt(L^2 - dv^2) = 2a * sinh(dh / (2a))
     * where dh = horizontal distance, dv = vertical distance, L = chain length.
     */
    function solveCatenaryParam(dx, dy, length) {
        const dh = Math.abs(dx);
        const dv = Math.abs(dy);

        // If length is barely enough to span the distance, return a very large 'a'
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (length <= dist * 1.001) {
            return { a: 1e6, valid: false };
        }

        // The horizontal span of the catenary sag
        const horizontalCatenarySag = Math.sqrt(length * length - dv * dv);

        if (horizontalCatenarySag <= 0 || isNaN(horizontalCatenarySag)) {
            return { a: 1e6, valid: false };
        }

        // Newton's method: solve f(a) = 2a*sinh(dh/(2a)) - horizontalCatenarySag = 0
        let a = Math.max(dh * 0.5, 1);

        for (let i = 0; i < 100; i++) {
            const ratio = dh / (2 * a);
            const sinhVal = Math.sinh(ratio);
            const coshVal = Math.cosh(ratio);
            const f = 2 * a * sinhVal - horizontalCatenarySag;
            const fPrime = 2 * sinhVal - dh * coshVal / a;

            if (Math.abs(fPrime) < 1e-15) break;

            const da = f / fPrime;
            a -= da;

            if (a <= 0) a = 0.1;
            if (Math.abs(da) < 1e-10) break;
        }

        return { a: Math.max(a, 0.01), valid: true };
    }

    /**
     * Generate catenary points between two endpoints.
     * p1 and p2 are {x, y} where y increases downward (screen coords).
     * Returns array of {x, y} points.
     */
    function generateCatenaryPoints(p1, p2, length, numPoints = 40) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If chain is shorter than distance, just draw a straight line
        if (length <= dist) {
            const pts = [];
            for (let i = 0; i <= numPoints; i++) {
                const t = i / numPoints;
                pts.push({ x: p1.x + dx * t, y: p1.y + dy * t });
            }
            return pts;
        }

        // For nearly vertical chains, use a special approach
        if (Math.abs(dx) < 1) {
            return generateVerticalCatenary(p1, p2, length, numPoints);
        }

        const { a, valid } = solveCatenaryParam(dx, dy, length);

        if (!valid) {
            const pts = [];
            for (let i = 0; i <= numPoints; i++) {
                const t = i / numPoints;
                pts.push({ x: p1.x + dx * t, y: p1.y + dy * t });
            }
            return pts;
        }

        // Find the x-offset and y-offset for the catenary
        // catenary: Y(X) = a * cosh((X - x0) / a) + y0
        // We work in a local coordinate where X goes from 0 to dh (horizontal span)
        const dh = Math.abs(dx);
        const sign = dx > 0 ? 1 : -1;

        // Solve for x0: the x-position of the catenary minimum
        // From boundary conditions:
        // cosh((0 - x0)/a) and cosh((dh - x0)/a) give the two endpoints
        // The difference in Y must equal dy (considering sign)
        const dyAdjusted = (dx > 0) ? dy : -dy;

        // x0 = dh/2 - a * arcsinh(dyAdjusted / (2 * a * sinh(dh/(2*a))))
        const sinhTerm = Math.sinh(dh / (2 * a));
        let x0;
        if (Math.abs(sinhTerm) > 1e-10) {
            x0 = dh / 2 - a * Math.asinh(dyAdjusted / (2 * a * sinhTerm));
        } else {
            x0 = dh / 2;
        }

        const y0 = -a * Math.cosh((0 - x0) / a);

        const pts = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const localX = t * dh;
            const localY = a * Math.cosh((localX - x0) / a) + y0;

            let px, py;
            if (dx > 0) {
                px = p1.x + localX;
                py = p1.y + localY;
            } else {
                px = p1.x - localX;
                py = p1.y + localY; // localY is relative, adjusted for the reversed direction
                // Need to recalculate for negative dx
                px = p1.x - sign * localX; // This simplifies
                // Actually let's do it properly
                px = p1.x + (dx > 0 ? localX : -localX);
                py = p1.y + (dx > 0 ? localY : localY);
            }
            // Simpler: parameterize by t along horizontal
            px = p1.x + dx * t;
            const lx = t * dh;
            py = p1.y + (a * Math.cosh((lx - x0) / a) + y0);
            if (dx < 0) {
                // Mirror the local x
                const lxMirror = (1 - t) * dh;
                py = p2.y + (a * Math.cosh((lxMirror - x0) / a) + y0);
            }

            pts.push({ x: px, y: py });
        }

        return pts;
    }

    /**
     * Generate points for a nearly-vertical hanging chain.
     */
    function generateVerticalCatenary(p1, p2, length, numPoints) {
        const pts = [];
        // For vertical chains, the catenary degenerates
        // Use a simple parabolic approximation with sag
        const midX = (p1.x + p2.x) / 2;
        const excess = length - Math.abs(p2.y - p1.y);

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const y = p1.y + (p2.y - p1.y) * t;
            // Small horizontal sag
            const sag = excess * 0.3 * Math.sin(Math.PI * t);
            pts.push({ x: midX + sag, y: y });
        }
        return pts;
    }

    /**
     * Simulate a chain with multiple weights using iterative relaxation.
     * This treats the chain as a series of connected segments with point masses.
     *
     * anchor1, anchor2: {x, y} fixed endpoints
     * weights: [{position: 0-1 along chain, mass: number}]
     * chainLength: total length of chain
     * gravity: gravity constant
     *
     * Returns array of {x, y} points for rendering.
     */
    function simulateChainWithWeights(anchor1, anchor2, chainLength, weights, gravity = 0.5, iterations = 80) {
        const numSegments = 50;
        const segLength = chainLength / numSegments;
        const dx = anchor2.x - anchor1.x;
        const dy = anchor2.y - anchor1.y;

        // Initialize particle positions along a straight line
        const particles = [];
        for (let i = 0; i <= numSegments; i++) {
            const t = i / numSegments;
            particles.push({
                x: anchor1.x + dx * t,
                y: anchor1.y + dy * t,
                oldX: anchor1.x + dx * t,
                oldY: anchor1.y + dy * t,
                pinned: (i === 0 || i === numSegments),
                mass: 1.0
            });
        }

        // Add extra mass at weight positions
        if (weights && weights.length > 0) {
            for (const w of weights) {
                const idx = Math.round(w.position * numSegments);
                if (idx > 0 && idx < numSegments) {
                    particles[idx].mass += w.mass;
                }
            }
        }

        // Verlet integration with constraint solving
        for (let iter = 0; iter < iterations; iter++) {
            // Apply gravity
            for (const p of particles) {
                if (p.pinned) continue;

                const vx = (p.x - p.oldX) * 0.99; // damping
                const vy = (p.y - p.oldY) * 0.99;

                p.oldX = p.x;
                p.oldY = p.y;

                p.x += vx;
                p.y += vy + gravity * p.mass * 0.1;
            }

            // Distance constraints
            for (let c = 0; c < 5; c++) {
                for (let i = 0; i < numSegments; i++) {
                    const a = particles[i];
                    const b = particles[i + 1];

                    const ddx = b.x - a.x;
                    const ddy = b.y - a.y;
                    const dist = Math.sqrt(ddx * ddx + ddy * ddy);

                    if (dist < 0.001) continue;

                    const diff = (segLength - dist) / dist;
                    const offsetX = ddx * diff * 0.5;
                    const offsetY = ddy * diff * 0.5;

                    if (!a.pinned) {
                        a.x -= offsetX;
                        a.y -= offsetY;
                    }
                    if (!b.pinned) {
                        b.x += offsetX;
                        b.y += offsetY;
                    }
                }

                // Re-pin anchors
                particles[0].x = anchor1.x;
                particles[0].y = anchor1.y;
                particles[numSegments].x = anchor2.x;
                particles[numSegments].y = anchor2.y;
            }
        }

        return particles.map(p => ({ x: p.x, y: p.y }));
    }

    /**
     * Find the closest point on a chain to a given position.
     * Returns {index, distance, point} where index is segment index (0-1 normalized).
     */
    function closestPointOnChain(chainPoints, pos) {
        let minDist = Infinity;
        let closestIdx = 0;
        let closestPt = chainPoints[0];

        for (let i = 0; i < chainPoints.length - 1; i++) {
            const a = chainPoints[i];
            const b = chainPoints[i + 1];

            // Project pos onto segment a-b
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const apx = pos.x - a.x;
            const apy = pos.y - a.y;

            const ab2 = abx * abx + aby * aby;
            if (ab2 < 0.001) continue;

            let t = (apx * abx + apy * aby) / ab2;
            t = Math.max(0, Math.min(1, t));

            const projX = a.x + abx * t;
            const projY = a.y + aby * t;
            const dist = Math.sqrt((pos.x - projX) ** 2 + (pos.y - projY) ** 2);

            if (dist < minDist) {
                minDist = dist;
                closestIdx = (i + t) / (chainPoints.length - 1);
                closestPt = { x: projX, y: projY };
            }
        }

        return { position: closestIdx, distance: minDist, point: closestPt };
    }

    return {
        solveCatenaryParam,
        generateCatenaryPoints,
        simulateChainWithWeights,
        closestPointOnChain
    };
})();
