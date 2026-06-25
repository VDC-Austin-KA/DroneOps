import { useEffect, useRef, useState } from 'react';
import { DroneViewer } from './drone/DroneViewer';
import { KINDS, CATS, SCENARIOS, KindId } from './drone/catalog';
import { Scenario, Telemetry, SafetyFinding, Debrief, Tool, CamMode } from './drone/types';
import ApiKeyGate from './components/ApiKeyGate';

const LS_KEY = 'droneops.key';
const LS_SCENE = 'droneops.scenario';

function fmt(s: number) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(LS_KEY) || '');
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DroneViewer | null>(null);

  const [scn, setScn] = useState<Scenario | null>(null);
  const [tele, setTele] = useState<Telemetry>({ state: 'IDLE', alt: 0, speed: 0, dist: 0, total: 0, eta: 0, battery: 100 });
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

  return (
    <>
      <div id="viewport" ref={viewportRef} />

      <div id="brand"><span style={{ fontSize: 18 }}>🚁</span><b>DroneOps</b></div>

      <div id="cams">
        {(['orbit', 'fpv', 'ground'] as CamMode[]).map((m) => (
          <button key={m} className={cam === m ? 'active' : ''} onClick={() => v()?.setCam(m)}>
            {m === 'orbit' ? '🛰 Orbit' : m === 'fpv' ? '🚁 FPV' : '🧍 Ground'}
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
          <Cell v={Math.round(tele.alt) + ' m'} k="Altitude AGL" />
          <Cell v={tele.speed.toFixed(1) + ' m/s'} k="Ground speed" />
          <Cell v={Math.round(tele.dist) + ' / ' + Math.round(tele.total) + ' m'} k="Distance" />
          <Cell v={(tele.state.includes('FLYING') ? fmt(tele.eta) + ' ETA' : fmt(tele.total / Math.max(0.1, scn?.speed || 8)))} k="Time / ETA" />
        </div>
        <div className="row small" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Battery {Math.round(tele.battery)}%</span>
          <label className="muted" title="Tumble & fall on collision"><input type="checkbox" checked={crashOn} onChange={(e) => { setCrashOn(e.target.checked); v()?.setCrashEnabled(e.target.checked); }} /> 💥 crash sim</label>
        </div>
        <div className="bar"><i style={{ width: tele.battery + '%', background: battColor }} /></div>
        <div id="transport">
          <button className="good" onClick={() => v()?.play()}>▶ Fly</button>
          <button onClick={() => v()?.pause()}>⏸</button>
          <button onClick={() => v()?.reset()}>⏮</button>
        </div>
        <label className="fld">Speed × {rate.toFixed(2)}</label>
        <input type="range" min={0.25} max={8} step={0.25} value={rate} onChange={(e) => { const r = parseFloat(e.target.value); setRate(r); v()?.setRate(r); }} />
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

      <div id="fpvhud" style={{ display: cam === 'orbit' ? 'none' : 'block' }}>
        <div className="frame" /><div className="rec"><i />REC</div><div className="ret" />
        <div className="lbl">{(cam === 'fpv' ? 'DRONE FPV' : 'GROUND OBSERVER')} · ALT {Math.round(tele.alt)}m · {tele.speed.toFixed(0)}m/s</div>
      </div>

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
  const [open, setOpen] = useState<Record<string, boolean>>({ drone: true, scen: true, path: true, haz: true, mark: false, safe: true, help: false });
  const tog = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
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
        <Sec id="drone" title="🚁 Drone & flight">
          <label className="fld">Ground speed (m/s)</label>
          <div className="row"><input type="number" min={1} max={40} value={scn.speed} onChange={(e) => v()?.setSpeed(parseFloat(e.target.value) || 1)} />
            <input type="range" min={1} max={40} value={scn.speed} onChange={(e) => v()?.setSpeed(parseFloat(e.target.value))} /></div>
          <label className="fld">Default waypoint altitude AGL (m)</label>
          <div className="row"><input type="number" min={5} max={500} value={scn.defaultAlt} onChange={(e) => v()?.setDefaultAlt(parseFloat(e.target.value) || 5)} />
            <input type="range" min={5} max={200} value={Math.min(200, scn.defaultAlt)} onChange={(e) => v()?.setDefaultAlt(parseFloat(e.target.value))} /></div>
          <label className="fld">Drone model size ×</label>
          <input type="range" min={1} max={30} step={1} value={scn.drone.scale} onChange={(e) => v()?.setDroneScale(parseFloat(e.target.value))} />
          <div className="small muted" style={{ marginTop: 6 }}>{scn.drone.lat != null ? `Launch @ ${scn.drone.lat.toFixed(5)}, ${scn.drone.lon!.toFixed(5)}` : 'Place the drone with 🚁 or drag it onto the map.'}</div>

          <label className="fld">Hero model</label>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Built-in: animated <b>Mavic 3 Pro–style</b> drone. Want photoreal? Download a free{' '}
            <a href="https://sketchfab.com/3d-models/dji-mavic-3-pro-e043f4394e6b4428ad9e69988e5f51ad" target="_blank" rel="noopener">Mavic 3 Pro GLB</a>{' '}
            (Sketchfab, CC-BY — credit <b>johnnokomis</b>) and load it here.
          </div>
          <div className="row">
            <button className="sm" onClick={() => uploadGlb((f) => v()?.loadDroneModelFile(f))}>📥 Load drone GLB</button>
            <button className="sm" onClick={() => v()?.setDroneModelUrl(null)} disabled={!scn.drone.modelUrl}>↺ Built-in</button>
          </div>
        </Sec>

        <Sec id="scen" title="🎓 Training scenarios">
          {SCENARIOS.map((s, i) => (
            <div key={i} className="scen" onClick={() => props.onLoadScenario(i)}><b>{s.icon} {s.title}</b><span className="d">{s.short}</span></div>
          ))}
        </Sec>

        <Sec id="path" title={<span>✏️ Flight path <span className="muted small">({scn.path.length} wp · {Math.round(props.sim.total)} m)</span></span>}>
          <div className="list">
            {scn.path.length ? scn.path.map((w, i) => (
              <div className="it" key={i}><span className="nm">WP{i + 1} · {w.lat.toFixed(4)},{w.lon.toFixed(4)}</span>
                <input type="number" value={Math.round(w.alt)} style={{ width: 62 }} title="alt AGL (m)" onChange={(e) => v()?.updateWaypointAlt(i, parseFloat(e.target.value) || 0)} />
                <button className="sm" onClick={() => v()?.removeWaypoint(i)}>✕</button></div>
            )) : <div className="small muted">No waypoints — pick ✏️ and click the map.</div>}
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
            {scn.situations.length ? scn.situations.map((s) => (
              <div key={s.id}>
                <div className="it"><span style={{ fontSize: 16 }}>{KINDS[s.kind].ic}</span>
                  <span className="nm"><input value={s.label} style={{ padding: '3px 5px' }} onChange={(e) => v()?.updateSituation(s.id, { label: e.target.value })} /></span>
                  <label className="small" title="show clearance"><input type="checkbox" checked={s.showClear} onChange={(e) => v()?.updateSituation(s.id, { showClear: e.target.checked })} />🛡</label>
                  <button className="sm" onClick={() => v()?.removeSituation(s.id)}>✕</button></div>
                <div className="row small" style={{ margin: '-2px 0 8px' }}>
                  <span className="muted" style={{ flex: '0 0 auto' }}>r</span><input type="number" value={s.clearR} style={{ width: 54 }} onChange={(e) => v()?.updateSituation(s.id, { clearR: parseFloat(e.target.value) || 1 })} />
                  <span className="muted" style={{ flex: '0 0 auto' }}>{KINDS[s.kind].mode === 'ceiling' ? 'ceil' : 'h'}</span><input type="number" value={s.clearH} style={{ width: 54 }} onChange={(e) => v()?.updateSituation(s.id, { clearH: parseFloat(e.target.value) || 1 })} />
                  <span className="muted" style={{ flex: '0 0 auto' }}>hdg</span><input type="number" value={s.heading || 0} style={{ width: 54 }} onChange={(e) => v()?.updateSituation(s.id, { heading: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
            )) : <div className="small muted">Drag a hazard onto the map, or click a chip then click the map.</div>}
          </div>
        </Sec>

        <Sec id="mark" title="📍 POIs & geofences">
          <div className="list">
            {scn.pois.map((p) => (
              <div className="it" key={p.id}><span>📍</span><span className="nm"><input value={p.label} style={{ padding: '3px 5px' }} onChange={(e) => v()?.updatePoi(p.id, { label: e.target.value })} /></span><button className="sm" onClick={() => v()?.removePoi(p.id)}>✕</button></div>
            ))}
            {scn.areas.map((a) => (
              <div className="it" key={a.id}><span>⭕</span><span className="nm"><input value={a.label} style={{ padding: '3px 5px' }} onChange={(e) => v()?.updateArea(a.id, { label: e.target.value })} /></span>
                <input type="number" value={Math.round(a.radius)} style={{ width: 60 }} title="radius m" onChange={(e) => v()?.updateArea(a.id, { radius: parseFloat(e.target.value) || 10 })} />
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
            <b>1.</b> Search a location.<br /><b>2.</b> Load a <b>training scenario</b> or build your own.<br />
            <b>3.</b> ✏️ lay a path; drag hazards (cranes, airspace…) on; tune <b>r/h</b> clearance.<br />
            <b>4.</b> Place the 🚁 drone, then ▶ Fly. Switch <b>FPV / Ground / Orbit</b> cameras (top-right).<br />
            <b>5.</b> Leave 💥 crash-sim on to see collisions & debriefs.
          </div>
        </Sec>
      </div>
    </div>
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
  return { drone: { ...s.drone, modelUrl }, speed: s.speed, defaultAlt: s.defaultAlt, path: s.path.map((w) => ({ lat: w.lat, lon: w.lon, alt: w.alt })), situations: s.situations, pois: s.pois, areas: s.areas };
}
function reviveScenario(o: any): Scenario {
  return {
    drone: { type: 'quad', scale: 6, lat: null, lon: null, ...(o.drone || {}) },
    speed: o.speed ?? 8, defaultAlt: o.defaultAlt ?? 60,
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
