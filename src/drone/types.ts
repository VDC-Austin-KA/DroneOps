import type { KindId } from './catalog';

export interface Waypoint { lat: number; lon: number; alt: number; _gh?: number }
export interface Situation {
  id: string; kind: KindId; lat: number; lon: number; heading: number;
  clearR: number; clearH: number; showClear: boolean; label: string;
  /** Visual size multiplier for the equipment/hazard mesh (1 = catalog default). */
  scale?: number;
  /** Override physical model height (m) — e.g. a specific tower-crane mast height. */
  height?: number;
  /** Working/jib reach or swing radius (m) for cranes & similar. Drives the swept swing ring. */
  reach?: number;
  /** Show the small floating info annotation (height / clearance / reach) next to it. */
  showInfo?: boolean;
}
export interface Poi { id: string; lat: number; lon: number; alt: number; label: string }
export interface AreaZone { id: string; lat: number; lon: number; radius: number; label: string }

export interface Scenario {
  drone: {
    type: string; scale: number; lat: number | null; lon: number | null; modelUrl?: string | null;
    /** Yaw correction (deg) for imported models that point the wrong way along the path. */
    modelYaw?: number;
    /** Highlight the drone with a glow/beacon so it stands out from the photoreal backdrop. */
    highlight?: boolean;
  };
  speed: number;
  defaultAlt: number;
  path: Waypoint[];
  situations: Situation[];
  pois: Poi[];
  areas: AreaZone[];
  /** Optional mission/project name (DroneDeploy-style project). */
  name?: string;
}

export interface Telemetry {
  state: string; alt: number; speed: number; dist: number; total: number;
  eta: number; battery: number;
  /** Clearance to the nearest mapped mesh surface (terrain/buildings) in m; null when unknown. */
  agl?: number | null;
}
export interface SafetyFinding { lvl: 'warn' | 'bad'; msg: string }
export interface Debrief { title: string; cause: string; steps: string[]; accent?: boolean }

export type Tool = 'orbit' | 'path' | 'poi' | 'area' | 'drone';
export type CamMode = 'orbit' | 'fpv' | 'ground' | 'chase' | 'cine';

export function newScenario(): Scenario {
  return {
    drone: { type: 'quad', scale: 6, lat: null, lon: null, modelYaw: 0, highlight: false },
    speed: 8, defaultAlt: 60, path: [], situations: [], pois: [], areas: [],
  };
}
