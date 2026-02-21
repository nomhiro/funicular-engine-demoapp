/**
 * Funicular Experiment Simulator - Main Application
 *
 * Interactive simulator for Gaudi's inverted hanging chain design method.
 */

(function () {
    'use strict';

    // =========================================================================
    // Data Model
    // =========================================================================

    /** @type {{ id: number, x: number, y: number, type: 'ceiling'|'chain-point' }[]} */
    let anchors = [];

    /**
     * @type {{
     *   id: number,
     *   startId: number,       // anchor id or special chain-point id
     *   endId: number,
     *   length: number,        // rope length
     *   weights: { position: number, mass: number }[],
     *   points: { x: number, y: number }[]  // computed curve points
     * }[]}
     */
    let chains = [];

    let nextId = 1;
    function genId() { return nextId++; }

    // =========================================================================
    // State
    // =========================================================================

    let mode = 'add-anchor'; // 'add-anchor' | 'add-chain' | 'add-weight' | 'select'
    let isFlipped = false;
    let flipProgress = 0; // 0 = normal, 1 = fully flipped (for animation)
    let animating = false;

    let selectedAnchor = null;
    let chainStartAnchor = null; // First anchor selected in chain-add mode
    let dragging = null;
    let wasDragging = false;
    let hoveredAnchor = null;
    let hoveredChainInfo = null; // { chainId, position, point }

    // =========================================================================
    // Structure Display Options
    // =========================================================================

    const structureOpts = {
        walls: true,
        pillars: true,
        stone: false,
        windows: false,
        wallThickness: 16,
        wallColor: 'sandstone',
        ground: true
    };

    const WALL_COLORS = {
        sandstone: { fill: '#d4b896', stroke: '#b89468', dark: '#a07840', light: '#e8d5a8', joint: '#c9a070' },
        granite:   { fill: '#9a9a9a', stroke: '#707070', dark: '#585858', light: '#b8b8b8', joint: '#888888' },
        marble:    { fill: '#e8e0d4', stroke: '#c8beb2', dark: '#a89e92', light: '#f5f0ea', joint: '#d8d0c4' },
        brick:     { fill: '#b85c3c', stroke: '#8b3a2a', dark: '#6e2e1e', light: '#d47050', joint: '#ccb8a0' },
        concrete:  { fill: '#a0a098', stroke: '#808078', dark: '#686860', light: '#b8b8b0', joint: '#909088' }
    };

    const CEILING_Y = 50;        // Y position of the ceiling line
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const ANCHOR_RADIUS = isTouchDevice ? 12 : 8;
    const SNAP_DISTANCE = isTouchDevice ? 30 : 15;
    const CHAIN_SNAP_DISTANCE = isTouchDevice ? 25 : 12;

    // =========================================================================
    // Canvas Setup
    // =========================================================================

    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        const container = document.getElementById('canvas-container');
        canvas.width = container.clientWidth * window.devicePixelRatio;
        canvas.height = container.clientHeight * window.devicePixelRatio;
        canvas.style.width = container.clientWidth + 'px';
        canvas.style.height = container.clientHeight + 'px';
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }

    window.addEventListener('resize', () => { resizeCanvas(); render(); });
    resizeCanvas();

    // =========================================================================
    // Physics Simulation
    // =========================================================================

    function recomputeAllChains() {
        for (const chain of chains) {
            recomputeChain(chain);
        }
    }

    function recomputeChain(chain) {
        const p1 = getAnchorPosition(chain.startId);
        const p2 = getAnchorPosition(chain.endId);
        if (!p1 || !p2) return;

        chain.points = CatenaryEngine.simulateChainWithWeights(
            p1, p2, chain.length, chain.weights, 0.5, 120
        );
    }

    function getAnchorPosition(id) {
        const anchor = anchors.find(a => a.id === id);
        if (anchor) return { x: anchor.x, y: anchor.y };
        return null;
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    function render() {
        const w = canvas.width / window.devicePixelRatio;
        const h = canvas.height / window.devicePixelRatio;

        ctx.clearRect(0, 0, w, h);

        // Background
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        if (!isFlipped && flipProgress === 0) {
            bg.addColorStop(0, '#0f0f1f');
            bg.addColorStop(1, '#1a1a2e');
        } else {
            bg.addColorStop(0, '#1a1a2e');
            bg.addColorStop(1, '#0f0f1f');
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // Calculate transform for flip
        const flipY = (y) => {
            if (flipProgress === 0) return y;
            const centerY = h / 2;
            return centerY + (centerY - y) * flipProgress + (y - centerY) * (1 - flipProgress);
        };

        // Draw ceiling/ground line
        const ceilingScreenY = flipY(CEILING_Y);
        ctx.strokeStyle = isFlipped ? '#4ecdc4' : '#e94560';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(0, ceilingScreenY);
        ctx.lineTo(w, ceilingScreenY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw ground line when flipped
        if (isFlipped || flipProgress > 0) {
            const groundY = flipY(h - 20);
            ctx.strokeStyle = 'rgba(78, 205, 196, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, groundY);
            ctx.lineTo(w, groundY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw chains
        for (const chain of chains) {
            if (!chain.points || chain.points.length < 2) continue;
            drawChain(chain, flipY, w, h);
        }

        // Draw anchors
        for (const anchor of anchors) {
            drawAnchor(anchor, flipY);
        }

        // Draw chain-start indicator
        if (mode === 'add-chain' && chainStartAnchor !== null) {
            const a = anchors.find(a => a.id === chainStartAnchor);
            if (a) {
                const sx = a.x;
                const sy = flipY(a.y);
                ctx.strokeStyle = '#ffcc00';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(sx, sy, ANCHOR_RADIUS + 4, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Draw hovered chain point indicator
        if (hoveredChainInfo && (mode === 'add-chain' || mode === 'add-weight')) {
            const pt = hoveredChainInfo.point;
            const sy = flipY(pt.y);
            ctx.fillStyle = mode === 'add-weight' ? '#ffcc00' : '#4ecdc4';
            ctx.beginPath();
            ctx.arc(pt.x, sy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Draw structure fill when flipped
        if ((isFlipped || flipProgress > 0) && chains.length > 0) {
            drawStructureFill(flipY, w, h);
        }
    }

    function getColors() {
        return WALL_COLORS[structureOpts.wallColor] || WALL_COLORS.sandstone;
    }

    function drawChain(chain, flipY, w, h) {
        const pts = chain.points;
        const isStructure = isFlipped || flipProgress > 0;

        if (isStructure) {
            drawStructureArch(chain, flipY, w, h);
        } else {
            // Chain mode: thin metallic line
            ctx.beginPath();
            ctx.moveTo(pts[0].x, flipY(pts[0].y));
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, flipY(pts[i].y));
            }
            ctx.strokeStyle = '#8899aa';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Chain link dots
            const step = Math.max(1, Math.floor(pts.length / 20));
            for (let i = 0; i < pts.length; i += step) {
                ctx.fillStyle = '#aabbcc';
                ctx.beginPath();
                ctx.arc(pts[i].x, flipY(pts[i].y), 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw weights
        if (chain.weights) {
            for (const wt of chain.weights) {
                const idx = Math.round(wt.position * (pts.length - 1));
                const pt = pts[Math.min(idx, pts.length - 1)];
                const wy = flipY(pt.y);

                if (isStructure) {
                    // Keystone marker
                    const colors = getColors();
                    const ks = 8;
                    ctx.fillStyle = colors.dark;
                    ctx.beginPath();
                    ctx.moveTo(pt.x, wy - ks);
                    ctx.lineTo(pt.x + ks, wy);
                    ctx.lineTo(pt.x, wy + ks);
                    ctx.lineTo(pt.x - ks, wy);
                    ctx.closePath();
                    ctx.fill();
                    ctx.strokeStyle = colors.light;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                } else {
                    const size = 4 + wt.mass * 2;
                    ctx.fillStyle = '#e94560';
                    ctx.beginPath();
                    ctx.arc(pt.x, wy, size, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ff6b8a';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    ctx.fillStyle = '#fff';
                    ctx.font = '10px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText(wt.mass.toFixed(1), pt.x, wy + size + 12);
                }
            }
        }
    }

    /**
     * Draw an architectural arch/wall structure along the chain curve.
     * The catenary curve becomes the center line of a thick arch wall.
     */
    function drawStructureArch(chain, flipY, w, h) {
        const pts = chain.points;
        const colors = getColors();
        const thickness = structureOpts.wallThickness * flipProgress;
        const halfT = thickness / 2;
        const groundY = flipY(h - 20);

        // Build inner and outer edge paths (offset from center curve by normals)
        const inner = [];
        const outer = [];
        for (let i = 0; i < pts.length; i++) {
            const cy = flipY(pts[i].y);
            const cx = pts[i].x;

            // Compute normal at this point
            let nx = 0, ny = -1;
            if (i > 0 && i < pts.length - 1) {
                const dx = pts[i + 1].x - pts[i - 1].x;
                const dy = flipY(pts[i + 1].y) - flipY(pts[i - 1].y);
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                nx = -dy / len;
                ny = dx / len;
            } else if (i === 0 && pts.length > 1) {
                const dx = pts[1].x - pts[0].x;
                const dy = flipY(pts[1].y) - flipY(pts[0].y);
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                nx = -dy / len;
                ny = dx / len;
            } else if (i === pts.length - 1 && pts.length > 1) {
                const dx = pts[i].x - pts[i - 1].x;
                const dy = flipY(pts[i].y) - flipY(pts[i - 1].y);
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                nx = -dy / len;
                ny = dx / len;
            }

            // Ensure normal points upward (toward outside of arch)
            if (ny > 0) { nx = -nx; ny = -ny; }

            outer.push({ x: cx + nx * halfT, y: cy + ny * halfT });
            inner.push({ x: cx - nx * halfT, y: cy - ny * halfT });
        }

        if (structureOpts.walls) {
            // --- Draw wall fill from arch down to ground ---
            ctx.save();
            ctx.globalAlpha = flipProgress;

            // Left wall: from left anchor down to ground
            const leftOuterX = outer[0].x;
            const leftInnerX = inner[0].x;
            const leftTopOuter = outer[0].y;
            const leftTopInner = inner[0].y;

            ctx.beginPath();
            ctx.moveTo(leftOuterX, leftTopOuter);
            ctx.lineTo(leftOuterX, groundY);
            ctx.lineTo(leftInnerX, groundY);
            ctx.lineTo(leftInnerX, leftTopInner);
            ctx.closePath();
            ctx.fillStyle = colors.fill;
            ctx.fill();
            ctx.strokeStyle = colors.stroke;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Right wall
            const ri = pts.length - 1;
            const rightOuterX = outer[ri].x;
            const rightInnerX = inner[ri].x;
            const rightTopOuter = outer[ri].y;
            const rightTopInner = inner[ri].y;

            ctx.beginPath();
            ctx.moveTo(rightOuterX, rightTopOuter);
            ctx.lineTo(rightOuterX, groundY);
            ctx.lineTo(rightInnerX, groundY);
            ctx.lineTo(rightInnerX, rightTopInner);
            ctx.closePath();
            ctx.fillStyle = colors.fill;
            ctx.fill();
            ctx.strokeStyle = colors.stroke;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Stone texture on walls
            if (structureOpts.stone) {
                drawStoneTexture(leftOuterX, leftInnerX, Math.min(leftTopOuter, leftTopInner), groundY, colors);
                drawStoneTexture(rightInnerX, rightOuterX, Math.min(rightTopOuter, rightTopInner), groundY, colors);
            }

            // Windows on walls
            if (structureOpts.windows) {
                const leftWallHeight = groundY - Math.min(leftTopOuter, leftTopInner);
                const rightWallHeight = groundY - Math.min(rightTopOuter, rightTopInner);
                const wallWidth = Math.abs(leftOuterX - leftInnerX);
                if (leftWallHeight > 60 && wallWidth > 6) {
                    drawWindowOnWall((leftOuterX + leftInnerX) / 2, Math.min(leftTopOuter, leftTopInner) + leftWallHeight * 0.35, wallWidth * 0.5, leftWallHeight * 0.25, colors);
                }
                if (rightWallHeight > 60 && wallWidth > 6) {
                    drawWindowOnWall((rightOuterX + rightInnerX) / 2, Math.min(rightTopOuter, rightTopInner) + rightWallHeight * 0.35, wallWidth * 0.5, rightWallHeight * 0.25, colors);
                }
            }

            ctx.restore();
        }

        // --- Draw the arch body (thick curved wall) ---
        ctx.save();
        ctx.globalAlpha = flipProgress;

        // Fill arch shape
        ctx.beginPath();
        ctx.moveTo(outer[0].x, outer[0].y);
        for (let i = 1; i < outer.length; i++) {
            ctx.lineTo(outer[i].x, outer[i].y);
        }
        for (let i = inner.length - 1; i >= 0; i--) {
            ctx.lineTo(inner[i].x, inner[i].y);
        }
        ctx.closePath();

        // Gradient fill for depth
        const archGrad = ctx.createLinearGradient(0, outer[Math.floor(outer.length / 2)].y - halfT, 0, inner[Math.floor(inner.length / 2)].y + halfT);
        archGrad.addColorStop(0, colors.light);
        archGrad.addColorStop(0.5, colors.fill);
        archGrad.addColorStop(1, colors.dark);
        ctx.fillStyle = archGrad;
        ctx.fill();

        // Arch outline
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(outer[0].x, outer[0].y);
        for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(inner[0].x, inner[0].y);
        for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
        ctx.stroke();

        // Stone texture on arch
        if (structureOpts.stone) {
            drawArchStoneTexture(outer, inner, colors);
        }

        ctx.restore();

        // --- Pillars at endpoints ---
        if (structureOpts.pillars) {
            drawPillar(outer[0], inner[0], groundY, colors, 'left');
            drawPillar(outer[outer.length - 1], inner[inner.length - 1], groundY, colors, 'right');
        }
    }

    function drawStoneTexture(x1, x2, topY, bottomY, colors) {
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const width = right - left;
        if (width < 3) return;

        ctx.save();
        ctx.strokeStyle = colors.joint;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.4 * flipProgress;

        const rowHeight = 12;
        let row = 0;
        for (let y = topY + 4; y < bottomY - 4; y += rowHeight) {
            // Horizontal joint
            ctx.beginPath();
            ctx.moveTo(left + 1, y);
            ctx.lineTo(right - 1, y);
            ctx.stroke();

            // Vertical joints (staggered)
            const offset = (row % 2) * (width * 0.4);
            for (let x = left + offset; x < right; x += width * 0.7) {
                if (x > left + 2 && x < right - 2) {
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, Math.min(y + rowHeight, bottomY - 2));
                    ctx.stroke();
                }
            }
            row++;
        }
        ctx.restore();
    }

    function drawArchStoneTexture(outer, inner, colors) {
        ctx.save();
        ctx.strokeStyle = colors.joint;
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.35;

        // Radial joints along the arch (voussoir lines)
        const step = Math.max(1, Math.floor(outer.length / 16));
        for (let i = step; i < outer.length - 1; i += step) {
            ctx.beginPath();
            ctx.moveTo(outer[i].x, outer[i].y);
            ctx.lineTo(inner[i].x, inner[i].y);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawPillar(outerPt, innerPt, groundY, colors, side) {
        ctx.save();
        ctx.globalAlpha = flipProgress;

        const pillarWidth = Math.abs(outerPt.x - innerPt.x) + 8;
        const centerX = (outerPt.x + innerPt.x) / 2;
        const topY = Math.min(outerPt.y, innerPt.y);
        const left = centerX - pillarWidth / 2;

        // Pillar body
        const pillarGrad = ctx.createLinearGradient(left, 0, left + pillarWidth, 0);
        pillarGrad.addColorStop(0, colors.dark);
        pillarGrad.addColorStop(0.3, colors.light);
        pillarGrad.addColorStop(0.7, colors.fill);
        pillarGrad.addColorStop(1, colors.dark);
        ctx.fillStyle = pillarGrad;
        ctx.fillRect(left, topY, pillarWidth, groundY - topY);

        // Pillar outline
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left, topY, pillarWidth, groundY - topY);

        // Capital (top ornament)
        const capH = 6;
        const capW = pillarWidth + 6;
        ctx.fillStyle = colors.light;
        ctx.fillRect(centerX - capW / 2, topY - capH, capW, capH);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(centerX - capW / 2, topY - capH, capW, capH);

        // Base ornament
        const baseH = 6;
        const baseW = pillarWidth + 6;
        ctx.fillStyle = colors.light;
        ctx.fillRect(centerX - baseW / 2, groundY, baseW, baseH);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(centerX - baseW / 2, groundY, baseW, baseH);

        // Stone texture on pillar
        if (structureOpts.stone) {
            drawStoneTexture(left, left + pillarWidth, topY, groundY, colors);
        }

        ctx.restore();
    }

    function drawWindowOnWall(cx, cy, winW, winH, colors) {
        ctx.save();
        ctx.globalAlpha = flipProgress;

        const hw = winW / 2;
        const hh = winH / 2;
        const archRadius = hw;

        // Window opening (dark)
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy + hh);
        ctx.lineTo(cx - hw, cy - hh + archRadius);
        ctx.arc(cx, cy - hh + archRadius, archRadius, Math.PI, 0);
        ctx.lineTo(cx + hw, cy + hh);
        ctx.closePath();
        ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
        ctx.fill();

        // Window frame
        ctx.strokeStyle = colors.dark;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Light glow inside
        ctx.save();
        ctx.globalAlpha = 0.15;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(hw, hh));
        glow.addColorStop(0, '#ffe8a0');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fill();
        ctx.restore();

        ctx.restore();
    }

    function drawAnchor(anchor, flipY) {
        const x = anchor.x;
        const y = flipY(anchor.y);
        const isSelected = selectedAnchor === anchor.id;
        const isHovered = hoveredAnchor === anchor.id;
        const isCeiling = anchor.type === 'ceiling';
        const isStructure = isFlipped || flipProgress > 0;

        // Anchor point
        ctx.beginPath();
        ctx.arc(x, y, ANCHOR_RADIUS, 0, Math.PI * 2);

        if (isStructure) {
            ctx.fillStyle = isCeiling ? '#4ecdc4' : getColors().fill;
        } else {
            ctx.fillStyle = isCeiling ? '#e94560' : '#4ecdc4';
        }

        if (isSelected) {
            ctx.fillStyle = '#ffcc00';
        }

        ctx.fill();

        if (isHovered || isSelected) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Ceiling mount indicator (design mode)
        if (isCeiling && !isStructure) {
            ctx.strokeStyle = '#e94560';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 10, y - 8);
            ctx.lineTo(x + 10, y - 8);
            ctx.stroke();

            for (let i = -8; i <= 8; i += 4) {
                ctx.beginPath();
                ctx.moveTo(x + i, y - 8);
                ctx.lineTo(x + i - 3, y - 12);
                ctx.stroke();
            }
        }

        // Foundation indicator (structure mode)
        if (isCeiling && isStructure) {
            ctx.strokeStyle = '#4ecdc4';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 12, y + 8);
            ctx.lineTo(x + 12, y + 8);
            ctx.stroke();

            for (let i = -10; i <= 10; i += 4) {
                ctx.beginPath();
                ctx.moveTo(x + i, y + 8);
                ctx.lineTo(x + i + 3, y + 12);
                ctx.stroke();
            }
        }
    }

    function drawStructureFill(flipY, w, h) {
        // Ground plane
        if (structureOpts.ground) {
            const groundY = flipY(h - 20);
            ctx.save();
            ctx.globalAlpha = 0.3 * flipProgress;
            const groundGrad = ctx.createLinearGradient(0, groundY, 0, groundY + 30);
            groundGrad.addColorStop(0, getColors().dark);
            groundGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = groundGrad;
            ctx.fillRect(0, groundY, w, 30);
            ctx.restore();
        }

        // Light interior fill below arches
        ctx.save();
        ctx.globalAlpha = 0.05 * flipProgress;

        for (const chain of chains) {
            if (!chain.points || chain.points.length < 2) continue;

            const pts = chain.points;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, flipY(pts[0].y));

            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, flipY(pts[i].y));
            }

            const groundY = flipY(h - 20);
            ctx.lineTo(pts[pts.length - 1].x, groundY);
            ctx.lineTo(pts[0].x, groundY);
            ctx.closePath();

            const interiorGrad = ctx.createLinearGradient(0, flipY(pts[0].y), 0, groundY);
            interiorGrad.addColorStop(0, '#ffe8a0');
            interiorGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = interiorGrad;
            ctx.fill();
        }

        ctx.restore();
    }

    // =========================================================================
    // Interaction Handlers
    // =========================================================================

    function getCanvasPos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    function screenToWorld(pos) {
        // In flipped mode, invert the Y coordinate
        if (isFlipped) {
            const h = canvas.height / window.devicePixelRatio;
            return { x: pos.x, y: h - pos.y };
        }
        return pos;
    }

    function findNearestAnchor(pos, maxDist = SNAP_DISTANCE) {
        let nearest = null;
        let minDist = maxDist;

        for (const a of anchors) {
            const screenY = isFlipped ? (canvas.height / window.devicePixelRatio - a.y) : a.y;
            const d = Math.sqrt((pos.x - a.x) ** 2 + (pos.y - screenY) ** 2);
            if (d < minDist) {
                minDist = d;
                nearest = a;
            }
        }
        return nearest;
    }

    function findNearestChainPoint(pos, maxDist = CHAIN_SNAP_DISTANCE) {
        let best = null;
        let bestDist = maxDist;

        for (const chain of chains) {
            if (!chain.points || chain.points.length < 2) continue;

            // Convert chain points to screen coords
            const screenPoints = chain.points.map(p => ({
                x: p.x,
                y: isFlipped ? (canvas.height / window.devicePixelRatio - p.y) : p.y
            }));

            const result = CatenaryEngine.closestPointOnChain(screenPoints, pos);
            if (result.distance < bestDist) {
                bestDist = result.distance;
                // Convert back to world coords
                const worldY = isFlipped ? (canvas.height / window.devicePixelRatio - result.point.y) : result.point.y;
                best = {
                    chainId: chain.id,
                    position: result.position,
                    point: { x: result.point.x, y: worldY },
                    screenPoint: result.point
                };
            }
        }

        return best;
    }

    // ---- Mouse Events ----

    canvas.addEventListener('mousedown', (e) => {
        const pos = getCanvasPos(e);

        if (mode === 'select') {
            const anchor = findNearestAnchor(pos, 20);
            if (anchor && anchor.type === 'ceiling') {
                dragging = anchor;
                selectedAnchor = anchor.id;
                showProperties(anchor);
            } else if (anchor) {
                selectedAnchor = anchor.id;
                showProperties(anchor);
            } else {
                selectedAnchor = null;
                hideProperties();
            }
            render();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const pos = getCanvasPos(e);

        // Update hovered anchor
        hoveredAnchor = null;
        hoveredChainInfo = null;

        const nearAnchor = findNearestAnchor(pos, 20);
        if (nearAnchor) {
            hoveredAnchor = nearAnchor.id;
        }

        // Check for chain hover in chain-add or weight mode
        if (mode === 'add-chain' || mode === 'add-weight') {
            if (!nearAnchor) {
                const chainPt = findNearestChainPoint(pos);
                if (chainPt) {
                    hoveredChainInfo = chainPt;
                }
            }
        }

        // Handle dragging
        if (dragging) {
            const worldPos = screenToWorld(pos);
            dragging.x = worldPos.x;
            dragging.y = Math.min(worldPos.y, CEILING_Y + 30); // Keep near ceiling
            dragging.y = Math.max(CEILING_Y - 10, dragging.y);
            recomputeAllChains();
        }

        // Update cursor
        if (nearAnchor && mode === 'select') {
            canvas.style.cursor = 'grab';
        } else if (nearAnchor && mode === 'add-chain') {
            canvas.style.cursor = 'pointer';
        } else if (hoveredChainInfo) {
            canvas.style.cursor = 'pointer';
        } else {
            canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair';
        }

        render();
    });

    canvas.addEventListener('mouseup', () => {
        if (dragging) {
            wasDragging = true;
            dragging = null;
            render();
        }
    });

    canvas.addEventListener('click', (e) => {
        if (wasDragging) { wasDragging = false; return; }

        const pos = getCanvasPos(e);
        const worldPos = screenToWorld(pos);

        switch (mode) {
            case 'add-anchor':
                handleAddAnchor(worldPos, pos);
                break;
            case 'add-chain':
                handleAddChain(pos, worldPos);
                break;
            case 'add-weight':
                handleAddWeight(pos);
                break;
        }
    });

    // ---- Mode-specific handlers ----

    function handleAddAnchor(worldPos, screenPos) {
        // Only allow anchors near the ceiling
        if (worldPos.y > CEILING_Y + 60) {
            // Flash the ceiling line to indicate where to click
            return;
        }

        const anchor = {
            id: genId(),
            x: worldPos.x,
            y: CEILING_Y,
            type: 'ceiling'
        };
        anchors.push(anchor);
        render();
    }

    function handleAddChain(screenPos, worldPos) {
        // First, check if clicking on an existing anchor
        const nearAnchor = findNearestAnchor(screenPos, 20);

        // Or on an existing chain
        const chainPt = !nearAnchor ? findNearestChainPoint(screenPos) : null;

        let targetId = null;

        if (nearAnchor) {
            targetId = nearAnchor.id;
        } else if (chainPt) {
            // Create a new anchor on the chain
            const newAnchor = {
                id: genId(),
                x: chainPt.point.x,
                y: chainPt.point.y,
                type: 'chain-point'
            };
            anchors.push(newAnchor);
            targetId = newAnchor.id;

            // Split the existing chain at this point
            splitChainAtPoint(chainPt.chainId, chainPt.position, newAnchor.id);
        }

        if (targetId === null) return;

        if (chainStartAnchor === null) {
            // First point selected
            chainStartAnchor = targetId;
            render();
        } else {
            if (chainStartAnchor === targetId) return; // Same point

            // Create chain between the two anchors
            const p1 = getAnchorPosition(chainStartAnchor);
            const p2 = getAnchorPosition(targetId);
            if (!p1 || !p2) { chainStartAnchor = null; return; }

            const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            const defaultLength = dist * 1.5; // 50% longer than straight line

            const chain = {
                id: genId(),
                startId: chainStartAnchor,
                endId: targetId,
                length: defaultLength,
                weights: [],
                points: []
            };
            chains.push(chain);
            recomputeChain(chain);

            chainStartAnchor = null;
            render();
        }
    }

    function handleAddWeight(screenPos) {
        const chainPt = findNearestChainPoint(screenPos, 20);
        if (!chainPt) return;

        const chain = chains.find(c => c.id === chainPt.chainId);
        if (!chain) return;

        chain.weights.push({
            position: chainPt.position,
            mass: 3.0
        });

        recomputeChain(chain);
        render();
    }

    function splitChainAtPoint(chainId, position, newAnchorId) {
        const chain = chains.find(c => c.id === chainId);
        if (!chain) return;

        const origLength = chain.length;
        const len1 = origLength * position;
        const len2 = origLength * (1 - position);

        // Distribute weights between the two new chains
        const weights1 = [];
        const weights2 = [];
        for (const w of chain.weights) {
            if (w.position < position) {
                weights1.push({ position: w.position / position, mass: w.mass });
            } else {
                weights2.push({ position: (w.position - position) / (1 - position), mass: w.mass });
            }
        }

        // Create two new chains
        const chain1 = {
            id: genId(),
            startId: chain.startId,
            endId: newAnchorId,
            length: len1,
            weights: weights1,
            points: []
        };

        const chain2 = {
            id: genId(),
            startId: newAnchorId,
            endId: chain.endId,
            length: len2,
            weights: weights2,
            points: []
        };

        // Remove old chain
        const idx = chains.indexOf(chain);
        chains.splice(idx, 1, chain1, chain2);

        recomputeChain(chain1);
        recomputeChain(chain2);
    }

    // =========================================================================
    // Properties Panel
    // =========================================================================

    function showProperties(anchor) {
        const panel = document.getElementById('properties-panel');
        const content = document.getElementById('props-content');
        panel.classList.remove('hidden');

        // Find connected chains
        const connectedChains = chains.filter(c => c.startId === anchor.id || c.endId === anchor.id);

        let html = `
            <div class="prop-row">
                <label>タイプ</label>
                <span class="value-display">${anchor.type === 'ceiling' ? '天井固定点' : 'チェーン接続点'}</span>
            </div>
            <div class="prop-row">
                <label>X座標</label>
                <span class="value-display">${anchor.x.toFixed(0)}</span>
            </div>
            <div class="prop-row">
                <label>Y座標</label>
                <span class="value-display">${anchor.y.toFixed(0)}</span>
            </div>
        `;

        // Chain length controls
        for (const chain of connectedChains) {
            const other = chain.startId === anchor.id ? chain.endId : chain.startId;
            const otherAnchor = anchors.find(a => a.id === other);
            const otherLabel = otherAnchor ? `(→ ${otherAnchor.x.toFixed(0)}, ${otherAnchor.y.toFixed(0)})` : '';

            const p1 = getAnchorPosition(chain.startId);
            const p2 = getAnchorPosition(chain.endId);
            const minLength = p1 && p2 ? Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) : 10;

            html += `
                <hr style="border-color:#333; margin:8px 0">
                <div class="prop-row">
                    <label>チェーン ${otherLabel}</label>
                </div>
                <div class="prop-row">
                    <label>長さ</label>
                    <input type="range" min="${Math.ceil(minLength)}" max="${Math.ceil(minLength * 4)}"
                           value="${Math.round(chain.length)}"
                           data-chain-id="${chain.id}"
                           class="chain-length-slider">
                </div>
                <div class="prop-row">
                    <label></label>
                    <input type="number" value="${Math.round(chain.length)}"
                           data-chain-id="${chain.id}"
                           class="chain-length-input"
                           min="${Math.ceil(minLength)}" step="5">
                </div>
            `;

            // Weight controls for this chain
            chain.weights.forEach((w, wi) => {
                html += `
                    <div class="prop-row">
                        <label>重り ${wi + 1} 質量</label>
                        <input type="range" min="0.5" max="20" step="0.5"
                               value="${w.mass}"
                               data-chain-id="${chain.id}" data-weight-idx="${wi}"
                               class="weight-mass-slider">
                    </div>
                `;
            });
        }

        // Delete button
        html += `
            <button class="prop-btn delete" onclick="window._deleteAnchor(${anchor.id})">削除</button>
        `;

        content.innerHTML = html;

        // Bind slider events
        content.querySelectorAll('.chain-length-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const chainId = parseInt(e.target.dataset.chainId);
                const chain = chains.find(c => c.id === chainId);
                if (chain) {
                    chain.length = parseFloat(e.target.value);
                    recomputeChain(chain);
                    render();
                    // Sync number input
                    const numInput = content.querySelector(`.chain-length-input[data-chain-id="${chainId}"]`);
                    if (numInput) numInput.value = Math.round(chain.length);
                }
            });
        });

        content.querySelectorAll('.chain-length-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const chainId = parseInt(e.target.dataset.chainId);
                const chain = chains.find(c => c.id === chainId);
                if (chain) {
                    chain.length = parseFloat(e.target.value);
                    recomputeChain(chain);
                    render();
                    // Sync slider
                    const slider = content.querySelector(`.chain-length-slider[data-chain-id="${chainId}"]`);
                    if (slider) slider.value = chain.length;
                }
            });
        });

        content.querySelectorAll('.weight-mass-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const chainId = parseInt(e.target.dataset.chainId);
                const weightIdx = parseInt(e.target.dataset.weightIdx);
                const chain = chains.find(c => c.id === chainId);
                if (chain && chain.weights[weightIdx]) {
                    chain.weights[weightIdx].mass = parseFloat(e.target.value);
                    recomputeChain(chain);
                    render();
                }
            });
        });
    }

    function hideProperties() {
        document.getElementById('properties-panel').classList.add('hidden');
    }

    window._deleteAnchor = function (id) {
        // Remove all chains connected to this anchor
        chains = chains.filter(c => c.startId !== id && c.endId !== id);
        anchors = anchors.filter(a => a.id !== id);
        selectedAnchor = null;
        hideProperties();
        recomputeAllChains();
        render();
    };

    // =========================================================================
    // Toolbar Buttons
    // =========================================================================

    const modeButtons = {
        'add-anchor': document.getElementById('btn-add-anchor'),
        'add-chain': document.getElementById('btn-add-chain'),
        'add-weight': document.getElementById('btn-add-weight'),
        'select': document.getElementById('btn-select')
    };

    function setMode(newMode) {
        mode = newMode;
        chainStartAnchor = null;
        for (const [m, btn] of Object.entries(modeButtons)) {
            btn.classList.toggle('active', m === newMode);
        }
        render();
    }

    modeButtons['add-anchor'].addEventListener('click', () => setMode('add-anchor'));
    modeButtons['add-chain'].addEventListener('click', () => setMode('add-chain'));
    modeButtons['add-weight'].addEventListener('click', () => setMode('add-weight'));
    modeButtons['select'].addEventListener('click', () => setMode('select'));

    // Flip button
    function updateStructurePanel() {
        document.getElementById('structure-options').classList.toggle('hidden', !isFlipped);
    }

    document.getElementById('btn-flip').addEventListener('click', () => {
        isFlipped = !isFlipped;
        flipProgress = isFlipped ? 1 : 0;
        document.getElementById('btn-flip').classList.toggle('flipped', isFlipped);

        const indicator = document.getElementById('mode-indicator');
        indicator.textContent = isFlipped ? '構造表示モード' : '設計モード';
        indicator.classList.toggle('structure', isFlipped);

        document.getElementById('ceiling-label').classList.toggle('hidden', isFlipped);
        document.getElementById('floor-label').classList.toggle('hidden', !isFlipped);
        updateStructurePanel();

        render();
    });

    // Animated flip
    document.getElementById('btn-animate-flip').addEventListener('click', () => {
        if (animating) return;
        animating = true;

        const targetFlipped = !isFlipped;
        const startProgress = flipProgress;
        const endProgress = targetFlipped ? 1 : 0;
        const startTime = performance.now();
        const duration = 1500;

        function animate(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            // Ease in-out
            const eased = t < 0.5
                ? 2 * t * t
                : 1 - Math.pow(-2 * t + 2, 2) / 2;

            flipProgress = startProgress + (endProgress - startProgress) * eased;
            render();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                isFlipped = targetFlipped;
                flipProgress = endProgress;
                animating = false;

                document.getElementById('btn-flip').classList.toggle('flipped', isFlipped);
                const indicator = document.getElementById('mode-indicator');
                indicator.textContent = isFlipped ? '構造表示モード' : '設計モード';
                indicator.classList.toggle('structure', isFlipped);
                document.getElementById('ceiling-label').classList.toggle('hidden', isFlipped);
                document.getElementById('floor-label').classList.toggle('hidden', !isFlipped);
                updateStructurePanel();

                render();
            }
        }

        requestAnimationFrame(animate);
    });

    // =========================================================================
    // Structure Options Controls
    // =========================================================================

    document.getElementById('opt-walls').addEventListener('change', (e) => {
        structureOpts.walls = e.target.checked;
        render();
    });
    document.getElementById('opt-pillars').addEventListener('change', (e) => {
        structureOpts.pillars = e.target.checked;
        render();
    });
    document.getElementById('opt-stone').addEventListener('change', (e) => {
        structureOpts.stone = e.target.checked;
        render();
    });
    document.getElementById('opt-windows').addEventListener('change', (e) => {
        structureOpts.windows = e.target.checked;
        render();
    });
    document.getElementById('opt-wall-thickness').addEventListener('input', (e) => {
        structureOpts.wallThickness = parseInt(e.target.value);
        render();
    });
    document.getElementById('opt-wall-color').addEventListener('change', (e) => {
        structureOpts.wallColor = e.target.value;
        render();
    });
    document.getElementById('opt-ground').addEventListener('change', (e) => {
        structureOpts.ground = e.target.checked;
        render();
    });

    // Clear button
    document.getElementById('btn-clear').addEventListener('click', () => {
        if (anchors.length === 0 && chains.length === 0) return;
        anchors = [];
        chains = [];
        nextId = 1;
        selectedAnchor = null;
        chainStartAnchor = null;
        hideProperties();

        if (isFlipped) {
            isFlipped = false;
            flipProgress = 0;
            document.getElementById('btn-flip').classList.remove('flipped');
            document.getElementById('mode-indicator').textContent = '設計モード';
            document.getElementById('mode-indicator').classList.remove('structure');
            document.getElementById('ceiling-label').classList.remove('hidden');
            document.getElementById('floor-label').classList.add('hidden');
            updateStructurePanel();
        }

        render();
    });

    // Demo button
    document.getElementById('btn-demo').addEventListener('click', loadDemo);

    // =========================================================================
    // Demo Data
    // =========================================================================

    function loadDemo() {
        anchors = [];
        chains = [];
        nextId = 1;

        const w = canvas.width / window.devicePixelRatio;
        const centerX = w / 2;

        // Create ceiling anchors for a cathedral-like structure
        const ceilingAnchors = [
            { x: centerX - 250, y: CEILING_Y },
            { x: centerX - 150, y: CEILING_Y },
            { x: centerX - 50, y: CEILING_Y },
            { x: centerX + 50, y: CEILING_Y },
            { x: centerX + 150, y: CEILING_Y },
            { x: centerX + 250, y: CEILING_Y }
        ];

        for (const pos of ceilingAnchors) {
            anchors.push({
                id: genId(),
                x: pos.x,
                y: pos.y,
                type: 'ceiling'
            });
        }

        // Main arch chains
        const h = canvas.height / window.devicePixelRatio;
        const chainDefs = [
            // Outer arches
            { start: 0, end: 5, lengthFactor: 2.5, weights: [{ pos: 0.5, mass: 5 }] },
            // Inner arches
            { start: 1, end: 4, lengthFactor: 2.2, weights: [{ pos: 0.5, mass: 4 }] },
            { start: 2, end: 3, lengthFactor: 2.0, weights: [{ pos: 0.5, mass: 3 }] },
            // Side arches
            { start: 0, end: 1, lengthFactor: 2.0, weights: [{ pos: 0.5, mass: 2 }] },
            { start: 1, end: 2, lengthFactor: 2.0, weights: [{ pos: 0.5, mass: 2 }] },
            { start: 3, end: 4, lengthFactor: 2.0, weights: [{ pos: 0.5, mass: 2 }] },
            { start: 4, end: 5, lengthFactor: 2.0, weights: [{ pos: 0.5, mass: 2 }] },
        ];

        for (const def of chainDefs) {
            const a1 = anchors[def.start];
            const a2 = anchors[def.end];
            const dist = Math.sqrt((a2.x - a1.x) ** 2 + (a2.y - a1.y) ** 2);

            const chain = {
                id: genId(),
                startId: a1.id,
                endId: a2.id,
                length: dist * def.lengthFactor,
                weights: def.weights.map(w => ({ position: w.pos, mass: w.mass })),
                points: []
            };
            chains.push(chain);
        }

        // Reset flip state
        if (isFlipped) {
            isFlipped = false;
            flipProgress = 0;
            document.getElementById('btn-flip').classList.remove('flipped');
            document.getElementById('mode-indicator').textContent = '設計モード';
            document.getElementById('mode-indicator').classList.remove('structure');
            document.getElementById('ceiling-label').classList.remove('hidden');
            document.getElementById('floor-label').classList.add('hidden');
            updateStructurePanel();
        }

        recomputeAllChains();
        render();
    }

    // =========================================================================
    // Touch Events (Mobile Support)
    // =========================================================================

    let touchStartPos = null;
    let touchMoved = false;

    function getTouchPos(e) {
        const touch = e.touches[0] || e.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const pos = getTouchPos(e);
        touchStartPos = pos;
        touchMoved = false;

        if (mode === 'select') {
            const anchor = findNearestAnchor(pos, 30);
            if (anchor && anchor.type === 'ceiling') {
                dragging = anchor;
                selectedAnchor = anchor.id;
                showProperties(anchor);
            } else if (anchor) {
                selectedAnchor = anchor.id;
                showProperties(anchor);
            } else {
                selectedAnchor = null;
                hideProperties();
            }
            render();
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const pos = getTouchPos(e);
        touchMoved = true;

        if (dragging) {
            const worldPos = screenToWorld(pos);
            dragging.x = worldPos.x;
            dragging.y = Math.min(worldPos.y, CEILING_Y + 30);
            dragging.y = Math.max(CEILING_Y - 10, dragging.y);
            recomputeAllChains();
            render();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const pos = getTouchPos(e);

        if (dragging) {
            dragging = null;
            render();
            touchStartPos = null;
            return;
        }

        // Only treat as tap if finger didn't move much
        if (touchMoved && touchStartPos) {
            const dx = pos.x - touchStartPos.x;
            const dy = pos.y - touchStartPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > 15) {
                touchStartPos = null;
                return;
            }
        }

        // Treat as a click/tap
        const worldPos = screenToWorld(pos);
        switch (mode) {
            case 'add-anchor':
                handleAddAnchor(worldPos, pos);
                break;
            case 'add-chain':
                handleAddChain(pos, worldPos);
                break;
            case 'add-weight':
                handleAddWeight(pos);
                break;
            case 'select':
                // Already handled in touchstart
                break;
        }

        touchStartPos = null;
    }, { passive: false });

    // =========================================================================
    // Keyboard Shortcuts
    // =========================================================================

    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case '1': setMode('add-anchor'); break;
            case '2': setMode('add-chain'); break;
            case '3': setMode('add-weight'); break;
            case '4': setMode('select'); break;
            case 'f': case 'F':
                document.getElementById('btn-flip').click();
                break;
            case 'Delete': case 'Backspace':
                if (selectedAnchor) {
                    window._deleteAnchor(selectedAnchor);
                }
                break;
            case 'Escape':
                chainStartAnchor = null;
                selectedAnchor = null;
                hideProperties();
                render();
                break;
        }
    });

    // =========================================================================
    // Initial Render
    // =========================================================================

    render();

})();
