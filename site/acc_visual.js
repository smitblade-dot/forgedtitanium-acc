/* FORGEDTITANIUM ACC visual layer. Decorative only: it draws the holographic Earth, the backdrop, ambient light and the camera
   tween. It reads no data, makes no request and stores nothing. Anything that reflects agent state is decided in index.html
   from the restricted public status document, never here. The land mask is Natural Earth 110m land at 2 degrees (public domain). */
(function(){
'use strict';
const LAND_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAfAP8HAAAAAAAAAAAAAAAAAAAAAADo//z//wcAAAAAAAACAAAAAAAAAAAAhvvw//8PAPABAAAAwAMAAAAAAAAAwADkw////wEABAAAAABgAAAAAAAAAADAUT8A/v8PAAAAAAwA/j8AuAEAAAAAcBHtDcD/fwAAAAAwAPz/fwMAABCAAQD5w/wD8P8FAAAcAIL7//9//xOAAP/ff0668QD/HwAA+A8At///////v3/w/////x8++B8AAOD/1//7////////jP////+/+AE/gAcAn9f//////////w/w/////wEs4AEAAHz+////////////gL////8HeAAcAADg5///////////9ADgAf7/f4AnAAAAAH78////////H0QAAAiA//8f8AcAAIBB4////////38ADwAQAOD//5//AQAAHAT/////////A3AAAAAA/v//+T8AAGDz//////////8DAQAAAMD/////AwAAsP//////////LwAAAAAA6P///2IAAAD+//////////8CAAAAAAD///8/CAAA4P//////////JwAAAAAA8P///wYAAAD+/unz/////z8AAAAAAAD///8HAAAA/pgPPP//////MQAAAAAA8P//PwAAAMBD9v7n/////wcBAAAAAAD///8AAAAAPkD7f/7///8hEAAAAAAA4P//DwAAAIDhAv/n////f8YAAAAAAAD8//8AAAAA+AdE//////8jDwAAAAAAgP//AwAAAMD/APD/////PxgAAAAAAADw/x8AAAAA/n/v//////8HAAAAAAAAAPwDAgAAAOD////7////fwAAAAAAAACgHyAAAACA//9/f/7///8DAAAAAAAAAPQBAAAAAPj//+cv+P//PwAAAAAAAAAAHjAAAADA/////g/+//8EAAAAAAAAAOBhCAAAAP7//99/4D//AAAAAAAAAAAAPAMEAADA////+Qf84BcAAAAAAAAAAAA/AAAAAPz//58fgAf+QAAAAAAAAAAAAA8AAADg////ewA4gA8EAAAAAAAAAADAAAAAAPz//38BgAP4QQAAAAAAAAAAAAgPAADA////zwAwgAwQAAAAAAAAAAAA9Q8AAPj///8HAAVIAAAAAAAAAAAAAID/AQAA////fwBAAAAQAAAAAAAAAAAA+P8AAGDh//8DAAA0GAAAAAAAAAAAAID/HwAAAPj/HwAAgMIBAAAAAAAAAAAA/P8BAACA//8AAAAYXgAAAAAAAAAAAMD/fwAAAPz/BwAAAOOBAQAAAAAAAAAA/P8/AACA/z8AAABgbtQBAAAAAAAAAOD//w8AAPD/AwAAAAQIeAAAAAAAAAAA/P//AQAA/z8AAACAA4APAQAAAAAAAID//w8AAPD/AwAAAAARsEAAAAAAAAAA+P9/AAAA/j8AAAAAAAAAAAAAAAAAAAD//wcAAPD/QwAAAACAIwAAAAAAAAAA8P9/AAAA/z8EAAAAAD8GIAAAAAAAAAD8/wMAAPD/cQAAAAD4ZwAAAAAAAAAAgP8/AAAA/w8HAAAAgP8HAAAAAAAAAAD4/wMAAOD/MAAAAAD//wEBAAAAAAAAgP8PAAAA/g8DAAAA+P8fAAAAAAAAAAD4PwAAAOB/EAAAAID//wMAAAAAAAAAgP8DAAAA/AMAAAAA+P9/AAAAAAAAAAD8HwAAAMA/AAAAAID//wcAAAAAAAAAwP8BAAAA+AEAAAAA8P9/AAAAAAAAAAD8DwAAAIAPAAAAAAAP/gMAAAAAAAAAwB8AAAAAAAAAAAAAEIAfAAEAAAAAAAD+AwAAAAAAAAAAAAAA8AEgAAAAAAAA4AcAAAAAAAAAAAAAAAAAAAYAAAAAAABeAAAAAAAAAAAAAAAAwAAwAAAAAAAAwAMAAAAAAAAAAAAAAAAIgAEAAAAAAAAeAAAAAAAAAAAAAAAAAAAMAAAAAAAA4AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAABAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAB4AEDwn/8HAAAAAAAAAAAwAAAAAACA/P/h/////w8AAAAAAAAAwAcAAAD4////z///////PwAAAAAAHALwAACA//////////////8HAADw/y///wMAAP7/////////////HwAA+P///38AAID///////////////8AAPL/////BwAO////////////////DwAA8P////8HEPD//////////////z8AAOD/////////////////////////H/AfwP//////////////////////////////////////////////////////////////////////////////////////';
const LW = 180, LH = 90;
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ---------- Earth ---------- */
let dots = null;
function buildDots(){
  const bin = atob(LAND_B64), out = [], step = 2.0;
  const landAt = (lon, lat) => { const x = clamp(Math.floor((lon + 180) / 360 * LW), 0, LW - 1), y = clamp(Math.floor((90 - lat) / 180 * LH), 0, LH - 1), i = y * LW + x; return (bin.charCodeAt(i >> 3) >> (i & 7)) & 1; };
  for (let lat = -87; lat <= 87; lat += step) {
    const n = Math.max(6, Math.round(360 * Math.cos(lat * Math.PI / 180) / step));
    for (let k = 0; k < n; k++) {
      const lon = -180 + (k + .5) * 360 / n, la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
      out.push({ lat, x: Math.cos(la) * Math.cos(lo), y: Math.sin(la), z: Math.cos(la) * Math.sin(lo), land: landAt(lon, lat) === 1 });
    }
  }
  return out;
}

function createEarth(canvas){
  const ctx = canvas.getContext('2d');
  if (!dots) dots = buildDots();
  const tilt = 20 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
  let side = 0, dpr = 1;
  function size(cssSide){
    dpr = Math.min(window.devicePixelRatio || 1, 2) * 1.25;
    side = cssSide;
    canvas.width = Math.round(cssSide * dpr); canvas.height = Math.round(cssSide * dpr);
  }
  function project(d, a){
    const ca = Math.cos(a), sa = Math.sin(a);
    const x1 = d.x * ca + d.z * sa, z1 = -d.x * sa + d.z * ca;
    return { x: x1, y: d.y * ct - z1 * st, z: d.y * st + z1 * ct };
  }
  function draw(t){
    if (!side) return;
    const W = canvas.width, c = W / 2, R = W / 2 / 1.22, spin = (t / 1000) * 0.11;
    ctx.clearRect(0, 0, W, W);
    // atmosphere and holographic body
    let g = ctx.createRadialGradient(c, c, R * .86, c, c, R * 1.2);
    g.addColorStop(0, 'rgba(70,190,255,.55)'); g.addColorStop(.35, 'rgba(40,140,255,.22)'); g.addColorStop(1, 'rgba(20,80,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R * 1.2, 0, 7); ctx.fill();
    g = ctx.createRadialGradient(c - R * .3, c - R * .35, R * .1, c, c, R);
    g.addColorStop(0, 'rgba(40,150,240,.7)'); g.addColorStop(.65, 'rgba(14,72,156,.66)'); g.addColorStop(1, 'rgba(5,26,76,.78)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.fill();
    // graticule
    ctx.lineWidth = Math.max(1, dpr * .6); ctx.strokeStyle = 'rgba(120,205,255,.13)';
    for (let lon = 0; lon < 360; lon += 30) {
      ctx.beginPath(); let pen = false;
      for (let la = -90; la <= 90; la += 6) {
        const a = la * Math.PI / 180, o = lon * Math.PI / 180, p = project({ x: Math.cos(a) * Math.cos(o), y: Math.sin(a), z: Math.cos(a) * Math.sin(o) }, spin);
        if (p.z < 0) { pen = false; continue; }
        const X = c + p.x * R, Y = c - p.y * R; pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true;
      }
      ctx.stroke();
    }
    for (let la = -60; la <= 60; la += 30) {
      ctx.beginPath(); let pen = false;
      for (let lo = 0; lo <= 360; lo += 6) {
        const a = la * Math.PI / 180, o = lo * Math.PI / 180, p = project({ x: Math.cos(a) * Math.cos(o), y: Math.sin(a), z: Math.cos(a) * Math.sin(o) }, spin);
        if (p.z < 0) { pen = false; continue; }
        const X = c + p.x * R, Y = c - p.y * R; pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true;
      }
      ctx.stroke();
    }
    // dotted globe: land bright, ocean faint, far side faintly visible (hologram)
    const scan = Math.sin(t / 2600) * 70, lw = dpr * 2.3, ow = dpr * 1.2;
    for (const d of dots) {
      const p = project(d, spin), X = c + p.x * R, Y = c - p.y * R;
      if (p.z < 0) { if (d.land) { ctx.fillStyle = 'rgba(80,170,255,.07)'; ctx.fillRect(X, Y, ow, ow); } continue; }
      const rim = 1 - p.z, near = Math.abs(d.lat - scan) < 2.6;
      if (d.land) { ctx.fillStyle = near ? 'rgba(255,255,255,.98)' : `rgba(${150 + 80 * rim | 0},${235 + 20 * rim | 0},255,${.75 + .25 * p.z})`; ctx.fillRect(X - lw / 2, Y - lw / 2, lw, lw); }
      else { ctx.fillStyle = near ? 'rgba(170,230,255,.7)' : `rgba(90,175,255,${.22 + .3 * rim})`; ctx.fillRect(X - ow / 2, Y - ow / 2, ow, ow); }
    }
    // limb light
    g = ctx.createRadialGradient(c, c, R * .93, c, c, R * 1.02);
    g.addColorStop(0, 'rgba(120,220,255,0)'); g.addColorStop(.7, 'rgba(140,230,255,.7)'); g.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, R * 1.02, 0, 7); ctx.fill();
  }
  return { size, draw, get ratio(){ return 1.22; } };
}

/* ---------- Backdrop: depth, nebula, stars, light sweeps ---------- */
function createBackdrop(canvas){
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, ox = 0, oy = 0;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), r: rnd() * 1.25 + .25, a: rnd() * .6 + .2, p: rnd() * 6.28, d: rnd() * .8 + .2, warm: rnd() > .85 }));
  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  function shift(dx, dy){ ox = dx; oy = dy; }
  function draw(t){
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020813'; ctx.fillRect(0, 0, w, h);
    const neb = (x, y, r, c1, c2) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); };
    neb(w * .5 + ox * .2, h * .42 + oy * .2, Math.max(w, h) * .62, 'rgba(16,64,140,.55)', 'rgba(2,8,19,0)');
    neb(w * .12 - ox * .1, h * .2, Math.max(w, h) * .42, 'rgba(90,40,150,.22)', 'rgba(2,8,19,0)');
    neb(w * .9 - ox * .1, h * .72, Math.max(w, h) * .4, 'rgba(0,120,160,.2)', 'rgba(2,8,19,0)');
    // stars with gentle twinkle and parallax
    for (const s of stars) {
      const tw = .65 + .35 * Math.sin(t / 900 * s.d + s.p);
      ctx.globalAlpha = s.a * tw; ctx.fillStyle = s.warm ? '#ffd9a0' : '#a8dcff';
      const x = ((s.x * w + ox * s.d * .5) % w + w) % w, y = ((s.y * h + oy * s.d * .5) % h + h) % h;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // sweeping light curves near the lower edge (as in the approved visual)
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const ph = t / 6000 + i * .9, y0 = h * (.8 + i * .028), amp = h * (.05 + i * .006);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(30,120,255,0)'); g.addColorStop(.5 + .3 * Math.sin(ph), `rgba(70,190,255,${.22 - i * .02})`); g.addColorStop(1, 'rgba(30,120,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-20, y0 + amp);
      ctx.bezierCurveTo(w * .3, y0 - amp * 1.4 + Math.sin(ph) * 8, w * .62, y0 + amp * 1.2, w + 20, y0 - amp * .6);
      ctx.stroke();
    }
    // vignette for depth
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .35, w / 2, h / 2, Math.max(w, h) * .8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,3,10,.7)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
  return { resize, draw, shift };
}

/* ---------- loop, tween, helpers ---------- */
function loop(fns, fps){
  const gap = 1000 / (fps || 40); let last = 0, id = 0;
  const tick = t => { id = requestAnimationFrame(tick); if (t - last < gap) return; last = t; for (const f of fns) f(t); };
  if (reduced()) { requestAnimationFrame(t => { for (const f of fns) f(t || 1); }); return { stop(){}, once(){ for (const f of fns) f(performance.now()); } }; }
  id = requestAnimationFrame(tick);
  return { stop(){ cancelAnimationFrame(id); }, once(){ for (const f of fns) f(performance.now()); } };
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
