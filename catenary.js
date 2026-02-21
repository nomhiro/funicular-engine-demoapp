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
     * The hanging catenary uses: y = -a * cosh((x - x0) / a) + C
     * so the curve sags downward (positive y) between the endpoints.
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

        // Work in a left-to-right coordinate system for the catenary math
        const goingRight = dx >= 0;
        const left = goingRight ? p1 : p2;
        const right = goingRight ? p2 : p1;
        const dh = right.x - left.x; // always positive
        const dv = right.y - left.y; // positive = right endpoint is lower

        const { a, valid } = solveCatenaryParam(dh, dv, length);

        if (!valid) {
            const pts = [];
            for (let i = 0; i <= numPoints; i++) {
                const t = i / numPoints;
                pts.push({ x: p1.x + dx * t, y: p1.y + dy * t });
            }
            return pts;
        }

        // Solve for x0 (catenary lowest point) in local coords (0 to dh)
        const sinhTerm = Math.sinh(dh / (2 * a));
        let x0Local = dh / 2;
        if (Math.abs(sinhTerm) > 1e-10) {
            x0Local = dh / 2 - a * Math.asinh(dv / (2 * a * sinhTerm));
        }

        // Absolute x position of catenary vertex
        const x0 = left.x + x0Local;

        // C from left boundary: left.y = -a * cosh((left.x - x0)/a) + C
        const C = left.y + a * Math.cosh((left.x - x0) / a);

        // Generate points from p1 to p2
        const pts = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const px = p1.x + dx * t;
            const py = -a * Math.cosh((px - x0) / a) + C;
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
     * Simulate a chain with multiple weights using position-based relaxation.
     * Uses iterative Verlet-like relaxation for stable, natural catenary curves.
     *
     * anchor1, anchor2: {x, y} fixed endpoints
     * weights: [{position: 0-1 along chain, mass: number}]
     * chainLength: total length of chain
     * gravity: gravity constant
     *
     * Returns array of {x, y} points for rendering.
     */
    function simulateChainWithWeights(anchor1, anchor2, chainLength, weights, gravity = 0.5, iterations = 80) {
        // If no weights, use the analytical catenary for a perfect curve
        if (!weights || weights.length === 0) {
            return generateCatenaryPoints(anchor1, anchor2, chainLength, 60);
        }

        const numSegments = 60;
        const segLength = chainLength / numSegments;
        const dx = anchor2.x - anchor1.x;
        const dy = anchor2.y - anchor1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Initialize positions along straight line
        const particles = [];
        for (let i = 0; i <= numSegments; i++) {
            const t = i / numSegments;
            particles.push({
                x: anchor1.x + dx * t,
                y: anchor1.y + dy * t,
                prevX: anchor1.x + dx * t,
                prevY: anchor1.y + dy * t,
                pinned: (i === 0 || i === numSegments),
                mass: 1.0
            });
        }

        // Add extra mass at weight positions
        for (const w of weights) {
            const idx = Math.round(w.position * numSegments);
            if (idx > 0 && idx < numSegments) {
                particles[idx].mass += w.mass;
            }
        }

        // Verlet integration with many constraint passes
        const dt = 0.016;
        const gForce = gravity * 200;
        const damping = 0.99;
        const constraintPasses = 15;

        for (let iter = 0; iter < iterations; iter++) {
            // Verlet integration step
            for (const p of particles) {
                if (p.pinned) continue;
                const vx = (p.x - p.prevX) * damping;
                const vy = (p.y - p.prevY) * damping;
                p.prevX = p.x;
                p.prevY = p.y;
                p.x += vx;
                p.y += vy + gForce * p.mass * dt * dt;
            }

            // Distance constraint solving
            for (let c = 0; c < constraintPasses; c++) {
                for (let i = 0; i < numSegments; i++) {
                    const a = particles[i];
                    const b = particles[i + 1];

                    const ddx = b.x - a.x;
                    const ddy = b.y - a.y;
                    const currentDist = Math.sqrt(ddx * ddx + ddy * ddy);

                    if (currentDist < 0.001) continue;

                    const diff = (segLength - currentDist) / currentDist;
                    const totalMass = a.mass + b.mass;
                    const ratioA = a.pinned ? 0 : (b.pinned ? 1 : b.mass / totalMass);
                    const ratioB = b.pinned ? 0 : (a.pinned ? 1 : a.mass / totalMass);

                    if (!a.pinned) {
                        a.x -= ddx * diff * ratioA;
                        a.y -= ddy * diff * ratioA;
                    }
                    if (!b.pinned) {
                        b.x += ddx * diff * ratioB;
                        b.y += ddy * diff * ratioB;
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
