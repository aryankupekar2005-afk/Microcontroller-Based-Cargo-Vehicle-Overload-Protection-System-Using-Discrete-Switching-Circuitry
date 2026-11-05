"""
=============================================================================
SMART CARGO VEHICLE MONITORING AND OVERLOAD PROTECTION SYSTEM
Backend Server: Python Flask
Microcontroller Target: STM32F103C6T6 + HX711 + ESP-01 (ESP8266)
=============================================================================
"""

import math
import time
from collections import deque
from datetime import datetime
from threading import Lock
from flask import Flask, jsonify, render_template, request, Response

app = Flask(__name__)

# ==========================================
# SYSTEM PARAMETERS
# ==========================================
OVERLOAD_LIMIT = 60.0        # Overload threshold in kg
MAX_HISTORY = 500            # Retain up to 500 recent measurements
OFFLINE_TIMEOUT = 12.0       # Mark offline if no packet received within 12 seconds

data_lock = Lock()
history = deque(maxlen=MAX_HISTORY)
latest = None
last_received = None
total_packets_received = 0
peak_weight_recorded = 0.0


# ==========================================
# FRONTEND HOME ROUTE
# ==========================================
@app.route("/", methods=["GET"])
def home():
    """Renders the primary live monitoring dashboard."""
    return render_template("index.html")


# ==========================================
# STM32 TELEMETRY INGESTION ENDPOINT
# ==========================================
@app.route("/api/weight", methods=["POST"])
def receive_weight():
    """
    Ingests live sensor telemetry from STM32F103 via ESP-01 Wi-Fi module.
    Expected JSON format:
    {
        "weight": 12.450,
        "overload": false,
        "relay": false
    }
    """
    global latest, last_received, total_packets_received, peak_weight_recorded

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "Invalid JSON format"}), 400

    try:
        weight = float(data["weight"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"success": False, "error": "Missing or invalid 'weight' field"}), 400

    if not math.isfinite(weight):
        return jsonify({"success": False, "error": "Weight value must be finite"}), 400

    if not -200.0 <= weight <= 200.0:
        return jsonify({"success": False, "error": "Weight outside acceptable physical range (-200kg to 200kg)"}), 400

    # Overload decision logic (60 kg threshold)
    overload = weight > OVERLOAD_LIMIT
    relay = bool(data.get("relay", overload))

    timestamp = datetime.now().strftime("%H:%M:%S")

    reading = {
        "weight": round(weight, 3),
        "overload": overload,
        "relay": relay,
        "timestamp": timestamp,
        "epoch": time.time()
    }

    with data_lock:
        latest = reading.copy()
        history.append(reading.copy())
        last_received = time.monotonic()
        total_packets_received += 1
        if weight > peak_weight_recorded:
            peak_weight_recorded = weight

    # Console logging for real-time verification during live demonstrations
    print(
        f"STM32 POST | {timestamp} | "
        f"Weight: {weight:7.3f} kg | "
        f"Overload: {str(overload):5} | "
        f"Relay PB0: {'HIGH (CUTOFF)' if relay else 'LOW (RUN)'} | "
        f"Total: {total_packets_received}",
        flush=True
    )

    return jsonify({
        "success": True,
        "message": "Telemetry reading successfully recorded",
        "received": reading
    }), 200


# ==========================================
# LIVE DASHBOARD TELEMETRY POLLING API
# ==========================================
@app.route("/api/live", methods=["GET"])
def get_live_data():
    """
    Supplies the web dashboard with real-time state, history, and system statistics.
    Polled every 1000 ms by static/live.js.
    """
    with data_lock:
        current = latest.copy() if latest else None
        records = list(history)
        received = last_received
        packets = total_packets_received
        peak = peak_weight_recorded

    online = (
        received is not None
        and (time.monotonic() - received) < OFFLINE_TIMEOUT
    )

    # Compute telemetry metrics
    weights = [r["weight"] for r in records if isinstance(r.get("weight"), (int, float))]
    avg_weight = round(sum(weights) / len(weights), 3) if weights else 0.0

    return jsonify({
        "online": online,
        "latest": current,
        "history": records,
        "limit": OVERLOAD_LIMIT,
        "stats": {
            "total_packets": packets,
            "peak_weight": round(peak, 3),
            "avg_weight": avg_weight,
            "sample_count": len(records),
            "offline_timeout_sec": OFFLINE_TIMEOUT
        }
    })


# ==========================================
# EXPORT TELEMETRY TO CSV (PROJECT REPORTS)
# ==========================================
@app.route("/api/export-csv", methods=["GET"])
def export_csv():
    """Exports all recorded telemetry in CSV format for engineering lab reports."""
    with data_lock:
        records = list(history)

    csv_lines = ["Timestamp,Weight_KG,Overload_Triggered,Relay_PB0_State\n"]
    for item in records:
        ts = item.get("timestamp", "")
        wt = item.get("weight", 0.0)
        ov = "YES" if item.get("overload") else "NO"
        rl = "HIGH_CUTOFF" if item.get("relay") else "LOW_NORMAL"
        csv_lines.append(f"{ts},{wt:.3f},{ov},{rl}\n")

    return Response(
        "".join(csv_lines),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=smart_cargo_telemetry.csv"}
    )


# ==========================================
# SYSTEM HEALTH & DIAGNOSTIC ENDPOINT
# ==========================================
@app.route("/api/health", methods=["GET"])
def health_check():
    """Diagnostics endpoint used to verify external phone/hotspot reachability."""
    return jsonify({
        "status": "running",
        "service": "Smart Cargo Monitoring Server",
        "port": 5000,
        "overload_limit_kg": OVERLOAD_LIMIT,
        "total_packets": total_packets_received,
        "last_contact_sec_ago": (
            round(time.monotonic() - last_received, 1)
            if last_received is not None else None
        )
    })


# ==========================================
# BACKWARD COMPATIBILITY ROUTES
# ==========================================
@app.route("/api/data", methods=["GET"])
def get_data_compat():
    return get_live_data()


@app.route("/api/update", methods=["GET", "POST"])
def update_compat():
    if request.method == "GET":
        return jsonify({"message": "Send POST request to upload data", "endpoint": "/api/weight"})
    return receive_weight()


# ==========================================
# SERVER LAUNCHER
# ==========================================
if __name__ == "__main__":
    print("=" * 65)
    print(" SMART CARGO VEHICLE MONITORING AND OVERLOAD PROTECTION SYSTEM")
    print("=" * 65)
    print(" Microcontroller : STM32F103C6T6 (Blue Pill)")
    print(" Sensor Core     : HX711 24-Bit ADC + 4x 50kg Load Cells")
    print(" Actuator Output : STM32 GPIO PB0 (Ignition Cutoff Relay)")
    print(" Wireless Bridge : ESP-01 / ESP8266 (USART2 @ 115200 Baud)")
    print(" Listening On    : 0.0.0.0:5000 (Accepts Hotspot Connections)")
    print(" API Endpoint    : POST http://10.70.64.79:5000/api/weight")
    print(" Live Dashboard  : http://localhost:5000 or http://10.70.64.79:5000")
    print(" Overload Limit  : 60.0 kg")
    print("=" * 65, flush=True)

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        threaded=True
    )
