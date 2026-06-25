import { useEffect, useRef, useState } from 'react';
import { DroneViewer } from './drone/DroneViewer';
import { KINDS, CATS, SCENARIOS, KindId } from './drone/catalog';
import { Scenario, Telemetry, SafetyFinding, Debrief, Tool, CamMode } from './drone/types';
import { mToFt, ftToM, mpsToMph, mphToMps, fmtDist, fmtFt } from './drone/units';
import ApiKeyGate from './components/ApiKeyGate';

const LS_KEY = 'droneops.key';
const LS_SCENE = 'droneops.scenario';

/** Maps key resolution: a user-entered key wins, then a runtime-injected (Railway) env var,
 *  then a build-time baked key. If any is found we skip the in-app key gate entirely. */
function runtimeKey(): string {
  const rc = (window as any).__RUNTIME_CONFIG__;
  return (rc && rc.GOOGLE_MAPS_API_KEY) || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

function fmt(s: number) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

export default function App() {
  const envKey = runtimeKey();
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(LS_KEY) || envKey || '');
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DroneViewer | null>(null);

  const [scn, setScn] = useState<Scenario | null>(null);
  const [tele, setTele] = useState<Telemetry>({ state: 'IDLE', alt: 0, speed: 0, dist: 0, total: 0, eta: 0, battery: 100, agl: null });
  const [safety, setSafety] = useState<SafetyFinding[]>([]);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [cam, setCam] = useState<CamMode>('orbit');
  const [tool, setToolS] = useState<Tool>('orbit');
  const [rate, setRate] = useState(1);
  const [crashOn, setCrashOn] = useState(true);
  const [showClear, setShowClear] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const toastT = useRef<number | undefined>(undefined);

  const showToast = (m: string) => { setToast(m); window.clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    if (!apiKey || !viewportRef.current) return;
    const viewer = new DroneViewer(viewportRef.current, apiKey, {
      onReady: () => showToast('World loaded — plan your mission or load a scenario'),
      onError: (m) => showToast('⚠ ' + m),
      onToast: showToast,
      onScenarioChange: (s) => { setScn({ ...s }); try { localStorage.setItem(LS_SCENE, JSON.stringify(strip(s))); } catch { /* ignore */ } },
      onTelemetry: setTele,
      onSafety: setSafety,
      onDebrief: setDebrief,
      onCam: setCam,
    });
    viewerRef.current = viewer;
    try { const s = localStorage.getItem(LS_SCENE); if (s) viewer.loadScenarioData(reviveScenario(JSON.parse(s))); } catch { /* ignore */ }
    setScn({ ...viewer.getScenario() });
    setShowClear(viewer.getShowClearance());
    return () => { viewer.dispose(); viewerRef.current = null; };
  }, [apiKey]);

  const v = () => viewerRef.current;
  const setTool = (t: Tool) => { setToolS(t); v()?.setTool(t); showToast(toolHint(t)); };

  if (!apiKey) return <ApiKeyGate onSubmit={(k) => { localStorage.setItem(LS_KEY, k); setApiKey(k); }} />;

  const battColor = tele.battery < 20 ? '#ff4d4d' : tele.battery < 40 ? '#ffb020' : '#2bd67b';
  const CAMS: { id: CamMode; label: string }[] = [
    { id: 'orbit', label: '🛰 Orbit' }, { id: 'chase', label: '🎯 Chase' }, { id: 'fpv', label: '🚁 FPV' },
    { id: 'ground', label: '🧍 Ground' }, { id: 'cine', label: '🎬 Scene' },
  ];

  return (
    <>
      <div id="viewport" ref={viewportRef} />

      <div id="brand"><span style={{ fontSize: 18 }}>🚁</span><b>DroneOps</b></div>

      <div id="cams">
        {CAMS.map((c) => (
          <button key={c.id} className={cam === c.id ? 'active' : ''} onClick={() => v()?.setCam(c.id)} title={c.id === 'cine' ? 'Cinematic scenario camera — drag to orbit, scroll to zoom' : c.id === 'chase' ? '3rd-person chase camera' : c.label}>
            {c.label}
          </button>
        ))}
      </div>

      <div id="topbar">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v()?.search(search)} placeholder="Search a place or paste lat, lon…" />
        <button className="sm" onClick={() => v()?.search(search)}>Go</button>
        <span style={{ width: 1, height: 22, background: 'var(--line)' }} />
        <button className="sm" onClick={() => v()?.frame()} title="Frame the mission">⤢ Frame</button>
      </div>

      <div id="rail">
        <button className={tool === 'orbit' ? 'active' : ''} onClick={() => setTool('orbit')} title="Navigate">🖐</button>
        <div className="sep" />
        <button className={tool === 'path' ? 'active' : ''} onClick={() => setTool('path')} title="Draw flight path">✏️</button>
        <button className={tool === 'poi' ? 'active' : ''} onClick={() => setTool('poi')} title="Drop point of interest">📍</button>
        <button className={tool === 'area' ? 'active' : ''} onClick={() => setTool('area')} title="Operating area / geofence">⭕</button>
        <button className={tool === 'drone' ? 'active' : ''} onClick={() => setTool('drone')} title="Place the drone (launch point)">🚁</button>
        <div className="sep" />
        <button onClick={() => { const on = v()?.toggleClearance(); setShowClear(!!on); showToast('Clearance volumes ' + (on ? 'ON' : 'OFF')); }} title="Toggle clearance volumes">🛡</button>
        <button onClick={() => v()?.undoWaypoint()} title="Remove last waypoint">↶</button>
      </div>

      <Panel
        scn={scn} showClear={showClear} sim={tele} safety={safety}
        onPlace={(k) => { v()?.setPendingPlace(k); setToolS('orbit'); showToast('Click the map to place ' + KINDS[k].name); }}
        onLoadScenario={(i) => { const d = v()?.loadTrainingScenario(i); if (d) setDebrief(d); showToast('Scenario loaded — read the briefing'); }}
        v={v}
        onSetShowClear={(b) => { v()?.setShowClearance(b); setShowClear(b); }}
        onSave={() => scn && download(strip(scn))}
        onLoad={() => uploadJson((o) => v()?.loadScenarioData(reviveScenario(o)))}
      />

      <div id="hud">
        <div className="row" style={{ justifyContent: 'space-between' }}><b>Telemetry</b><span className="small muted">{tele.state}</span></div>
        <div className="grid">
          <Cell v={fmtFt(tele.alt)} k="Altitude AGL" />
          <Cell v={Math.round(mpsToMph(tele.speed)) + ' mph'} k="Ground speed" />
          <Cell v={fmtDist(tele.dist) + ' / ' + fmtDist(tele.total)} k="Distance" />
          <Cell v={(tele.state.includes('FLYING') ? fmt(tele.eta) + ' ETA' : fmt(tele.total / Math.max(0.1, scn?.speed || 8)))} k="Time / ETA" />
        </div>
        <div className="row small" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Battery {Math.round(tele.battery)}%</span>
          <span className="muted" title="Clearance to the mapped terrain / buildings below">⛰ {tele.agl == null ? '—' : fmtFt(Math.max(0, tele.agl))} clr</span>
        </div>
        <div className="bar"><i style={{ width: tele.battery + '%', background: battColor }} /></div>
        <div id="transport">
          <button className="good" onClick={() => v()?.play()}>▶ Fly</button>
          <button onClick={() => v()?.pause()}>⏸</button>
          <button onClick={() => v()?.reset()}>⏮</button>
        </div>
        <label className="fld">Sim speed × {rate.toFixed(2)}</label>
        <input type="range" min={0.25} max={8} step={0.25} value={rate} onChange={(e) => { const r = parseFloat(e.target.value); setRate(r); v()?.setRate(r); }} />
        <label className="small" style={{ display: 'block', marginTop: 6 }} title="Tumble & fall on collision"><input type="checkbox" checked={crashOn} onChange={(e) => { setCrashOn(e.target.checked); v()?.setCrashEnabled(e.target.checked); }} /> 💥 crash sim</label>
      </div>

      <div id="safety">
        {(() => {
          if (!safety.length) return scn && scn.path.length >= 2 ? <div className="alert ok">✓ No safety conflicts detected.</div> : null;
          const shown = safety.slice(0, 4);
          return <>
            {shown.map((a, i) => <div key={i} className={'alert ' + (a.lvl === 'bad' ? 'bad' : '')}>{(a.lvl === 'bad' ? '⛔ ' : '⚠ ') + a.msg}</div>)}
            {safety.length > 4 && <div className="alert">…+{safety.length - 4} more</div>}
          </>;
        })()}
      </div>

      {/* FPV / Ground / Chase onboard overlay */}
      <div id="fpvhud" style={{ display: cam === 'fpv' || cam === 'ground' || cam === 'chase' ? 'block' : 'none' }}>
        <div className="frame" /><div className="rec"><i />REC</div>
        {cam !== 'chase' && <div className="ret" />}
        <div className="lbl">{(cam === 'fpv' ? 'DRONE FPV' : cam === 'chase' ? 'CHASE CAM' : 'GROUND OBSERVER')} · ALT {fmtFt(tele.alt)} · {Math.round(mpsToMph(tele.speed))}mph</div>
      </div>

      {/* Cinematic scenario camera: letterbox + framing label */}
      {cam === 'cine' && (
        <div id="cinehud">
          <div className="lbar top" /><div className="lbar bot" />
          <div className="clbl">🎬 SCENARIO · drag to orbit · scroll to zoom</div>
        </div>
      )}

      {debrief && (
        <div id="debrief" style={{ display: 'flex' }}>
          <div className="card" style={debrief.accent ? { borderColor: 'var(--accent)' } : undefined}>
            <h2 style={debrief.accent ? { color: 'var(--accent)' } : undefined}>{debrief.title}</h2>
            <p className="muted">{debrief.cause}</p>
            <h3 style={{ margin: '10px 0 4px' }}>{debrief.accent ? 'Try this' : 'Correct response'}</h3>
            <ul>{debrief.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <div style={{ height: 12 }} />
            <button className="primary" onClick={() => setDebrief(null)}>Close briefing</button>
          </div>
        </div>
      )}

      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </>
  );
}

function Cell({ v, k }: { v: string; k: string }) { return <div className="g"><div className="v">{v}</div><div className="k">{k}</div></div>; }

// ---- Panel ----
function Panel(props: {
  scn: Scenario | null; showClear: boolean; sim: Telemetry; safety: SafetyFinding[];
  onPlace: (k: KindId) => void; onLoadScenario: (i: number) => void; v: () => DroneViewer | null;
  onSetShowClear: (b: boolean) => void; onSave: () => void; onLoad: () => void;
}) {
  const { scn, v } = props;
  const [open, setOpen] = useState<Record<string, boolean>>({ proj: true, drone: true, view: false, scen: true, path: true, haz: true, mark: false, safe: true, help: false });
  const tog = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // survey planner inputs (US units in the UI)
  const [surveySpacing, setSurveySpacing] = useState(100); // ft
  const [surveyAlt, setSurveyAlt] = useState(200);         // ft
  const [surveyHdg, setSurveyHdg] = useState(0);           // deg
  if (!scn) return <div id="panel"><div className="head"><h2 style={{ fontSize: 15 }}>Mission</h2></div><div className="body"><div className="small muted" style={{ padding: 10 }}>Loading the 3D world…</div></div></div>;

  const Sec = ({ id, title, children }: { id: string; title: React.ReactNode; children: React.ReactNode }) => (
    <div className="section"><div className="t" onClick={() => tog(id)}>{title}<span>{open[id] ? '▾' : '▸'}</span></div>{open[id] && <div className="c">{children}</div>}</div>
  );

  return (
    <div id="panel">
      <div className="head"><h2 style={{ fontSize: 15 }}>Mission</h2>
        <div className="row tight" style={{ gap: 6 }}>
          <button className="sm" title="Download mission JSON" onClick={props.onSave}>💾</button>
          <button className="sm" title="Load mission JSON" onClick={props.onLoad}>📂</button>
        </div>
      </div>
      <div className="body">
        <Sec id="proj" title="🗂 Project & mapping">
          <label className="fld">Project name</label>
          <input value={scn.name || ''} placeholder="Untitled mission" onChange={(e) => v()?.setMissionName(e.target.value)} />
          <div className="small muted" style={{ margin: '8px 0 4px' }}>
            DroneDeploy-style mapping: drop a geofence (⭕) over your site (or just frame an area), set the grid, and generate a serpentine survey flight.
          </div>
          <label className="fld">Line spacing (ft)</label>
          <div className="row"><input type="number" min={25} max={600} step={5} value={surveySpacing} onChange={(e) => setSurveySpacing(parseFloat(e.target.value) || 25)} />
            <input type="range" min={25} max={600} step={5} value={surveySpacing} onChange={(e) => setSurveySpacing(parseFloat(e.target.value))} /></div>
          <label className="fld">Survey altitude AGL (ft)</label>
          <div className="row"><input type="number" min={50} max={1300} step={5} value={surveyAlt} onChange={(e) => setSurveyAlt(parseFloat(e.target.value) || 50)} />
            <input type="range" min={50} max={1300} step={5} value={surveyAlt} onChange={(e) => setSurveyAlt(parseFloat(e.target.value))} /></div>
          <label className="fld">Grid heading (°)</label>
          <input type="range" min={0} max={180} step={5} value={surveyHdg} onChange={(e) => setSurveyHdg(parseFloat(e.target.value))} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="sm" onClick={() => v()?.generateSurvey({ spacing: ftToM(surveySpacing), alt: ftToM(surveyAlt), heading: surveyHdg })}>🗺 Generate survey grid</button>
          </div>
        </Sec>

        <Sec id="drone" title="🚁 Drone & flight">
          <label className="fld">Ground speed (mph)</label>
          <div className="row"><input type="number" min={2} max={90} value={Math.round(mpsToMph(scn.speed))} onChange={(e) => v()?.setSpeed(mphToMps(parseFloat(e.target.value) || 2))} />
            <input type="range" min={2} max={90} value={Math.round(mpsToMph(scn.speed))} onChange={(e) => v()?.setSpeed(mphToMps(parseFloat(e.target.value)))} /></div>
          <label className="fld">Default waypoint altitude AGL (ft)</label>
          <div className="row"><input type="number" min={15} max={1600} step={5} value={Math.round(mToFt(scn.defaultAlt))} onChange={(e) => v()?.setDefaultAlt(ftToM(parseFloat(e.target.value) || 15))} />
            <input type="range" min={15} max={660} step={5} value={Math.min(660, Math.round(mToFt(scn.defaultAlt)))} onChange={(e) => v()?.setDefaultAlt(ftToM(parseFloat(e.target.value)))} /></div>
          <label className="fld">Drone model size ×</label>
          <input type="range" min={1} max={30} step={1} value={scn.drone.scale} onChange={(e) => v()?.setDroneScale(parseFloat(e.target.value))} />
          <label className="fld">Model facing / yaw fix (°) — rotate if an imported model flies sideways</label>
          <div className="row"><input type="number" min={-180} max={180} step={5} value={scn.drone.modelYaw || 0} onChange={(e) => v()?.setModelYaw(parseFloat(e.target.value) || 0)} />
            <input type="range" min={-180} max={180} step={5} value={scn.drone.modelYaw || 0} onChange={(e) => v()?.setModelYaw(parseFloat(e.target.value))} /></div>
          <div className="row" style={{ marginTop: 4 }}>
            {[0, 90, 180, -90].map((d) => <button key={d} className="sm" onClick={() => v()?.setModelYaw(d)}>{d}°</button>)}
          </div>
          <label className="small" style={{ display: 'block', marginTop: 8 }}><input type="checkbox" checked={!!scn.drone.highlight} onChange={(e) => v()?.setHighlight(e.target.checked)} /> ✨ Highlight drone (glow + beacon so it stands out)</label>
          <div className="small muted" style={{ marginTop: 6 }}>{scn.drone.lat != null ? `Launch @ ${scn.drone.lat.toFixed(5)}, ${scn.drone.lon!.toFixed(5)}` : 'Place the drone with 🚁 or drag it onto the map.'}</div>

          <label className="fld">Hero model</label>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Built-in: animated <b>Mavic 3 Pro–style</b> drone. Want photoreal? Download a free{' '}
            <a href="https://sketchfab.com/3d-models/dji-mavic-3-pro-e043f4394e6b4428ad9e69988e5f51ad" target="_blank" rel="noopener">Mavic 3 Pro GLB</a>{' '}
            (Sketchfab, CC-BY — credit <b>johnnokomis</b>) and load it here. If it flies sideways, use the yaw fix above.
          </div>
          <div className="row">
            <button className="sm" onClick={() => uploadGlb((f) => v()?.loadDroneModelFile(f))}>📥 Load drone GLB</button>
            <button className="sm" onClick={() => v()?.setDroneModelUrl(null)} disabled={!scn.drone.modelUrl}>↺ Built-in</button>
          </div>
        </Sec>

        <Sec id="view" title="🎛 View & focus">
          <ViewControls v={v} />
        </Sec>

        <Sec id="scen" title="🎓 Training scenarios">
          {SCENARIOS.map((s, i) => (
            <div key={i} className="scen" onClick={() => props.onLoadScenario(i)}><b>{s.icon} {s.title}</b><span className="d">{s.short}</span></div>
          ))}
        </Sec>

        <Sec id="path" title={<span>✏️ Flight path <span className="muted small">({scn.path.length} wp · {fmtDist(props.sim.total)})</span></span>}>
          <div className="list">
            {scn.path.length ? scn.path.map((w, i) => {
              const ft = Math.round(mToFt(w.alt));
              return (
                <div className="wp" key={i}>
                  <div className="it" style={{ border: 'none', margin: 0, padding: 0, background: 'none' }}>
                    <span className="nm">WP{i + 1} · {w.lat.toFixed(4)},{w.lon.toFixed(4)}</span>
                    <input type="number" value={ft} step={5} style={{ width: 70 }} title="alt AGL (ft)" onChange={(e) => v()?.updateWaypointAlt(i, ftToM(parseFloat(e.target.value) || 0))} />
                    <span className="muted small">ft</span>
                    <button className="sm" onClick={() => v()?.removeWaypoint(i)}>✕</button>
                  </div>
                  <input type="range" min={0} max={1300} step={5} value={Math.min(1300, ft)} title="drag — steps of 5 ft" onChange={(e) => v()?.updateWaypointAlt(i, ftToM(parseFloat(e.target.value)))} />
                </div>
              );
            }) : <div className="small muted">No waypoints — pick ✏️ and click the map.</div>}
          </div>
          <div className="row" style={{ marginTop: 6 }}><button className="sm" onClick={() => v()?.clearPath()}>Clear</button><button className="sm" onClick={() => v()?.addRthLeg()}>+ RTH leg</button></div>
        </Sec>

        <Sec id="haz" title="🧩 Hazards & clearance">
          {CATS.map((cat) => (
            <div key={cat}>
              <div className="catlbl">{cat}</div>
              <div className="palette">
                {(Object.keys(KINDS) as KindId[]).filter((k) => KINDS[k].cat === cat).map((k) => (
                  <div key={k} className="chip" draggable onDragStart={(e) => e.dataTransfer.setData('text/kind', k)} onClick={() => props.onPlace(k)}>
                    <span className="ic">{KINDS[k].ic}</span>{KINDS[k].name}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ height: 8 }} />
          <label className="small"><input type="checkbox" checked={props.showClear} onChange={(e) => props.onSetShowClear(e.target.checked)} /> Show all clearance / standoff volumes</label>
          <div style={{ height: 8 }} />
          <div className="list">
            {scn.situations.length ? scn.situations.map((s) => {
              const k = KINDS[s.kind];
              return (
                <div key={s.id} className="hazcard">
                  <div className="it" style={{ border: 'none', margin: 0, padding: 0, background: 'none' }}><span style={{ fontSize: 16 }}>{k.ic}</span>
                    <span className="nm"><input value={s.label} style={{ padding: '3px 5px' }} onChange={(e) => v()?.updateSituation(s.id, { label: e.target.value })} /></span>
                    <label className="small" title="show clearance"><input type="checkbox" checked={s.showClear} onChange={(e) => v()?.updateSituation(s.id, { showClear: e.target.checked })} />🛡</label>
                    <label className="small" title="show info text"><input type="checkbox" checked={!!s.showInfo} onChange={(e) => v()?.updateSituation(s.id, { showInfo: e.target.checked })} />ℹ️</label>
                    <button className="sm" onClick={() => v()?.removeSituation(s.id)}>✕</button></div>
                  <div className="row small" style={{ marginTop: 6 }}>
                    <span className="muted" style={{ flex: '0 0 auto' }}>r ft</span><input type="number" value={Math.round(mToFt(s.clearR))} step={5} style={{ width: 60 }} onChange={(e) => v()?.updateSituation(s.id, { clearR: ftToM(parseFloat(e.target.value) || 1) })} />
                    <span className="muted" style={{ flex: '0 0 auto' }}>{k.mode === 'ceiling' ? 'ceil ft' : 'h ft'}</span><input type="number" value={Math.round(mToFt(s.clearH))} step={5} style={{ width: 60 }} onChange={(e) => v()?.updateSituation(s.id, { clearH: ftToM(parseFloat(e.target.value) || 1) })} />
                    <span className="muted" style={{ flex: '0 0 auto' }}>hdg</span><input type="number" value={s.heading || 0} step={5} style={{ width: 52 }} onChange={(e) => v()?.updateSituation(s.id, { heading: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="row small" style={{ marginTop: 4 }}>
                    <span className="muted" style={{ flex: '0 0 auto' }}>size ×</span>
                    <input type="range" min={0.3} max={3} step={0.1} value={s.scale ?? 1} onChange={(e) => v()?.updateSituation(s.id, { scale: parseFloat(e.target.value) })} />
                    <span className="muted small" style={{ flex: '0 0 auto', width: 26 }}>{(s.scale ?? 1).toFixed(1)}</span>
                  </div>
                  {k.sizable && (
                    <div className="row small" style={{ marginTop: 4 }}>
                      <span className="muted" style={{ flex: '0 0 auto' }}>height ft</span>
                      <input type="number" value={Math.round(mToFt(s.height ?? k.h ?? 0))} step={5} style={{ width: 64 }} onChange={(e) => v()?.updateSituation(s.id, { height: ftToM(parseFloat(e.target.value) || 0) })} />
                      {k.reach != null && <>
                        <span className="muted" style={{ flex: '0 0 auto' }}>reach ft</span>
                        <input type="number" value={Math.round(mToFt(s.reach ?? k.reach ?? 0))} step={5} style={{ width: 64 }} title="jib / swing radius" onChange={(e) => v()?.updateSituation(s.id, { reach: ftToM(parseFloat(e.target.value) || 0) })} />
                      </>}
                    </div>
                  )}
                </div>
              );
            }) : <div className="small muted">Drag a hazard onto the map, or click a chip then click the map.</div>}
          </div>
        </Sec>

        <Sec id="mark" title="📍 POIs & geofences">
          <div className="list">
            {scn.pois.map((p) => (
              <div className="it" key={p.id}><span>📍</span><span className="nm"><input value={p.label} style={{ padding: '3px 5px' }} onChange={(e) => v()?.updatePoi(p.id, { label: e.target.value })} /></span><button className="sm" onClick={() => v()?.removePoi(p.id)}>✕</button></div>
            ))}
            {scn.areas.map((a) => (
              <div className="it" key={a.id}><span>⭕</span><span className="nm"><input value={a.label} style={{ padding: '3px 5px' }} onChange={(e) => v()?.updateArea(a.id, { label: e.target.value })} /></span>
                <input type="number" value={Math.round(mToFt(a.radius))} step={5} style={{ width: 66 }} title="radius ft" onChange={(e) => v()?.updateArea(a.id, { radius: ftToM(parseFloat(e.target.value) || 10) })} /><span className="muted small">ft</span>
                <button className="sm" onClick={() => v()?.removeArea(a.id)}>✕</button></div>
            ))}
            {!scn.pois.length && !scn.areas.length && <div className="small muted">None</div>}
          </div>
        </Sec>

        <Sec id="safe" title={<span>✅ Safety analysis <span className="muted small">({props.safety.filter((f) => !f.msg.startsWith('LIVE')).length})</span></span>}>
          {props.safety.length ? props.safety.map((f, i) => <div key={i} className={'alert ' + (f.lvl === 'bad' ? 'bad' : '')}>{(f.lvl === 'bad' ? '⛔' : '⚠') + ' ' + f.msg}</div>) : <div className="alert ok">✓ No conflicts detected.</div>}
        </Sec>

        <Sec id="help" title="❓ Quick guide">
          <div className="small muted" style={{ lineHeight: 1.6 }}>
            <b>1.</b> Search a location.<br /><b>2.</b> Load a <b>training scenario</b>, or drop a ⭕ geofence and <b>Generate survey grid</b> (DroneDeploy-style).<br />
            <b>3.</b> ✏️ lay a path; drag hazards (cranes, airspace…) on; tune <b>r / h / size / height / reach</b> (all in ft).<br />
            <b>4.</b> Place the 🚁 drone, then ▶ Fly. Cameras: <b>Orbit / Chase / FPV / Ground / 🎬 Scene</b>.<br />
            <b>5.</b> Turn on <b>Auto-avoid terrain</b> to skim the real mesh, or leave it off + 💥 crash-sim to see CFIT.<br />
            <b>6.</b> Use <b>View &amp; focus</b> to dim the world, highlight the drone, and show equipment info labels.
          </div>
        </Sec>
      </div>
    </div>
  );
}

// ---- View & focus controls (tile dim/opacity, terrain avoidance, info labels) ----
function ViewControls({ v }: { v: () => DroneViewer | null }) {
  const [dim, setDim] = useState(false);
  const [opacity, setOpacity] = useState(100);
  const [avoid, setAvoid] = useState(true);
  const [info, setInfo] = useState(false);
  useEffect(() => {
    const vw = v(); if (!vw) return;
    setDim(vw.getTileDim()); setOpacity(Math.round(vw.getTileOpacity() * 100));
    setAvoid(vw.getAvoidTerrain()); setInfo(vw.getShowInfo());
  }, [v]);
  return (
    <>
      <label className="small"><input type="checkbox" checked={dim} onChange={(e) => { setDim(e.target.checked); v()?.setTileDim(e.target.checked); }} /> 🌫 Dim &amp; desaturate Google tiles (focus on overlays)</label>
      <label className="fld">Tile opacity %</label>
      <input type="range" min={35} max={100} step={5} value={opacity} onChange={(e) => { const o = parseFloat(e.target.value); setOpacity(o); v()?.setTileOpacity(o / 100); }} />
      <div style={{ height: 8 }} />
      <label className="small"><input type="checkbox" checked={avoid} onChange={(e) => { setAvoid(e.target.checked); v()?.setAvoidTerrain(e.target.checked); }} /> ⛰ Auto-avoid terrain &amp; buildings (hold clearance over the mesh)</label>
      <div style={{ height: 6 }} />
      <label className="small"><input type="checkbox" checked={info} onChange={(e) => { setInfo(e.target.checked); v()?.setShowInfo(e.target.checked); }} /> ℹ️ Show info labels on all equipment / hazards</label>
    </>
  );
}

// ---- helpers ----
function toolHint(t: Tool) {
  return t === 'path' ? 'Click the map to add flight-path waypoints' : t === 'poi' ? 'Click to drop a point of interest'
    : t === 'area' ? 'Click to place an operating area / geofence' : t === 'drone' ? 'Click to set the drone launch point'
      : 'Navigate: drag to orbit, scroll to zoom';
}
function strip(s: Scenario) {
  // Drop ephemeral blob: model URLs — they don't survive a reload.
  const modelUrl = s.drone.modelUrl && /^https?:/.test(s.drone.modelUrl) ? s.drone.modelUrl : null;
  return { drone: { ...s.drone, modelUrl }, speed: s.speed, defaultAlt: s.defaultAlt, name: s.name, path: s.path.map((w) => ({ lat: w.lat, lon: w.lon, alt: w.alt })), situations: s.situations, pois: s.pois, areas: s.areas };
}
function reviveScenario(o: any): Scenario {
  return {
    drone: { type: 'quad', scale: 6, lat: null, lon: null, modelYaw: 0, highlight: false, ...(o.drone || {}) },
    speed: o.speed ?? 8, defaultAlt: o.defaultAlt ?? 60, name: o.name,
    path: (o.path || []).map((w: any) => ({ ...w })), situations: o.situations || [], pois: o.pois || [], areas: o.areas || [],
  };
}
function download(obj: any) {
  const b = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'drone-mission.json'; a.click();
}
function uploadJson(cb: (o: any) => void) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => { const f = inp.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { cb(JSON.parse(rd.result as string)); } catch { /* ignore */ } }; rd.readAsText(f); };
  inp.click();
}
function uploadGlb(cb: (f: File) => void) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,.gltf,model/gltf-binary';
  inp.onchange = () => { const f = inp.files?.[0]; if (f) cb(f); };
  inp.click();
}
