import type { KindId } from './catalog';

export interface Waypoint { lat: number; lon: number; alt: number; _gh?: number }
export interface Situation {
  id: string; kind: KindId; lat: number; lon: number; heading: number;
  clearR: number; clearH: number; showClear: boolean; label: string;
}
export interface Poi { id: string; lat: number; lon: number; alt: number; label: string }
export interface AreaZone { id: string; lat: number; lon: number; radius: number; label: string }

export interface Scenario {
  drone: { type: string; scale: number; lat: number | null; lon: number | null; modelUrl?: string | null };
  speed: number;
  defaultAlt: number;
  path: Waypoint[];
  situations: Situation[];
  pois: Poi[];
  areas: AreaZone[];
}

export interface Telemetry {
  state: string; alt: number; speed: number; dist: number; total: number;
  eta: number; battery: number;
}
export interface SafetyFinding { lvl: 'warn' | 'bad'; msg: string }
export interface Debrief { title: string; cause: string; steps: string[]; accent?: boolean }

export type Tool = 'orbit' | 'path' | 'poi' | 'area' | 'drone';
export type CamMode = 'orbit' | 'fpv' | 'ground';

export function newScenario(): Scenario {
  return {
    drone: { type: 'quad', scale: 6, lat: null, lon: null },
    speed: 8, defaultAlt: 60, path: [], situations: [], pois: [], areas: [],
  };
}
