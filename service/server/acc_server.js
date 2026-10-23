/* FORGEDTITANIUM ACC-R011 server.
   Authenticated agent event intake, persistent storage and append-only audit log.
   Local only by default (127.0.0.1). Not deployed. No external network calls.

   Agent authentication: per-agent HMAC-SHA256 keys issued only for verified agent codes.
     X-ACC-Key-Id     key identifier
     X-ACC-Timestamp  request time, ISO 8601 UTC (Z), within 5 minutes of server time
     X-ACC-Nonce      16-128 chars [A-Za-z0-9_-], single use per key
     X-ACC-Signature  hex HMAC-SHA256(secret, METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256hex(body))
   Every event in a report must carry the agent code the key is bound to.
   Dashboard reads use a viewer bearer token (stored only as a SHA-256 hash).

   Two listeners (R010):
     private  (ACC_PORT, default 8787)        dashboard, reads, audit and intake: LAN or tailnet only
     ingest   (ACC_INGEST_PORT, e.g. 8788)    POST /v1/events and GET /v1/health only: the one path a
                                              public HTTPS tunnel may forward to
   ACC_TRUST_PROXY=1 records the client address from X-Forwarded-For / CF-Connecting-IP in the audit log,
   only for connections arriving from loopback (the local tunnel or proxy). */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ACC = require('../acc_core.js');
const PUBLIC = require('./public_status.js');

const GENESIS = '0'.repeat(64);
const SKEW_MS = 5 * 60 * 1000;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/acc_core.js': 'acc_core.js', '/acc_register.js': 'acc_register.js' };

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const iso = ms => new Date(ms).toISOString();

function canonical(method, p, ts, nonce, body) {
  return [method.toUpperCase(), p, ts, nonce, sha256(body)].join('\n');
}
function sign(secretB64, method, p, ts, nonce, body) {
  return crypto.createHmac('sha256', Buffer.from(secretB64, 'base64url')).update(canonical(method, p, ts, nonce, body)).digest('hex');
}

/* ---------- storage ---------- */
function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'acc_events.sqlite3'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, agent_key TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL, received_at_utc TEXT NOT NULL, key_id TEXT NOT NULL,
      schema_version TEXT NOT NULL, raw_json TEXT NOT NULL, flags_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_ts ON events(timestamp_utc);
    CREATE TABLE IF NOT EXISTS rejections (
      id INTEGER PRIMARY KEY, received_at_utc TEXT NOT NULL, key_id TEXT, event_index INTEGER,
      code TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nonces (key_id TEXT NOT NULL, nonce TEXT NOT NULL, seen_ms INTEGER NOT NULL, PRIMARY KEY (key_id, nonce));
    CREATE TABLE IF NOT EXISTS audit (
      seq INTEGER PRIMARY KEY, at_utc TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
      detail_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  `);
  return db;
}

function auditHash(prev, seq, at, actor, action, detail) {
  return sha256([prev, seq, at, actor, action, detail].join('|'));
}

function appendAudit(db, nowMs, actor, action, detail) {
  const last = db.prepare('SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1').get();
  const seq = last ? last.seq + 1 : 1;
  const prev = last ? last.hash : GENESIS;
  const at = iso(nowMs);
  const d = JSON.stringify(detail || {});
  const h = auditHash(prev, seq, at, actor, action, d);
  db.prepare('INSERT INTO audit (seq, at_utc, actor, action, detail_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(seq, at, actor, action, d, prev, h);
  return { seq, hash: h };
}

function verifyAudit(db) {
  const rows = db.prepare('SELECT * FROM audit ORDER BY seq').all();
  let prev = GENESIS, expect = 1;
  for (const r of rows) {
    if (r.seq !== expect) return { intact: false, entries: rows.length, broken_at: r.seq, reason: 'sequence gap' };
    if (r.prev_hash !== prev) return { intact: false, entries: rows.length, broken_at: r.seq, reason: 'previous-hash mismatch' };
    if (auditHash(r.prev_hash, r.seq, r.at_utc, r.actor, r.action, r.detail_json) !== r.hash) return { intact: false, entries: rows.length, broken_at: r.seq, reason: 'entry altered' };
    prev = r.hash; expect++;
  }
  return { intact: true, entries: rows.length, head: prev };
}

/* ---------- backups and retention (R010) ---------- */
function stamp(ms) { return iso(ms).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function fileSha(f) { return sha256(fs.readFileSync(f)); }

function dbStats(db) {
  const n = q => db.prepare(q).get().n;
  const a = verifyAudit(db);
  return { events: n('SELECT COUNT(*) n FROM events'), rejections: n('SELECT COUNT(*) n FROM rejections'),
    audit_entries: a.entries, audit_intact: a.intact, audit_head: a.head || null,
    oldest_event_utc: (db.prepare('SELECT MIN(timestamp_utc) t FROM events').get() || {}).t || null,
    newest_event_utc: (db.prepare('SELECT MAX(timestamp_utc) t FROM events').get() || {}).t || null };
}

/* Consistent online copy (VACUUM INTO), checked and described by a manifest. Keys are never included. */
function backupDb(ctx, destDir, actor) {
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  const t = ctx.now();
  const file = path.join(destDir, 'acc_events_' + stamp(t) + '.sqlite3');
  if (fs.existsSync(file)) throw new Error('backup already exists: ' + file);
  ctx.db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
  fs.chmodSync(file, 0o600);
  const copy = new DatabaseSync(file, { readOnly: true });
  let st; try { st = dbStats(copy); } finally { copy.close(); }
  if (!st.audit_intact) { fs.unlinkSync(file); throw new Error('audit chain broken in the backup copy; backup discarded'); }
  const manifest = Object.assign({ release: ACC.RELEASE, file: path.basename(file), created_at_utc: iso(t), sha256: fileSha(file), bytes: fs.statSync(file).size }, st);
  fs.writeFileSync(file + '.manifest.json', JSON.stringify(manifest, null, 2), { mode: 0o600 });
  appendAudit(ctx.db, ctx.now(), actor || 'admin', 'backup_created', { file: manifest.file, sha256: manifest.sha256, events: st.events, audit_head: st.audit_head });
  return Object.assign({ path: file }, manifest);
}

function verifyBackup(file) {
  const mf = file + '.manifest.json';
  if (!fs.existsSync(mf)) return { ok: false, reason: 'manifest missing' };
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (fileSha(file) !== m.sha256) return { ok: false, reason: 'checksum mismatch' };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const st = dbStats(db);
    if (!st.audit_intact) return { ok: false, reason: 'audit chain broken' };
    if (st.audit_head !== m.audit_head || st.events !== m.events) return { ok: false, reason: 'content differs from manifest' };
    return { ok: true, events: st.events, audit_entries: st.audit_entries, created_at_utc: m.created_at_utc };
  } finally { db.close(); }
}

/* Off-site friendly audit export: one JSON line per entry, chain fields included so it can be re-verified. */
function exportAudit(ctx, file, actor) {
  const rows = ctx.db.prepare('SELECT seq, at_utc, actor, action, detail_json, prev_hash, hash FROM audit ORDER BY seq').all();
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  appendAudit(ctx.db, ctx.now(), actor || 'admin', 'audit_exported', { entries: rows.length, head: rows.length ? rows[rows.length - 1].hash : GENESIS });
  return { entries: rows.length, file };
}

function verifyAuditExport(file) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || auditHash(r.prev_hash, r.seq, r.at_utc, r.actor, r.action, r.detail_json) !== r.hash) return { intact: false, broken_at: r.seq };
    prev = r.hash;
  }
  return { intact: true, entries: rows.length, head: prev };
}

/* ---------- keys ---------- */
function readKeys(keysFile) {
  if (!fs.existsSync(keysFile)) return { agent_keys: [], viewer_tokens: [] };
  const k = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  return { agent_keys: k.agent_keys || [], viewer_tokens: k.viewer_tokens || [] };
}
function writeKeys(keysFile, k) {
  fs.mkdirSync(path.dirname(keysFile), { recursive: true, mode: 0o700 });
  const tmp = keysFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(k, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, keysFile);
}

function verifiedAgent(code) {
  return ACC.REGISTER.find(a => a.code === code && a.verification === 'verified') || null;
}

function issueAgentKey(ctx, agentCode, actor) {
  const agent = verifiedAgent(agentCode);
  if (!agent) throw new Error('Keys are issued only for verified agent codes in acc_register.js; "' + agentCode + '" is not one.');
  const k = readKeys(ctx.keysFile);
  const keyId = 'k_' + crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  k.agent_keys.push({ key_id: keyId, agent_code: agentCode, secret_b64url: secret, created_at_utc: iso(ctx.now()), revoked_at_utc: null });
  writeKeys(ctx.keysFile, k);
  appendAudit(ctx.db, ctx.now(), actor || 'admin', 'agent_key_issued', { key_id: keyId, agent_code: agentCode });
  return { key_id: keyId, secret_b64url: secret, agent_code: agentCode };
}

function issueViewerToken(ctx, label, actor) {
  const k = readKeys(ctx.keysFile);
  const tokenId = 'v_' + crypto.randomBytes(6).toString('hex');
  const token = crypto.randomBytes(32).toString('base64url');
  k.viewer_tokens.push({ token_id: tokenId, label: String(label || '').slice(0, 80), sha256: sha256(token), created_at_utc: iso(ctx.now()), revoked_at_utc: null });
  writeKeys(ctx.keysFile, k);
  appendAudit(ctx.db, ctx.now(), actor || 'admin', 'viewer_token_issued', { token_id: tokenId, label });
  return { token_id: tokenId, token };
}

function revoke(ctx, id, actor) {
  const k = readKeys(ctx.keysFile);
  const item = k.agent_keys.find(x => x.key_id === id) || k.viewer_tokens.find(x => x.token_id === id);
  if (!item) throw new Error('No key or token ' + id);
  if (!item.revoked_at_utc) item.revoked_at_utc = iso(ctx.now());
  writeKeys(ctx.keysFile, k);
  appendAudit(ctx.db, ctx.now(), actor || 'admin', 'revoked', { id });
  return item.revoked_at_utc;
}

/* ---------- request helpers ---------- */
function send(res, status, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {}));
  res.end(body);
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, over = false;
    req.on('data', c => { n += c.length; if (n > max) { over = true; chunks.length = 0; if (n > max * 8) req.destroy(); } else if (!over) chunks.push(c); });
    req.on('end', () => over ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createAccServer(opts) {
  const o = opts || {};
  const now = o.now || (() => Date.now());
  const dataDir = o.dataDir || process.env.ACC_DATA_DIR || path.join(process.cwd(), 'acc_data');
  const keysFile = o.keysFile || process.env.ACC_KEYS_FILE || path.join(dataDir, 'acc_keys.json');
  const staticDir = o.staticDir || path.join(__dirname, '..');
  const maxBody = o.maxBody || 256 * 1024;
  const maxEvents = o.maxEvents || 500;
  const ratePerMin = o.ratePerMin || 60;
  /* ACC_TRUST_PROXY: unset/0 = never trust forwarding headers; 1 = trust them only from a loopback peer (a tunnel on the same
     host); private = also from private-range peers (RFC 1918, loopback, IPv6 unique-local fc00::/7), which is what a managed host's
     proxy looks like to the container. Without this, every visitor behind such a proxy shares one address and one rate limit. */
  const trustProxy = o.trustProxy !== undefined ? o.trustProxy : (process.env.ACC_TRUST_PROXY === 'private' ? 'private' : process.env.ACC_TRUST_PROXY === '1');
  /* Restricted public status (ACC-R014). OFF unless ACC_PUBLIC_STATUS=1. Read-only, no authentication, redacted by an
     allowlist (see public_status.js). CORS is granted only to the single https origin in ACC_PUBLIC_ORIGIN. */
  const publicStatusOn = o.publicStatus !== undefined ? !!o.publicStatus : process.env.ACC_PUBLIC_STATUS === '1';
  const publicOrigin = o.publicOrigin !== undefined ? o.publicOrigin : (process.env.ACC_PUBLIC_ORIGIN || '');
  if (publicOrigin && !/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(publicOrigin)) throw new Error('ACC_PUBLIC_ORIGIN must be one https origin, for example https://example.github.io');
  let publicCache = null;
  const db = openDb(dataDir);
  const ctx = { db, keysFile, now };
  const rate = new Map();
  /* Failed authentication from the public side is limited per client address: the first 20 a minute are audited
     one by one, the rest get 429 and a single summary entry per minute, so a flood cannot fill the audit log. */
  const failLimitPerMin = o.failLimitPerMin || 20;
  const fails = new Map();
  function authFailure(req, res, detail) {
    const who = remoteOf(req), minute = Math.floor(now() / 60000);
    let f = fails.get(who);
    if (!f || f.minute !== minute) {
      if (f && f.suppressed) appendAudit(db, now(), 'unauthenticated', 'auth_failed_suppressed', { remote: who, minute_utc: iso(f.minute * 60000), suppressed: f.suppressed });
      f = { minute, n: 0, suppressed: 0 }; fails.set(who, f);
      if (fails.size > 10000) fails.clear();
    }
    f.n++;
    if (f.n > failLimitPerMin) { f.suppressed++; return send(res, 429, { error: 'too many failed attempts' }); }
    appendAudit(db, now(), 'unauthenticated', detail.action, Object.assign({ remote: who }, detail.data));
    return send(res, 401, { error: 'authentication_failed' });
  }

  appendAudit(db, now(), 'server', 'server_started', { release: ACC.RELEASE, audit: verifyAudit(db).intact ? 'intact' : 'broken', public_status: publicStatusOn });

  function authAgent(req, body) {
    const h = n => req.headers[n];
    const keyId = h('x-acc-key-id'), ts = h('x-acc-timestamp'), nonce = h('x-acc-nonce'), sig = h('x-acc-signature');
    if (!keyId || !ts || !nonce || !sig) return { ok: false, reason: 'missing authentication headers', keyId };
    const key = readKeys(keysFile).agent_keys.find(k => k.key_id === keyId);
    if (!key) return { ok: false, reason: 'unknown key', keyId };
    if (key.revoked_at_utc) return { ok: false, reason: 'revoked key', keyId };
    if (!verifiedAgent(key.agent_code)) return { ok: false, reason: 'key bound to an agent that is no longer verified', keyId };
    if (!TS_RE.test(ts) || Math.abs(now() - Date.parse(ts)) > SKEW_MS) return { ok: false, reason: 'timestamp missing, malformed or outside 5 minutes', keyId };
    if (!NONCE_RE.test(nonce)) return { ok: false, reason: 'malformed nonce', keyId };
    const expected = sign(key.secret_b64url, req.method, req.url.split('?')[0], ts, nonce, body);
    if (!/^[0-9a-f]{64}$/.test(sig) || !safeEq(expected, sig)) return { ok: false, reason: 'bad signature', keyId };
    db.prepare('DELETE FROM nonces WHERE seen_ms < ?').run(now() - 2 * SKEW_MS);
    try { db.prepare('INSERT INTO nonces (key_id, nonce, seen_ms) VALUES (?, ?, ?)').run(keyId, nonce, now()); }
    catch { return { ok: false, reason: 'nonce replayed', keyId }; }
    return { ok: true, key };
  }

  function authViewer(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const hash = sha256(m[1]);
    return readKeys(keysFile).viewer_tokens.find(t => !t.revoked_at_utc && safeEq(t.sha256, hash)) || null;
  }

  function limited(id) {
    const minute = Math.floor(now() / 60000), r = rate.get(id);
    if (!r || r.minute !== minute) { rate.set(id, { minute, n: 1 }); return false; }
    r.n++; return r.n > ratePerMin;
  }

  function ingest(report, key) {
    const t = now(), received = iso(t);
    const version = report && report.version !== undefined ? String(report.version) : null;
    if (!report || typeof report !== 'object' || Array.isArray(report)) return { status: 400, body: { error: 'report must be a JSON object' } };
    if (!['1.0', '1.1'].includes(version)) return { status: 400, body: { error: 'unsupported or missing schema version (expected 1.0 or 1.1)' } };
    if (!Array.isArray(report.events)) return { status: 400, body: { error: 'expected an events array' } };
    if (report.events.length > maxEvents) return { status: 413, body: { error: 'too many events (max ' + maxEvents + ')' } };
    const out = { accepted: 0, duplicates: 0, rejected: 0, results: [] };
    const insert = db.prepare('INSERT OR IGNORE INTO events (dedupe_key, agent_key, timestamp_utc, received_at_utc, key_id, schema_version, raw_json, flags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const reject = db.prepare('INSERT INTO rejections (received_at_utc, key_id, event_index, code, reason) VALUES (?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
      report.events.forEach((raw, i) => {
        if (raw && typeof raw === 'object' && raw.agent_id !== key.agent_code) {
          out.rejected++; reject.run(received, key.key_id, i, 'AGENT_KEY_MISMATCH', 'Event agent_id does not match the agent code bound to this key');
          out.results.push({ index: i, outcome: 'rejected', code: 'AGENT_KEY_MISMATCH' }); return;
        }
        const v = ACC.validateEvent(raw, version, t);
        if (!v.ok) { out.rejected++; reject.run(received, key.key_id, i, v.code, v.reason); out.results.push({ index: i, outcome: 'rejected', code: v.code }); return; }
        const r = insert.run(ACC.dedupeKey(v.event), v.event.agent_key, v.event.timestamp_utc, received, key.key_id, version, JSON.stringify(raw), JSON.stringify(v.event.flags));
        if (r.changes === 0) { out.duplicates++; out.results.push({ index: i, outcome: 'duplicate' }); return; }
        out.accepted++; out.results.push({ index: i, outcome: 'accepted', flags: v.event.flags.map(f => f.code) });
        if (v.event.flags.some(f => f.code === 'DELIVERED_LATE')) out.late = (out.late || 0) + 1;
        if (v.event.delivery && v.event.delivery.dropped_before) out.dropped_reported = (out.dropped_reported || 0) + v.event.delivery.dropped_before;
      });
      appendAudit(db, t, 'agent:' + key.agent_code, 'report_received', { key_id: key.key_id, accepted: out.accepted, duplicates: out.duplicates, rejected: out.rejected,
        late: out.late || 0, dropped_reported: out.dropped_reported || 0,
        flags: out.results.flatMap(r => r.flags || []).filter(c => !['PRE_V1_1', 'STALE', 'LIVE_WITHIN_ALLOWANCE'].includes(c)) });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { status: 200, body: out };
  }

  function loadStore() {
    const store = ACC.createStore();
    const rows = db.prepare('SELECT schema_version, raw_json, key_id, received_at_utc FROM events ORDER BY timestamp_utc').all();
    for (const r of rows) ACC.ingestReport(store, { version: r.schema_version, events: [JSON.parse(r.raw_json)] }, now(), 'acc-server', { authenticated: true, key_id: r.key_id, received_at_utc: r.received_at_utc });
    return store;
  }

  function isPrivatePeer(addr) {
    const a = String(addr || '').replace(/^::ffff:/i, '').toLowerCase();
    return /^127\./.test(a) || a === '::1' || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd][0-9a-f]{2}:/.test(a);
  }
  function remoteOf(req) {
    const direct = req.socket.remoteAddress;
    const trusted = trustProxy === 'private' ? isPrivatePeer(direct) : (trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct));
    if (!trusted) return direct;
    const raw = trustProxy === 'private' ? (req.headers['fly-client-ip'] || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) : (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
    const fwd = String(raw || '').split(',')[0].trim();
    return /^[0-9a-fA-F:.]{2,45}$/.test(fwd) ? fwd + ' (via proxy)' : direct;
  }

  async function handle(req, res, ingestOnly) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      const isPublicStatus = publicStatusOn && req.method === 'GET' && p === '/public/status.json';
      if (ingestOnly && !((req.method === 'POST' && p === '/v1/events') || (req.method === 'GET' && p === '/v1/health') || isPublicStatus)) {
        return send(res, 404, { error: 'not found' });
      }
      if (req.method === 'GET' && STATIC[p]) {
        const f = path.join(staticDir, STATIC[p]);
        res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
        return res.end(fs.readFileSync(f));
      }
      if (isPublicStatus) {
        if (limited('public:' + remoteOf(req))) return send(res, 429, { error: 'rate limit exceeded' });
        const t = now();
        if (!publicCache || t - publicCache.at > 30000) {
          const rows = db.prepare('SELECT schema_version, raw_json, key_id, received_at_utc FROM events ORDER BY timestamp_utc').all();
          publicCache = { at: t, body: PUBLIC.buildPublicStatus(rows, t) };
        }
        const h = { 'Cache-Control': 'public, max-age=30', 'Referrer-Policy': 'no-referrer' };
        if (publicOrigin) { h['Access-Control-Allow-Origin'] = publicOrigin; h['Vary'] = 'Origin'; }
        return send(res, 200, publicCache.body, h);
      }
      if (req.method === 'GET' && p === '/v1/health') return ingestOnly
        ? send(res, 200, { ok: true })
        : send(res, 200, { ok: true, release: ACC.RELEASE, time_utc: iso(now()), audit_chain: verifyAudit(db).intact ? 'intact' : 'broken' });

      if (req.method === 'POST' && p === '/v1/events') {
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'content-type must be application/json' });
        if (parseInt(req.headers['content-length'] || '0', 10) > maxBody) { res.setHeader('Connection', 'close'); return send(res, 413, { error: 'body too large' }); }
        let body;
        try { body = await readBody(req, maxBody); } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? 'body too large' : 'read error' }); }
        const a = authAgent(req, body);
        if (!a.ok) return authFailure(req, res, { action: 'auth_failed', data: { key_id: a.keyId || null, reason: a.reason } });
        if (limited(a.key.key_id)) { appendAudit(db, now(), 'agent:' + a.key.agent_code, 'rate_limited', { key_id: a.key.key_id }); return send(res, 429, { error: 'rate limit exceeded' }); }
        let report;
        try { report = JSON.parse(body.toString('utf8')); } catch { appendAudit(db, now(), 'agent:' + a.key.agent_code, 'report_invalid_json', { key_id: a.key.key_id }); return send(res, 400, { error: 'invalid JSON' }); }
        const r = ingest(report, a.key);
        if (r.status !== 200) appendAudit(db, now(), 'agent:' + a.key.agent_code, 'report_refused', { key_id: a.key.key_id, error: r.body.error });
        return send(res, r.status, r.body);
      }

      if (req.method === 'GET' && p.startsWith('/v1/')) {
        const viewer = authViewer(req);
        if (!viewer) return authFailure(req, res, { action: 'viewer_auth_failed', data: { path: p } });
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '1000', 10) || 1000, 1), 5000);
        if (p === '/v1/events') {
          const since = url.searchParams.get('since');
          const rows = since && Number.isFinite(Date.parse(since))
            ? db.prepare('SELECT * FROM events WHERE timestamp_utc >= ? ORDER BY timestamp_utc DESC LIMIT ?').all(new Date(Date.parse(since)).toISOString(), limit)
            : db.prepare('SELECT * FROM events ORDER BY timestamp_utc DESC LIMIT ?').all(limit);
          appendAudit(db, now(), 'viewer:' + viewer.token_id, 'events_read', { count: rows.length });
          return send(res, 200, { release: ACC.RELEASE, records: rows.map(r => ({ schema_version: r.schema_version, raw: JSON.parse(r.raw_json), key_id: r.key_id, received_at_utc: r.received_at_utc, flags: JSON.parse(r.flags_json) })) });
        }
        if (p === '/v1/rejections') return send(res, 200, { rejections: db.prepare('SELECT * FROM rejections ORDER BY id DESC LIMIT ?').all(limit) });
        if (p === '/v1/audit') return send(res, 200, { entries: db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit).map(r => Object.assign(r, { detail: JSON.parse(r.detail_json) })) });
        if (p === '/v1/audit/verify') return send(res, 200, verifyAudit(db));
        if (p === '/v1/summary') {
          const s = ACC.summarise(loadStore(), now());
          return send(res, 200, { time_utc: iso(now()), reporting: s.reportingCount, registered: s.registered, verified: s.verifiedCount, working: s.workingCount,
            approvals_pending: s.approvals.length, violations: s.violations, reviews: s.reviews,
            api_cost_today_eur: s.cost.hasApi ? s.cost.apiEur : null,
            allowance_breaches: s.allowances.flatMap(x => x.usage.breaches.map(b => Object.assign({ agent: x.agent.name }, b))) });
        }
        return send(res, 404, { error: 'not found' });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      try { appendAudit(db, now(), 'server', 'server_error', { path: p, message: String(e && e.message).slice(0, 200) }); } catch {}
      return send(res, 500, { error: 'server error' });
    }
  }

  const server = http.createServer((q, r) => handle(q, r, false));
  let ingestServer = null;
  return {
    server, db, ctx,
    listenIngest(port, host) {
      const h = host || '127.0.0.1';
      if (!['127.0.0.1', '::1', 'localhost'].includes(h) && process.env.ACC_ALLOW_NON_LOCAL !== '1') throw new Error('Refusing to bind the ingest listener to ' + h + ': local only (a tunnel or proxy forwards to it).');
      ingestServer = http.createServer((q, r) => handle(q, r, true));
      return new Promise(r => ingestServer.listen(port, h, () => r(ingestServer.address())));
    },
    listen(port, host) {
      const h = host || '127.0.0.1';
      if (!['127.0.0.1', '::1', 'localhost'].includes(h) && process.env.ACC_ALLOW_NON_LOCAL !== '1') throw new Error('Refusing to bind to ' + h + ': the ACC is local only. Set ACC_ALLOW_NON_LOCAL=1 only after deployment approval.');
      return new Promise(r => server.listen(port, h, () => r(server.address())));
    },
    close() {
      const closeOne = srv => new Promise(r => srv ? srv.close(() => r()) : r());
      return Promise.all([closeOne(server), closeOne(ingestServer)]).then(() => { try { db.close(); } catch {} });
    }
  };
}

function publicStatusDoc(db, nowMs) {
  const rows = db.prepare('SELECT schema_version, raw_json, key_id, received_at_utc FROM events ORDER BY timestamp_utc').all();
  return PUBLIC.buildPublicStatus(rows, nowMs);
}

module.exports = { createAccServer, sign, canonical, verifyAudit, appendAudit, issueAgentKey, issueViewerToken, revoke, readKeys, openDb,
  dbStats, backupDb, verifyBackup, exportAudit, verifyAuditExport, publicStatusDoc };

if (require.main === module) {
  const s = createAccServer();
  const host = process.env.ACC_HOST || '127.0.0.1';
  s.listen(parseInt(process.env.ACC_PORT || '8787', 10), host)
    .then(a => {
      console.log(ACC.RELEASE + ' private listener on http://' + a.address + ':' + a.port);
      if (process.env.ACC_INGEST_PORT) return s.listenIngest(parseInt(process.env.ACC_INGEST_PORT, 10), host).then(b => console.log(ACC.RELEASE + ' ingest-only listener on http://' + b.address + ':' + b.port));
    })
    .catch(e => { console.error(e.message); process.exit(2); });
  const stop = () => {
    setTimeout(() => process.exit(0), 3000).unref();   // never hang a container stop
    s.server.closeIdleConnections && s.server.closeIdleConnections();
    s.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
