/**
 * ThermaLink Interactive Dashboard App Controller
 * 
 * Manages UI bindings, renders the 3D isometric municipal grid, handles mouse selection,
 * recalculates paths on canvas triggers, and updates the metrics dials/SVGs.
 */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Isometric Canvas Renderer Config
    const canvas = document.getElementById("isometric-canvas");
    const ctx = canvas.getContext("2d");

    // Grid details matching routing.js
    const gridCols = RoutingEngine.GRID_COLS;
    const gridRows = RoutingEngine.GRID_ROWS;
    
    // Isometric tile dimension (2:1 projection)
    const tileWidth = 46;
    const tileHeight = 23;

    // Center offsets for canvas
    let offsetX = canvas.width / 2;
    let offsetY = 80;

    // Selection State
    let selectedSourceKey = "SOSSENHEIM";
    let selectedSinkKey = "JUNCTION_WEST";
    let activePath = [];

    // DOM Elements - Selects & Inputs
    const selectDc = document.getElementById("select-dc");
    const selectJunction = document.getElementById("select-junction");
    const selectInsulation = document.getElementById("select-pipe-insulation");

    const sliders = {
        heatPower: document.getElementById("slider-heat-power"),
        targetTemp: document.getElementById("slider-target-temp"),
        groundTemp: document.getElementById("slider-ground-temp"),
        gridCarbon: document.getElementById("slider-grid-carbon")
    };

    const labels = {
        heatPower: document.getElementById("val-heat-power"),
        targetTemp: document.getElementById("val-target-temp"),
        groundTemp: document.getElementById("val-ground-temp"),
        gridCarbon: document.getElementById("val-grid-carbon")
    };

    // DOM Elements - Stats
    const elPipeLength = document.getElementById("val-pipe-length");
    const elPipeCapex = document.getElementById("val-pipe-capex");
    const elDeliveredTemp = document.getElementById("val-delivered-temp");
    const elTempLoss = document.getElementById("val-temp-loss");
    const elGrade = document.getElementById("val-grade");
    const elReason = document.getElementById("val-reason");

    // DOM Elements - Scorecards & Chart SVGs
    const elNetCarbon = document.getElementById("val-net-carbon");
    const elCop = document.getElementById("val-cop");
    const elCopGaugeFill = document.getElementById("fill-cop-gauge");
    const elOffsetDisplacedVal = document.getElementById("val-offset-displaced");
    const elOffsetEmittedVal = document.getElementById("val-offset-emitted");
    const elBarDisplaced = document.getElementById("bar-offset-displaced");
    const elBarEmitted = document.getElementById("bar-offset-emitted");
    const elDecayPath = document.getElementById("decay-svg-path");
    const elDecayDot = document.getElementById("decay-svg-dot");
    const elDecayAxisMid = document.getElementById("val-decay-axis-mid");
    const elDecayAxisEnd = document.getElementById("val-decay-axis-end");

    // Setup canvas resolution scaling for Retina screens
    scaleCanvasForRetina();
    
    // Bind Event Listeners
    setupInputBindings();
    
    // Fetch live API parameters from Frankfurt weather and grid mix
    fetchLiveTelemetryData().then(() => {
        // Initial Run
        recalculateSimulation();
    });

    // Fetch Frankfurt weather and grid intensity live
    async function fetchLiveTelemetryData() {
        const statusLabel = document.querySelector(".status-indicator span:last-child");
        if (!statusLabel) return;
        
        try {
            statusLabel.textContent = "Connecting to Frankfurt live feeds...";
            
            // Fetch live weather from Open-Meteo (lat/lon of Frankfurt)
            const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=50.1109&longitude=8.6821&current=temperature_2m,wind_speed_10m,cloud_cover");
            if (!res.ok) throw new Error("API failed");
            
            const data = await res.json();
            const current = data.current;
            
            // 1. Sync soil temperature with current Frankfurt weather
            const temp = Math.round(current.temperature_2m);
            const clampedTemp = Math.max(0, Math.min(20, temp));
            sliders.groundTemp.value = clampedTemp;
            labels.groundTemp.textContent = `${clampedTemp} °C`;
            
            // 2. Dynamically compute Germany grid carbon intensity based on wind and solar indices
            // Base intensity is 450 g/kWh. Wind speed and clear skies reduce this offset
            const windSpeed = current.wind_speed_10m; // km/h
            const cloudCover = current.cloud_cover; // %
            const clearSkyPercent = 100 - cloudCover;
            
            let estimatedCarbon = 450 - (windSpeed * 4.5) - (clearSkyPercent * 1.5);
            estimatedCarbon = Math.max(120, Math.min(500, Math.round(estimatedCarbon)));
            
            sliders.gridCarbon.value = estimatedCarbon;
            labels.gridCarbon.textContent = `${estimatedCarbon} g/kWh`;
            
            // Update status indicator label
            statusLabel.innerHTML = `Frankfurt Loop: ${temp}°C | Live Grid: ${estimatedCarbon} g/kWh <span style="color:var(--color-cyan);margin-left:4px;font-weight:700;">(LIVE)</span>`;
            
            const pulse = document.querySelector(".pulse-dot");
            if (pulse) {
                pulse.style.backgroundColor = "var(--color-cyan)";
                pulse.style.boxShadow = "0 0 10px var(--color-cyan)";
            }
            
        } catch (err) {
            console.warn("Failed to load live data, using offline fallback:", err);
            statusLabel.textContent = "Frankfurt Grid Loop: Active (Offline Defaults)";
        }
    }

    // Canvas click detection for 3D node selection
    canvas.addEventListener("click", handleCanvasClick);

    // Resize listener for canvas centering
    window.addEventListener("resize", () => {
        scaleCanvasForRetina();
        drawIsometricMap();
    });

    // --- Core Canvas Scaling ---
    function scaleCanvasForRetina() {
        const rect = canvas.parentNode.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = 430;
        offsetX = canvas.width / 2;
        offsetY = 70;
    }

    // --- Coordinate Projection Helper Formulas ---
    // Converts 2D orthogonal grid (x, y) into 3D isometric screen (X, Y)
    function gridToScreen(x, y) {
        const screenX = (x - y) * (tileWidth / 2) + offsetX;
        const screenY = (x + y) * (tileHeight / 2) + offsetY;
        return { x: screenX, y: screenY };
    }

    // Converts 3D isometric screen (X, Y) back into 2D orthogonal grid (x, y)
    function screenToGrid(screenX, screenY) {
        const relativeX = screenX - offsetX;
        const relativeY = screenY - offsetY;

        const gridX = Math.round((relativeY / (tileHeight / 2) + relativeX / (tileWidth / 2)) / 2);
        const gridY = Math.round((relativeY / (tileHeight / 2) - relativeX / (tileWidth / 2)) / 2);

        return { x: gridX, y: gridY };
    }

    // --- Inputs Event Setup ---
    function setupInputBindings() {
        // Dropdowns
        selectDc.addEventListener("change", (e) => {
            selectedSourceKey = e.target.value;
            recalculateSimulation();
        });

        selectJunction.addEventListener("change", (e) => {
            selectedSinkKey = e.target.value;
            recalculateSimulation();
        });

        selectInsulation.addEventListener("change", () => {
            recalculateSimulation();
        });

        // Sliders
        sliders.heatPower.addEventListener("input", (e) => {
            labels.heatPower.textContent = e.target.value;
            recalculateSimulation();
        });

        sliders.targetTemp.addEventListener("input", (e) => {
            labels.targetTemp.textContent = e.target.value;
            recalculateSimulation();
        });

        sliders.groundTemp.addEventListener("input", (e) => {
            labels.groundTemp.textContent = e.target.value;
            recalculateSimulation();
        });

        sliders.gridCarbon.addEventListener("input", (e) => {
            labels.gridCarbon.textContent = e.target.value;
            recalculateSimulation();
        });
    }

    // --- Canvas Mouse Click Selection ---
    function handleCanvasClick(event) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Translate screen coordinates to grid coordinates
        const gridCoord = screenToGrid(mouseX, mouseY);

        // 1. Check if clicked a Data Center Source node
        for (const [key, source] of Object.entries(RoutingEngine.sources)) {
            // Allow clicking adjacent tiles for easier selecting
            if (Math.abs(gridCoord.x - source.x) <= 1 && Math.abs(gridCoord.y - source.y) <= 1) {
                selectedSourceKey = key;
                selectDc.value = key;
                recalculateSimulation();
                return;
            }
        }

        // 2. Check if clicked a Grid Junction node
        for (const [key, sink] of Object.entries(RoutingEngine.sinks)) {
            if (Math.abs(gridCoord.x - sink.x) <= 1 && Math.abs(gridCoord.y - sink.y) <= 1) {
                selectedSinkKey = key;
                selectJunction.value = key;
                recalculateSimulation();
                return;
            }
        }
    }

    // --- Simulation Core Recalculator ---
    function recalculateSimulation() {
        const source = RoutingEngine.sources[selectedSourceKey];
        const sink = RoutingEngine.sinks[selectedSinkKey];

        // 1. Calculate Path
        activePath = RoutingEngine.findPath(source.x, source.y, sink.x, sink.y);
        const routeMetrics = RoutingEngine.calculateRouteMetrics(activePath);

        // 2. Read parameters
        const dcHeatMw = parseFloat(sliders.heatPower.value);
        const targetTemp = parseFloat(sliders.targetTemp.value);
        const uValue = parseFloat(selectInsulation.value);
        const groundTemp = parseFloat(sliders.groundTemp.value);
        const gridCarbon = parseFloat(sliders.gridCarbon.value);

        // 3. Compute thermodynamic balance
        const audit = ThermoEngine.runEnergyAudit(
            dcHeatMw,
            source.tempOut,
            targetTemp,
            routeMetrics.lengthMeters,
            uValue,
            groundTemp,
            gridCarbon
        );

        // 4. Update Stats in UI
        updateUI(routeMetrics, audit);

        // 5. Draw map
        drawIsometricMap();
    }

    // --- UI Values Binding & Animate Dials ---
    function updateUI(route, audit) {
        // Path details card
        elPipeLength.textContent = `${route.lengthMeters.toLocaleString()} m`;
        elPipeCapex.textContent = `€${route.capexEuro.toLocaleString()}`;
        elDeliveredTemp.textContent = `${audit.deliveredTemp.toFixed(1)} °C`;
        elTempLoss.textContent = `${audit.temperatureLoss.toFixed(1)} °C`;

        // Regulatory Compliance Report Card
        const cardReport = document.getElementById("card-regulatory-audit");
        elGrade.textContent = audit.complianceGrade;
        elReason.textContent = audit.statusReason;

        // Scale colors depending on compliance
        cardReport.className = "report-card card-compliance";
        elGrade.className = "grade-badge";

        if (audit.complianceGrade === "FAIL") {
            cardReport.classList.add("compliance-fail");
            elGrade.classList.add("grade-fail");
        } else if (audit.complianceGrade === "CLASS A") {
            cardReport.classList.add("compliance-pass");
            elGrade.classList.add("grade-class-a");
        } else if (audit.complianceGrade === "CLASS B") {
            cardReport.classList.add("compliance-pass");
            elGrade.classList.add("grade-class-b");
        } else {
            cardReport.classList.add("compliance-pass");
            elGrade.classList.add("grade-class-c");
        }

        // Scorecards
        elNetCarbon.textContent = audit.netCarbonSavedTonnes.toLocaleString();
        elCop.textContent = audit.cop.toFixed(1);

        // Update COP Radial Gauge Progress (max scale is COP = 8.0)
        const percentCop = Math.min(100, (audit.cop / 8.0) * 100);
        elCopGaugeFill.setAttribute("stroke-dasharray", `${percentCop}, 100`);

        // Carbon offsets comparison
        const displacedT = Math.round((audit.annualHeatDeliveredMwh * 1000 * 202.0) / 1e6);
        const emittedT = Math.round((audit.annualElectricConsumedMwh * 1000 * parseFloat(sliders.gridCarbon.value)) / 1e6);

        elOffsetDisplacedVal.textContent = `${displacedT.toLocaleString()} t`;
        elOffsetEmittedVal.textContent = `${emittedT.toLocaleString()} t`;

        const maxT = Math.max(1, displacedT, emittedT);
        elBarDisplaced.style.width = `${(displacedT / maxT) * 100}%`;
        elBarEmitted.style.width = `${(emittedT / maxT) * 100}%`;

        // Update Temp Decay graph
        updateTemperatureDecayGraph(audit.deliveredTemp, parseFloat(sliders.targetTemp.value), route.lengthMeters);
    }

    // --- Dynamic SVG Graph: Temperature Decay Curve ---
    function updateTemperatureDecayGraph(tDelivered, tTarget, lengthMeters) {
        if (lengthMeters <= 0) {
            elDecayPath.setAttribute("d", "M 0 50 L 200 50");
            elDecayDot.setAttribute("cx", 0);
            elDecayDot.setAttribute("cy", 50);
            elDecayAxisMid.textContent = "0m";
            elDecayAxisEnd.textContent = "0m";
            return;
        }

        elDecayAxisMid.textContent = `${(lengthMeters / 2).toFixed(0)}m`;
        elDecayAxisEnd.textContent = `${lengthMeters.toFixed(0)}m`;

        // SVG height is 60px. Let's map target temperature to y=10px, and ground temp (10°C) to y=50px.
        const yMax = 10;
        const yMin = 50;
        const tRange = Math.max(10, tTarget - 10); // Assume floor is 10°C ground

        const getSvgY = (temp) => {
            const ratio = (temp - 10) / tRange;
            return yMin - (ratio * (yMin - yMax));
        };

        const yStart = getSvgY(tTarget);
        const yEnd = getSvgY(tDelivered);
        
        // Generate curved line path representing exponential decay
        const yMid = getSvgY(tTarget - (tTarget - tDelivered) * 0.6); // Exponential decay midpoint curve
        
        const pathD = `M 0,${yStart} Q 100,${yMid} 200,${yEnd}`;
        elDecayPath.setAttribute("d", pathD);
        
        // Place dot marker on endpoint
        elDecayDot.setAttribute("cx", 200);
        elDecayDot.setAttribute("cy", yEnd);
    }

    // --- 3D Isometric Map Drawing Engine ---
    function drawIsometricMap() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Draw flat grid wireframe (The Ground plane)
        drawGridPlane();

        // 2. Draw Obstacles (The Main River)
        drawObstacles();

        // 3. Draw Routed Pipelines (Connecting pipes)
        drawPipelines();

        // 4. Draw Municipal Nodes (Junction loops)
        drawSinks();

        // 5. Draw Industrial Data Center structures (3D Buildings)
        drawSources();
    }

    function drawGridPlane() {
        ctx.strokeStyle = "rgba(69, 162, 158, 0.08)";
        ctx.lineWidth = 1.0;

        for (let col = 0; col <= gridCols; col++) {
            const start = gridToScreen(col, 0);
            const end = gridToScreen(col, gridRows);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }

        for (let row = 0; row <= gridRows; row++) {
            const start = gridToScreen(0, row);
            const end = gridToScreen(gridCols, row);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }
    }

    function drawObstacles() {
        ctx.fillStyle = "rgba(41, 128, 185, 0.4)"; // Blue flowing river
        ctx.strokeStyle = "rgba(52, 152, 219, 0.7)";
        ctx.lineWidth = 1.5;

        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                if (RoutingEngine.isObstacle(col, row)) {
                    drawIsometricTile(col, row, "rgba(22, 100, 150, 0.35)", "rgba(52, 152, 219, 0.3)");
                }
            }
        }
    }

    function drawPipelines() {
        if (activePath.length < 2) return;

        ctx.strokeStyle = "rgba(255, 118, 25, 0.85)"; // Glowing orange pipeline
        ctx.shadowColor = "var(--color-orange)";
        ctx.shadowBlur = 10;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        const start = gridToScreen(activePath[0].x + 0.5, activePath[0].y + 0.5);
        ctx.moveTo(start.x, start.y);

        for (let i = 1; i < activePath.length; i++) {
            const pt = gridToScreen(activePath[i].x + 0.5, activePath[i].y + 0.5);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        
        // Reset shadow defaults
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
    }

    function drawSources() {
        // Shading parameters for 3D cube building faces
        const dcColors = {
            active: { top: "#ff9036", left: "#ff7619", right: "#cc5200" },
            idle: { top: "#4a5b78", left: "#34495e", right: "#2c3e50" }
        };

        for (const [key, source] of Object.entries(RoutingEngine.sources)) {
            const isSelected = key === selectedSourceKey;
            const colors = isSelected ? dcColors.active : dcColors.idle;
            
            // Build a 3D block
            const height = isSelected ? 30 : 20;
            drawIsometricCube(source.x, source.y, height, colors, isSelected);
            
            // Text Label
            const pt = gridToScreen(source.x + 0.5, source.y + 0.5);
            ctx.font = "bold 9px 'Outfit'";
            ctx.fillStyle = isSelected ? "var(--color-orange)" : "var(--text-muted)";
            ctx.textAlign = "center";
            ctx.fillText(key, pt.x, pt.y - height - 10);
        }
    }

    function drawSinks() {
        for (const [key, sink] of Object.entries(RoutingEngine.sinks)) {
            const isSelected = key === selectedSinkKey;
            
            const pt = gridToScreen(sink.x + 0.5, sink.y + 0.5);
            
            // Draw base node circle
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isSelected ? 8 : 5, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? "var(--color-cyan)" : "var(--border-color)";
            ctx.shadowColor = isSelected ? "var(--color-cyan)" : "transparent";
            ctx.shadowBlur = isSelected ? 12 : 0;
            ctx.fill();
            
            ctx.shadowBlur = 0; // reset shadow
            
            // Draw a cylinder connector pin representing the utility junction
            ctx.strokeStyle = isSelected ? "#00f3e3" : "#45a29e";
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(pt.x, pt.y - 12);
            ctx.stroke();
            
            // Text Label
            ctx.font = "bold 9px 'Outfit'";
            ctx.fillStyle = isSelected ? "var(--color-cyan)" : "var(--text-muted)";
            ctx.textAlign = "center";
            ctx.fillText(key.replace("JUNCTION_", ""), pt.x, pt.y - 18);
        }
    }

    // --- Isometric Drawing Primitives ---

    function drawIsometricTile(x, y, fillStyle, strokeStyle) {
        const pt = gridToScreen(x + 0.5, y + 0.5);

        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.beginPath();
        
        ctx.moveTo(pt.x, pt.y - tileHeight / 2);
        ctx.lineTo(pt.x + tileWidth / 2, pt.y);
        ctx.lineTo(pt.x, pt.y + tileHeight / 2);
        ctx.lineTo(pt.x - tileWidth / 2, pt.y);
        
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // Draws a shaded 3D building cube
    function drawIsometricCube(x, y, height, colors, highlight = false) {
        const base = gridToScreen(x + 0.5, y + 0.5);
        const w = tileWidth / 2;
        const h = tileHeight / 2;

        // Top points (raised by building height)
        const tCenter = { x: base.x, y: base.y - height };
        const tRight = { x: base.x + w, y: base.y - height };
        const tLeft = { x: base.x - w, y: base.y - height };
        const tTop = { x: base.x, y: base.y - h - height };
        const tBottom = { x: base.x, y: base.y + h - height };

        // Base points
        const bRight = { x: base.x + w, y: base.y };
        const bLeft = { x: base.x - w, y: base.y };
        const bBottom = { x: base.x, y: base.y + h };

        // 1. Draw Left Face
        ctx.fillStyle = colors.left;
        ctx.beginPath();
        ctx.moveTo(bLeft.x, bLeft.y);
        ctx.lineTo(tLeft.x, tLeft.y);
        ctx.lineTo(tBottom.x, tBottom.y);
        ctx.lineTo(bBottom.x, bBottom.y);
        ctx.closePath();
        ctx.fill();

        // 2. Draw Right Face
        ctx.fillStyle = colors.right;
        ctx.beginPath();
        ctx.moveTo(bBottom.x, bBottom.y);
        ctx.lineTo(tBottom.x, tBottom.y);
        ctx.lineTo(tRight.x, tRight.y);
        ctx.lineTo(bRight.x, bRight.y);
        ctx.closePath();
        ctx.fill();

        // 3. Draw Top Face
        ctx.fillStyle = colors.top;
        ctx.beginPath();
        ctx.moveTo(tBottom.x, tBottom.y);
        ctx.lineTo(tLeft.x, tLeft.y);
        ctx.lineTo(tTop.x, tTop.y);
        ctx.lineTo(tRight.x, tRight.y);
        ctx.closePath();
        ctx.fill();

        if (highlight) {
            // Draw a subtle neon outline around top face
            ctx.strokeStyle = "var(--color-orange)";
            ctx.lineWidth = 1.0;
            ctx.stroke();
        }
    }
});
