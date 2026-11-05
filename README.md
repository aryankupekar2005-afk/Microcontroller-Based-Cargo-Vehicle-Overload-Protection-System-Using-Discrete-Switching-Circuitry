# Microcontroller-Based-Cargo-Vehicle-Overload-Protection-System-Using-Discrete-Switching-Circuitry
 
This repository contains the embedded firmware and project documentation for a real-time cargo weight measurement, display, and dashboard monitoring system using an STM32 controller and HX711 load cell amplifiers.

---

## Key Features
* **Real-Time Weight Measurement:** Interfaces load cells with an HX711 amplifier module to continuously measure cargo weight.
* **Local Display:** Integrates an SSD1306 OLED display for immediate, on-site weight readings and system status.
* **Wi-Fi Telemetry:** Uses an ESP-01 Wi-Fi module communicating via UART (Pins A9/A10) to transmit live telemetry data to a web-based dashboard.
* **Automated Protection:** Utilizes discrete switching circuitry and relay control to handle system protection triggers based on weight thresholds.

---

## Hardware Components
* **Microcontroller:** STM32 Controller
* **Sensor Module:** HX711 24-Bit ADC Amplifier with Load Cells
* **Display:** SSD1306 I2C OLED Display
* **Communication:** ESP-01 Wi-Fi Module
* **Switching & Power:** Discrete switching circuitry, relays, and step-down power regulation.

---

## Repository Structure
* `Core/` & `Drivers/` - STM32 HAL firmware source and driver files.
* `Images/` - Circuit schematics, simulation views (`Simulation_on_Wokwi.jpg`), and hardware setup photos.
* `Report_final.pdf` - Complete technical report detailing design methodology and testing.
* `finalposter.pdf` - Project presentation poster.
