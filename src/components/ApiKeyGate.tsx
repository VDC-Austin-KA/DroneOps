import { useState } from 'react';

export default function ApiKeyGate({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [val, setVal] = useState('');
  const go = () => { if (val.trim()) onSubmit(val.trim()); };
  return (
    <div id="gate">
      <div className="card">
        <span className="badge">🚁 DRONEOPS</span>
        <h1>Drone Flight &amp; Scenario Trainer</h1>
        <p>Plan and fly drone missions on Google's photorealistic 3D world, drop FAA
          airspace &amp; jobsite hazards with real clearance volumes, switch between
          FPV / ground / orbit cameras, and run crash &amp; emergency scenarios with
          guidance on the correct response.</p>
        <p>Needs a <b>Google Maps Platform</b> API key with the <b>Map Tiles API</b> enabled &amp; billing active.</p>
        <ol>
          <li>Open the <a href="https://console.cloud.google.com/google/maps-apis/api-list" target="_blank" rel="noopener">Google Maps Platform console</a></li>
          <li>Enable <b>“Map Tiles API”</b> + attach billing</li>
          <li>Create an API key (restrict by HTTP referrer)</li>
          <li>Paste it below — stored only in your browser</li>
        </ol>
        <label className="fld">Google Maps Platform API key</label>
        <input type="password" value={val} placeholder="AIza..." autoComplete="off"
          onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <div style={{ height: 12 }} />
        <button className="primary" style={{ width: '100%' }} disabled={!val.trim()} onClick={go}>Launch DroneOps →</button>
      </div>
    </div>
  );
}
