/* FORGEDTITANIUM ACC visual layer. Decorative only: it draws the three-dimensional Earth, the cinematic backdrop and the camera tween.
   It reads no data, makes no request and stores nothing. Everything that reflects agent state is decided in index.html from the
   restricted public status document, never here. The land mask is Natural Earth 110m land at 2 degrees (public domain); the city
   lights on the night side are decorative texture, not data. */
(function(){
'use strict';
const LAND_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAfAP8HAAAAAAAAAAAAAAAAAAAAAADo//z//wcAAAAAAAACAAAAAAAAAAAAhvvw//8PAPABAAAAwAMAAAAAAAAAwADkw////wEABAAAAABgAAAAAAAAAADAUT8A/v8PAAAAAAwA/j8AuAEAAAAAcBHtDcD/fwAAAAAwAPz/fwMAABCAAQD5w/wD8P8FAAAcAIL7//9//xOAAP/ff0668QD/HwAA+A8At///////v3/w/////x8++B8AAOD/1//7////////jP////+/+AE/gAcAn9f//////////w/w/////wEs4AEAAHz+////////////gL////8HeAAcAADg5///////////9ADgAf7/f4AnAAAAAH78////////H0QAAAiA//8f8AcAAIBB4////////38ADwAQAOD//5//AQAAHAT/////////A3AAAAAA/v//+T8AAGDz//////////8DAQAAAMD/////AwAAsP//////////LwAAAAAA6P///2IAAAD+//////////8CAAAAAAD///8/CAAA4P//////////JwAAAAAA8P///wYAAAD+/unz/////z8AAAAAAAD///8HAAAA/pgPPP//////MQAAAAAA8P//PwAAAMBD9v7n/////wcBAAAAAAD///8AAAAAPkD7f/7///8hEAAAAAAA4P//DwAAAIDhAv/n////f8YAAAAAAAD8//8AAAAA+AdE//////8jDwAAAAAAgP//AwAAAMD/APD/////PxgAAAAAAADw/x8AAAAA/n/v//////8HAAAAAAAAAPwDAgAAAOD////7////fwAAAAAAAACgHyAAAACA//9/f/7///8DAAAAAAAAAPQBAAAAAPj//+cv+P//PwAAAAAAAAAAHjAAAADA/////g/+//8EAAAAAAAAAOBhCAAAAP7//99/4D//AAAAAAAAAAAAPAMEAADA////+Qf84BcAAAAAAAAAAAA/AAAAAPz//58fgAf+QAAAAAAAAAAAAA8AAADg////ewA4gA8EAAAAAAAAAADAAAAAAPz//38BgAP4QQAAAAAAAAAAAAgPAADA////zwAwgAwQAAAAAAAAAAAA9Q8AAPj///8HAAVIAAAAAAAAAAAAAID/AQAA////fwBAAAAQAAAAAAAAAAAA+P8AAGDh//8DAAA0GAAAAAAAAAAAAID/HwAAAPj/HwAAgMIBAAAAAAAAAAAA/P8BAACA//8AAAAYXgAAAAAAAAAAAMD/fwAAAPz/BwAAAOOBAQAAAAAAAAAA/P8/AACA/z8AAABgbtQBAAAAAAAAAOD//w8AAPD/AwAAAAQIeAAAAAAAAAAA/P//AQAA/z8AAACAA4APAQAAAAAAAID//w8AAPD/AwAAAAARsEAAAAAAAAAA+P9/AAAA/j8AAAAAAAAAAAAAAAAAAAD//wcAAPD/QwAAAACAIwAAAAAAAAAA8P9/AAAA/z8EAAAAAD8GIAAAAAAAAAD8/wMAAPD/cQAAAAD4ZwAAAAAAAAAAgP8/AAAA/w8HAAAAgP8HAAAAAAAAAAD4/wMAAOD/MAAAAAD//wEBAAAAAAAAgP8PAAAA/g8DAAAA+P8fAAAAAAAAAAD4PwAAAOB/EAAAAID//wMAAAAAAAAAgP8DAAAA/AMAAAAA+P9/AAAAAAAAAAD8HwAAAMA/AAAAAID//wcAAAAAAAAAwP8BAAAA+AEAAAAA8P9/AAAAAAAAAAD8DwAAAIAPAAAAAAAP/gMAAAAAAAAAwB8AAAAAAAAAAAAAEIAfAAEAAAAAAAD+AwAAAAAAAAAAAAAA8AEgAAAAAAAA4AcAAAAAAAAAAAAAAAAAAAYAAAAAAABeAAAAAAAAAAAAAAAAwAAwAAAAAAAAwAMAAAAAAAAAAAAAAAAIgAEAAAAAAAAeAAAAAAAAAAAAAAAAAAAMAAAAAAAA4AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAABAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAB4AEDwn/8HAAAAAAAAAAAwAAAAAACA/P/h/////w8AAAAAAAAAwAcAAAD4////z///////PwAAAAAAHALwAACA//////////////8HAADw/y///wMAAP7/////////////HwAA+P///38AAID///////////////8AAPL/////BwAO////////////////DwAA8P////8HEPD//////////////z8AAOD/////////////////////////H/AfwP//////////////////////////////////////////////////////////////////////////////////////';
const LW = 180, LH = 90, FW = 360, FH = 180;
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- land field: the 2-degree mask upsampled to 1 degree and softened so coastlines are smooth ---------- */
let FIELD = null, CITY = null, TEX = null;
function buildFields(){
  const bin = atob(LAND_B64), g = new Float32Array(LW * LH);
  for (let i = 0; i < g.length; i++) g[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  const f = new Float32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const gx = (x + .5) / 2 - .5, gy = (y + .5) / 2 - .5, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
    const at = (xx, yy) => g[clamp(yy, 0, LH - 1) * LW + ((xx % LW) + LW) % LW];
    f[y * FW + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  }
  const t = new Float32Array(f.length);                       // two 3x3 blur passes
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += f[clamp(y + dy, 0, FH - 1) * FW + (x + dx + FW) % FW];
      t[y * FW + x] = s / 9;
    }
    f.set(t);
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const city = new Uint8Array(FW * FH), tex = new Float32Array(FW * FH);
  const lat = new Float32Array(FW * FH); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  for (let y = 1; y < FH - 1; y++) for (let x = 0; x < FW; x++) {                // smooth texture variation
    const i = y * FW + x; tex[i] = (lat[i] + lat[i - 1 < 0 ? i : i - 1] + lat[i + 1] + lat[i - FW] + lat[i + FW]) / 5;
  }
  for (let y = 12; y < FH - 25; y++) for (let x = 0; x < FW; x++) {              // sparse clustered city lights on land only
    const i = y * FW + x;
    if (f[i] > .62 && lat[i] > .9 && tex[i] > .46) city[i] = 1 + ((lat[i] * 977) | 0) % 3;
  }
  FIELD = f; CITY = city; TEX = tex;
}

function createEarth(canvas){
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas'), octx = off.getContext('2d');
  if (!FIELD) buildFields();
  const tilt = 18 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
  let N = 0, S = 0, Rpx = 0, dpr = 1, pre = null, img = null;
  function size(cssSide){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    N = clamp(Math.round(cssSide * dpr), 240, 540); canvas.width = N; canvas.height = N;
    Rpx = N / 2 / 1.22; S = Math.ceil(Rpx * 2) + 2; off.width = S; off.height = S;
    img = octx.createImageData(S, S);
    const n = S * S, fx0 = new Float32Array(n), fy = new Float32Array(n), lam = new Float32Array(n), rim = new Float32Array(n), spec = new Float32Array(n), alpha = new Uint8ClampedArray(n);
    const L = [-.46, .5, .73], ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    const H = [L[0], L[1], L[2] + 1], hl = Math.hypot(...H); H[0] /= hl; H[1] /= hl; H[2] /= hl;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const p = j * S + i, x = ((i + .5) / S) * 2 - 1, y = 1 - ((j + .5) / S) * 2, r2 = x * x + y * y;
      if (r2 >= 1.02) continue;
      const z = Math.sqrt(Math.max(0, 1 - r2)), r = Math.sqrt(r2);
      alpha[p] = clamp((1 - r) * Rpx * .5 + .5, 0, 1) * 255;
      const gy = y * ct + z * st, gz = -y * st + z * ct, gx = x;
      const la = Math.asin(clamp(gy, -1, 1)), lo = Math.atan2(gx, gz);
      fx0[p] = ((lo + Math.PI) / (2 * Math.PI)) * FW; fy[p] = clamp(((Math.PI / 2 - la) / Math.PI) * FH, 0, FH - 1.001);
      lam[p] = Math.max(0, x * L[0] + y * L[1] + z * L[2]);
      rim[p] = Math.pow(1 - z, 2.4);
      spec[p] = Math.pow(Math.max(0, x * H[0] + y * H[1] + z * H[2]), 110);
    }
    pre = { fx0, fy, lam, rim, spec, alpha };
  }
  function draw(t){
    if (!pre) return;
    const { fx0, fy, lam, rim, spec, alpha } = pre, d = img.data, spin = reduced() ? 1.9 : (t / 1000) * 0.075;
    const shift = -(spin / (2 * Math.PI)) * FW, band = ((t / 1000) * 14) % FW;
    for (let p = 0, q = 0; p < alpha.length; p++, q += 4) {
      const a = alpha[p];
      if (!a) { d[q + 3] = 0; continue; }
      let fx = fx0[p] + shift; fx = fx - Math.floor(fx / FW) * FW;
      const x0 = fx | 0, x1 = x0 + 1 === FW ? 0 : x0 + 1, tx = fx - x0, yy = fy[p], y0 = yy | 0, ty = yy - y0, r0 = y0 * FW, r1 = r0 + FW;
      const v = (FIELD[r0 + x0] * (1 - tx) + FIELD[r0 + x1] * tx) * (1 - ty) + (FIELD[r1 + x0] * (1 - tx) + FIELD[r1 + x1] * tx) * ty;
      const land = smooth(.4, .6, v), l = lam[p], sh = .26 + .74 * Math.pow(l, .85), rm = rim[p];
      const tex = .9 + .1 * Math.sin(fx * .33) * Math.sin(yy * .41 + 1.3) + .18 * (TEX[r0 + x0] - .5);
      let R = 6 + 26 * Math.pow(l, .8), G = 30 + 66 * Math.pow(l, .8), B = 84 + 112 * Math.pow(l, .8);          // ocean
      const sp = spec[p] * (1 - land) * .4; R += 150 * sp; G += 190 * sp; B += 235 * sp;
      const ice = smooth(.74, .9, Math.abs(yy - 90) / 90), lR = (26 + 74 * l) * tex + 150 * ice * l, lG = (128 + 96 * l) * tex + 110 * ice * l, lB = (142 + 78 * l) * tex + 90 * ice * l;                     // lit land (holographic teal)
      R = R + (lR * sh - R) * land; G = G + (lG * sh - G) * land; B = B + (lB * sh - B) * land;
      if (land > .5 && l < .4) { const c = CITY[r0 + x0]; if (c) { const k = (1 - l / .4) * (.6 + .15 * c) * Math.max(0, 1 - 2.1 * Math.hypot(tx - .5, ty - .5)); R += 255 * k; G += 175 * k; B += 80 * k; } }
      const dist = Math.abs(fx - band), sc = Math.max(0, 1 - Math.min(dist, FW - dist) / 5) * .22 * (.4 + land);
      R += 60 * rm * .9 + 70 * sc; G += 170 * rm * .9 + 160 * sc; B += 255 * rm * .9 + 220 * sc;
      d[q] = R; d[q + 1] = G; d[q + 2] = B; d[q + 3] = a;
    }
    octx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, N, N);
    const c = N / 2;
    let g = ctx.createRadialGradient(c, c, Rpx * .9, c, c, Rpx * 1.22);
    g.addColorStop(0, 'rgba(70,190,255,.55)'); g.addColorStop(.3, 'rgba(40,140,255,.24)'); g.addColorStop(1, 'rgba(20,80,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, Rpx * 1.22, 0, 7); ctx.fill();
    ctx.drawImage(off, c - S / 2, c - S / 2);
    // holographic graticule, kept consistent with the texture rotation
    ctx.lineWidth = Math.max(1, dpr * .7); ctx.strokeStyle = 'rgba(150,225,255,.16)';
    const proj = (la, lo) => { const lon = lo + spin, gx = Math.cos(la) * Math.sin(lon), gy = Math.sin(la), gz = Math.cos(la) * Math.cos(lon); return { x: gx, y: gy * ct - gz * st, z: gy * st + gz * ct }; };
    const line = pts => { ctx.beginPath(); let pen = false; for (const p of pts) { if (p.z < 0) { pen = false; continue; } const X = c + p.x * Rpx, Y = c - p.y * Rpx; pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true; } ctx.stroke(); };
    for (let lo = 0; lo < 360; lo += 30) { const pts = []; for (let la = -90; la <= 90; la += 6) pts.push(proj(la * Math.PI / 180, lo * Math.PI / 180)); line(pts); }
    for (let la = -60; la <= 60; la += 30) { const pts = []; for (let lo = 0; lo <= 360; lo += 6) pts.push(proj(la * Math.PI / 180, lo * Math.PI / 180)); line(pts); }
    g = ctx.createRadialGradient(c, c, Rpx * .94, c, c, Rpx * 1.03);
    g.addColorStop(0, 'rgba(120,220,255,0)'); g.addColorStop(.72, 'rgba(150,235,255,.55)'); g.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, Rpx * 1.03, 0, 7); ctx.fill();
  }
  return { size, draw, get ratio(){ return 1.22; } };
}

/* ---------- Backdrop: depth, nebula, stars, light sweeps ---------- */
function createBackdrop(canvas){
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, ox = 0, oy = 0;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 300 }, () => ({ x: rnd(), y: rnd(), r: rnd() * 1.25 + .25, a: rnd() * .6 + .2, p: rnd() * 6.28, d: rnd() * .8 + .2, warm: rnd() > .85 }));
  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  function shift(dx, dy){ ox = dx; oy = dy; }
  function draw(t){
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#01050e'; ctx.fillRect(0, 0, w, h);
    const neb = (x, y, r, c1, c2) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); };
    neb(w * .5 + ox * .2, h * .46 + oy * .2, Math.max(w, h) * .66, 'rgba(14,70,160,.62)', 'rgba(2,8,19,0)');
    neb(w * .1 - ox * .1, h * .22, Math.max(w, h) * .46, 'rgba(110,40,170,.3)', 'rgba(2,8,19,0)');
    neb(w * .92 - ox * .1, h * .74, Math.max(w, h) * .44, 'rgba(0,130,180,.26)', 'rgba(2,8,19,0)');
    neb(w * .84, h * .12, Math.max(w, h) * .3, 'rgba(255,150,40,.1)', 'rgba(2,8,19,0)');
    for (const s of stars) {
      const tw = .65 + .35 * Math.sin(t / 900 * s.d + s.p);
      ctx.globalAlpha = s.a * tw; ctx.fillStyle = s.warm ? '#ffd9a0' : '#a8dcff';
      const x = ((s.x * w + ox * s.d * .5) % w + w) % w, y = ((s.y * h + oy * s.d * .5) % h + h) % h;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {                                   // light sweeps in the lower third (as in the approved visual)
      const ph = t / 6500 + i * .9, y0 = h * (.78 + i * .026), amp = h * (.05 + i * .006);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(30,120,255,0)'); g.addColorStop(.5 + .3 * Math.sin(ph), `rgba(80,200,255,${.3 - i * .025})`); g.addColorStop(1, 'rgba(30,120,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-20, y0 + amp);
      ctx.bezierCurveTo(w * .3, y0 - amp * 1.4 + Math.sin(ph) * 8, w * .62, y0 + amp * 1.2, w + 20, y0 - amp * .6);
      ctx.stroke();
    }
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .4, w / 2, h / 2, Math.max(w, h) * .82);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,3,10,.72)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
  return { resize, draw, shift };
}

/* ---------- loop, tween, helpers ---------- */
function loop(fns, fps){
  const gap = 1000 / (fps || 30); let last = 0, id = 0, n = 0;
  const tick = t => { id = requestAnimationFrame(tick); if (t - last < gap) return; last = t; n++; for (const f of fns) f(t, n); };
  if (reduced()) { requestAnimationFrame(t => { for (const f of fns) f(t || 1, 0); }); return { stop(){}, once(){ for (const f of fns) f(performance.now(), 0); } }; }
  id = requestAnimationFrame(tick);
  return { stop(){ cancelAnimationFrame(id); }, once(){ for (const f of fns) f(performance.now(), 0); } };
}

function tween(from, to, ms, onStep, onDone){
  if (reduced() || !ms) { onStep(to.slice()); if (onDone) onDone(); return { cancel(){} }; }
  const t0 = performance.now(); let raf = 0, dead = false;
  const step = now => {
    if (dead) return;
    const k = clamp((now - t0) / ms, 0, 1), e = ease(k);
    onStep(from.map((v, i) => v + (to[i] - v) * e));
    if (k < 1) raf = requestAnimationFrame(step); else if (onDone) onDone();
  };
  raf = requestAnimationFrame(step);
  return { cancel(){ dead = true; cancelAnimationFrame(raf); } };
}

/* Age of a report as plain text, for freshness. */
function ageText(ms){
  if (!Number.isFinite(ms) || ms < 0) return 'time unknown';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ' + (m % 60 ? (m % 60) + ' min ' : '') + 'ago';
  return Math.floor(h / 24) + ' d ago';
}

window.ACC_FX = { createEarth, createBackdrop, loop, tween, ageText, reduced };
})();
