import {
  ACESFilmicToneMapping, AmbientLight, AnimationMixer, Box3, BoxGeometry, BufferGeometry, CanvasTexture,
  CatmullRomCurve3, CapsuleGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight, Line, LineBasicMaterial,
  LineDashedMaterial, LineLoop, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PerspectiveCamera, PMREMGenerator, Raycaster, Scene, SphereGeometry, Sprite,
  SpriteMaterial, Texture, TorusGeometry, TubeGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TilesRenderer, GlobeControls } from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin, TileCompressionPlugin, UpdateOnChangePlugin,
  UnloadTilesPlugin, TilesFadePlugin, GLTFExtensionsPlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { geodeticToWorld, worldToGeodetic, localEnuFrame, metersPerDegree, distMeters } from './regionUtils';
import { KINDS, SCENARIOS, KindId } from './catalog';
import { Scenario, Situation, Telemetry, SafetyFinding, Debrief, Tool, CamMode, newScenario } from './types';

export interface ViewerCallbacks {
  onReady?: () => void;
  onError?: (m: string) => void;
  onToast?: (m: string) => void;
  onScenarioChange?: (s: Scenario) => void;
  onTelemetry?: (t: Telemetry) => void;
  onSafety?: (f: SafetyFinding[]) => void;
  onDebrief?: (d: Debrief | null) => void;
  onCam?: (m: CamMode) => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);

export class DroneViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private tiles!: TilesRenderer;
  private controls!: GlobeControls;
  private raycaster = new Raycaster();
  private ready = false;
  private disposed = false;
  private animId = 0;
  private container: HTMLElement;
  private cb: ViewerCallbacks;

  private overlay = new Group();
  private pathGroup = new Group();
  private sitGroup = new Group();
  private poiGroup = new Group();
  private areaGroup = new Group();
  private droneGroup = new Group();
  private fxGroup = new Group();

  private scenario: Scenario = newScenario();
  private showClearance = true;
  private tool: Tool = 'orbit';
  private pendingPlace: KindId | null = null;
  private camMode: CamMode = 'orbit';
  private groundObs: { lat: number; lon: number } | null = null;

  private rotors: Object3D[] = [];
  private droneMesh: Group | null = null;
  private droneAnchor: Group | null = null;
  private droneLift: Group | null = null;     // child that carries the hover bob, so heading yaw stays clean
  private shadowBlob: Mesh | null = null;
  private mixer: AnimationMixer | null = null;
  private droneModelUrl: string | null = null; // custom GLB, null = built-in Mavic-style model
  private envTexture: Texture | null = null;
  private bob = 0;
  private shadowAlt = 60;
  private sprites: Sprite[] = [];

  private safetyFindings: SafetyFinding[] = [];
  private sim = { playing: false, elapsed: 0, rate: 1, dist: 0, total: 0, pts: [] as Vector3[], cum: [] as number[],
    geo: [] as { lat: number; lon: number; alt: number; gh: number }[], batt: 100,
    _lat: null as number | null, _lon: 0, _alt: 0, _pos: null as Vector3 | null, _dir: new Vector3(), _up: new Vector3() };
  private simViolations = new Set<string>();
  private crash = { active: false, vel: new Vector3(), spin: new Vector3(), pos: new Vector3(), t: 0, grounded: false, groundH: 0 };
  private crashEnabled = true;
  private lastTime = performance.now();

  private downPt = { x: 0, y: 0 };
  private downT = 0;

  constructor(container: HTMLElement, apiKey: string, cb: ViewerCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setClearColor(0x0b0f14);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 1.6e8);
    this.camera.position.set(4800000, 2570000, 14720000);
    this.camera.lookAt(0, 0, 0);

    // Cinematic atmosphere: gradient sky + gentle depth haze.
    this.scene.background = this.makeSky();
    this.scene.fog = new FogExp2(0x9fb6cc, 0.000004);

    // Image-based lighting so the drone's glossy shell catches realistic reflections.
    const pmrem = new PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmrem.dispose();

    this.scene.add(new HemisphereLight(0xcfe2ff, 0x6b5a45, 1.0));
    this.scene.add(new AmbientLight(0xffffff, 0.28));
    const sun = new DirectionalLight(0xfff4e6, 2.6);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);

    this.scene.add(this.overlay);
    this.overlay.add(this.pathGroup, this.sitGroup, this.poiGroup, this.areaGroup, this.droneGroup, this.fxGroup);

    this.initTiles(apiKey);
    this.bindEvents();
    this.animate();
  }

  // ---------------------------------------------------------------- tiles
  private initTiles(apiKey: string) {
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new GLTFExtensionsPlugin({
      dracoLoader: new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/') as any,
    }));
    tiles.group.rotation.x = -Math.PI / 2;
    this.scene.add(tiles.group);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.setCamera(this.camera);
    tiles.addEventListener('load-tile-set', () => {
      if (this.ready) return;
      this.ready = true;
      this.cb.onReady?.();
      this.frame();
      this.rebuildAll();
    });
    tiles.addEventListener('load-error', (e: any) => {
      const url: string = e?.url || '';
      if (url.includes('googleapis.com') || /root\.json|3dtiles/.test(url))
        this.cb.onError?.('Google rejected the 3D Tiles request — check the API key, Map Tiles API and billing.');
    });
    this.tiles = tiles;
    this.controls = new GlobeControls(this.scene, this.camera, this.renderer.domElement, this.tiles);
    this.controls.enableDamping = true;
  }

  private toast(m: string) { this.cb.onToast?.(m); }

  // ---------------------------------------------------------------- geo helpers
  private sampleGround(lat: number, lon: number): number {
    if (!this.tiles) return 0;
    const o = geodeticToWorld(lat, lon, 6000, this.tiles.group);
    const up = geodeticToWorld(lat, lon, 7000, this.tiles.group).sub(o).normalize();
    this.raycaster.set(o, up.negate());
    this.raycaster.far = 14000;
    const h = this.raycaster.intersectObject(this.tiles.group, true);
    this.raycaster.far = Infinity;
    return h.length ? worldToGeodetic(h[0].point, this.tiles.group).height : 0;
  }
  private pickGround(cx: number, cy: number) {
    if (!this.tiles) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const h = this.raycaster.intersectObject(this.tiles.group, true);
    return h.length ? worldToGeodetic(h[0].point, this.tiles.group) : null;
  }

  // ---------------------------------------------------------------- events
  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', this.onDrop);
    window.addEventListener('resize', this.onResize);
  }
  private onResize = () => {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  };
  private onDown = (e: PointerEvent) => { this.downPt = { x: e.clientX, y: e.clientY }; this.downT = performance.now(); };
  private onUp = (e: PointerEvent) => {
    if (this.camMode !== 'orbit') return;
    if (Math.hypot(e.clientX - this.downPt.x, e.clientY - this.downPt.y) > 6 || performance.now() - this.downT > 500) return;
    const g = this.pickGround(e.clientX, e.clientY);
    if (!g) { if (this.tool !== 'orbit' || this.pendingPlace) this.toast('No surface under cursor — zoom into your area first'); return; }
    if (this.pendingPlace) { this.addSituation(this.pendingPlace, g.lat, g.lon); this.pendingPlace = null; return; }
    if (this.tool === 'path') this.scenario.path.push({ lat: g.lat, lon: g.lon, alt: this.scenario.defaultAlt });
    else if (this.tool === 'poi') this.scenario.pois.push({ id: uid(), lat: g.lat, lon: g.lon, alt: 20, label: 'POI ' + (this.scenario.pois.length + 1) });
    else if (this.tool === 'area') this.scenario.areas.push({ id: uid(), lat: g.lat, lon: g.lon, radius: 120, label: 'Geofence ' + (this.scenario.areas.length + 1) });
    else if (this.tool === 'drone') { this.scenario.drone.lat = g.lat; this.scenario.drone.lon = g.lon; this.rebuildAll(); this.reset(); return; }
    else return;
    this.rebuildAll();
  };
  private onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer?.getData('text/kind') as KindId | '';
    if (!kind) return;
    const g = this.pickGround(e.clientX, e.clientY);
    if (!g) { this.toast('Drop onto the map (zoom in if needed)'); return; }
    if ((kind as string) === 'drone') { this.scenario.drone.lat = g.lat; this.scenario.drone.lon = g.lon; this.rebuildAll(); }
    else this.addSituation(kind as KindId, g.lat, g.lon);
  };

  private addSituation(kind: KindId, lat: number, lon: number) {
    const k = KINDS[kind];
    this.scenario.situations.push({ id: uid(), kind, lat, lon, heading: 0, clearR: k.clearR, clearH: k.clearH, showClear: true, label: k.name });
    this.rebuildAll();
  }

  // ---------------------------------------------------------------- prims
  private makeAnchor(lat: number, lon: number, h: number): Group {
    const g = new Group();
    g.matrixAutoUpdate = false;
    localEnuFrame(lat, lon, h, this.tiles.group, g.matrix);
    g.matrixWorldNeedsUpdate = true;
    return g;
  }
  private disc(r: number, color: number, op: number, segs = 48) {
    return new Mesh(new CircleGeometry(r, segs), new MeshBasicMaterial({ color, transparent: true, opacity: op, side: DoubleSide, depthWrite: false }));
  }
  private ring(r: number, color: number) {
    const p: Vector3[] = [];
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; p.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
    return new LineLoop(new BufferGeometry().setFromPoints(p), new LineBasicMaterial({ color }));
  }
  private clearanceVolume(r: number, h: number, color: number, mode: string): Group {
    const grp = new Group();
    const geo = new CylinderGeometry(r, r, h, 48, 1, true);
    geo.rotateX(Math.PI / 2); geo.translate(0, 0, h / 2);
    grp.add(new Mesh(geo, new MeshBasicMaterial({ color, transparent: true, opacity: mode === 'ceiling' ? 0.07 : 0.12, side: DoubleSide, depthWrite: false })));
    grp.add(new Mesh(geo, new MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.3 })));
    const cap = this.disc(r, color, mode === 'ceiling' ? 0.18 : 0.1); cap.position.z = h; grp.add(cap);
    const tr = this.ring(r, color); tr.position.z = h; grp.add(tr);
    grp.add(this.ring(r, color));
    return grp;
  }

  private buildSituationMesh(kind: KindId): Group {
    const k = KINDS[kind], g = new Group();
    const mat = (c: number, e = 0) => new MeshStandardMaterial({ color: c, emissive: e, roughness: 0.7, metalness: 0.15 });
    const cyl = (rt: number, rb: number, h: number, c: number) => { const m = new Mesh(new CylinderGeometry(rt, rb, h, 12), mat(c)); m.rotation.x = Math.PI / 2; return m; };
    if (kind === 'helipad') {
      const pad = cyl(11, 11, 0.4, 0x222a33); pad.position.z = 0.2; g.add(pad);
      const t = new Mesh(new TorusGeometry(8, 0.4, 8, 40), mat(0xffd24d, 0x553300)); t.position.z = 0.5; g.add(t);
      ([[-3, 0, 1.4, 8], [3, 0, 1.4, 8], [0, 0, 5, 1.4]] as number[][]).forEach(([x, y, w, h]) => { const b = new Mesh(new BoxGeometry(w, h, 0.3), mat(0xffffff)); b.position.set(x, y, 0.6); g.add(b); });
    } else if (kind === 'towercrane') {
      const H = k.h!; const mast = new Mesh(new BoxGeometry(2.4, 2.4, H), mat(0xffb020)); mast.position.z = H / 2; g.add(mast);
      const jib = new Mesh(new BoxGeometry(70, 1.5, 1.5), mat(0xffcf5c)); jib.position.set(22, 0, H - 2); g.add(jib);
      const cjib = new Mesh(new BoxGeometry(20, 1.4, 1.4), mat(0xffcf5c)); cjib.position.set(-10, 0, H - 2); g.add(cjib);
      const cab = new Mesh(new BoxGeometry(3, 3, 3), mat(0x333333)); cab.position.set(2, 0, H - 4); g.add(cab);
      const hook = new Mesh(new BoxGeometry(0.4, 0.4, 5), mat(0x222222)); hook.position.set(40, 0, H - 10); g.add(hook);
    } else if (kind === 'mobilecrane') {
      const base = new Mesh(new BoxGeometry(8, 3.5, 2.4), mat(0xffb020)); base.position.z = 1.2; g.add(base);
      const boom = new Mesh(new BoxGeometry(2, 1.4, k.h!), mat(0xffcf5c)); boom.position.set(0, 0, k.h! / 2 + 2); boom.rotation.y = 0.5; g.add(boom);
    } else if (kind === 'excavator') {
      const tr = new Mesh(new BoxGeometry(6, 2.6, 1.4), mat(0x333333)); tr.position.z = 0.7; g.add(tr);
      const cab = new Mesh(new BoxGeometry(3.4, 2.4, 2.4), mat(0xffb020)); cab.position.set(-0.5, 0, 2.6); g.add(cab);
      const arm = new Mesh(new BoxGeometry(5, 0.8, 0.8), mat(0xffcf5c)); arm.position.set(2.5, 0, 3.2); arm.rotation.y = -0.6; g.add(arm);
    } else if (kind === 'comm') {
      const t = cyl(0.6, 2.5, k.h!, 0xb9c2cc); t.position.z = k.h! / 2; g.add(t);
      const b = new Mesh(new SphereGeometry(1.4, 12, 12), mat(0xff3030, 0x880000)); b.position.z = k.h!; g.add(b);
    } else if (kind === 'building') {
      const b = new Mesh(new BoxGeometry(18, 18, k.h!), mat(0x8893a0)); b.position.z = k.h! / 2; g.add(b);
    } else if (kind === 'powerline') {
      [-14, 14].forEach((x) => { const p = cyl(0.4, 0.5, k.h!, 0x8a939e); p.position.set(x, 0, k.h! / 2); g.add(p);
        const arm = new Mesh(new BoxGeometry(0.3, 5, 0.3), mat(0x555555)); arm.position.set(x, 0, k.h! - 2); g.add(arm); });
      [-2, 2].forEach((y) => { const w = new Mesh(new BoxGeometry(28, 0.12, 0.12), mat(0x222222)); w.position.set(0, y, k.h! - 2); g.add(w); });
    } else if (kind === 'tree') {
      const tr = cyl(0.6, 0.9, 8, 0x6b4a2b); tr.position.z = 4; g.add(tr);
      const cr = new Mesh(new SphereGeometry(5, 12, 12), mat(0x3f7d3f)); cr.scale.z = 1.2; cr.position.z = 11; g.add(cr);
    } else if (kind === 'crowd') {
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, rr = 4 + Math.random() * 6;
        const b = new Mesh(new CapsuleGeometry(0.5, 1.1, 4, 6), mat(0xff7ad1)); b.rotation.x = Math.PI / 2; b.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 1); g.add(b); }
    } else if (kind === 'birds') {
      for (let i = 0; i < 6; i++) { const w = new Mesh(new BoxGeometry(3, 0.4, 0.1), mat(0x333333)); w.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, k.clearH * 0.5 + Math.random() * 20); w.rotation.z = Math.random(); g.add(w); }
    } else if (kind === 'airport') {
      const t = cyl(1, 4, 18, 0xff4d4d); t.position.z = 9; g.add(t);
      const b = new Mesh(new SphereGeometry(2, 12, 12), mat(0xff3030, 0x880000)); b.position.z = 18; g.add(b);
    } else if (kind === 'restricted' || kind === 'controlled' || kind === 'stadium') {
      const post = cyl(0.5, 0.5, 8, k.color); post.position.z = 4; g.add(post);
      const sign = new Mesh(new CircleGeometry(2.4, 32), new MeshStandardMaterial({ color: k.color, side: DoubleSide })); sign.position.z = 8; g.add(sign);
    }
    return g;
  }

  /** Vertical gradient sky as a canvas texture, for a cinematic backdrop. */
  private makeSky(): Texture {
    const c = document.createElement('canvas'); c.width = 8; c.height = 256; const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0b1a2e'); g.addColorStop(0.45, '#1d4e7a'); g.addColorStop(0.8, '#6fa7cf'); g.addColorStop(1, '#cfe2ef');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 256);
    const tex = new CanvasTexture(c); tex.needsUpdate = true; return tex;
  }

  /** Soft radial contact shadow that sits on the ground beneath the aircraft. */
  private buildShadowBlob(): Mesh {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const tex = new CanvasTexture(c);
    const m = new Mesh(new CircleGeometry(3, 32), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    return m;
  }

  /** Built-in animated DJI Mavic 3 Pro–style model (local ENU, +X forward, Z up). */
  private buildDrone(): Group {
    const g = new Group(); this.rotors = [];
    const shell = (c: number, r = 0.38, m = 0.55) => new MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 1.1 });
    const flat = (c: number, e = 0) => new MeshStandardMaterial({ color: c, emissive: e, roughness: 0.55, metalness: 0.2 });
    const DARK = 0x4c535b, LIGHT = 0x9aa2aa, BLACK = 0x15181c, GLASS = 0x0a1c2c;

    // Fuselage — flattened, tapered grey body.
    const core = new Mesh(new BoxGeometry(3.2, 1.7, 0.55), shell(DARK)); core.position.z = 0.3; g.add(core);
    const deck = new Mesh(new BoxGeometry(2.6, 1.5, 0.12), shell(LIGHT)); deck.position.z = 0.62; g.add(deck);
    const nose = new Mesh(new BoxGeometry(1.0, 1.3, 0.42), shell(DARK)); nose.position.set(1.7, 0, 0.28); nose.rotation.y = -0.18; g.add(nose);
    const tail = new Mesh(new BoxGeometry(0.8, 1.2, 0.4), shell(BLACK)); tail.position.set(-1.7, 0, 0.3); g.add(tail);

    // Hasselblad-style gimbal with twin lenses, slung under the nose.
    const gimbal = new Mesh(new BoxGeometry(0.8, 1.05, 0.62), flat(BLACK)); gimbal.position.set(1.85, 0, 0.05); g.add(gimbal);
    const lens = (y: number, r: number) => {
      const barrel = new Mesh(new CylinderGeometry(r, r, 0.32, 20), flat(0x202327)); barrel.rotation.z = Math.PI / 2; barrel.position.set(2.18, y, 0.05); g.add(barrel);
      const glass = new Mesh(new CircleGeometry(r * 0.82, 20), new MeshStandardMaterial({ color: GLASS, emissive: 0x12406a, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.4 }));
      glass.rotation.y = Math.PI / 2; glass.position.set(2.35, y, 0.05); g.add(glass);
    };
    lens(0.28, 0.3); lens(-0.3, 0.2);

    // Four folding arms (front pair forward, rear pair back) + motors + spinning props.
    const arms: [number, number, number][] = [[1.0, 0.8, 0.55], [1.0, -0.8, 0.55], [-1.0, 0.8, 0.55], [-1.0, -0.8, 0.55]];
    arms.forEach(([sx, sy]) => {
      const ang = Math.atan2(sy, sx);
      const arm = new Mesh(new BoxGeometry(1.7, 0.16, 0.16), shell(BLACK, 0.6, 0.3));
      arm.position.set(sx * 0.95, sy * 0.6, 0.42); arm.rotation.z = ang; g.add(arm);
      const ex = sx * 1.7, ey = sy * 1.25;
      const motor = new Mesh(new CylinderGeometry(0.24, 0.26, 0.32, 16), shell(LIGHT, 0.3, 0.7)); motor.rotation.x = Math.PI / 2; motor.position.set(ex, ey, 0.5); g.add(motor);
      const cap = new Mesh(new CylinderGeometry(0.12, 0.12, 0.08, 12), flat(0xc23030, 0x300000)); cap.rotation.x = Math.PI / 2; cap.position.set(ex, ey, 0.68); g.add(cap);
      const prop = new Group(); prop.position.set(ex, ey, 0.66); g.add(prop);
      const disc = new Mesh(new CircleGeometry(1.5, 28), new MeshBasicMaterial({ color: 0xaecbe6, transparent: true, opacity: 0.16, side: DoubleSide, depthWrite: false }));
      prop.add(disc);
      [0, Math.PI].forEach((a) => { const blade = new Mesh(new BoxGeometry(2.9, 0.16, 0.03), flat(0x0f1115)); blade.rotation.z = a; prop.add(blade); });
      (prop as any).userData.disc = disc.material;
      this.rotors.push(prop);
    });

    // Landing feet.
    [[1.2, 0.7], [1.2, -0.7], [-1.2, 0.7], [-1.2, -0.7]].forEach(([fx, fy]) => {
      const leg = new Mesh(new BoxGeometry(0.1, 0.1, 0.5), flat(BLACK)); leg.position.set(fx, fy, 0.02); g.add(leg);
    });

    // Status LEDs: front white, rear red, belly green (the belly one pulses).
    const mkLed = (x: number, y: number, z: number, col: number, em: number) => {
      const l = new Mesh(new SphereGeometry(0.13, 10, 10), new MeshStandardMaterial({ color: col, emissive: em, emissiveIntensity: 1 })); l.position.set(x, y, z); g.add(l); return l;
    };
    mkLed(1.7, 0.85, 0.5, 0xffffff, 0xffffff); mkLed(1.7, -0.85, 0.5, 0xffffff, 0xffffff);
    mkLed(-1.7, 0.85, 0.5, 0xff2222, 0x660000); mkLed(-1.7, -0.85, 0.5, 0xff2222, 0x660000);
    const belly = mkLed(0, 0, 0.0, 0x2bd67b, 0x0a7a3a);

    const lift = new Group(); // carries the hover bob; reparent all parts into it
    while (g.children.length) lift.add(g.children[0]);
    g.add(lift);
    this.droneLift = lift;
    (g as any).userData.belly = belly;
    return g;
  }
  private setAlert(bad: boolean) {
    if (!this.droneMesh) return;
    const l = (this.droneMesh as any).userData.belly as Mesh | undefined;
    if (!l) return;
    const m = l.material as MeshStandardMaterial;
    m.color.set(bad ? 0xff4d4d : 0x2bd67b); m.emissive.set(bad ? 0x880000 : 0x0a7a3a);
  }

  // ---------------------------------------------------------------- labels
  private labelSprite(text: string, color = '#e7eef6', bg = 'rgba(10,16,22,.82)'): Sprite {
    const pad = 10, fs = 40, c = document.createElement('canvas'), ctx = c.getContext('2d')!;
    ctx.font = `600 ${fs}px system-ui,sans-serif`; const w = ctx.measureText(text).width;
    c.width = w + pad * 2; c.height = fs + pad * 2; ctx.font = `600 ${fs}px system-ui,sans-serif`;
    ctx.fillStyle = bg; this.rr(ctx, 0, 0, c.width, c.height, 12); ctx.fill();
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, pad, c.height / 2);
    const tex = new CanvasTexture(c); tex.anisotropy = 4;
    const sp = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    (sp as any).userData.aspect = c.width / c.height; sp.scale.set(c.width / c.height, 1, 1);
    this.sprites.push(sp);
    return sp;
  }
  private rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  private clearGroup(g: Group) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      c.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.()); });
      g.remove(c);
    }
  }

  // ---------------------------------------------------------------- rebuild
  private pathWorldPoints(): Vector3[] {
    return this.scenario.path.map((w) => {
      const gh = w._gh ?? (w._gh = this.sampleGround(w.lat, w.lon));
      return geodeticToWorld(w.lat, w.lon, gh + w.alt, this.tiles.group);
    });
  }
  private rebuildPath() {
    this.clearGroup(this.pathGroup);
    this.sprites = this.sprites.filter((s) => s.parent);
    if (!this.tiles) return;
    const pts = this.pathWorldPoints();
    this.scenario.path.forEach((w, i) => {
      const gh = w._gh ?? this.sampleGround(w.lat, w.lon);
      const wp = geodeticToWorld(w.lat, w.lon, gh + w.alt, this.tiles.group);
      const base = geodeticToWorld(w.lat, w.lon, gh, this.tiles.group);
      this.pathGroup.add(new Line(new BufferGeometry().setFromPoints([wp, base]),
        new LineDashedMaterial({ color: 0x39b6ff, transparent: true, opacity: 0.5, dashSize: 4, gapSize: 3 })).computeLineDistances());
      const m = new Mesh(new SphereGeometry(2.4, 16, 16), new MeshStandardMaterial({ color: i === 0 ? 0x2bd67b : 0x39b6ff, emissive: i === 0 ? 0x0a7a3a : 0x06384f }));
      m.position.copy(wp); this.pathGroup.add(m);
      const sp = this.labelSprite('WP' + (i + 1), '#cfe9ff'); sp.position.copy(wp); this.pathGroup.add(sp);
    });
    if (pts.length >= 2) {
      this.pathGroup.add(new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: 0x39b6ff })));
      try {
        const curve = new CatmullRomCurve3(pts);
        this.pathGroup.add(new Mesh(new TubeGeometry(curve, Math.max(20, pts.length * 8), 4, 8, false),
          new MeshBasicMaterial({ color: 0x39b6ff, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false })));
      } catch { /* short paths */ }
    }
  }
  private rebuildSituations() {
    this.clearGroup(this.sitGroup);
    if (!this.tiles) return;
    this.scenario.situations.forEach((s) => {
      const k = KINDS[s.kind]; const gh = this.sampleGround(s.lat, s.lon); const a = this.makeAnchor(s.lat, s.lon, gh);
      const inner = new Group(); inner.rotation.z = (s.heading || 0) * MathUtils.DEG2RAD; inner.add(this.buildSituationMesh(s.kind)); a.add(inner);
      if (this.showClearance && s.showClear) a.add(this.clearanceVolume(s.clearR, s.clearH, k.color, k.mode));
      const sp = this.labelSprite(`${k.ic} ${s.label || k.name}`); sp.position.set(0, 0, (k.h || 6) + 8); a.add(sp);
      this.sitGroup.add(a);
    });
  }
  private rebuildPois() {
    this.clearGroup(this.poiGroup);
    if (!this.tiles) return;
    this.scenario.pois.forEach((p) => {
      const gh = this.sampleGround(p.lat, p.lon); const a = this.makeAnchor(p.lat, p.lon, gh);
      const pin = new Mesh(new ConeGeometry(2, 6, 16), new MeshStandardMaterial({ color: 0xffd24d, emissive: 0x553300 })); pin.rotation.x = Math.PI; pin.position.z = p.alt || 10; a.add(pin);
      a.add(new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, (p.alt || 10) - 3)]), new LineBasicMaterial({ color: 0xffd24d })));
      const sp = this.labelSprite('📍 ' + (p.label || 'POI'), '#ffe9b0'); sp.position.set(0, 0, (p.alt || 10) + 5); a.add(sp);
      this.poiGroup.add(a);
    });
  }
  private rebuildAreas() {
    this.clearGroup(this.areaGroup);
    if (!this.tiles) return;
    this.scenario.areas.forEach((ar) => {
      const gh = this.sampleGround(ar.lat, ar.lon); const a = this.makeAnchor(ar.lat, ar.lon, gh + 1);
      a.add(this.disc(ar.radius, 0x2bd67b, 0.1)); a.add(this.ring(ar.radius, 0x2bd67b));
      const sp = this.labelSprite('⭕ ' + (ar.label || 'Area') + ` · ${Math.round(ar.radius)}m`, '#bff3d6'); sp.position.set(0, 0, 8); a.add(sp);
      this.areaGroup.add(a);
    });
  }
  private rebuildDrone() {
    this.clearGroup(this.droneGroup); this.droneMesh = null; this.droneAnchor = null; this.droneLift = null;
    this.shadowBlob = null; this.mixer = null;
    if (!this.tiles) return;
    const d = this.scenario.drone;
    if (d.lat == null || d.lon == null) return;
    const gh = this.sampleGround(d.lat, d.lon);
    this.shadowAlt = this.scenario.defaultAlt;
    this.droneAnchor = this.makeAnchor(d.lat, d.lon, gh + this.scenario.defaultAlt);
    // ground contact shadow lives in the anchor, dropped to the ground each frame
    this.shadowBlob = this.buildShadowBlob(); this.shadowBlob.position.z = -this.scenario.defaultAlt; this.droneAnchor.add(this.shadowBlob);

    if (this.droneModelUrl) {
      // custom GLB hero model (e.g. a downloaded Mavic 3 Pro)
      const placeholder = new Group(); placeholder.scale.setScalar(d.scale); this.droneAnchor.add(placeholder); this.droneMesh = placeholder;
      this.loadGlbInto(placeholder, this.droneModelUrl);
    } else {
      this.droneMesh = this.buildDrone(); this.droneMesh.scale.setScalar(d.scale); this.droneAnchor.add(this.droneMesh);
    }
    this.droneGroup.add(this.droneAnchor);
  }

  private loadGlbInto(parent: Group, url: string) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/'); loader.setDRACOLoader(draco);
    loader.load(url, (gltf) => {
      if (this.droneMesh !== parent) return; // drone was rebuilt while loading
      const model = gltf.scene;
      // normalize: fit to ~3.5 m, orient Y-up models into our Z-up ENU frame (+X forward)
      const box = new Box3().setFromObject(model);
      const size = new Vector3(); box.getSize(size); const center = new Vector3(); box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.position.sub(center); model.scale.setScalar(3.5 / maxDim);
      const wrap = new Group(); wrap.rotation.x = Math.PI / 2; // Y-up -> Z-up
      wrap.add(model); parent.add(wrap);
      this.droneLift = parent; // bob the whole imported craft
      this.rotors = []; // imported model: rely on its own clips / hover instead of procedural rotor spin
      model.traverse((o: any) => { if (o.isMesh && o.material) o.material.envMapIntensity = 1.1; });
      if (gltf.animations?.length) { this.mixer = new AnimationMixer(model); gltf.animations.forEach((c) => this.mixer!.clipAction(c).play()); }
      this.toast('Custom drone model loaded');
    }, undefined, () => {
      this.toast('Could not load that model — keeping the built-in drone');
      this.droneModelUrl = null;
      this.rebuildDrone();
    });
  }
  private rebuildAll() {
    this.rebuildPath(); this.rebuildSituations(); this.rebuildPois(); this.rebuildAreas(); this.rebuildDrone();
    this.buildSimPath(); this.runSafety();
    this.cb.onScenarioChange?.(this.scenario);
  }

  // ---------------------------------------------------------------- safety
  private runSafety() {
    const f: SafetyFinding[] = [], p = this.scenario.path;
    const maxAlt = Math.max(0, ...p.map((w) => w.alt));
    if (maxAlt > 120) f.push({ lvl: 'warn', msg: `Peak altitude ${Math.round(maxAlt)} m AGL exceeds the 120 m (400 ft) Part 107 ceiling.` });
    if (p.length >= 2) {
      const dense: { lat: number; lon: number; alt: number }[] = [];
      for (let i = 0; i < p.length - 1; i++) { const A = p[i], B = p[i + 1]; for (let t = 0; t < 1; t += 0.08) dense.push({ lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (B.lon - A.lon) * t, alt: A.alt + (B.alt - A.alt) * t }); }
      dense.push(p[p.length - 1]);
      this.scenario.situations.forEach((s) => {
        const k = KINDS[s.kind]; let minH = Infinity, breach = false, ceilBust = false;
        dense.forEach((d) => { const dist = distMeters(d.lat, d.lon, s.lat, s.lon); minH = Math.min(minH, dist);
          if (dist < s.clearR) { if (k.mode === 'ceiling') { if (d.alt > s.clearH) ceilBust = true; } else if (d.alt < s.clearH) breach = true; } });
        if (k.mode === 'ceiling' && ceilBust) f.push({ lvl: 'bad', msg: `Path exceeds the ${s.clearH} m ceiling inside ${s.label || k.name} — requires LAANC authorization.` });
        else if (breach && k.mode === 'restricted') f.push({ lvl: 'bad', msg: `Path enters ${s.label || k.name} restricted airspace/zone.` });
        else if (breach && k.mode === 'obstacle') f.push({ lvl: 'bad', msg: `Path violates clearance around ${s.label || k.name} (within ${s.clearR} m & below ${s.clearH} m).` });
        else if (breach && k.mode === 'hazard') f.push({ lvl: 'warn', msg: `Path crosses ${s.label || k.name} hazard area — heightened vigilance advised.` });
        else if (k.mode === 'obstacle' && minH < s.clearR * 1.6) f.push({ lvl: 'warn', msg: `Path passes close to ${s.label || k.name} (${Math.round(minH)} m horizontal).` });
      });
    } else if (p.length === 1) f.push({ lvl: 'warn', msg: 'Add at least 2 waypoints to define a flight path.' });
    if (p.length > 0 && !this.scenario.situations.some((s) => s.kind === 'helipad')) f.push({ lvl: 'warn', msg: 'No helipad / landing zone set — define a takeoff & RTH point.' });
    this.safetyFindings = f;
    this.emitSafety();
  }
  private emitSafety() {
    const live: SafetyFinding[] = [...this.simViolations].map((m) => ({ lvl: 'bad' as const, msg: 'LIVE: ' + m }));
    this.cb.onSafety?.([...live, ...this.safetyFindings]);
  }

  // ---------------------------------------------------------------- sim
  private buildSimPath() {
    if (!this.tiles) return;
    this.sim.pts = this.pathWorldPoints();
    this.sim.geo = this.scenario.path.map((w) => ({ lat: w.lat, lon: w.lon, alt: w.alt, gh: w._gh ?? this.sampleGround(w.lat, w.lon) }));
    this.sim.cum = [0]; this.sim.total = 0;
    for (let i = 1; i < this.sim.pts.length; i++) { this.sim.total += this.sim.pts[i].distanceTo(this.sim.pts[i - 1]); this.sim.cum.push(this.sim.total); }
  }
  reset() {
    this.sim.playing = false; this.sim.elapsed = 0; this.sim.dist = 0; this.sim.batt = 100; this.simViolations.clear();
    this.crash.active = false; this.cb.onDebrief?.(null);
    this.buildSimPath();
    if (this.droneMesh) this.droneMesh.rotation.set(0, 0, 0);
    this.placeDroneAtDistance(0);
    this.setAlert(false); this.emitSafety(); this.emitTelemetry('IDLE');
  }
  play() {
    if (this.scenario.path.length < 2) { this.toast('Draw a flight path first (✏️)'); return; }
    if (this.crash.active) this.reset();
    this.buildSimPath(); this.sim.playing = true; this.emitTelemetry('● FLYING');
  }
  pause() { this.sim.playing = false; this.emitTelemetry('PAUSED'); }
  setRate(r: number) { this.sim.rate = r; }
  setCrashEnabled(b: boolean) { this.crashEnabled = b; }

  private placeDroneAtDistance(dist: number) {
    if (!this.sim.pts.length || !this.droneAnchor) return;
    dist = Math.max(0, Math.min(dist, this.sim.total));
    let i = 1; while (i < this.sim.cum.length && this.sim.cum[i] < dist) i++;
    const a = this.sim.pts[i - 1], b = this.sim.pts[i] || a;
    const segLen = (this.sim.cum[i] ?? this.sim.total) - this.sim.cum[i - 1] || 1;
    const t = Math.min(1, (dist - this.sim.cum[i - 1]) / segLen);
    const pos = a.clone().lerp(b, t);
    const ga = this.sim.geo[i - 1], gb = this.sim.geo[i] || ga;
    const curLat = ga.lat + (gb.lat - ga.lat) * t, curLon = ga.lon + (gb.lon - ga.lon) * t, curAlt = ga.alt + (gb.alt - ga.alt) * t;
    localEnuFrame(curLat, curLon, this.sim.geo[0].gh + curAlt, this.tiles.group, this.droneAnchor.matrix); this.droneAnchor.matrixWorldNeedsUpdate = true;
    const { mLat, mLon } = metersPerDegree(curLat); const vE = (gb.lon - ga.lon) * mLon, vN = (gb.lat - ga.lat) * mLat;
    if (this.droneMesh && (vE || vN)) this.droneMesh.rotation.z = Math.atan2(vN, vE);
    this.sim._lat = curLat; this.sim._lon = curLon; this.sim._alt = curAlt; this.sim._pos = pos; this.shadowAlt = curAlt;
    this.sim._up = geodeticToWorld(curLat, curLon, this.sim.geo[0].gh + curAlt + 10, this.tiles.group).sub(pos).normalize();
    this.sim._dir = b.clone().sub(a); if (this.sim._dir.lengthSq() < 1e-6) this.sim._dir = this.sim._up.clone(); this.sim._dir.normalize();
    this.simViolations.clear(); let hit: Situation | null = null;
    this.scenario.situations.forEach((s) => {
      const k = KINDS[s.kind]; const d = distMeters(curLat, curLon, s.lat, s.lon);
      if (d < s.clearR) {
        if (k.mode === 'obstacle' && curAlt < s.clearH) { this.simViolations.add('COLLISION RISK — ' + (s.label || k.name)); if (d < s.clearR * 0.55) hit = s; }
        else if (k.mode === 'restricted' && curAlt < s.clearH) this.simViolations.add('In restricted zone — ' + (s.label || k.name));
        else if (k.mode === 'ceiling' && curAlt > s.clearH) this.simViolations.add('Above LAANC ceiling — ' + (s.label || k.name));
        else if (k.mode === 'hazard') this.simViolations.add('In hazard area — ' + (s.label || k.name));
      }
    });
    this.setAlert(this.simViolations.size > 0);
    if (hit && this.crashEnabled && this.sim.playing && !this.crash.active) this.triggerCrash(hit);
  }

  private triggerCrash(s: Situation) {
    this.crash.active = true; this.sim.playing = false; this.crash.t = 0; this.crash.grounded = false;
    this.crash.pos = this.sim._pos!.clone();
    this.crash.vel = this.sim._dir.clone().multiplyScalar(8).add(this.sim._up.clone().multiplyScalar(4));
    this.crash.spin = new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    this.crash.groundH = this.sampleGround(this.sim._lat!, this.sim._lon);
    this.emitTelemetry('💥 CRASH');
    const k = KINDS[s.kind];
    this.cb.onDebrief?.({
      title: '💥 COLLISION — ' + (s.label || k.name),
      cause: `The flight path violated the clearance volume of ${s.label || k.name} (standoff ${s.clearR} m / ${s.clearH} m). At this speed the aircraft could not avoid the obstacle.`,
      steps: [
        'Stay calm — if airborne, immediately reduce throttle and arrest the descent if any control remains.',
        'Call out the emergency to your visual observer / crew and clear the area below the aircraft.',
        'If contact is unavoidable, cut motor power to minimise injury and damage on impact.',
        'After impact: secure the area, do not approach spinning props, disconnect the battery (LiPo fire risk).',
        'Document the site; notify the FAA if injury or >$500 damage occurred (Part 107 accident reporting, within 10 days).',
        'Debrief: what clearance was missed? Update your pre-flight survey, geofence and obstacle standoffs.',
      ],
    });
  }
  private spawnSmoke(pos: Vector3) {
    const m = new Mesh(new SphereGeometry(1 + Math.random() * 1.5, 8, 8), new MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.6 }));
    m.position.copy(pos); (m as any).userData.life = 0; this.fxGroup.add(m);
  }

  // ---------------------------------------------------------------- cameras
  setCam(m: CamMode) {
    this.camMode = m;
    this.controls.enabled = m === 'orbit';
    this.cb.onCam?.(m);
    if (m === 'ground' && this.sim._lat != null) {
      const { mLat, mLon } = metersPerDegree(this.sim._lat);
      this.groundObs = { lat: this.sim._lat - 40 / mLat, lon: this.sim._lon - 40 / mLon };
    }
  }
  private updateCamera() {
    if (this.camMode === 'orbit' || this.sim._pos == null) return;
    if (this.camMode === 'fpv') {
      const eye = this.sim._pos.clone().add(this.sim._up.clone().multiplyScalar(0.5 * this.scenario.drone.scale));
      const look = eye.clone().add(this.sim._dir.clone().multiplyScalar(120));
      this.camera.position.copy(eye); this.camera.up.copy(this.sim._up); this.camera.lookAt(look); this.camera.fov = 78; this.camera.updateProjectionMatrix();
    } else if (this.camMode === 'ground') {
      if (!this.groundObs) { const { mLat, mLon } = metersPerDegree(this.sim._lat!); this.groundObs = { lat: this.sim._lat! - 40 / mLat, lon: this.sim._lon - 40 / mLon }; }
      const gh = this.sampleGround(this.groundObs.lat, this.groundObs.lon);
      const eye = geodeticToWorld(this.groundObs.lat, this.groundObs.lon, gh + 1.7, this.tiles.group);
      const up = geodeticToWorld(this.groundObs.lat, this.groundObs.lon, gh + 10, this.tiles.group).sub(eye).normalize();
      this.camera.position.copy(eye); this.camera.up.copy(up); this.camera.lookAt(this.sim._pos); this.camera.fov = 42; this.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- loop
  private animate = () => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.animate);
    const now = performance.now(); const dt = Math.min(0.05, (now - this.lastTime) / 1000); this.lastTime = now;
    if (this.controls && this.camMode === 'orbit') this.controls.update();
    if (this.tiles) { this.camera.updateMatrixWorld(); this.tiles.setResolutionFromRenderer(this.camera, this.renderer); this.tiles.update(); }

    const flying = this.sim.playing || this.crash.active;
    const spin = flying ? 1 : 0.18;
    this.rotors.forEach((r, i) => {
      r.rotation.z += (i % 2 ? 1 : -1) * spin * 1.4;
      const dm = (r as any).userData.disc as MeshBasicMaterial | undefined;
      if (dm) dm.opacity = flying ? 0.26 : 0.12;
    });
    if (this.mixer) this.mixer.update(dt);

    // idle hover bob + gentle LED pulse — the "alive", mesmerizing feel
    this.bob += dt;
    if (this.droneLift && !this.crash.active) this.droneLift.position.z = Math.sin(this.bob * 1.6) * 0.18;
    const belly = this.droneMesh ? (this.droneMesh as any).userData?.belly as Mesh | undefined : undefined;
    if (belly && this.simViolations.size === 0) ((belly.material as MeshStandardMaterial).emissiveIntensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(this.bob * 4)));

    // keep the contact shadow on the ground, growing/softening with altitude
    if (this.shadowBlob) {
      this.shadowBlob.position.z = -this.shadowAlt;
      this.shadowBlob.scale.setScalar(Math.max(1, 1 + this.shadowAlt / 30));
      (this.shadowBlob.material as MeshBasicMaterial).opacity = Math.max(0.08, 0.5 - this.shadowAlt / 260);
    }

    if (this.sim.playing) {
      this.sim.dist += this.scenario.speed * this.sim.rate * dt; this.sim.elapsed += dt; this.sim.batt = Math.max(0, 100 - this.sim.elapsed * this.sim.rate * 0.25);
      if (this.sim.dist >= this.sim.total) { this.sim.dist = this.sim.total; this.sim.playing = false; this.emitTelemetry('✓ ARRIVED'); this.toast('Mission complete'); }
      this.placeDroneAtDistance(this.sim.dist);
      if (this.simViolations.size) this.emitSafety();
      this.emitTelemetry(this.sim.playing ? '● FLYING' : undefined);
    }

    if (this.crash.active && !this.crash.grounded && this.droneAnchor) {
      this.crash.t += dt; this.crash.vel.add(this.sim._up.clone().multiplyScalar(-9.8 * dt));
      this.crash.pos.add(this.crash.vel.clone().multiplyScalar(dt));
      const geo = worldToGeodetic(this.crash.pos, this.tiles.group);
      if (geo.height <= this.crash.groundH + 1) { this.crash.grounded = true; this.emitTelemetry('💥 DOWN'); }
      localEnuFrame(geo.lat, geo.lon, Math.max(geo.height, this.crash.groundH + 0.5), this.tiles.group, this.droneAnchor.matrix); this.droneAnchor.matrixWorldNeedsUpdate = true;
      if (this.droneMesh) { this.droneMesh.rotation.x += this.crash.spin.x * dt; this.droneMesh.rotation.y += this.crash.spin.y * dt; this.droneMesh.rotation.z += this.crash.spin.z * dt; }
      if (Math.random() < 0.4) this.spawnSmoke(this.crash.pos);
      this.sim._pos = this.crash.pos.clone();
    }

    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const m = this.fxGroup.children[i] as Mesh; const ud = (m as any).userData; ud.life += dt; m.scale.multiplyScalar(1 + dt * 0.8);
      const mat = m.material as MeshBasicMaterial; mat.opacity -= dt * 0.35;
      if (mat.opacity <= 0) { m.geometry.dispose(); mat.dispose(); this.fxGroup.remove(m); }
    }

    this.updateCamera();

    const tmp = new Vector3();
    this.sprites.forEach((sp) => { if (!sp.parent) return; sp.getWorldPosition(tmp); const d = tmp.distanceTo(this.camera.position); const sc = Math.max(6, d * 0.022); sp.scale.set(sc * ((sp as any).userData.aspect || 3), sc, 1); });

    this.renderer.render(this.scene, this.camera);
  };

  private emitTelemetry(state?: string) {
    const rate = this.sim.rate;
    this.cb.onTelemetry?.({
      state: state ?? (this.sim.playing ? '● FLYING' : 'IDLE'),
      alt: this.sim._alt, speed: this.sim.playing ? this.scenario.speed * rate : 0,
      dist: this.sim.dist, total: this.sim.total,
      eta: this.sim.total > 0 ? (this.sim.total - this.sim.dist) / Math.max(0.1, this.scenario.speed * rate) : 0,
      battery: this.sim.batt,
    });
  }

  // ---------------------------------------------------------------- public mutations
  getScenario() { return this.scenario; }
  setTool(t: Tool) { this.tool = t; this.pendingPlace = null; }
  setPendingPlace(k: KindId) { this.pendingPlace = k; this.tool = 'orbit'; }
  setShowClearance(v: boolean) { this.showClearance = v; this.rebuildSituations(); this.cb.onScenarioChange?.(this.scenario); }
  toggleClearance() { this.setShowClearance(!this.showClearance); return this.showClearance; }
  getShowClearance() { return this.showClearance; }

  undoWaypoint() { if (this.scenario.path.length) { this.scenario.path.pop(); this.rebuildAll(); } }
  clearPath() { this.scenario.path = []; this.rebuildAll(); }
  addRthLeg() { const f = this.scenario.path[0]; if (f) { this.scenario.path.push({ lat: f.lat, lon: f.lon, alt: f.alt }); this.rebuildAll(); } }
  setSpeed(v: number) { this.scenario.speed = v; this.buildSimPath(); this.emitTelemetry(); this.cb.onScenarioChange?.(this.scenario); }
  setDefaultAlt(v: number) { this.scenario.defaultAlt = v; this.cb.onScenarioChange?.(this.scenario); }
  setDroneScale(v: number) { this.scenario.drone.scale = v; if (this.droneMesh) this.droneMesh.scale.setScalar(v); this.cb.onScenarioChange?.(this.scenario); }
  /** Swap in a custom drone GLB (e.g. a downloaded Mavic 3 Pro). Pass null to return to the built-in model. */
  setDroneModelUrl(url: string | null) { this.droneModelUrl = url; this.scenario.drone.modelUrl = url; this.rebuildDrone(); this.cb.onScenarioChange?.(this.scenario); }
  loadDroneModelFile(file: File) { this.setDroneModelUrl(URL.createObjectURL(file)); }
  hasCustomModel() { return !!this.droneModelUrl; }
  updateWaypointAlt(i: number, alt: number) { const w = this.scenario.path[i]; if (w) { w.alt = alt; w._gh = undefined; this.rebuildAll(); } }
  removeWaypoint(i: number) { this.scenario.path.splice(i, 1); this.rebuildAll(); }
  updateSituation(id: string, patch: Partial<Situation>) { const s = this.scenario.situations.find((x) => x.id === id); if (s) { Object.assign(s, patch); this.rebuildAll(); } }
  removeSituation(id: string) { this.scenario.situations = this.scenario.situations.filter((s) => s.id !== id); this.rebuildAll(); }
  updatePoi(id: string, patch: any) { const p = this.scenario.pois.find((x) => x.id === id); if (p) { Object.assign(p, patch); this.rebuildAll(); } }
  removePoi(id: string) { this.scenario.pois = this.scenario.pois.filter((p) => p.id !== id); this.rebuildAll(); }
  updateArea(id: string, patch: any) { const a = this.scenario.areas.find((x) => x.id === id); if (a) { Object.assign(a, patch); this.rebuildAll(); } }
  removeArea(id: string) { this.scenario.areas = this.scenario.areas.filter((a) => a.id !== id); this.rebuildAll(); }

  loadScenarioData(s: Scenario) {
    this.scenario = s;
    this.droneModelUrl = s.drone.modelUrl ?? null;
    this.scenario.path.forEach((w) => (w._gh = undefined));
    if (this.ready) { this.rebuildAll(); this.frame(); this.reset(); }
  }

  loadTrainingScenario(index: number): Debrief | null {
    const c = this.scenarioCentroid() || this.pickGroundCenter();
    if (!c) { this.toast('Search a location first, then load the scenario'); return null; }
    const s = SCENARIOS[index]; const { mLat, mLon } = metersPerDegree(c.lat); const dN = (m: number) => m / mLat, dE = (m: number) => m / mLon;
    const data = s.build(c, dN, dE);
    this.scenario.path = data.path.map((w) => ({ ...w, _gh: undefined }));
    this.scenario.situations = data.sit.map(([kind, n, e, extra]) => {
      const k = KINDS[kind];
      return { id: uid(), kind, lat: c.lat + dN(n), lon: c.lon + dE(e), heading: extra?.heading || 0, clearR: extra?.clearR ?? k.clearR, clearH: extra?.clearH ?? k.clearH, showClear: true, label: extra?.label || k.name };
    });
    this.scenario.drone.lat = c.lat; this.scenario.drone.lon = c.lon; this.scenario.pois = []; this.scenario.areas = [];
    this.rebuildAll(); this.frame(); this.reset();
    return { title: s.icon + ' ' + s.title, cause: s.brief, accent: true, steps: [
      'Review the hazards & clearance volumes shown on the map.',
      'Adjust the path until the Safety panel is clear.',
      'Press ▶ Fly and watch from FPV / Ground cameras.',
      'Leave 💥 crash-sim on to see the consequence of a bad path.',
    ] };
  }

  // ---------------------------------------------------------------- navigation
  private scenarioCentroid(): { lat: number; lon: number } | null {
    const all: { lat: number; lon: number }[] = [...this.scenario.path, ...this.scenario.situations, ...this.scenario.pois, ...this.scenario.areas];
    if (this.scenario.drone.lat != null) all.push({ lat: this.scenario.drone.lat, lon: this.scenario.drone.lon! });
    if (!all.length) return null;
    return { lat: all.reduce((a, b) => a + b.lat, 0) / all.length, lon: all.reduce((a, b) => a + b.lon, 0) / all.length };
  }
  private pickGroundCenter(): { lat: number; lon: number } | null {
    if (!this.tiles) return null;
    this.raycaster.setFromCamera(new Vector2(0, 0), this.camera);
    const h = this.raycaster.intersectObject(this.tiles.group, true);
    return h.length ? worldToGeodetic(h[0].point, this.tiles.group) : null;
  }
  flyTo(lat: number, lon: number, height = 900) {
    if (!this.tiles) return;
    this.setCam('orbit');
    const g = this.sampleGround(lat, lon);
    const target = geodeticToWorld(lat, lon, g, this.tiles.group);
    const up = geodeticToWorld(lat, lon, g + 1000, this.tiles.group).sub(target).normalize();
    const north = geodeticToWorld(lat + 0.01, lon, g, this.tiles.group).sub(target).normalize();
    const eye = target.clone().add(up.clone().multiplyScalar(height)).add(north.multiplyScalar(-height * 0.8));
    this.camera.position.copy(eye); this.camera.up.copy(up); this.camera.lookAt(target); this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  frame() { const c = this.scenarioCentroid(); if (c) this.flyTo(c.lat, c.lon, 800); }
  async search(q: string) {
    q = q.trim(); if (!q) return;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) { this.flyTo(parseFloat(m[1]), parseFloat(m[2]), 800); return; }
    this.toast('Searching…');
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (j[0]) { this.flyTo(parseFloat(j[0].lat), parseFloat(j[0].lon), 900); this.toast(j[0].display_name.split(',').slice(0, 3).join(',')); }
      else this.toast('No match — try “lat, lon”');
    } catch { this.toast('Search failed — paste “lat, lon” coordinates'); }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    window.removeEventListener('resize', this.onResize);
    this.tiles?.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
