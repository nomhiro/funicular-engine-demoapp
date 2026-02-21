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

    function drawChain(chain, flipY, w, h) {
        const pts = chain.points;
        const isStructure = isFlipped || flipProgress > 0;

        // Chain line
        ctx.beginPath();
        ctx.moveTo(pts[0].x, flipY(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, flipY(pts[i].y));
        }

        if (isStructure) {
            // Structure mode: thicker, stone-like appearance
            ctx.strokeStyle = '#c9a96e';
            ctx.lineWidth = 6;
            ctx.stroke();

            // Inner line
            ctx.strokeStyle = '#e8d5a8';
            ctx.lineWidth = 3;
            ctx.stroke();
        } else {
            // Chain mode: thin metallic line
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
                    // Show as a keystone
                    ctx.fillStyle = '#c9a96e';
                    ctx.fillRect(pt.x - 6, wy - 6, 12, 12);
                    ctx.strokeStyle = '#a07840';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(pt.x - 6, wy - 6, 12, 12);
                } else {
                    // Show as hanging weight
                    const size = 4 + wt.mass * 2;
                    ctx.fillStyle = '#e94560';
                    ctx.beginPath();
                    ctx.arc(pt.x, wy, size, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ff6b8a';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Mass label
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText(wt.mass.toFixed(1), pt.x, wy + size + 12);
                }
            }
        }
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
            ctx.fillStyle = isCeiling ? '#4ecdc4' : '#c9a96e';
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

        // Ceiling mount indicator
        if (isCeiling && !isStructure) {
            ctx.strokeStyle = '#e94560';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 10, y - 8);
            ctx.lineTo(x + 10, y - 8);
            ctx.stroke();

            // Small hatching
            for (let i = -8; i <= 8; i += 4) {
                ctx.beginPath();
                ctx.moveTo(x + i, y - 8);
                ctx.lineTo(x + i - 3, y - 12);
                ctx.stroke();
            }
        }

        // Foundation indicator when flipped
        if (isCeiling && isStructure) {
            ctx.strokeStyle = '#4ecdc4';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 12, y + 8);
            ctx.lineTo(x + 12, y + 8);
            ctx.stroke();

            // Ground hatching
            for (let i = -10; i <= 10; i += 4) {
                ctx.beginPath();
                ctx.moveTo(x + i, y + 8);
                ctx.lineTo(x + i + 3, y + 12);
                ctx.stroke();
            }
        }
    }

    function drawStructureFill(flipY, w, h) {
        // Light fill effect for structure
        ctx.save();
        ctx.globalAlpha = 0.08 * flipProgress;

        for (const chain of chains) {
            if (!chain.points || chain.points.length < 2) continue;

            const pts = chain.points;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, flipY(pts[0].y));

            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, flipY(pts[i].y));
            }

            // Close down to ground
            const groundY = flipY(h - 20);
            ctx.lineTo(pts[pts.length - 1].x, groundY);
            ctx.lineTo(pts[0].x, groundY);
            ctx.closePath();

            ctx.fillStyle = '#c9a96e';
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
    document.getElementById('btn-flip').addEventListener('click', () => {
        isFlipped = !isFlipped;
        flipProgress = isFlipped ? 1 : 0;
        document.getElementById('btn-flip').classList.toggle('flipped', isFlipped);

        const indicator = document.getElementById('mode-indicator');
        indicator.textContent = isFlipped ? '構造表示モード' : '設計モード';
        indicator.classList.toggle('structure', isFlipped);

        document.getElementById('ceiling-label').classList.toggle('hidden', isFlipped);
        document.getElementById('floor-label').classList.toggle('hidden', !isFlipped);

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

                render();
            }
        }

        requestAnimationFrame(animate);
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
