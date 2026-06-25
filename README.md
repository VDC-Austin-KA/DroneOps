# 🚁 DroneOps — Drone Flight & Scenario Trainer

A **drone-focused** flight planner, visualizer and scenario trainer built on
**Google Photorealistic 3D Tiles**. It is a standalone fork of the *Earth4D*
construction app — same React + Vite + Three.js + `3d-tiles-renderer` engine,
rebuilt around drone operations instead of construction scheduling.

Inspired by DroneDeploy-style mission mapping, but made for **training**: plan a
path, drop real-world hazards, fly it, and learn how to handle what goes wrong.

![drone](https://img.shields.io/badge/Google-3D%20Tiles-39b6ff) ![three](https://img.shields.io/badge/three.js-0.169-2bd67b)

---

## What it does

- **Animated Mavic 3 Pro–style hero drone** — a detailed built-in model (grey
  body, Hasselblad twin-lens gimbal, folding arms, motion-blur prop discs, status
  LEDs) with idle hover bob, a ground contact shadow, and cinematic
  reflections/sky for a "visual storyteller" feel. Prefer photoreal? Download a
  free [Mavic 3 Pro GLB from Sketchfab](https://sketchfab.com/3d-models/dji-mavic-3-pro-e043f4394e6b4428ad9e69988e5f51ad)
  (CC-BY — credit *johnnokomis*) and **Load drone GLB** in the panel; its own
  animation clips play automatically.
- **DroneDeploy-style flight planning** — click to lay a path, set per-waypoint
  altitude, and watch the drone fly it with a live telemetry HUD (altitude AGL,
  ground speed, distance, ETA, battery).
- **Built-in default hazards** (drag & drop — no file importing), each with a
  **toggleable clearance / standoff volume**:
  - **Airspace (FAA):** airport/heliport, controlled/LAANC ceiling, restricted/TFR, stadium TFR
  - **Construction:** tower crane (with swing radius), mobile crane, excavator
  - **Obstacles:** comm tower, power line, building, tree
  - **Ops & hazards:** helipad/LZ, people/crowd, bird activity
- **Three cameras:** free **Orbit**, the drone's **FPV** onboard view, and a
  **Ground** observer looking up at the aircraft.
- **Crash simulation:** collide with an obstacle and the drone tumbles, smokes and
  falls, then a **debrief** explains the cause and the correct response.
- **Training scenarios:** airport proximity (LAANC), active crane site, crowd
  overflight, power-line inspection, tall obstacle, GPS-loss/flyaway, low-battery
  RTH — each with a briefing on how to recognise and handle the situation.
- **Live safety analysis** flags airspace incursions, clearance violations and the
  120 m (400 ft) ceiling. **Save/load** missions to JSON.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # → dist/
npm start            # serve dist/ with the bundled Node server
```

You need a **Google Maps Platform API key** with the **Map Tiles API** enabled and
billing active. Paste it into the launch screen (stored only in your browser), or
bake a default in via `VITE_GOOGLE_MAPS_API_KEY` (see `.env.example`).

## Deploy

- **Static hosts (GitHub Pages, Netlify, Vercel, Cloudflare):** `npm run build`,
  publish `dist/`.
- **Node hosts (Railway/Render):** `railway.json` is included; it runs
  `npm run build` then `node server.js`.

## How it's structured

```
src/
  main.tsx                 React entry
  App.tsx                  UI: rail, panel, HUD, cameras, scenarios, debrief
  components/ApiKeyGate.tsx
  index.css                all styling
  drone/
    DroneViewer.ts         the engine (tiles, drone, hazards, path, sim, crash, cameras)
    catalog.ts             hazard kinds + training scenarios
    regionUtils.ts         geodetic ↔ world math (ported from Earth4D)
    types.ts               scenario data types
```

The original construction app this was forked from lives in the **Earth4D**
repository.
