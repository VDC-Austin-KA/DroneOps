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
  altitude (slider, 5 ft steps), and watch the drone fly it with a live telemetry
  HUD (altitude AGL, ground speed, distance, ETA, battery, mesh clearance). Or drop
  a geofence and **generate a serpentine survey grid** automatically.
- **Active terrain & building interaction** — the drone reads the real Google mesh.
  Turn on **Auto-avoid terrain** to hold a minimum clearance over buildings and
  ground, or leave it off to see **controlled-flight-into-terrain** crashes.
- **Drone highlight, downwash & yaw fix** — a toggleable glow/beacon makes the
  aircraft pop against the photoreal world; faint prop-wash rings show it's actively
  flying; imported models that fly sideways are corrected with a **yaw fix**.
- **Adjustable equipment** — change each hazard's **size, height and crane reach /
  swing radius**, toggle a floating **info label** (height / standoff / reach), and
  show/hide clearance volumes per item.
- **Built-in default hazards** (drag & drop — no file importing), each with a
  **toggleable clearance / standoff volume**:
  - **Airspace (FAA):** airport/heliport, controlled/LAANC ceiling, restricted/TFR, stadium TFR
  - **Construction:** tower crane (with swing radius), mobile crane, excavator
  - **Obstacles:** comm tower, power line, building, tree
  - **Ops & hazards:** helipad/LZ, people/crowd, bird activity
- **Five cameras:** free **Orbit**, 3rd-person **Chase**, the drone's **FPV** view,
  a **Ground** observer, and a cinematic **Scenario** camera (letterboxed, orbit by
  drag, keeps the whole situation framed).
- **Focus controls** — dim & desaturate or fade the Google tiles so the important
  objects stand out.
- **Crash simulation:** collide with an obstacle or the terrain and the drone tumbles,
  smokes and falls, then a **debrief** explains the cause and the correct response.
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
billing active. Provide it any of three ways:

1. **Paste it into the launch screen** — stored only in your browser.
2. **Build/dev env var** — set `GOOGLE_MAPS_API_KEY` (or `VITE_GOOGLE_MAPS_API_KEY`)
   in `.env`; it's baked into the bundle (see `.env.example`).
3. **Runtime env var (recommended for hosting)** — set `GOOGLE_MAPS_API_KEY` in your
   host's dashboard. `server.js` injects it into the page at request time, so the key
   can be set or rotated with **no rebuild and without entering it in the app**.

All units in the UI are **US customary** — feet, miles and mph.

## Deploy

- **Static hosts (GitHub Pages, Netlify, Vercel, Cloudflare):** `npm run build`,
  publish `dist/`. Provide the key with build-time `GOOGLE_MAPS_API_KEY`.
- **Node hosts (Railway/Render):** `railway.json` is included; it runs
  `npm run build` then `node server.js`.

### Railway via GitHub

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** and pick it. Railway reads
   `railway.json` (NIXPACKS): build `npm run build`, start `node server.js`, health
   check `/`.
3. Add a service variable **`GOOGLE_MAPS_API_KEY`** = your Map Tiles API key. The
   server injects it at runtime, so deploys and key rotations need no code changes.
4. Restrict the key by HTTP referrer to your Railway domain.

`PORT` is provided by Railway automatically and honored by `server.js`.

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
    units.ts               US-customary unit conversions/formatters (ft, mi, mph)
    types.ts               scenario data types
```

The original construction app this was forked from lives in the **Earth4D**
repository.
