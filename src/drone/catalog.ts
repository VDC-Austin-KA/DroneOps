// Hazard catalog + training scenarios shared by the viewer engine and the React UI.

export type HazardMode = 'obstacle' | 'restricted' | 'ceiling' | 'pad' | 'hazard';

export interface HazardKind {
  cat: string;
  ic: string;
  name: string;
  mode: HazardMode;
  /** Default clearance / standoff radius (m). */
  clearR: number;
  /** Default clearance height — ceiling for 'ceiling' mode, volume top otherwise (m). */
  clearH: number;
  color: number;
  /** Physical model height (m) for obstacle meshes. */
  h?: number;
}

export type KindId =
  | 'airport' | 'controlled' | 'restricted' | 'stadium'
  | 'towercrane' | 'mobilecrane' | 'excavator'
  | 'comm' | 'building' | 'powerline' | 'tree'
  | 'helipad' | 'crowd' | 'birds';

export const KINDS: Record<KindId, HazardKind> = {
  // FAA airspace
  airport:     { cat: 'Airspace (FAA)', ic: '🛫', name: 'Airport / Heliport', mode: 'restricted', clearR: 600, clearH: 120, color: 0xff4d4d },
  controlled:  { cat: 'Airspace (FAA)', ic: '🗺', name: 'Controlled (LAANC)',  mode: 'ceiling',    clearR: 500, clearH: 60,  color: 0x39b6ff },
  restricted:  { cat: 'Airspace (FAA)', ic: '⛔', name: 'Restricted / TFR',    mode: 'restricted', clearR: 300, clearH: 150, color: 0xff4d4d },
  stadium:     { cat: 'Airspace (FAA)', ic: '🏟', name: 'Stadium / Crowd TFR', mode: 'restricted', clearR: 150, clearH: 120, color: 0xff7ad1 },
  // Construction
  towercrane:  { cat: 'Construction',   ic: '🏗', name: 'Tower Crane',  mode: 'obstacle', clearR: 45, clearH: 90, color: 0xffb020, h: 80 },
  mobilecrane: { cat: 'Construction',   ic: '🚧', name: 'Mobile Crane', mode: 'obstacle', clearR: 30, clearH: 55, color: 0xffb020, h: 48 },
  excavator:   { cat: 'Construction',   ic: '🛠', name: 'Excavator',    mode: 'obstacle', clearR: 14, clearH: 10, color: 0xffb020, h: 6 },
  // Obstacles
  comm:        { cat: 'Obstacles',      ic: '🗼', name: 'Comm Tower',  mode: 'obstacle', clearR: 18, clearH: 95, color: 0xff9d3a, h: 85 },
  building:    { cat: 'Obstacles',      ic: '🏢', name: 'Building',    mode: 'obstacle', clearR: 15, clearH: 55, color: 0xffb020, h: 45 },
  powerline:   { cat: 'Obstacles',      ic: '⚡', name: 'Power Line',  mode: 'obstacle', clearR: 12, clearH: 32, color: 0xffd24d, h: 24 },
  tree:        { cat: 'Obstacles',      ic: '🌳', name: 'Tree',        mode: 'obstacle', clearR: 8,  clearH: 18, color: 0x66cc66, h: 14 },
  // People / pad / hazards
  helipad:     { cat: 'Ops & Hazards',  ic: '🛬', name: 'Helipad / LZ',  mode: 'pad',       clearR: 25, clearH: 50, color: 0x2bd67b },
  crowd:       { cat: 'Ops & Hazards',  ic: '👥', name: 'People/Crowd',  mode: 'restricted', clearR: 30, clearH: 30, color: 0xff7ad1 },
  birds:       { cat: 'Ops & Hazards',  ic: '🦅', name: 'Bird Activity', mode: 'hazard',    clearR: 60, clearH: 90, color: 0xffd24d },
};

export const CATS = ['Airspace (FAA)', 'Construction', 'Obstacles', 'Ops & Hazards'];

export interface ScenarioDef {
  icon: string;
  title: string;
  short: string;
  brief: string;
  /** Build path + situations relative to a centre point. n/e are metres North/East. */
  build: (c: { lat: number; lon: number }, dN: (m: number) => number, dE: (m: number) => number) => {
    path: { lat: number; lon: number; alt: number }[];
    sit: [KindId, number, number, Partial<{ heading: number; clearR: number; clearH: number; label: string }>?][];
  };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    icon: '🛫', title: 'Airport Proximity (LAANC)', short: 'Fly under a controlled-airspace ceiling near an airport.',
    brief: 'You are within controlled airspace. You MUST have LAANC authorization and stay at/below the published grid ceiling. Watch for manned traffic on approach/departure.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(150), lon: c.lon + dE(60), alt: 45 }, { lat: c.lat + dN(300), lon: c.lon + dE(200), alt: 55 }],
      sit: [['helipad', 0, 0, { label: 'Launch' }], ['airport', 500, 400, { clearR: 600, clearH: 120, label: 'Class D Airport' }], ['controlled', 150, 80, { clearR: 450, clearH: 60, label: 'LAANC 0–60m grid' }]],
    }),
  },
  {
    icon: '🏗', title: 'Active Crane / Construction Site', short: 'Inspect a jobsite with a slewing tower crane.',
    brief: 'A tower crane can slew 360° at any time — treat the full jib radius as a moving no-fly volume. Coordinate with the crane operator/lift director, keep 30 m+ standoff and never fly under a suspended load.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(80), lon: c.lon + dE(120), alt: 70 }, { lat: c.lat + dN(200), lon: c.lon + dE(160), alt: 85 }],
      sit: [['helipad', 0, 0, { label: 'LZ' }], ['towercrane', 150, 140, { label: 'Tower Crane' }], ['mobilecrane', 60, 90, { label: 'Mobile Crane' }], ['excavator', 40, 40, { label: 'Excavator' }]],
    }),
  },
  {
    icon: '👥', title: 'Crowd / Event Overflight', short: 'Operate near people without flying over them.',
    brief: 'Flight over people requires a Part 107 waiver or compliant category drone. Maintain horizontal standoff, plan the path so a failure never drifts the aircraft over the crowd, and keep an emergency landing zone clear of people.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(120), lon: c.lon - dE(30), alt: 50 }, { lat: c.lat + dN(220), lon: c.lon + dE(40), alt: 55 }],
      sit: [['helipad', 0, 0, { label: 'Launch' }], ['stadium', 150, 40, { label: 'Event TFR' }], ['crowd', 150, 40, { label: 'Spectators' }]],
    }),
  },
  {
    icon: '⚡', title: 'Power-Line Inspection', short: 'Fly a parallel corridor along high-voltage lines.',
    brief: 'Maintain a constant offset and fly parallel — never cross between conductors. High-voltage lines induce EMI that can disturb the compass/GPS; watch for conductor sag and guy wires that are nearly invisible to the camera.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(60), lon: c.lon + dE(60), alt: 35 }, { lat: c.lat + dN(200), lon: c.lon + dE(120), alt: 35 }, { lat: c.lat + dN(340), lon: c.lon + dE(180), alt: 35 }],
      sit: [['helipad', 0, 0, { label: 'Launch' }], ['powerline', 120, 90, { heading: 35, label: 'HV Line' }], ['powerline', 270, 150, { heading: 35, label: 'HV Line' }]],
    }),
  },
  {
    icon: '🗼', title: 'Tall Obstacle in the Path', short: 'A comms tower sits directly on the planned route.',
    brief: 'Spot vertical obstructions in your pre-flight survey. Either climb well above the structure (mind the 120 m ceiling) or reroute laterally with margin. Maintain visual line of sight at all times.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(120), lon: c.lon + dE(80), alt: 60 }, { lat: c.lat + dN(260), lon: c.lon + dE(170), alt: 60 }],
      sit: [['helipad', 0, 0, { label: 'Launch' }], ['comm', 130, 90, { label: 'Comm Tower 85m' }]],
    }),
  },
  {
    icon: '🛰', title: 'GPS Loss / Flyaway', short: 'Practice the response to lost positioning.',
    brief: 'If GPS degrades the drone may drift (toilet-bowling/flyaway). RESPONSE: switch to ATTI/manual mode, do not fight it with RTH (which needs GPS), fly it home manually by visual reference, descend and land immediately in the nearest safe clear area. Re-home before next flight.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(140), lon: c.lon + dE(140), alt: 70 }, { lat: c.lat + dN(60), lon: c.lon + dE(260), alt: 70 }],
      sit: [['helipad', 0, 0, { label: 'Launch / RTH' }], ['building', 120, 120, { label: 'Urban canyon' }]],
    }),
  },
  {
    icon: '🔋', title: 'Low Battery / RTH', short: 'Return-to-home with obstacles in the way.',
    brief: 'Set RTH altitude ABOVE the tallest obstacle between you and home before takeoff. On low-battery RTH the aircraft climbs to that altitude then returns straight-line — verify nothing taller is in that corridor. Keep a reserve to land, not to arrive at 0%.',
    build: (c, dN, dE) => ({
      path: [{ lat: c.lat, lon: c.lon, alt: 5 }, { lat: c.lat + dN(220), lon: c.lon + dE(220), alt: 80 }, { lat: c.lat, lon: c.lon, alt: 5 }],
      sit: [['helipad', 0, 0, { label: 'Home' }], ['building', 150, 150, { label: 'Obstacle in RTH path', clearH: 90 }]],
    }),
  },
];
