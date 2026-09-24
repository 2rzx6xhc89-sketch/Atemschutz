/*
 * Fahrzeugverwaltung – lokaler Server
 * ------------------------------------
 * Liefert die App (public/index.html) an alle Geräte im Netzwerk aus und
 * hält alle geteilten Daten (Fahrzeuge, Status, Abschnitte, Mannschaft,
 * Logbuch, Lagekarte, Benutzer) zentral in data.json. Jede Änderung wird
 * per WebSocket sofort an alle verbundenen Geräte weitergegeben.
 *
 * Start:  node server.js
 * Port:   8080 (änderbar über die Umgebungsvariable PORT)
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const MELDE_PORT = process.env.MELDE_PORT || (Number(PORT) + 1);
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;

/* Storage-Keys, wie sie der Client in public/index.html verwendet (siehe dortiges K-Objekt) */
const K_VEHICLES = 'opta3.vehicles';
const K_STATUS = 'opta3.status';
const K_PERSONNEL = 'opta3.personnel';
const K_MELDE_TOKENS = 'opta3.meldeTokens';
const K_LOG = 'opta3.log';
const K_ASUE = 'opta3.asueTrupps';
const K_EINSATZ_START = 'opta3.einsatzStart';
const VALID_STATUS = ['frei', 'alarmiert', 'einsatz'];

/* ---------- Daten laden ---------- */
let store = {};
try {
  store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`data.json geladen (${Object.keys(store).length} Einträge).`);
} catch (e) {
  console.log('Keine vorhandene data.json gefunden – starte mit leerem Datenstand.');
  store = {};
}

let saveTimer = null;
function saveStore() {
  // Schreibzugriffe kurz bündeln, falls mehrere Änderungen schnell hintereinander kommen
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(store), (err) => {
      if (err) console.error('Fehler beim Speichern von data.json:', err);
    });
  }, 150);
}

/* ---------- Automatische, rotierende Backups ----------
   Einmal pro Tag eine Kopie von data.json in backups/ ablegen (Dateiname mit
   Datum), ältere als BACKUP_RETENTION_DAYS Tage werden automatisch gelöscht.
   Läuft unabhängig vom normalen Speichern (saveStore), damit ein versehentliches
   Löschen/Überschreiben nicht auch gleich alle Sicherungen mitreißt. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function runDailyBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `data-${todayStr()}.json`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(store, null, 2));
      console.log(`Backup erstellt: backups/${path.basename(file)}`);
    }
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .forEach((f) => {
        const datePart = f.match(/^data-(\d{4}-\d{2}-\d{2})\.json$/)[1];
        const t = new Date(`${datePart}T00:00:00`).getTime();
        if (t < cutoff) {
          try {
            fs.unlinkSync(path.join(BACKUP_DIR, f));
            console.log(`Altes Backup gelöscht: backups/${f}`);
          } catch (e) { /* egal, beim naechsten Mal wieder versuchen */ }
        }
      });
  } catch (e) {
    console.error('Backup fehlgeschlagen:', e.message);
  }
}
runDailyBackup(); // gleich beim Start eines pruefen/erstellen
setInterval(runDailyBackup, 60 * 60 * 1000); // danach stuendlich pruefen (max. 1x taeglich neu)

/* ---------- Web-Server (Haupt-App, LAN) ---------- */
const app = express();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/config', (req, res) => res.json({ meldePort: MELDE_PORT }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

wss.on('connection', (ws) => {
  console.log('Gerät verbunden. Aktuell verbunden:', wss.clients.size);

  // Neu verbundenem Gerät sofort den kompletten aktuellen Datenstand schicken
  ws.send(JSON.stringify({ type: 'init', data: store }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (msg && msg.type === 'set' && typeof msg.key === 'string') {
      store[msg.key] = msg.value;
      saveStore();
      // An ALLE verbundenen Geräte weitergeben (inkl. Absender – das hält die App einfach)
      broadcast({ type: 'update', key: msg.key, value: msg.value });
    }
  });

  ws.on('close', () => {
    console.log('Gerät getrennt. Aktuell verbunden:', wss.clients.size);
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log(`Fahrzeugverwaltung läuft auf Port ${PORT}`);
  console.log(`Lokal auf diesem Gerät:  http://localhost:${PORT}`);
  console.log('Im Netzwerk erreichbar unter http://<IP-Adresse-des-Rechners>:' + PORT);
  console.log('Die IP-Adresse findest du z. B. mit: hostname -I');
  console.log('----------------------------------------------------');
});

/* ==========================================================================
   Isolierter Meldeserver (eigener Port, für Freigabe nach außen gedacht)
   --------------------------------------------------------------------------
   Läuft im selben Prozess und teilt sich denselben "store" + dieselbe
   saveStore()/broadcast() wie die Haupt-App (Änderungen erscheinen also
   sofort auch dort) - aber er bietet NUR drei eng begrenzte Dinge an, jeweils
   ausschließlich für das eine Fahrzeug, dessen (langes, zufälliges, nicht
   erratbares) Token in der URL steht:
     - Funkrufname + Status LESEN
     - Status SETZEN (frei / alarmiert / einsatz)
     - Mannschaft/PA-Träger MELDEN
   Es gibt keinerlei Weg, andere Fahrzeuge, Listen, Benutzer oder sonstige
   App-Daten über diesen Port einzusehen oder zu verändern - unabhängig davon,
   ob die Haupt-App (Port oben) nur im LAN bleibt oder dieser zweite Port
   gezielt nach außen freigegeben wird (z. B. per MyFRITZ!).
   ========================================================================== */

function resolveVehicleId(token) {
  const tokens = store[K_MELDE_TOKENS] || {};
  return typeof token === 'string' ? tokens[token] : undefined;
}
function findVehicle(vehicleId) {
  const vehicles = store[K_VEHICLES] || [];
  return vehicles.find((v) => v.id === vehicleId);
}

// Sehr einfache Ratenbegrenzung pro Token, gegen versehentliches/absichtliches Zuspammen
const lastRequest = new Map();
function rateLimited(token) {
  const now = Date.now();
  const last = lastRequest.get(token) || 0;
  if (now - last < 400) return true;
  lastRequest.set(token, now);
  return false;
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readJSONBody(req, cb) {
  let body = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 2000) { tooLarge = true; req.destroy(); }
  });
  req.on('end', () => {
    if (tooLarge) return cb(new Error('too large'));
    try { cb(null, body ? JSON.parse(body) : {}); }
    catch (e) { cb(e); }
  });
}

function meldeHTML(token) {
  // Eigenständige, minimale Seite - lädt NICHTS von der Haupt-App, hat keinen
  // Zugriff auf deren Code/Daten, spricht nur die drei API-Endpunkte unten an.
  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Stärkemeldung</title>
<style>
:root{--bg:#eef3f6;--card:#fff;--text:#16242e;--muted:#647784;--line:#d7e1e7;--brand:#0d4268;--accent:#0f8794;--soft:#e4f4f5;}
@media(prefers-color-scheme:dark){:root{--bg:#0f171d;--card:#18232b;--text:#eef5f8;--muted:#aab8c1;--line:#31434e;--brand:#2d78ad;--accent:#38bdc8;--soft:#16363a;}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px;
  padding-top:calc(24px + env(safe-area-inset-top,0px));background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:1.1rem;margin:0 0 4px;text-align:center}
.mark{width:52px;height:52px;border-radius:14px;background:var(--soft);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px}
.wrap{width:100%;max-width:420px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px;text-align:center}
.status-row{display:flex;gap:8px;margin-top:10px}
.status-row button{flex:1;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:12px 4px;font-size:.8rem;font-weight:700;color:var(--muted)}
.status-row button.on{border-color:transparent}
.status-row button.on.frei{background:var(--soft);color:var(--accent)}
.status-row button.on.alarmiert{background:#fdf0d5;color:#c07a12}
.status-row button.on.einsatz{background:#fbe1e4;color:#b13b49}
.field label{display:block;font-size:.78rem;color:var(--muted);margin:14px 0 6px;font-weight:600;text-align:center}
.stepper{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:6px}
.step-btn{width:52px;height:52px;border-radius:50%;border:1px solid var(--line);background:var(--card);font-size:1.5rem;font-weight:700;color:var(--brand)}
input[type=number]{width:90px;text-align:center;font-size:2rem;font-weight:800;border:1px solid var(--line);border-radius:12px;min-height:58px;background:var(--card);color:var(--text)}
.btn{width:100%;border:0;border-radius:10px;padding:14px;font-weight:700;font-size:.95rem;background:var(--brand);color:#fff;margin-top:18px}
.msg{text-align:center;font-size:.82rem;color:var(--muted);min-height:18px;margin-top:10px}
.err{text-align:center;padding:40px 16px;color:var(--muted)}
button{cursor:pointer}
</style>
</head><body>
<div class="wrap">
<div class="mark">🚒</div>
<h1 id="title">Lädt…</h1>
<div id="body"></div>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const titleEl = document.getElementById('title');
const bodyEl = document.getElementById('body');

async function api(path, opts){
  const res = await fetch(path, opts);
  if(!res.ok) throw new Error('http '+res.status);
  return res.json();
}

function statusLabel(s){ return {frei:'Frei',alarmiert:'Alarmiert',einsatz:'Im Einsatz'}[s] || s; }

async function load(){
  let state;
  try{ state = await api('/api/state/'+TOKEN); }
  catch(e){
    titleEl.textContent = 'Nicht gefunden';
    bodyEl.innerHTML = '<div class="err">Dieser Link ist ungültig oder abgelaufen.</div>';
    return;
  }
  titleEl.textContent = state.funkrufname || 'Fahrzeug';
  let personnel = {mannschaft:0, paTraeger:0};
  try{ personnel = await api('/api/personnel/'+TOKEN); }catch(e){}

  bodyEl.innerHTML = \`
    <div class="card">
      <div class="status-row" id="statusRow">
        <button data-s="frei">Frei</button>
        <button data-s="alarmiert">Alarmiert</button>
        <button data-s="einsatz">Im Einsatz</button>
      </div>
    </div>
    <div class="field"><label>Mannschaftsstärke</label></div>
    <div class="stepper">
      <button class="step-btn" id="mMinus">−</button>
      <input type="number" inputmode="numeric" min="0" max="99" id="mInput" value="\${personnel.mannschaft||0}">
      <button class="step-btn" id="mPlus">+</button>
    </div>
    <div class="field"><label>PA-Träger</label></div>
    <div class="stepper">
      <button class="step-btn" id="paMinus">−</button>
      <input type="number" inputmode="numeric" min="0" max="99" id="paInput" value="\${personnel.paTraeger||0}">
      <button class="step-btn" id="paPlus">+</button>
    </div>
    <button class="btn" id="saveBtn">Melden</button>
    <div class="msg" id="msg"></div>
  \`;
  renderStatus(state.status);
  document.querySelectorAll('#statusRow button').forEach(b=>{
    b.onclick = async ()=>{
      try{
        await api('/api/status/'+TOKEN, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:b.dataset.s})});
        renderStatus(b.dataset.s);
        document.getElementById('msg').textContent = 'Status aktualisiert.';
      }catch(e){ document.getElementById('msg').textContent = 'Konnte Status nicht setzen.'; }
    };
  });
  const mInput = document.getElementById('mInput'), paInput = document.getElementById('paInput');
  document.getElementById('mMinus').onclick = ()=>{ mInput.value = Math.max(0,(parseInt(mInput.value,10)||0)-1); };
  document.getElementById('mPlus').onclick = ()=>{ mInput.value = Math.min(99,(parseInt(mInput.value,10)||0)+1); };
  document.getElementById('paMinus').onclick = ()=>{ paInput.value = Math.max(0,(parseInt(paInput.value,10)||0)-1); };
  document.getElementById('paPlus').onclick = ()=>{ paInput.value = Math.min(99,(parseInt(paInput.value,10)||0)+1); };
  document.getElementById('saveBtn').onclick = async ()=>{
    try{
      await api('/api/personnel/'+TOKEN, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        mannschaft: parseInt(mInput.value,10)||0, paTraeger: parseInt(paInput.value,10)||0
      })});
      document.getElementById('msg').textContent = 'Danke, Meldung gespeichert!';
    }catch(e){ document.getElementById('msg').textContent = 'Konnte Meldung nicht speichern.'; }
  };
}
function renderStatus(current){
  document.querySelectorAll('#statusRow button').forEach(b=>{
    b.classList.toggle('on', b.dataset.s===current);
    b.classList.toggle(b.dataset.s, b.dataset.s===current);
  });
}
load();
setInterval(load, 8000); // haelt Status/Mannschaft aktuell, falls anderswo geaendert
</script>
</body></html>`;
}

const meldeApp = express();
meldeApp.use(express.json({ limit: '2kb' }));

meldeApp.get('/melden/:token', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(meldeHTML(req.params.token));
});

meldeApp.get('/api/state/:token', (req, res) => {
  const vehicleId = resolveVehicleId(req.params.token);
  const v = vehicleId && findVehicle(vehicleId);
  if (!v) return sendJSON(res, 404, { error: 'not_found' });
  const status = (store[K_STATUS] || {})[vehicleId] || 'frei';
  sendJSON(res, 200, { funkrufname: v.funkrufname || '', status });
});

meldeApp.get('/api/personnel/:token', (req, res) => {
  const vehicleId = resolveVehicleId(req.params.token);
  if (!vehicleId || !findVehicle(vehicleId)) return sendJSON(res, 404, { error: 'not_found' });
  const p = (store[K_PERSONNEL] || {})[vehicleId] || { mannschaft: 0, paTraeger: 0 };
  sendJSON(res, 200, { mannschaft: p.mannschaft || 0, paTraeger: p.paTraeger || 0 });
});

meldeApp.post('/api/status/:token', (req, res) => {
  const token = req.params.token;
  const vehicleId = resolveVehicleId(token);
  const v = vehicleId && findVehicle(vehicleId);
  if (!v) return sendJSON(res, 404, { error: 'not_found' });
  if (rateLimited(token)) return sendJSON(res, 429, { error: 'rate_limited' });
  const status = req.body && req.body.status;
  if (!VALID_STATUS.includes(status)) return sendJSON(res, 400, { error: 'invalid_status' });

  const statusMap = { ...(store[K_STATUS] || {}) };
  if (status === 'frei') delete statusMap[vehicleId];
  else statusMap[vehicleId] = status;
  store[K_STATUS] = statusMap;

  const log = Array.isArray(store[K_LOG]) ? store[K_LOG] : [];
  log.push({ time: Date.now(), user: 'Selbstmeldung', text: `${v.funkrufname || vehicleId}: Status auf „${status}" gesetzt (extern gemeldet)` });
  store[K_LOG] = log.slice(-500);

  saveStore();
  broadcast({ type: 'update', key: K_STATUS, value: store[K_STATUS] });
  broadcast({ type: 'update', key: K_LOG, value: store[K_LOG] });
  sendJSON(res, 200, { ok: true });
});

meldeApp.post('/api/personnel/:token', (req, res) => {
  const token = req.params.token;
  const vehicleId = resolveVehicleId(token);
  const v = vehicleId && findVehicle(vehicleId);
  if (!v) return sendJSON(res, 404, { error: 'not_found' });
  if (rateLimited(token)) return sendJSON(res, 429, { error: 'rate_limited' });

  const mannschaft = Number(req.body && req.body.mannschaft);
  const paTraeger = Number(req.body && req.body.paTraeger);
  if (!Number.isInteger(mannschaft) || mannschaft < 0 || mannschaft > 99) return sendJSON(res, 400, { error: 'invalid_mannschaft' });
  if (!Number.isInteger(paTraeger) || paTraeger < 0 || paTraeger > 99) return sendJSON(res, 400, { error: 'invalid_pa' });

  const personnelMap = { ...(store[K_PERSONNEL] || {}) };
  personnelMap[vehicleId] = { mannschaft, paTraeger };
  store[K_PERSONNEL] = personnelMap;

  const log = Array.isArray(store[K_LOG]) ? store[K_LOG] : [];
  log.push({ time: Date.now(), user: 'Selbstmeldung', text: `${v.funkrufname || vehicleId}: Stärke gemeldet (Mannschaft ${mannschaft}, PA ${paTraeger})` });
  store[K_LOG] = log.slice(-500);

  saveStore();
  broadcast({ type: 'update', key: K_PERSONNEL, value: store[K_PERSONNEL] });
  broadcast({ type: 'update', key: K_LOG, value: store[K_LOG] });
  sendJSON(res, 200, { ok: true });
});

// Alles andere auf diesem Port: bewusst nichts (kein Zugriff auf App/Daten/Dateien)
meldeApp.use((req, res) => sendJSON(res, 404, { error: 'not_found' }));

const meldeServer = http.createServer(meldeApp);
meldeServer.listen(MELDE_PORT, () => {
  console.log(`Isolierter Meldeserver läuft auf Port ${MELDE_PORT} (nur Status + Mannschaft, pro Fahrzeug per Token).`);
  console.log(`Nur diesen Port nach außen freigeben, NICHT Port ${PORT}.`);
});
