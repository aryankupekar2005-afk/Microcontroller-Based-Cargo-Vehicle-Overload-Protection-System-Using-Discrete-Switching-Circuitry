/**
 * ============================================================================
 * SMART CARGO VEHICLE TELEMETRY & OVERLOAD PROTECTION SYSTEM
 * Frontend Interactive Driver | Chart.js + SVG Digital Twin + Web Audio Alarm
 * ============================================================================
 */

"use strict";

(function () {
    // ==========================================
    // CONFIGURATION & GLOBAL STATE
    // ==========================================
    const CONFIG = {
        OVERLOAD_LIMIT: 60.0,
        MAX_GAUGE_WEIGHT: 80.0,
        API_LIVE_URL: "/api/live",
        POLL_INTERVAL_MS: 1000,
        ARC_TOTAL_CIRCUMFERENCE: 471 // SVG Gauge perimeter for dashoffset
    };

    let telemetryHistory = [];
    let isRequestInProgress = false;
    let chartInstance = null;
    let selectedSampleWindow = 30; // '30', '60', or 'all'
    let isAudioAlarmEnabled = true;
    let isSimulationMode = false;
    let simulationTimer = null;
    let audioContext = null;
    let lastAudioBeepTime = 0;

    // ==========================================
    // DOM CACHE UTILITIES
    // ==========================================
    const $ = (id) => document.getElementById(id);

    const safeSetText = (id, text) => {
        const el = $(id);
        if (el && el.textContent !== text) {
            el.textContent = text;
        }
    };

    const safeSetClass = (id, className) => {
        const el = $(id);
        if (el && el.className !== className) {
            el.className = className;
        }
    };

    // ==========================================
    // WEB AUDIO ALARM SYNTHESIZER
    // ==========================================
    function initAudioContext() {
        if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioCtx();
        }
        if (audioContext && audioContext.state === "suspended") {
            audioContext.resume();
        }
    }

    function playOverloadBeep() {
        if (!isAudioAlarmEnabled) return;
        const now = Date.now();
        if (now - lastAudioBeepTime < 2500) return; // Prevent audio stutter
        lastAudioBeepTime = now;

        try {
            initAudioContext();
            if (!audioContext) return;

            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
            osc.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.35);

            gain.gain.setValueAtTime(0.12, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start();
            osc.stop(audioContext.currentTime + 0.36);
        } catch (e) {
            console.warn("Audio alarm playback blocked by browser policy:", e);
        }
    }

    // ==========================================
    // DIGITAL CLOCK
    // ==========================================
    function updateClock() {
        const now = new Date();
        const timeStr = now.toTimeString().split(" ")[0];
        safeSetText("nav-clock", timeStr);
    }

    // ==========================================
    // RADIAL SPEEDOMETER & SVG TRUCK ANIMATION
    // ==========================================
    function updateRadialGauge(weight, isOverload) {
        const clampedWeight = Math.max(0, Math.min(weight, CONFIG.MAX_GAUGE_WEIGHT));
        const fraction = clampedWeight / CONFIG.MAX_GAUGE_WEIGHT;

        // Animate circular arc
        const activeArc = $("gauge-active-arc");
        if (activeArc) {
            const offset = CONFIG.ARC_TOTAL_CIRCUMFERENCE * (1 - fraction);
            activeArc.style.strokeDashoffset = Math.max(0, offset).toFixed(1);
            activeArc.style.stroke = isOverload ? "#ff3b30" : "url(#arc-gradient)";
        }

        // Digital numeric readout
        safeSetText("weight-display", weight.toFixed(3));

        // SVG Truck cargo level animation
        const cargoRect = $("truck-cargo-level");
        const hazardStripes = $("truck-hazard-stripes");
        if (cargoRect) {
            const maxFillHeight = 125; // Inside truck bed
            const fillHeight = (Math.min(weight, CONFIG.OVERLOAD_LIMIT * 1.25) / (CONFIG.OVERLOAD_LIMIT * 1.25)) * maxFillHeight;
            const yPos = 180 - fillHeight;

            cargoRect.setAttribute("y", yPos.toString());
            cargoRect.setAttribute("height", fillHeight.toString());

            if (isOverload) {
                cargoRect.setAttribute("fill", "#ff3b30");
                if (hazardStripes) hazardStripes.classList.remove("hidden");
            } else if (weight > 48.0) {
                cargoRect.setAttribute("fill", "#f59e0b");
                if (hazardStripes) hazardStripes.classList.add("hidden");
            } else {
                cargoRect.setAttribute("fill", "url(#cargo-gradient)");
                if (hazardStripes) hazardStripes.classList.add("hidden");
            }
        }

        // Capacity Progress Bar
        const capacityFill = $("capacity-fill");
        if (capacityFill) {
            const capacityPercent = Math.min((weight / CONFIG.MAX_GAUGE_WEIGHT) * 100, 100);
            capacityFill.style.width = capacityPercent.toFixed(1) + "%";
            capacityFill.style.background = isOverload
                ? "linear-gradient(90deg, #f59e0b 0%, #ff3b30 100%)"
                : "linear-gradient(90deg, #00F2FE 0%, #4FACFE 70%, #10B981 100%)";
        }

        // Payload capacity %
        const payloadPercent = ((weight / CONFIG.OVERLOAD_LIMIT) * 100).toFixed(1);
        safeSetText("truck-payload-percent", `${payloadPercent}% OF 60 KG CAPACITY`);

        // Available margin
        const margin = CONFIG.OVERLOAD_LIMIT - weight;
        if (margin >= 0) {
            safeSetText("capacity-margin", `${margin.toFixed(3)} kg remaining`);
            safeSetClass("truck-status-badge", "meta-value badge-pill badge-safe");
            safeSetText("truck-status-badge", "SAFE (WITHIN LIMIT)");
        } else {
            safeSetText("capacity-margin", `+${Math.abs(margin).toFixed(3)} kg EXCEEDED`);
            safeSetClass("truck-status-badge", "meta-value badge-pill badge-hazard");
            safeSetText("truck-status-badge", "CRITICAL OVERLOAD");
        }
    }

    // ==========================================
    // CRITICAL HAZARD BANNER
    // ==========================================
    function updateHazardBanner(isOverload, weight) {
        const banner = $("hazard-banner");
        const excessEl = $("hazard-excess");
        if (!banner) return;

        if (isOverload) {
            banner.classList.remove("hidden");
            const excess = weight - CONFIG.OVERLOAD_LIMIT;
            if (excessEl) excessEl.textContent = `+${excess.toFixed(3)} KG OVERLOAD`;
            playOverloadBeep();
        } else {
            banner.classList.add("hidden");
        }
    }

    // ==========================================
    // 4 TELEMETRY CARDS UPDATE
    // ==========================================
    function updateCards(weight, isOverload, isRelayHigh, online, stats, timestamp) {
        // 1. Gross Weight Card
        safeSetText("card-weight", `${weight.toFixed(3)}`);
        safeSetText("card-weight-sub", online ? "Live calibrated reading from HX711" : "STM32 offline &bull; Last known reading");
        if (stats && stats.peak_weight !== undefined) {
            safeSetText("peak-weight-val", `${Number(stats.peak_weight).toFixed(3)} kg`);
        }

        // 2. Overload Condition Guard Card
        const overloadStatus = $("overload-status-text");
        const overloadDesc = $("overload-desc");
        if (overloadStatus && overloadDesc) {
            if (isOverload) {
                overloadStatus.textContent = "OVERLOAD!";
                overloadStatus.className = "metric-status status-hazard";
                overloadDesc.textContent = `CRITICAL: Exceeds 60.0 kg limit by ${(weight - CONFIG.OVERLOAD_LIMIT).toFixed(3)} kg!`;
            } else {
                overloadStatus.textContent = "NORMAL";
                overloadStatus.className = "metric-status status-safe";
                overloadDesc.textContent = `Payload within limits (${(CONFIG.OVERLOAD_LIMIT - weight).toFixed(3)} kg safety margin).`;
            }
        }

        // 3. PB0 Actuator & Relay State Card
        const relayStatus = $("relay-status-text");
        const relayDesc = $("relay-desc");
        if (relayStatus && relayDesc) {
            if (isRelayHigh) {
                relayStatus.textContent = "TRIPPED \u2022 CUTOFF";
                relayStatus.className = "metric-status status-hazard";
                relayDesc.textContent = "GPIO PB0 = HIGH. Vehicle ignition lockout is currently active!";
            } else {
                relayStatus.textContent = "OFF \u2022 RUN";
                relayStatus.className = "metric-status status-safe";
                relayDesc.textContent = "GPIO PB0 = LOW. Ignition circuit enabled for regular transit.";
            }
        }

        // 4. Hardware Link Card
        safeSetText("link-latency", online ? "ONLINE \u2022 115200" : "OFFLINE");
        safeSetClass("link-latency", online ? "metric-number-small status-safe" : "metric-number-small status-hazard");
        const count = stats ? stats.total_packets : telemetryHistory.length;
        safeSetText("link-packets", `Packets Received: ${count} | Latency: ~3s`);

        // Telemetry Timestamp
        safeSetText("telemetry-timestamp", timestamp ? `RECEIVED ${timestamp}` : "AWAITING SENSOR");
    }

    // ==========================================
    // HARDWARE CONNECTION PILL
    // ==========================================
    function updateConnectionStatus(online) {
        const pill = $("connection-pill");
        const text = $("connection-text");
        if (!pill || !text) return;

        if (online) {
            pill.className = "connection-pill online";
            text.textContent = "STM32 TELEMETRY ONLINE";
        } else {
            pill.className = "connection-pill offline";
            text.textContent = "STM32 OFFLINE";
        }
    }

    // ==========================================
    // TELEMETRY EVENT LOG TABLE
    // ==========================================
    function updateActivityTable(records) {
        const tbody = $("telemetry-tbody");
        const countBadge = $("table-record-count");
        if (!tbody) return;

        if (countBadge) {
            countBadge.textContent = `${records.length} measurements recorded`;
        }

        if (!records || records.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="table-placeholder">
                        <div class="placeholder-box">
                            <div class="pulse-ring"></div>
                            <span>Listening for incoming STM32 HTTP POST requests on port 5000...</span>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        // Render latest 15 records in reverse chronological order
        const recent = records.slice(-15).reverse();
        const rowsHtml = recent.map((r) => {
            const wt = Number(r.weight || 0);
            const isOv = Boolean(r.overload);
            const isRl = Boolean(r.relay);
            const capPercent = Math.min((wt / CONFIG.OVERLOAD_LIMIT) * 100, 999).toFixed(1);

            return `
                <tr>
                    <td><strong>${r.timestamp || "--:--:--"}</strong></td>
                    <td><strong>${wt.toFixed(3)} kg</strong></td>
                    <td>${capPercent}%</td>
                    <td><span class="${isOv ? 'row-hazard' : 'row-safe'}">${isOv ? 'OVERLOAD' : 'NORMAL'}</span></td>
                    <td><span class="${isRl ? 'row-hazard' : 'row-safe'}">${isRl ? 'PB0 HIGH (CUTOFF)' : 'PB0 LOW (RUN)'}</span></td>
                    <td><span class="row-safe">&bull; HTTP 200 OK</span></td>
                </tr>`;
        }).join("");

        tbody.innerHTML = rowsHtml;
    }

    // ==========================================
    // CHART.JS INTEGRATION & FALLBACK CANVAS
    // ==========================================
    function initOrUpdateChart(records) {
        const canvas = $("telemetryChart");
        if (!canvas) return;

        // Apply slice window
        let displayData = records;
        if (selectedSampleWindow === 30) {
            displayData = records.slice(-30);
        } else if (selectedSampleWindow === 60) {
            displayData = records.slice(-60);
        }

        const labels = displayData.map((d) => d.timestamp || "");
        const weights = displayData.map((d) => Number(d.weight || 0));
        const limits = displayData.map(() => CONFIG.OVERLOAD_LIMIT);

        // If Chart.js library is available
        if (window.Chart) {
            if (!chartInstance) {
                const ctx = canvas.getContext("2d");
                const gradient = ctx.createLinearGradient(0, 0, 0, 300);
                gradient.addColorStop(0, "rgba(0, 242, 254, 0.35)");
                gradient.addColorStop(1, "rgba(0, 242, 254, 0.0)");

                chartInstance = new Chart(ctx, {
                    type: "line",
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: "Measured Load Cell Weight (kg)",
                                data: weights,
                                borderColor: "#00F2FE",
                                borderWidth: 3,
                                backgroundColor: gradient,
                                fill: true,
                                tension: 0.35,
                                pointRadius: displayData.length > 40 ? 0 : 3,
                                pointHoverRadius: 6,
                                pointBackgroundColor: "#00F2FE"
                            },
                            {
                                label: "60.0 kg Overload Threshold",
                                data: limits,
                                borderColor: "#ff3b30",
                                borderWidth: 2,
                                borderDash: [6, 6],
                                fill: false,
                                pointRadius: 0
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 400 },
                        interaction: { intersect: false, mode: "index" },
                        scales: {
                            x: {
                                grid: { color: "rgba(255, 255, 255, 0.05)" },
                                ticks: { color: "#64748b", font: { family: "'JetBrains Mono', monospace", size: 10 } }
                            },
                            y: {
                                min: 0,
                                suggestedMax: 80,
                                grid: { color: "rgba(255, 255, 255, 0.05)" },
                                ticks: {
                                    color: "#94a3b8",
                                    font: { family: "'JetBrains Mono', monospace", size: 11 },
                                    callback: (val) => `${val} kg`
                                }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: "rgba(12, 20, 36, 0.95)",
                                titleColor: "#00F2FE",
                                titleFont: { family: "'JetBrains Mono', monospace" },
                                bodyFont: { family: "'Plus Jakarta Sans', sans-serif" },
                                borderColor: "rgba(67, 224, 194, 0.3)",
                                borderWidth: 1,
                                padding: 12
                            }
                        }
                    }
                });
            } else {
                chartInstance.data.labels = labels;
                chartInstance.data.datasets[0].data = weights;
                chartInstance.data.datasets[1].data = limits;
                chartInstance.update("none");
            }
        }
    }

    // ==========================================
    // PRIMARY TELEMETRY POLLING FUNCTION
    // ==========================================
    async function fetchLiveTelemetry() {
        if (isRequestInProgress || isSimulationMode) return;
        isRequestInProgress = true;

        try {
            const response = await fetch(`${CONFIG.API_LIVE_URL}?_=${Date.now()}`, {
                method: "GET",
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const data = await response.json();
            const online = Boolean(data.online);
            const latest = data.latest;
            telemetryHistory = Array.isArray(data.history) ? data.history : [];

            updateConnectionStatus(online);

            if (latest && Number.isFinite(Number(latest.weight))) {
                const weight = Number(latest.weight);
                const isOverload = Boolean(latest.overload);
                const isRelayHigh = Boolean(latest.relay);

                updateRadialGauge(weight, isOverload);
                updateHazardBanner(isOverload, weight);
                updateCards(weight, isOverload, isRelayHigh, online, data.stats, latest.timestamp);
                initOrUpdateChart(telemetryHistory);
                updateActivityTable(telemetryHistory);
            } else {
                // No active measurements yet
                updateRadialGauge(0.0, false);
                updateHazardBanner(false, 0.0);
                updateCards(0.0, false, false, online, data.stats, null);
                initOrUpdateChart([]);
                updateActivityTable([]);
            }
        } catch (err) {
            console.warn("Telemetry polling warning:", err.message);
            updateConnectionStatus(false);
        } finally {
            isRequestInProgress = false;
        }
    }

    // ==========================================
    // INTERACTIVE DEMO SIMULATOR
    // ==========================================
    function toggleSimulatorMode() {
        isSimulationMode = !isSimulationMode;
        const btn = $("btn-demo-toggle");
        const text = $("demo-text");

        if (isSimulationMode) {
            if (btn) btn.classList.add("active");
            if (text) text.textContent = "SIMULATOR ACTIVE";
            initAudioContext();
            startSimulatorLoop();
        } else {
            if (btn) btn.classList.remove("active");
            if (text) text.textContent = "TEST SIMULATOR";
            if (simulationTimer) clearInterval(simulationTimer);
            fetchLiveTelemetry(); // Restore real telemetry
        }
    }

    function startSimulatorLoop() {
        let simStep = 0;
        const testLoads = [
            0.000, 8.450, 19.320, 34.600, 48.900, 58.200, 64.750, 72.300, 81.100, 42.100, 15.000
        ];

        simulationTimer = setInterval(() => {
            const weight = testLoads[simStep % testLoads.length];
            const isOverload = weight > CONFIG.OVERLOAD_LIMIT;
            const isRelayHigh = isOverload;
            const now = new Date();
            const timeStr = now.toTimeString().split(" ")[0];

            const simReading = {
                weight: weight,
                overload: isOverload,
                relay: isRelayHigh,
                timestamp: timeStr
            };

            telemetryHistory.push(simReading);
            if (telemetryHistory.length > 100) telemetryHistory.shift();

            updateConnectionStatus(true);
            updateRadialGauge(weight, isOverload);
            updateHazardBanner(isOverload, weight);
            updateCards(weight, isOverload, isRelayHigh, true, {
                total_packets: telemetryHistory.length,
                peak_weight: Math.max(...telemetryHistory.map(r => r.weight))
            }, timeStr);
            initOrUpdateChart(telemetryHistory);
            updateActivityTable(telemetryHistory);

            simStep++;
        }, 2000);
    }

    // ==========================================
    // EVENT LISTENERS & INITIALIZATION
    // ==========================================
    function setupEventHandlers() {
        // Digital Clock Interval
        setInterval(updateClock, 1000);
        updateClock();

        // Sound Toggle Button
        const soundBtn = $("btn-sound-toggle");
        if (soundBtn) {
            soundBtn.addEventListener("click", () => {
                isAudioAlarmEnabled = !isAudioAlarmEnabled;
                safeSetText("sound-icon", isAudioAlarmEnabled ? "🔔" : "🔕");
                safeSetText("sound-text", isAudioAlarmEnabled ? "ALARM ON" : "MUTED");
                initAudioContext();
            });
        }

        // Demo Simulator Toggle
        const demoBtn = $("btn-demo-toggle");
        if (demoBtn) {
            demoBtn.addEventListener("click", toggleSimulatorMode);
        }

        // CSV Export Button
        const exportBtn = $("btn-export-csv");
        if (exportBtn) {
            exportBtn.addEventListener("click", () => {
                window.location.href = "/api/export-csv";
            });
        }

        // Chart Filter Buttons
        const filterBtns = document.querySelectorAll(".filter-btn");
        filterBtns.forEach((btn) => {
            btn.addEventListener("click", (e) => {
                filterBtns.forEach((b) => b.classList.remove("active"));
                e.target.classList.add("active");
                const samples = e.target.getAttribute("data-samples");
                selectedSampleWindow = samples === "all" ? "all" : parseInt(samples, 10);
                initOrUpdateChart(telemetryHistory);
            });
        });
    }

    function init() {
        console.log("SMART CARGO TELEMETRY ENGINE INITIALIZED");
        setupEventHandlers();
        fetchLiveTelemetry();
        setInterval(fetchLiveTelemetry, CONFIG.POLL_INTERVAL_MS);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
