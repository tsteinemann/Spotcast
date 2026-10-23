'use strict';
// =====================================================================
// Spotcast — spots load for whatever part of Florida is on screen.
// Spot types come from public structure data (FWC, FDOT) and from the
// NOAA depth model (channel drop-offs); each is rated hourly from tides,
// wind, moon and light.
// =====================================================================

// ---------------- helpers
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cap = s => s ? s[0].toUpperCase()+s.slice(1) : s;
const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const card = d => DIRS[Math.round(((d%360)+360)%360/22.5)%16];
const DIR_DEG = Object.fromEntries(DIRS.map((d,i)=>[d,i*22.5]));
const FL = {s:24.3, w:-87.7, n:31.1, e:-79.8};
const store = { get(k,d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } }, set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} } };
function toast(msg, ms=3500){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, ms); }
function distKm(a,b){ const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLng=(b[1]-a[1])*Math.PI/180, la=a[0]*Math.PI/180, lb=b[0]*Math.PI/180;
  return 2*R*Math.asin(Math.sqrt(Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLng/2)**2)); }
const centroid = pts => [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
const lineLenKm = pts => pts.reduce((s,p,i) => i ? s + distKm(pts[i-1], p) : 0, 0);
async function getJSON(url, {timeout=25000}={}){
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), timeout);
  try { const r = await fetch(url, {signal:ctl.signal}); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}
function circle(lat,lng,rM,n=18){ const out=[]; for (let i=0;i<n;i++){ const a=i/n*2*Math.PI; out.push([lat + rM/111320*Math.cos(a), lng + rM/(111320*Math.cos(lat*Math.PI/180))*Math.sin(a)]); } return out; }
function hull(pts){
  pts = pts.slice().sort((a,b) => a[1]-b[1] || a[0]-b[0]);
  const cr = (o,a,b) => (a[1]-o[1])*(b[0]-o[0]) - (a[0]-o[0])*(b[1]-o[1]);
  const lo=[], up=[];
  for (const p of pts){ while (lo.length>=2 && cr(lo[lo.length-2],lo[lo.length-1],p)<=0) lo.pop(); lo.push(p); }
  for (let i=pts.length-1;i>=0;i--){ const p=pts[i]; while (up.length>=2 && cr(up[up.length-2],up[up.length-1],p)<=0) up.pop(); up.push(p); }
  return lo.slice(0,-1).concat(up.slice(0,-1));
}
function simplify(pts, tol){ // Douglas-Peucker in degrees
  if (pts.length < 3) return pts;
  const sq = (p,a,b) => { let x=a[1], y=a[0], dx=b[1]-x, dy=b[0]-y; if (dx||dy){ const t=((p[1]-x)*dx+(p[0]-y)*dy)/(dx*dx+dy*dy); if (t>1){x=b[1];y=b[0];} else if (t>0){x+=dx*t;y+=dy*t;} } dx=p[1]-x; dy=p[0]-y; return dx*dx+dy*dy; };
  const keep = new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1; const st=[[0,pts.length-1]], t2=tol*tol;
  while (st.length){ const [a,b]=st.pop(); let m=0, mi=-1; for (let i=a+1;i<b;i++){ const d=sq(pts[i],pts[a],pts[b]); if (d>m){m=d;mi=i;} } if (m>t2){ keep[mi]=1; st.push([a,mi],[mi,b]); } }
  return pts.filter((_,i)=>keep[i]);
}
function splitLine(pts, maxKm){ // cut a long line into pieces no longer than maxKm
  const out=[]; let cur=[pts[0]], len=0;
  for (let i=1;i<pts.length;i++){ const d=distKm(pts[i-1],pts[i]); cur.push(pts[i]); len+=d; if (len>=maxKm){ out.push(cur); cur=[pts[i]]; len=0; } }
  if (cur.length>1 && (len>maxKm*0.35 || !out.length)) out.push(cur); return out;
}

// ---------------- time (the location's own clock)
function tzOffsetMin(ms, tz){
  const p = new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ms));
  const g = t => +p.find(x=>x.type===t).value;
  return (Date.UTC(g('year'),g('month')-1,g('day'),g('hour')%24,g('minute')) - ms)/60000;
}
function localMidnight(tz){
  const now = Date.now(), off = tzOffsetMin(now, tz), l = new Date(now + off*60000);
  const m = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - off*60000;
  return m - (tzOffsetMin(m, tz) - off)*60000;
}
let TZ = 'America/New_York', T0 = 0, H = 168, HRS = [], DAYS = [];
function buildClock(){
  T0 = localMidnight(TZ); HRS = []; DAYS = []; H = 168;
  const f = new Intl.DateTimeFormat('en-US',{timeZone:TZ,weekday:'short',month:'short',day:'numeric',hour:'numeric',hourCycle:'h23'});
  for (let i=0;i<H;i++){
    const t = T0 + i*3600e3, p = f.formatToParts(new Date(t)), g = k => p.find(x=>x.type===k).value, dk = g('month')+' '+g('day');
    if (!DAYS.length || DAYS[DAYS.length-1].dk !== dk) DAYS.push({dk, wd:g('weekday'), dn:g('day'), mo:g('month'), idx:[]});
    HRS.push({t, h:(+g('hour'))%24, d:DAYS.length-1}); DAYS[DAYS.length-1].idx.push(i);
  }
  DAYS = DAYS.slice(0,7); HRS = HRS.filter(h => h.d < 7); H = HRS.length;
}
const fmtTime = ms => new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(ms)).replace(':00','');
const hourLabel = x => fmtTime(T0 + x*3600e3);
const dayLabel = d => `${DAYS[d].wd} ${DAYS[d].mo} ${DAYS[d].dn}`;
const hourAt = (d,h) => { const ix = DAYS[d].idx; let b = ix[0]; for (const i of ix) if (HRS[i].h <= h) b = i; return b; };

// ---------------- spot types
const TYPES = {
  pass:     {label:'Pass',          pref:'outgoing', deep:true,  shelter:false, wind:'pass', base:5, depth:'6–20 ft (typical)', structure:'Inlet with current seams and a deep throat; fish the jetty tips and eddies'},
  bridge:   {label:'Bridge',        pref:'moving',   deep:true,  shelter:false, wind:'pass', base:3, depth:'Channel under the span', structure:'Pilings, shade lines and lights; current pushes bait past the pilings'},
  dropoff:  {label:'Drop-off',      pref:'outgoing', deep:false, shelter:false, wind:'pass', base:4, depth:'3 to 9+ ft edge', structure:'Edge where a shallow flat falls into a channel; bait drains off the flat to waiting fish'},
  flat:     {label:'Flat',          pref:'incoming', deep:false, shelter:false, wind:'flat', base:3, depth:'1–3 ft', structure:'Mapped tidal flat or sandbar; fish the edges and potholes as water floods in'},
  mangrove: {label:'Mangroves',     pref:'incoming', deep:false, shelter:true,  wind:'shel', base:3, depth:'1–4 ft at the edge', structure:'Mangrove shoreline; high water pushes fish up under the roots'},
  oyster:   {label:'Oyster bars',   pref:'incoming', deep:false, shelter:true,  wind:'shel', base:3, depth:'1–4 ft', structure:'Mapped oyster bars with shell edges and drop-offs'},
  dock:     {label:'Docks',         pref:'moving',   deep:true,  shelter:true,  wind:'shel', base:1, depth:'Varies; deeper dock ends', structure:'Docks and seawalls; shade by day, lights at night'},
  reef:     {label:'Reef',          pref:'moving',   deep:true,  shelter:false, wind:'reef', base:3, depth:'', structure:'Man-made reef'}
};
function speciesFor(type, lat, lng){
  const south = lat < 28.8, gulf = lng < -81.3 || lat < 25.6;
  const inshore = south ? ['Snook','Redfish','Speckled trout'] : ['Redfish','Speckled trout','Flounder'];
  switch (type){
    case 'pass': case 'bridge': return south ? ['Snook','Mangrove snapper','Sheepshead','Redfish'] : ['Redfish','Sheepshead','Flounder','Speckled trout'];
    case 'dock': return south ? ['Snook','Mangrove snapper','Sheepshead'] : ['Redfish','Sheepshead','Black drum'];
    case 'dropoff': return inshore.concat(['Spanish mackerel']);
    case 'reef': return gulf ? ['Gag grouper','Mangrove snapper','Sheepshead','Spanish mackerel'] : ['Mangrove snapper','Sheepshead','Black sea bass','Spanish mackerel'];
    default: return inshore.concat([south ? 'Sheepshead' : 'Black drum']);
  }
}

// ---------------- state
const TIER = [[83,'hot','Hot'],[72,'great','Great'],[58,'good','Good'],[0,'fair','Fair']];
const tierOf = s => TIER.find(t => s >= t[0]);
const COLORS = {hot:'#ff5466', great:'#ffb547', good:'#7fd6ee', fair:'#71848b'};
let STATIONS = {tide:[], wt:[]};
const ZONES = [];                     // every spot loaded so far
const ZONE_IDS = new Set();
let COND = null;                      // conditions for the area: wind, sun, moon, water temp
const TIDES = new Map();              // station id -> {ev, name, h, hT0} | promise
let SCORE = new Map();                // memo: zoneIndex*1000+hour -> score
let cur = 0, sel = null, placeName = null;
const plans = {};

// ---------------- map
const map = L.map('map', {zoomControl:false, zoomSnap:.5, minZoom:7, maxZoom:19, maxBounds:[[23.6,-88.6],[31.6,-79.0]], tap:false});
map.attributionControl.setPrefix(false);
map.createPane('habitat').style.zIndex = 410;
map.createPane('zones').style.zIndex = 450;
map.createPane('labels').style.zIndex = 430; map.getPane('labels').style.pointerEvents = 'none';
const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom:18, maxZoom:19, attribution:'Imagery © Esri, Maxar, Earthstar Geographics'});
const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {pane:'labels', maxNativeZoom:18, maxZoom:19});
const zoneRenderer = L.canvas({pane:'zones', padding:.4, tolerance:6});
const zoneLayer = L.layerGroup().addTo(map);

// ---- NOAA NCEI depth tiles (raw float grid, rendered here and mined for drop-offs)
const DEM_URL = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage';
const DEM_N = 128, demCache = new Map(), demWait = new Map(), MERC = 20037508.342789244;
function parseTiff(buf){
  const dv = new DataView(buf), le = dv.getUint16(0) === 0x4949, u16 = o => dv.getUint16(o,le), u32 = o => dv.getUint32(o,le);
  const ifd = u32(4), n = u16(ifd), tags = {}, SZ = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,16:8};
  for (let i=0;i<n;i++){
    const e = ifd+2+i*12, tag = u16(e), type = u16(e+2), cnt = u32(e+4), sz = SZ[type]||1, vo = cnt*sz <= 4 ? e+8 : u32(e+8), vals = [];
    if ([256,257,259,273,278,322,323,324].includes(tag)) for (let k=0;k<cnt;k++) vals.push(type===3 ? u16(vo+k*2) : type===4 ? u32(vo+k*4) : type===16 ? Number(dv.getBigUint64(vo+k*8,le)) : dv.getUint8(vo+k));
    tags[tag] = vals;
  }
  const W = tags[256][0], Ht = tags[257][0];
  if ((tags[259]||[1])[0] !== 1) throw new Error('compressed tiff');
  const out = new Float32Array(W*Ht);
  if (tags[324] && tags[324].length){
    const tw = tags[322][0], th = tags[323][0], across = Math.ceil(W/tw);
    tags[324].forEach((o,ti) => { const tx=(ti%across)*tw, ty=Math.floor(ti/across)*th;
      for (let r=0;r<th && ty+r<Ht;r++) for (let c=0;c<tw && tx+c<W;c++) out[(ty+r)*W+tx+c] = dv.getFloat32(o+(r*tw+c)*4, le); });
  } else {
    const rps = (tags[278]||[Ht])[0];
    tags[273].forEach((o,si) => { const r0 = si*rps; for (let r=0;r<rps && r0+r<Ht;r++) for (let c=0;c<W;c++) out[(r0+r)*W+c] = dv.getFloat32(o+(r*W+c)*4, le); });
  }
  return out;
}
function demTile(z,x,y){
  const key = z+'/'+x+'/'+y;
  if (demCache.has(key)) return Promise.resolve(demCache.get(key));
  if (demWait.has(key)) return demWait.get(key);
  const size = 2*MERC/2**z, x0 = -MERC + x*size, y1 = MERC - y*size;
  const url = `${DEM_URL}?bbox=${x0},${y1-size},${x0+size},${y1}&bboxSR=3857&imageSR=3857&size=${DEM_N},${DEM_N}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&noDataInterpretation=esriNoDataMatchAny&f=image`;
  const p = fetch(url).then(r => { if (!r.ok) throw new Error('dem'); return r.arrayBuffer(); }).then(b => {
    const d = parseTiff(b); demCache.set(key, d); if (demCache.size > 500) demCache.delete(demCache.keys().next().value); return d;
  }).finally(() => demWait.delete(key));
  demWait.set(key, p); return p;
}
const isNo = v => !(v > -1000 && v < 9000);
const tileLatRad = (yf,z) => Math.atan(Math.sinh(Math.PI - 2*Math.PI*yf/2**z));
const lng2t = (lng,z) => (lng+180)/360*2**z;
const lat2t = (lat,z) => (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*2**z;
const px2ll = (z,tx,ty,q,r) => [tileLatRad(ty+(r+.5)/DEM_N, z)*180/Math.PI, (tx+(q+.5)/DEM_N)/2**z*360-180];
function demAt(lat,lng){ // sample a loaded z13 tile; null when not loaded
  const xf = lng2t(lng,13), yf = lat2t(lat,13), x = Math.floor(xf), y = Math.floor(yf), g = demCache.get('13/'+x+'/'+y);
  if (!g) return null; const q = clamp(Math.floor((xf-x)*DEM_N),0,DEM_N-1), r = clamp(Math.floor((yf-y)*DEM_N),0,DEM_N-1), v = g[r*DEM_N+q];
  return isNo(v) ? null : v;
}
const STOPS = [[-0.5,[233,222,168]],[1.5,[216,226,170]],[3,[160,214,190]],[6,[92,186,196]],[10,[52,140,186]],[15,[38,98,160]],[22,[30,72,136]],[35,[22,50,106]],[50,[16,36,82]],[70,[11,25,60]]];
function ramp(d){
  if (d <= STOPS[0][0]) return STOPS[0][1];
  for (let i=1;i<STOPS.length;i++) if (d <= STOPS[i][0]){ const [a,ca]=STOPS[i-1],[b,cb]=STOPS[i], f=(d-a)/(b-a); return [ca[0]+(cb[0]-ca[0])*f, ca[1]+(cb[1]-ca[1])*f, ca[2]+(cb[2]-ca[2])*f]; }
  return STOPS[STOPS.length-1][1];
}
const ReliefLayer = L.GridLayer.extend({
  createTile(c, done){
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    demTile(c.z,c.x,c.y).then(g => {
      const N = DEM_N, img = new ImageData(N,N), px = (2*MERC/2**c.z)/N*Math.cos(tileLatRad(c.y+.5,c.z)), az = 315*Math.PI/180, alt = 40*Math.PI/180;
      for (let r=0;r<N;r++) for (let q=0;q<N;q++){
        const i = r*N+q, v = g[i], o = i*4;
        if (isNo(v)){ img.data[o+3] = 0; continue; }
        const at = (rr,qq) => { const w = g[clamp(rr,0,N-1)*N+clamp(qq,0,N-1)]; return isNo(w) ? v : w; };
        const ex = v < 0.3 ? 10 : 2.5, dx = (at(r,q+1)-at(r,q-1))*ex/(2*px), dy = (at(r+1,q)-at(r-1,q))*ex/(2*px);
        const slope = Math.atan(Math.hypot(dx,dy)), aspect = Math.atan2(-dx, dy);
        const hs = clamp(Math.sin(alt)*Math.cos(slope) + Math.cos(alt)*Math.sin(slope)*Math.cos(az-aspect), 0, 1);
        const col = v > 0.3 ? [128,124,112] : ramp(-(v+0.2)*3.28084), s = 0.45 + 0.75*hs;
        img.data[o] = clamp(col[0]*s,0,255); img.data[o+1] = clamp(col[1]*s,0,255); img.data[o+2] = clamp(col[2]*s,0,255); img.data[o+3] = 255;
      }
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = N; tmp.getContext('2d').putImageData(img,0,0);
      const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp,0,0,256,256); done(null, cv);
    }).catch(() => done(null, cv));
    return cv;
  }
});
const relief = new ReliefLayer({minZoom:8, maxNativeZoom:15, maxZoom:19, attribution:'Depth: NOAA NCEI'});
function marching(g, N, level, cb){ // g: depth in ft (NaN = none); cb(x1,y1,x2,y2,q,r) in pixel units
  for (let r=0;r<N-1;r++) for (let q=0;q<N-1;q++){
    const a=g[r*N+q], b=g[r*N+q+1], d=g[(r+1)*N+q], e=g[(r+1)*N+q+1];
    if (isNaN(a)||isNaN(b)||isNaN(d)||isNaN(e)) continue;
    const idx = (a>level?8:0)|(b>level?4:0)|(e>level?2:0)|(d>level?1:0); if (idx===0||idx===15) continue;
    const T=[q+(level-a)/(b-a), r], R=[q+1, r+(level-b)/(e-b)], B=[q+(level-d)/(e-d), r+1], Lp=[q, r+(level-a)/(d-a)];
    const segs = {1:[[Lp,B]],2:[[B,R]],3:[[Lp,R]],4:[[T,R]],5:[[Lp,T],[B,R]],6:[[T,B]],7:[[Lp,T]],8:[[Lp,T]],9:[[T,B]],10:[[T,R],[Lp,B]],11:[[T,R]],12:[[Lp,R]],13:[[B,R]],14:[[Lp,B]]}[idx];
    for (const [p1,p2] of segs) cb(p1[0],p1[1],p2[0],p2[1],q,r);
  }
}
function depthGrid(g0){ const N = DEM_N, g = new Float32Array(N*N);
  for (let r=0;r<N;r++) for (let q=0;q<N;q++){ let s=0,n=0; for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++){ const w=g0[clamp(r+a,0,N-1)*N+clamp(q+b,0,N-1)]; if(!isNo(w)){s+=w;n++;} } g[r*N+q] = n ? -(s/n+0.2)*3.28084 : NaN; }
  return g; }
const ContourLayer = L.GridLayer.extend({
  createTile(c, done){
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    if (c.z < 11){ setTimeout(()=>done(null,cv)); return cv; }
    const z = Math.min(c.z,15), sc = c.z>15 ? 2**(c.z-15) : 1, tx = c.x>>(c.z-z), ty = c.y>>(c.z-z), ox = c.x % sc, oy = c.y % sc;
    demTile(z, tx, ty).then(g0 => {
      const N = DEM_N, g = depthGrid(g0), ctx = cv.getContext('2d'), k = 256*sc/(N-1), rel = LS.base==='relief';
      const levels = c.z >= 13 ? [2,3,4,6,8,10,12,15,20,25,30,40,50,60,80,100] : [6,10,20,30,50,100], major = new Set([6,10,20,30,50,100]);
      for (const L0 of levels){
        ctx.beginPath(); marching(g, N, L0, (x1,y1,x2,y2) => { ctx.moveTo(x1*k-ox*256, y1*k-oy*256); ctx.lineTo(x2*k-ox*256, y2*k-oy*256); });
        const mj = major.has(L0); ctx.strokeStyle = rel ? `rgba(8,24,40,${mj?.6:.32})` : `rgba(255,255,255,${mj?.7:.35})`; ctx.lineWidth = mj ? 1.4 : .8; ctx.stroke();
      }
      done(null, cv);
    }).catch(() => done(null, cv));
    return cv;
  }
});
const contours = new ContourLayer({minZoom:11, maxZoom:19, pane:'habitat'});

// ---------------- layers panel
// spot types the user wants on the map (drop-offs start off: there are many and they crowd the other spots)
const TYPE_CHIPS = [['pass','Passes'],['bridge','Bridges'],['flat','Flats'],['mangrove','Mangroves'],['oyster','Oyster bars'],['dock','Docks'],['reef','Reefs'],['dropoff','Drop-offs']];
const SHOW = new Set(store.get('sz3-types', TYPE_CHIPS.map(t => t[0]).filter(k => k !== 'dropoff')));
function paintTypeChips(){
  $('typeChips').innerHTML = TYPE_CHIPS.map(([k,l]) => `<button type="button" data-k="${k}" aria-pressed="${SHOW.has(k)}">${l}</button>`).join('');
  $('typeChips').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; SHOW.has(k) ? SHOW.delete(k) : SHOW.add(k); store.set('sz3-types', [...SHOW]);
    ZONES.forEach(z => { if (z.type !== k) return; SHOW.has(k) ? zoneLayer.addLayer(z.layer) : zoneLayer.removeLayer(z.layer); });
    if (sel != null && !SHOW.has(ZONES[sel].type)) selectZone(null); paintTypeChips(); refresh(); });
}
const OVS = ['labels','contours','oyster','reefs','hardbottom'];
const LS = Object.assign({base:'sat', labels:true, contours:false, oyster:false, reefs:true, hardbottom:false}, store.get('sz2-layers', {}));
const OV = {oyster:L.layerGroup(), reefs:L.layerGroup(), hardbottom:L.layerGroup()};
function applyLayers(){
  [sat, relief].forEach(b => map.hasLayer(b) && map.removeLayer(b));
  (LS.base==='relief' ? relief : sat).addTo(map);
  document.querySelectorAll('[data-base]').forEach(b => b.setAttribute('aria-pressed', b.dataset.base===LS.base));
  $('depthKey').hidden = !(LS.base==='relief' || LS.contours);
  OVS.forEach(k => $('ov-'+k).checked = !!LS[k]);
  LS.labels ? labels.addTo(map) : map.removeLayer(labels);
  if (LS.contours){ if (map.hasLayer(contours)) contours.redraw(); else contours.addTo(map); } else map.removeLayer(contours);
  ['oyster','reefs','hardbottom'].forEach(k => LS[k] ? OV[k].addTo(map) : map.removeLayer(OV[k]));
  store.set('sz2-layers', LS);
}
document.querySelectorAll('[data-base]').forEach(b => b.onclick = () => { LS.base = b.dataset.base; applyLayers(); });
OVS.forEach(k => $('ov-'+k).onchange = e => { LS[k] = e.target.checked; applyLayers(); });
paintTypeChips();
$('layersBtn').onclick = () => { const p=$('layersPanel'); p.hidden = !p.hidden; $('layersBtn').setAttribute('aria-expanded', !p.hidden); if (!p.hidden && typeof openSearch === 'function') openSearch(false); };
$('zin').onclick = () => map.zoomIn(); $('zout').onclick = () => map.zoomOut();
applyLayers();

// ---------------- data sources for a map cell
const FWC = 'https://gis.myfwc.com/hosting/rest/services/Open_Data/';
const SRC = {
  inlets: FWC+'Inlets_and_Passes_Florida/MapServer/1',
  reefs: 'https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12',
  oyster: FWC+'Oyster_Beds_Statewide/MapServer/17',
  flats: FWC+'Tidal_Flats/MapServer/21',
  mangroves: FWC+'Mangroves/MapServer/19',
  marinas: FWC+'Marinas_Florida/MapServer/6',
  hb1: FWC+'Coral_and_Hard_Bottom_Habitats_Statewide/MapServer/18',
  hb2: FWC+'West_Florida_Shelf_Benthic_Habitats/MapServer/13',
  br1: 'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/FDOT_Bridges/FeatureServer/0',
  br2: 'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Non_FDOT_Bridges_20240418/FeatureServer/21'
};
function query(url, bb, extra={}){
  const p = new URLSearchParams(Object.assign({where:'1=1', geometry:bb.join(','), geometryType:'esriGeometryEnvelope', inSR:'4326', spatialRel:'esriSpatialRelIntersects', outSR:'4326', outFields:'*', f:'geojson', resultRecordCount:'1500'}, extra));
  return getJSON(url+'/query?'+p).then(j => j.features || []).catch(() => []);
}
const ringsOf = g => !g ? [] : (g.type==='Polygon' ? [g.coordinates] : g.type==='MultiPolygon' ? g.coordinates : []).map(p => p.map(r => r.map(([x,y]) => [y,x])));
const linesOf = g => !g ? [] : (g.type==='LineString' ? [g.coordinates] : g.type==='MultiLineString' ? g.coordinates : []).map(l => l.map(([x,y]) => [y,x]));
function nearName(c){ // "near Jupiter Inlet" from the closest tide station
  let best = null, bd = 1e9; for (const s of STATIONS.tide){ const d = (s[1]-c[0])**2 + ((s[2]-c[1])*0.9)**2; if (d < bd){ bd = d; best = s; } }
  return best ? best[3].split(',')[0].replace(/\s*\(.*?\)\s*/g,' ').trim() : 'Florida';
}

const CELL = 0.1, cellsDone = new Set(), cellsBusy = new Set();
const cellKey = (lat,lng) => Math.floor(lat/CELL)+':'+Math.floor(lng/CELL);
async function loadCell(key){
  if (cellsDone.has(key) || cellsBusy.has(key)) return; cellsBusy.add(key); setLoading();
  const [iy, ix] = key.split(':').map(Number), s = iy*CELL, w = ix*CELL, bb = [w, s, w+CELL, s+CELL];
  const inBox = c => c[0]>=s && c[0]<s+CELL && c[1]>=w && c[1]<w+CELL;
  const simp = {maxAllowableOffset:'0.00004', geometryPrecision:'5', outFields:'OBJECTID'};
  // depth tiles for the cell plus a 2 km margin (z13)
  const PAD = 0.02, tx0 = Math.floor(lng2t(w-PAD,13)), tx1 = Math.floor(lng2t(w+CELL+PAD,13)), ty0 = Math.floor(lat2t(s+CELL+PAD,13)), ty1 = Math.floor(lat2t(s-PAD,13)), tiles = [];
  for (let x=tx0;x<=tx1;x++) for (let y=ty0;y<=ty1;y++) tiles.push([x,y]);
  const [inlets, reefs, oys, flats, mangs, marinas, hb1, hb2, br1, br2, dem] = await Promise.all([
    query(SRC.inlets,bb), query(SRC.reefs,bb), query(SRC.oyster,bb,simp), query(SRC.flats,bb,simp), query(SRC.mangroves,bb,{maxAllowableOffset:'0.0001', geometryPrecision:'5', outFields:'OBJECTID'}),
    query(SRC.marinas,bb,{outFields:'Name,Usage,Wat_Name'}), query(SRC.hb1,bb,simp), query(SRC.hb2,bb,Object.assign({}, simp, {where:"Geoform = 'Coral Reef and Hardbottom'"})),
    query(SRC.br1,bb,{outFields:'OBJECTID'}), query(SRC.br2,bb,{outFields:'OBJECTID'}),
    Promise.all(tiles.map(([x,y]) => demTile(13,x,y).then(g => ({x,y,g})).catch(() => null)))]);
  const add = [];
  const push = (type, name, c, geom, extra={}) => {
    if (!inBox(c)) return; const id = type+':'+c[0].toFixed(4)+','+c[1].toFixed(4); if (ZONE_IDS.has(id)) return; ZONE_IDS.add(id);
    add.push(Object.assign({id, type, name, c, geom, species:speciesFor(type,c[0],c[1])}, TYPES[type], extra));
  };
  // passes
  inlets.forEach(f => { const c=[f.geometry.coordinates[1], f.geometry.coordinates[0]]; push('pass', f.properties.NAME || 'Pass', c, {poly:circle(c[0],c[1],300)}); });
  // reefs
  reefs.slice(0,15).forEach(f => { const p=f.properties, c=[p.Lat_DD ?? f.geometry.coordinates[1], p.Long_DD ?? f.geometry.coordinates[0]];
    push('reef', p.Name || 'Artificial reef', c, {poly:circle(c[0],c[1],120,12)}, {depth: p.Depth ? p.Depth+' ft' : 'Unknown', structure:`Man-made reef: ${p.MatDescrip || p.MatCat || 'structure'}${p.Relief?', '+p.Relief+' ft relief':''}`, gps:`${c[0].toFixed(5)}, ${c[1].toFixed(5)}`});
    OV.reefs.addLayer(L.circleMarker(c, {pane:'habitat', radius:p.MatCat==='Vessel'?6.5:5, color:'#08161a', weight:1.5, fillColor:p.MatCat==='Vessel'?'#ffd23d':'#ff8a3d', fillOpacity:1})
      .bindPopup(`<b>${esc(p.Name||'Artificial reef')}</b><br>${p.Depth?esc(p.Depth)+' ft deep · ':''}${esc(p.MatCat==='Vessel'?'Sunken vessel':p.MatCat||'Reef')}<br>${esc(p.MatDescrip||'')}${p.DeployDate?'<br>Placed '+esc(p.DeployDate):''}<br>${c[0].toFixed(5)}, ${c[1].toFixed(5)}`)); });
  // ---- water checks from the depth model (z13 tiles for this cell are loaded above)
  const depthFt = (la,ln) => { const v = demAt(la,ln); return v===null ? null : -(v+0.2)*3.28084; };
  const offsetPt = (p, nx, ny, m) => [p[0] + ny*m/111320, p[1] + nx*m/(111320*Math.cos(p[0]*Math.PI/180))];
  // ---- water grid for this cell (+2 km margin) from the depth model: 30 m pixels
  const GR = 30, gN = s+CELL+PAD, gWl = w-PAD, dLat = GR/111320, dLng = GR/(111320*Math.cos((s+CELL/2)*Math.PI/180));
  const GW = Math.ceil((CELL+2*PAD)/dLng), GH = Math.ceil((CELL+2*PAD)/dLat), GN = GW*GH;
  const pll = (q,r) => [gN-(r+.5)*dLat, gWl+(q+.5)*dLng];
  const gix = (la,ln) => { const q = Math.floor((ln-gWl)/dLng), r = Math.floor((gN-la)/dLat); return q<0||r<0||q>=GW||r>=GH ? -1 : r*GW+q; };
  const dep = new Float32Array(GN);
  for (let r=0;r<GH;r++) for (let q=0;q<GW;q++){ const p = pll(q,r), v = demAt(p[0],p[1]); dep[r*GW+q] = v===null ? NaN : -(v+0.2)*3.28084; }
  const NB8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  // open water = 2+ ft deep and connected to 6+ ft water (drops ponds, ditches and dead-end creeks)
  const nav = new Uint8Array(GN), Q = new Int32Array(GN); let qh = 0, qt = 0;
  for (let i=0;i<GN;i++) if (dep[i] >= 6){ nav[i] = 1; Q[qt++] = i; }
  while (qh < qt){ const i = Q[qh++], q = i%GW, r = (i/GW)|0;
    for (const [a,b] of NB8){ const qq=q+a, rr=r+b; if (qq<0||rr<0||qq>=GW||rr>=GH) continue; const j = rr*GW+qq; if (!nav[j] && dep[j] >= 2){ nav[j] = 1; Q[qt++] = j; } } }
  // distance to open water, in pixels (capped)
  const dist = new Uint8Array(GN).fill(255); qh = qt = 0;
  for (let i=0;i<GN;i++) if (nav[i]){ dist[i] = 0; Q[qt++] = i; }
  while (qh < qt){ const i = Q[qh++], q = i%GW, r = (i/GW)|0, d = dist[i]; if (d >= 12) continue;
    for (const [a,b] of NB8){ const qq=q+a, rr=r+b; if (qq<0||rr<0||qq>=GW||rr>=GH) continue; const j = rr*GW+qq; if (dist[j] > d+1){ dist[j] = d+1; Q[qt++] = j; } } }
  const pip = (p, ring) => { let ins = false; for (let i=0, j=ring.length-1; i<ring.length; j=i++){ const a=ring[i], b=ring[j]; if ((a[0]>p[0]) !== (b[0]>p[0]) && p[1] < (b[1]-a[1])*(p[0]-a[0])/(b[0]-a[0]) + a[1]) ins = !ins; } return ins; };
  const chaikin = r => { let p = r; for (let k=0;k<2;k++){ const o=[]; for (let i=0;i<p.length;i++){ const a=p[i], b=p[(i+1)%p.length]; o.push([a[0]*.75+b[0]*.25, a[1]*.75+b[1]*.25], [a[0]*.25+b[0]*.75, a[1]*.25+b[1]*.75]); } p = o; } return p; };
  // outline of one labelled blob as rings (outer first, then sizable holes)
  const trace = (lab, id, q0, r0, q1, r1) => {
    const v = (q,r) => (q>=q0 && q<=q1 && r>=r0 && r<=r1 && lab[r*GW+q]===id) ? 1 : 0, segs = [];
    for (let r=r0-1; r<=r1; r++) for (let q=q0-1; q<=q1; q++){
      const idx = (v(q,r)?8:0)|(v(q+1,r)?4:0)|(v(q+1,r+1)?2:0)|(v(q,r+1)?1:0); if (!idx || idx===15) continue;
      const T=[q+.5,r], R=[q+1,r+.5], B=[q+.5,r+1], Lp=[q,r+.5];
      ({1:[[Lp,B]],2:[[B,R]],3:[[Lp,R]],4:[[T,R]],5:[[Lp,T],[B,R]],6:[[T,B]],7:[[Lp,T]],8:[[Lp,T]],9:[[T,B]],10:[[T,R],[Lp,B]],11:[[T,R]],12:[[Lp,R]],13:[[B,R]],14:[[Lp,B]]})[idx].forEach(sg => segs.push(sg));
    }
    const key = p => p[0]+','+p[1], at = new Map(); segs.forEach((sg,i) => sg.forEach(p => (at.get(key(p)) || at.set(key(p),[]).get(key(p))).push(i)));
    const used = new Uint8Array(segs.length), rings = [];
    segs.forEach((sg,i) => { if (used[i]) return; used[i] = 1; const ring = [sg[0], sg[1]]; let tip = sg[1];
      for (let g=0; g<100000; g++){ const nx = (at.get(key(tip))||[]).find(j => !used[j]); if (nx===undefined) break; used[nx] = 1; const t = segs[nx]; tip = key(t[0])===key(tip) ? t[1] : t[0]; ring.push(tip); }
      const ll = ring.map(([q,r]) => pll(q,r)); const sm = chaikin(simplify(ll, 0.00018)); if (sm.length >= 6) rings.push(sm); });
    rings.sort((a,b) => lineLenKm(b) - lineLenKm(a));
    return rings.filter((r,i) => i===0 || lineLenKm(r) >= 0.35);
  };
  // turn mapped habitat polygons into blobs clipped to reachable water; returns blobs + the kept mask
  const maskZones = (rings, o) => {
    const m = new Uint8Array(GN);
    for (const ring of rings){ let a0=90, a1=-90, n0=180, n1=-180; for (const p of ring){ if (p[0]<a0) a0=p[0]; if (p[0]>a1) a1=p[0]; if (p[1]<n0) n0=p[1]; if (p[1]>n1) n1=p[1]; }
      const r0 = clamp(Math.floor((gN-a1)/dLat),0,GH-1), r1 = clamp(Math.ceil((gN-a0)/dLat),0,GH-1), q0 = clamp(Math.floor((n0-gWl)/dLng),0,GW-1), q1 = clamp(Math.ceil((n1-gWl)/dLng),0,GW-1);
      for (let r=r0;r<=r1;r++) for (let q=q0;q<=q1;q++){ const i = r*GW+q; if (!m[i] && pip(pll(q,r), ring)) m[i] = 1; } }
    for (let g=0; g<(o.grow||0); g++){ const c = m.slice(); for (let i=0;i<GN;i++) if (c[i]){ const q=i%GW; if (q>0) m[i-1]=1; if (q<GW-1) m[i+1]=1; if (i>=GW) m[i-GW]=1; if (i+GW<GN) m[i+GW]=1; } }
    for (let i=0;i<GN;i++) if (m[i] && (!(dep[i] >= o.minFt && dep[i] <= o.maxFt) || dist[i] > o.maxDist || (o.not && o.not[i]))) m[i] = 0;
    if (o.open){ // drop slivers narrower than ~3 pixels (90 m): erode then grow back inside the original
      const orig = m.slice(), er = new Uint8Array(GN);
      for (let k=0;k<o.open;k++){ const c = m.slice(); for (let i=GW;i<GN-GW;i++){ const q=i%GW; er[i] = c[i] && q>0 && q<GW-1 && c[i-1] && c[i+1] && c[i-GW] && c[i+GW] ? 1 : 0; } m.set(er); }
      for (let k=0;k<o.open;k++){ const c = m.slice(); for (let i=GW;i<GN-GW;i++) if (!c[i] && orig[i] && (c[i-1]||c[i+1]||c[i-GW]||c[i+GW])) m[i] = 1; }
    }
    const lab = new Int32Array(GN), blobs = [], keep = new Uint8Array(GN); let id = 0;
    for (let i0=0;i0<GN;i0++){ if (!m[i0] || lab[i0]) continue; id++; lab[i0] = id; qh = qt = 0; Q[qt++] = i0;
      let n=0, sq=0, sr=0, q0=1e9, q1=-1, r0=1e9, r1=-1;
      while (qh < qt){ const i = Q[qh++], q = i%GW, r = (i/GW)|0; n++; sq+=q; sr+=r; if (q<q0) q0=q; if (q>q1) q1=q; if (r<r0) r0=r; if (r>r1) r1=r;
        for (const [a,b] of NB8){ const qq=q+a, rr=r+b; if (qq<0||rr<0||qq>=GW||rr>=GH) continue; const j = rr*GW+qq; if (m[j] && !lab[j]){ lab[j] = id; Q[qt++] = j; } } }
      if (n < o.minPx) continue;
      blobs.push({id, n, c:pll(sq/n, sr/n), box:[q0,r0,q1,r1]});
    }
    // keep the biggest blobs whose centre is in this cell
    const out = blobs.filter(b => inBox(b.c)).sort((a,b) => b.n - a.n).slice(0, o.max);
    out.forEach(b => { for (let r=b.box[1]; r<=b.box[3]; r++) for (let q=b.box[0]; q<=b.box[2]; q++) if (lab[r*GW+q]===b.id) keep[r*GW+q] = 1; b.rings = trace(lab, b.id, ...b.box); });
    return {blobs: out.filter(b => b.rings.length), keep};
  };
  // oyster bars: beds within ~120 m merged, cut to the water around them
  const oyRings = oys.flatMap(f => ringsOf(f.geometry)).map(p => p[0]);
  OV.oyster.addLayer(L.layerGroup(oyRings.map(p => L.polygon(p, {pane:'habitat', color:'#ffd58a', weight:1, fillColor:'#e8b45a', fillOpacity:.75, interactive:false}))));
  const OY = maskZones(oyRings, {grow:2, minFt:-1.5, maxFt:8, maxDist:6, minPx:10, max:10});
  OY.blobs.forEach(b => push('oyster', 'Oyster bars near '+nearName(b.c), b.c, {poly:b.rings}, {structure:'Mapped oyster bars with shell edges; fish the edges and the cuts between bars'}));
  // tidal flats: the shallow water inside mapped flats that touches open water; no overlap with oyster zones
  const FZ = maskZones(flats.flatMap(f => ringsOf(f.geometry)).map(p => p[0]), {grow:0, open:1, minFt:-0.7, maxFt:5, maxDist:5, minPx:30, max:8, not:OY.keep});
  FZ.blobs.forEach(b => push('flat', 'Flat near '+nearName(b.c), b.c, {poly:b.rings}));
  // mangrove shorelines: edges with land behind and open water in front (not ponds or dead-end creeks)
  const at = p => gix(p[0],p[1]);
  const runs = [];
  mangs.flatMap(f => ringsOf(f.geometry)).map(r => simplify(r[0], 0.00008)).filter(pts => pts.length >= 4 && lineLenKm(pts) >= 0.35).forEach(pts => {
    let run = null;
    for (let i=0;i<pts.length-1;i++){
      const A = pts[i], B = pts[i+1], m = [(A[0]+B[0])/2, (A[1]+B[1])/2];
      const dx = (B[1]-A[1])*Math.cos(m[0]*Math.PI/180), dy = B[0]-A[0], len = Math.hypot(dx,dy) || 1, nx = -dy/len, ny = dx/len;
      let ok = false;
      for (const sgn of [1,-1]){ const i1 = at(offsetPt(m, nx*sgn, ny*sgn, 60)), i2 = at(offsetPt(m, nx*sgn, ny*sgn, 130)), i0 = at(offsetPt(m, -nx*sgn, -ny*sgn, 45));
        if (i1<0 || i2<0 || i0<0) continue;
        if (dep[i1] >= 1.5 && dist[i1] <= 1 && nav[i2] && !(dep[i0] >= 1)){ ok = true; break; } }
      if (ok){ if (!run){ run = [A]; } run.push(B); } else if (run){ runs.push(run); run = null; }
    }
    if (run) runs.push(run);
  });
  // docks and marinas
  marinas.filter(f => { const p=f.properties||{}, nm=p.Name||'', us=p.Usage||'';
      return !/condo|villa|apartment|association|\bhoa\b|tower|residen|club|yacht sales|kayak|boats?$|rental/i.test(nm) && (/public/i.test(us) || /park|pier|ramp|marina|fish/i.test(nm)); })
    .map(f => ({p:f.properties, c:[f.geometry.coordinates[1], f.geometry.coordinates[0]]}))
    .map(o => { // snap the marker to the nearest water within 120 m (marina points often sit on the building)
      if (demAt(o.c[0],o.c[1]) !== null && demAt(o.c[0],o.c[1]) < -0.3) return o;
      for (const r of [40,80,120]) for (let k=0;k<12;k++){ const ang=k*Math.PI/6, q=[o.c[0]+Math.sin(ang)*r/111320, o.c[1]+Math.cos(ang)*r/(111320*Math.cos(o.c[0]*Math.PI/180))], v=demAt(q[0],q[1]); if (v!==null && v < -0.3) return {p:o.p, c:q}; }
      return null; }).filter(Boolean)
    .slice(0,5).forEach(({p,c}) => {
    push('dock', p.Name ? p.Name.replace(/\s*-\s*Marina$/,'') : 'Docks', c, {poly:circle(c[0],c[1],60,12)}, {structure:`Docks and seawalls${p.Wat_Name?' on '+p.Wat_Name:''}; shade by day, lights at night`}); });
  // bridges: keep only the part of each span that crosses water 2+ ft deep
  br1.concat(br2).flatMap(f => linesOf(f.geometry)).forEach(l => {
    const dense = []; for (let i=0;i<l.length-1;i++){ const n = Math.max(1, Math.ceil(distKm(l[i],l[i+1])/0.025)); for (let k=0;k<n;k++) dense.push([l[i][0]+(l[i+1][0]-l[i][0])*k/n, l[i][1]+(l[i+1][1]-l[i][1])*k/n]); } dense.push(l[l.length-1]);
    let run = [], best = []; const flush = () => { if (lineLenKm(run) > lineLenKm(best)) best = run; run = []; };
    for (const p of dense){ const v = demAt(p[0],p[1]); if (v !== null && -(v+0.2)*3.28084 >= 2) run.push(p); else flush(); } flush();
    if (best.length < 2 || lineLenKm(best) < 0.04) return; const c = best[Math.floor(best.length/2)], e = demAt(c[0],c[1]);
    push('bridge', 'Bridge near '+nearName(c), c, {line:best}, {depth: `${Math.round(-(e+0.2)*3.28084)} ft under the span (approx.)`}); });
  // drop-offs from the depth model: the 6 ft line where the bottom falls fast
  const segs = [];
  dem.filter(Boolean).forEach(({x,y,g:g0}) => {
    const N = DEM_N, g = depthGrid(g0);
    const steep = (q,r) => { let lo=1e9, hi=-1e9; for (let a=-3;a<=3;a++) for (let b=-3;b<=3;b++){ const v=g[clamp(r+a,0,N-1)*N+clamp(q+b,0,N-1)]; if (!isNaN(v)){ if (v<lo) lo=v; if (v>hi) hi=v; } } return lo <= 3.5 && hi >= 10 ? hi-lo : 0; };
    marching(g, N, 6, (x1,y1,x2,y2,q,r) => { const st = steep(q,r); if (!st) return; segs.push([px2ll(13,x,y,x1-.5,y1-.5), px2ll(13,x,y,x2-.5,y2-.5), st]); });
  });
  const kf = p => p[0].toFixed(5)+','+p[1].toFixed(5), ends = new Map();
  segs.forEach((s,i) => { [kf(s[0]),kf(s[1])].forEach(k => (ends.get(k)||ends.set(k,[]).get(k)).push(i)); });
  const taken = new Uint8Array(segs.length), chains = [];
  segs.forEach((s,i) => { if (taken[i]) return; taken[i]=1; const chain=[s[0],s[1]]; let st=s[2];
    for (const dir of [1,-1]){ let tip = dir>0 ? chain[chain.length-1] : chain[0];
      for (let guard=0; guard<4000; guard++){ const nx = (ends.get(kf(tip))||[]).find(j => !taken[j]); if (nx===undefined) break; taken[nx]=1; const t=segs[nx]; st+=t[2];
        const other = kf(t[0])===kf(tip) ? t[1] : t[0]; dir>0 ? chain.push(other) : chain.unshift(other); tip = other; } }
    if (lineLenKm(chain) > 0.25) chains.push({pts:simplify(chain,0.00005), st:st/chain.length}); });
  chains.sort((a,b) => b.st*lineLenKm(b.pts) - a.st*lineLenKm(a.pts)).slice(0,14)
    .forEach(ch => splitLine(ch.pts, 1.0).slice(0,2).forEach(seg => { const c = seg[Math.floor(seg.length/2)]; push('dropoff', 'Drop-off near '+nearName(c), c, {line:seg}); }));
  // mangrove edges that run along a drop-off duplicate it, so the drop-off wins
  const dropPts = add.filter(z => z.type==='dropoff').flatMap(z => z.geom.line);
  const nearDrop = seg => seg.filter((p,i) => i%2===0).some(p => dropPts.some(d => Math.abs(d[0]-p[0]) < 0.0012 && distKm(p,d) < 0.12));
  runs.filter(r => lineLenKm(r) >= 0.4).flatMap(r => splitLine(r, 0.9)).filter(r => lineLenKm(r) >= 0.3)
    .filter(seg => !nearDrop(seg)).sort((x,y) => lineLenKm(y) - lineLenKm(x)).slice(0,6)
    .forEach(seg => { const c = seg[Math.floor(seg.length/2)]; push('mangrove', 'Mangrove shoreline near '+nearName(c), c, {line:seg}, {structure:'Mangrove edge on fishable water; high tide pushes fish up under the roots'}); });
  // hard bottom overlay
  hb1.concat(hb2).flatMap(f => ringsOf(f.geometry)).forEach(r => OV.hardbottom.addLayer(L.polygon(r, {pane:'habitat', color:'#d9b3ff', weight:.8, fillColor:'#c48cff', fillOpacity:.38, interactive:false})));
  // register
  cellsBusy.delete(key); cellsDone.add(key);
  add.forEach(z => { z.k = ZONES.length; ZONES.push(z); z.st = nearestStation(z.c); drawZone(z); if (z.st) ensureTide(z.st); });
  setLoading(); refresh();
}
function nearestStation(c){ let best=null, bd=1e9; for (const s of STATIONS.tide){ const d = distKm(c,[s[1],s[2]]); if (d < bd){ bd=d; best=s; } } return best && bd < 50 ? best[0] : null; }
function drawZone(z){
  const opts = {pane:'zones', renderer:zoneRenderer};
  z.layer = z.geom.line ? L.polyline(z.geom.line, Object.assign(opts, {weight:7, lineCap:'round'})) : L.polygon(z.geom.poly, Object.assign(opts, {weight:2}));
  z.layer.on('click', () => selectZone(z.k)); if (SHOW.has(z.type)) zoneLayer.addLayer(z.layer);
}

// ---------------- tides, weather, sun & moon
const ymd = ms => { const d = new Date(ms); return d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0'); };
function ensureTide(id){
  if (TIDES.has(id)) return; const name = (STATIONS.tide.find(s => s[0]===id)||[])[3] || '';
  TIDES.set(id, {loading:true, name});
  getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=${id}&begin_date=${ymd(Date.now()-2*86400e3)}&range=240&datum=MLLW&units=english&time_zone=gmt&interval=hilo&format=json&application=spotcast`)
    .then(j => { if (!j.predictions) throw 0; TIDES.set(id, {name, ev: j.predictions.map(p => ({t:Date.parse(p.t.replace(' ','T')+':00Z'), v:+p.v}))}); SCORE.clear(); refreshSoon(); })
    .catch(() => TIDES.set(id, {name, failed:true}));
}
function tideH(id){
  const T = TIDES.get(id); if (!T || !T.ev) return null;
  if (T.hT0 !== T0){ const ev = T.ev; T.h = HRS.map(({t}) => { for (let k=0;k<ev.length-1;k++){ const a=ev[k], b=ev[k+1]; if (t>=a.t && t<=b.t){ const f=(t-a.t)/(b.t-a.t); return a.v+(b.v-a.v)*(1-Math.cos(Math.PI*f))/2; } } return ev[ev.length-1].v; }); T.hT0 = T0; }
  return T.h;
}
let condSeq = 0;
async function loadConditions(c){
  const seq = ++condSeq;
  const tzGuess = (c[1] < -85.0 && c[0] > 29.5) ? 'America/Chicago' : 'America/New_York';
  const base = {c, wx:null, waterTemp:null};
  let tz = tzGuess, periods = null;
  try { const pt = await getJSON(`https://api.weather.gov/points/${c[0].toFixed(4)},${c[1].toFixed(4)}`); tz = pt.properties.timeZone || tz; periods = (await getJSON(pt.properties.forecastHourly)).properties.periods; } catch(e){}
  if (seq !== condSeq) return;
  TZ = tz; buildClock();
  // wind per hour
  const P = (periods||[]).map(p => { const sp = (p.windSpeed||'0').match(/\d+/g)||['0']; return {t:Date.parse(p.startTime), ws:Math.max(...sp.map(Number)), wd:DIR_DEG[p.windDirection] ?? 0, temp:p.temperature}; });
  base.wx = HRS.map(({t}) => { if (!P.length) return [10,90,null]; let b=P[0]; for (const p of P) if (Math.abs(p.t-t) < Math.abs(b.t-t)) b=p; return [b.ws, b.wd, b.temp]; });
  base.noWind = !P.length;
  // sun and moon per hour
  const ev = {sunrise:[], sunset:[], major:[], minor:[]}, step = 1/6; let pS=null, pM=null, ppM=null;
  for (let x=-12; x<=H+12; x+=step){
    const t = new Date(T0 + x*3600e3), s = SunCalc.getPosition(t,c[0],c[1]).altitude*180/Math.PI, m = SunCalc.getMoonPosition(t,c[0],c[1]).altitude*180/Math.PI;
    if (pS!==null){ if (pS<-0.83 && s>=-0.83) ev.sunrise.push(x); if (pS>=-0.83 && s<-0.83) ev.sunset.push(x); }
    if (pM!==null){ if ((pM<0)!==(m<0)) ev.minor.push(x); if (ppM!==null && ((pM>ppM && pM>=m)||(pM<ppM && pM<=m))) ev.major.push({x:x-step, up:pM>0}); }
    ppM=pM; pM=m; pS=s;
  }
  const near = (arr,i,f=v=>v) => arr.reduce((b,v) => Math.abs(f(v)-i) < Math.abs(f(b)-i) ? v : b, arr[0]);
  base.hour = HRS.map((_,i) => {
    const mj = near(ev.major,i,v=>v.x), mn = near(ev.minor,i), sr = near(ev.sunrise,i), ss = near(ev.sunset,i);
    const dM = Math.abs(mj.x-i), dm = Math.abs(mn-i), sM = dM<=1 ? 20 : dM<=2.5 ? 20*(2.5-dM)/1.5 : 0, sm = dm<=.75 ? 13 : dm<=1.5 ? 13*(1.5-dm)/.75 : 0;
    const alt = SunCalc.getPosition(new Date(T0+i*3600e3), c[0], c[1]).altitude*180/Math.PI;
    return {sol:Math.max(sM,sm), major:sM>=sm, mjAt:mj.x, mjUp:mj.up, mnAt:mn, dS:Math.min(Math.abs(sr-i),Math.abs(ss-i)), srNear:Math.abs(sr-i)<Math.abs(ss-i), sr, ss, alt,
      night: SunCalc.getPosition(new Date(T0+(i+.5)*3600e3), c[0], c[1]).altitude < -0.0145, moon: SunCalc.getMoonIllumination(new Date(T0+i*3600e3)).fraction};
  });
  // water temperature
  let wt = null, bd = 1e9; for (const s of STATIONS.wt){ const d = distKm(c,[s[1],s[2]]); if (d < bd){ bd=d; wt=s; } }
  if (wt && bd < 80){ try { const j = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature&station=${wt[0]}&date=latest&units=english&time_zone=gmt&format=json&application=spotcast`); if (j.data) base.waterTemp = +j.data[0].v; } catch(e){} }
  if (seq !== condSeq) return;
  COND = base; SCORE.clear();
  const now = (Date.now()-T0)/3600e3; if (!condReady){ cur = clamp(Math.ceil(now),0,H-1); condReady = true; } else cur = clamp(cur,0,H-1);
  refresh();
}
let condReady = false;

// ---------------- scoring
function score(k, i){
  const key = k*1000+i; if (SCORE.has(key)) return SCORE.get(key);
  const z = ZONES[k], hr = COND.hour[i];
  let tide = 14, tideWhy = [-1,'No tide prediction nearby yet, so this rating leans on wind, moon and light.'], r = 0, v = null;
  const h = z.st ? tideH(z.st) : null;
  if (h){
    v = h[i]; r = (h[Math.min(i+1,H-1)] - h[Math.max(i-1,0)])/2;
    const mag = Math.abs(r), dir = r>0?'incoming':'outgoing', s = Math.min(1, mag/0.22);
    if (mag < 0.04){ tide = 6; tideWhy = [-1,'Slack tide. Expect a slow bite until the water starts moving.']; }
    else if (z.pref==='moving'){ tide = 8+21*s; tideWhy = [s>.55?2:1, `Tide ${s>.55?'moving well':'starting to move'}, pushing bait past the structure.`]; }
    else if (dir===z.pref){ tide = 12+23*s; tideWhy = [s>.55?2:1, `${cap(dir)} tide ${s>.55?'running well':'starting to move'}. ${z.label} fish best on the ${z.pref}.`]; }
    else { tide = 6+4*s; tideWhy = [-1, `Tide is ${dir==='incoming'?'coming in':'going out'}. ${z.label} fish best on the ${z.pref}.`]; }
  }
  const [ws, wd] = COND.wx[i];
  let wind, windWhy;
  if (z.wind==='shel'){ wind = ws>14 ? 25 : 21; windWhy = [ws>14?1:0, `Protected water, so the ${ws} mph ${card(wd)} wind matters less.`]; }
  else if (z.wind==='reef'){ const pen = clamp((ws-8)/10,0,1); wind = 25*(1-pen); windWhy = pen>.6 ? [-2, `${ws} mph ${card(wd)} wind. Rough for running offshore.`] : pen>.25 ? [-1, `${ws} mph ${card(wd)} wind. Expect a bumpy ride out.`] : [1, `Light ${card(wd)} wind. Good conditions to run out and anchor.`]; }
  else if (z.wind==='flat'){ const pen = clamp((ws-10)/10,0,1)*0.7; wind = 25*(1-pen); windWhy = pen>.35 ? [-1, `${ws} mph ${card(wd)} wind will muddy a shallow flat. Work the lee side.`] : [1, `A ${ws} mph ${card(wd)} breeze is workable on the flat.`]; }
  else { const pen = clamp((ws-12)/12,0,1)*0.6; wind = 25*(1-pen); windWhy = pen>.3 ? [-1, `${ws} mph ${card(wd)} wind. Fish the protected side.`] : [1, `The ${ws} mph ${card(wd)} wind stays fishable here.`]; }
  let solWhy = null;
  if (hr.sol >= 10) solWhy = hr.major ? [2, `Major feeding window: moon ${hr.mjUp?'overhead':'underfoot'} at ${hourLabel(hr.mjAt)}.`] : [1, `Minor feeding window: moon on the horizon at ${hourLabel(hr.mnAt)}.`];
  let light, lightWhy = null;
  if (hr.dS <= 1.5){ light = 20; lightWhy = [2, `Low light around ${hr.srNear?'sunrise':'sunset'} (${hourLabel(hr.srNear?hr.sr:hr.ss)}).`]; }
  else if (hr.alt < -6){ light = z.deep ? 15 : 9; lightWhy = (z.type==='bridge'||z.type==='dock') ? [2,'Night bite. Fish the shadow line under the lights.'] : z.type==='pass' ? [1,'Night bite. Fish current lines in the pass.'] : z.type==='reef' ? [-1,'Dark offshore. Run out only if you know the water.'] : [-1,'Dark on shallow water. Hard to read and fish.']; if (z.type==='bridge'||z.type==='dock') light = 14; }
  else { light = z.deep ? 12 : 7; if (z.type==='dock'||z.type==='bridge') { light = 10; lightWhy = [1,'Bright sun pushes fish into the shade under the structure.']; } else if (!z.deep) lightWhy = [-1,'High sun on shallow water. Fish push to edges and shade.']; }
  const total = Math.min(100, Math.round(tide + wind + hr.sol + light + (z.base||0)));
  const why = [tideWhy, windWhy, solWhy, lightWhy].filter(Boolean).filter(w => w[0]!==0).sort((a,b) => Math.abs(b[0])-Math.abs(a[0]) || b[0]-a[0]);
  const out = {total, tier:tierOf(total), why, tide:{v, r, dir: r>0?'incoming':'outgoing'}, ws, wd};
  SCORE.set(key, out); return out;
}
function visibleZones(){
  const b = map.getBounds().pad(-0.05); return map.getZoom() < 11 ? [] : ZONES.filter(z => SHOW.has(z.type) && b.contains(z.c));
}
function bestOfDay(d, list){
  const val = i => list.reduce((m,z) => Math.max(m, score(z.k,i).total), 0);
  const ix = DAYS[d].idx.filter(i => HRS[i].h>=5 && HRS[i].h<=21); let best = null;
  for (const i of ix){ const v = val(i); if (!best || v>best.total) best = {i,total:v}; }
  let a=best.i, b=best.i; while (ix.includes(a-1) && val(a-1) >= best.total-4) a--; while (ix.includes(b+1) && val(b+1) >= best.total-4) b++;
  return {...best, from:a, to:b};
}

// ---------------- loading on pan
let moveTimer = null;
function onMove(){
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    const m = map.getCenter(), c = [m.lat, m.lng];
    if (!COND || distKm(COND.c, c) > 40) loadConditions(c);
    if (map.getZoom() >= 11){
      const b = map.getBounds().pad(0.15), keys = [];
      for (let la = Math.floor(b.getSouth()/CELL); la <= Math.floor(b.getNorth()/CELL); la++)
        for (let lo = Math.floor(b.getWest()/CELL); lo <= Math.floor(b.getEast()/CELL); lo++) keys.push(la+':'+lo);
      keys.sort((a,bk) => { const ca = a.split(':').map(Number), cb = bk.split(':').map(Number); return distKm(c,[(ca[0]+.5)*CELL,(ca[1]+.5)*CELL]) - distKm(c,[(cb[0]+.5)*CELL,(cb[1]+.5)*CELL]); });
      keys.slice(0, 16).forEach(k => loadCell(k));
    }
    store.set('sz3-view', {lat:m.lat, lng:m.lng, z:map.getZoom(), name:placeName});
    refresh();
  }, 300);
}
map.on('moveend', onMove);
map.on('click', () => { $('layersPanel').hidden = true; if (!$('searchForm').hidden) openSearch(false); });
function setLoading(){ $('loadBar').hidden = cellsBusy.size === 0; }
let refreshT = null; const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(refresh, 250); };

// ---------------- render
function paintMap(){
  if (!COND) return;
  const lowZoom = map.getZoom() < 11;
  ZONES.forEach(z => {
    if (lowZoom){ z.layer.setStyle({opacity:0, fillOpacity:0}); return; }
    const s = score(z.k, cur), c = COLORS[s.tier[1]], on = sel===z.k, dim = sel!=null && !on;
    if (z.geom.line) z.layer.setStyle({color: on?'#ffffff':c, weight: on?7:(map.getZoom()>=14?5:3.5), opacity: dim?.3:.85});
    else z.layer.setStyle({color: on?'#ffffff':c, fillColor:c, weight:on?3:1.4, fillOpacity: dim?.08:(s.tier[1]==='fair'?.12:.22), opacity: dim?.35:.95});
  });
}
function paintStatus(){
  const m = map.getCenter();
  $('where').textContent = placeName || ('Near ' + nearName([m.lat, m.lng]));
  if (!COND){ $('when').textContent = 'Loading conditions…'; $('cond').innerHTML = ''; return; }
  const [ws,wd,temp] = COND.wx[cur], d = HRS[cur].d, hr = COND.hour[cur];
  $('when').textContent = `${dayLabel(d)} · ${hourLabel(cur)}`;
  const st = nearestStation([m.lat, m.lng]), h = st ? tideH(st) : null;
  let tide = ''; if (h){ const v = h[cur], r = (h[Math.min(cur+1,H-1)]-h[Math.max(cur-1,0)])/2; tide = `<span>Tide <b>${Math.abs(r)<.04?'Slack':(r>0?'↑ In':'↓ Out')} ${v.toFixed(1)} ft</b></span>`; }
  $('cond').innerHTML = `<span>Wind <b>${COND.noWind?'n/a':card(wd)+' '+ws+' mph'}</b></span>${tide}${COND.waterTemp?`<span>Water <b>${COND.waterTemp.toFixed(0)}°</b></span>`:(temp!=null?`<span>Air <b>${temp}°</b></span>`:'')}<span>Moon <b>${Math.round(hr.moon*100)}%</b></span>`;
}
const KIND_ORDER = ['pass','bridge','dropoff','flat','mangrove','oyster','dock','reef'];
function paintHead(){
  const el = $('dockSummary'); let html;
  if (!COND) html = 'Loading conditions…';
  else if (sel != null){ const z = ZONES[sel], s = score(sel,cur); html = `<span class="t-${s.tier[1]}"><span class="pill">${s.tier[2]}</span></span><span class="nm1">${esc(z.name)}</span>`; }
  else if (map.getZoom() < 11) html = '<b>Zoom in</b> to see spots';
  else { const vis = visibleZones();
    if (!vis.length) html = cellsBusy.size ? 'Finding spots in view…' : 'No mapped spots in view';
    else { let best = vis[0], bs = score(best.k,cur); for (const z of vis){ const s = score(z.k,cur); if (s.total > bs.total){ best = z; bs = s; } }
      html = `<b>${vis.length} spots</b><span>·</span><span class="t-${bs.tier[1]}"><span class="pill">${bs.tier[2]}</span></span><span class="nm1">${esc(best.name)}</span>`; } }
  el.innerHTML = html;
  $('dockHead').setAttribute('aria-expanded', !$('dock').classList.contains('collapsed'));
}
let dockOpen = store.get('sz3-dock-open', false);
function setDock(open){ $('dock').classList.toggle('collapsed', !open); $('app').classList.toggle('dock-open', !!open); if (open) $('layersPanel').hidden = true; paintHead(); }
function toggleDock(want){ const isOpen = !$('dock').classList.contains('collapsed'); if (want === isOpen) return;
  if (sel != null && !want){ selectZone(null); if (!dockOpen) return; dockOpen = false; store.set('sz3-dock-open', false); setDock(false); refresh(); return; }
  dockOpen = want; store.set('sz3-dock-open', dockOpen); setDock(dockOpen); refresh(); }
// tap the header to open/close; drag the grab bar up to open, down to close (window-shade)
(function(){
  const head = $('dockHead'), dock = $('dock'); let y0 = null, dy = 0, moved = false;
  head.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; moved = false; head.setPointerCapture(e.pointerId); dock.style.transition = 'none'; });
  head.addEventListener('pointermove', e => { if (y0 === null) return; dy = e.clientY - y0; if (Math.abs(dy) > 6) moved = true;
    const open = !dock.classList.contains('collapsed');
    if (open && dy > 0) dock.style.transform = `translateY(${dy}px)`;
    if (!open && dy < -24){ y0 = null; dock.style.transform = ''; toggleDock(true); } });
  const end = () => { if (y0 === null) return; y0 = null; dock.style.transition = 'transform .18s'; dock.style.transform = '';
    const open = !dock.classList.contains('collapsed');
    if (!moved){ if (sel != null) selectZone(null); else toggleDock(!open); } else if (open && dy > 50) toggleDock(false); };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', () => { y0 = null; dock.style.transform = ''; });
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleDock(dock.classList.contains('collapsed')); } });
})();
setDock(dockOpen);
function paintBody(){
  const el = $('body');
  if (!COND){ el.innerHTML = `<div class="eyebrow">Loading conditions</div><div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>`; return; }
  if (map.getZoom() < 11){ el.innerHTML = `<div class="empty"><b>Zoom in to see spots</b>Spots load automatically once you zoom in on the water.</div>${installHtml()}`; wireInstall(); return; }
  if (sel != null) return paintSpot();
  const vis = visibleZones();
  if (!vis.length){ el.innerHTML = cellsBusy.size ? `<div class="eyebrow">Finding spots in view</div><div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>` : `<div class="empty"><b>No mapped spots in view</b>Pan to the coast or zoom out a little. Spots come from passes, bridges, drop-offs, flats, mangroves, oyster bars, docks and reefs.</div>${installHtml()}`; wireInstall(); return; }
  const ranked = vis.map(z => ({z, s:score(z.k,cur)})).sort((a,b) => b.s.total-a.s.total);
  const counts = {}; vis.forEach(z => counts[z.type] = (counts[z.type]||0)+1);
  el.innerHTML = `<div class="list-head"><span class="eyebrow">${vis.length} spots in view · best at ${hourLabel(cur)}</span><span class="legend">${TIER.map(t=>`<span class="t-${t[1]}"><i class="dot"></i>${t[2]}</span>`).join('')}</span></div>
    <ol class="rank">${ranked.slice(0,30).map((r,n)=>`<li><button type="button" class="t-${r.s.tier[1]}" data-k="${r.z.k}"><span class="n">${n+1}</span><span class="nm">${esc(r.z.name)} <span class="kind">· ${r.z.label}</span><span class="why">${esc(shortWhy(r.s))}</span></span><span class="pill">${r.s.tier[2]}</span></button></li>`).join('')}</ol>
    ${ranked.length>30?`<p class="note">Showing the top 30. Zoom in to narrow the list.</p>`:''}
    <p class="note">${KIND_ORDER.filter(k=>counts[k]).map(k=>`${counts[k]} ${TYPES[k].label.toLowerCase()}`).join(' · ')}</p>
    ${installHtml()}
    <p class="note">Spots are generated from FWC habitat maps, FDOT bridges and the NOAA depth model, then rated each hour from NOAA tides, the NWS wind forecast, moon and sun. A starting point, not local knowledge. Not for navigation.</p>`;
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => selectZone(+b.dataset.k));
  wireInstall();
}
function paintSpot(){
  const el = $('body'), z = ZONES[sel], s = score(sel,cur), d = HRS[cur].d, b = bestOfDay(d, [z]), key = sel+':'+cur;
  const stName = z.st ? (TIDES.get(z.st)||{}).name : null;
  el.innerHTML = `<div class="spot-head t-${s.tier[1]}"><h2>${esc(z.name)}</h2>
      <button class="close" type="button" aria-label="Back to all spots" id="closeSpot"><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="meta"><span class="pill">${s.tier[2]}</span><span>${z.label} · ${hourLabel(cur)} · score ${s.total}/100</span></div></div>
    <div class="best"><span><span class="eyebrow">Best on ${DAYS[d].wd}</span><br><b>${hourLabel(b.from)}${b.to>b.from?'–'+hourLabel(b.to+1):''}</b> · ${tierOf(b.total)[2]}</span>${b.i!==cur?`<button type="button" id="goBest">Show this time</button>`:''}</div>
    <ul class="why-list">${s.why.map(w=>`<li class="${w[0]>0?'up':'down'}"><span class="ic">${w[0]>0?'↑':'↓'}</span><span>${esc(w[1])}</span></li>`).join('')}</ul>
    <dl class="facts">
      <dt>Fishes best</dt><dd>${z.pref==='moving'?'Any moving tide':cap(z.pref)+' tide'}</dd>
      ${z.depth?`<dt>Depth</dt><dd>${esc(z.depth)}</dd>`:''}
      <dt>Structure</dt><dd>${esc(z.structure)}</dd>
      <dt>GPS</dt><dd>${esc(z.gps || z.c[0].toFixed(5)+', '+z.c[1].toFixed(5))}</dd>
      <dt>Tide station</dt><dd>${esc(stName || 'None nearby')}</dd>
      <dt>Species</dt><dd class="chips">${z.species.map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</dd>
    </dl>
    <button class="plan-btn" type="button" id="planBtn">Game plan for ${hourLabel(cur)}</button>
    <div id="planOut">${plans[key]?planHtml(plans[key]):''}</div>`;
  $('closeSpot').onclick = () => selectZone(null);
  const gb = $('goBest'); if (gb) gb.onclick = () => setTime(b.i);
  $('planBtn').onclick = () => { plans[key] = gamePlan(z, s, cur); $('planOut').innerHTML = planHtml(plans[key]); wireCopy(); };
  wireCopy();
}
function shortWhy(s){ const up = s.why.filter(w=>w[0]>0)[0], dn = s.why.filter(w=>w[0]<0)[0]; return ((up||dn||[0,''])[1]).split('. ')[0]; }

// ---- game plan
function gamePlan(z, s, i){
  const t = s.tide, [ws, wd] = COND.wx[i], slack = Math.abs(t.r||0) < .04, dir = slack ? 'slack' : t.dir, windy = ws > 14;
  const lee = windy ? ` Stay on the side protected from the ${ws} mph ${card(wd)} wind.` : '';
  switch (z.type){
    case 'reef': return `### Start here\n${ws>15?`It is ${ws} mph out of the ${card(wd)}. Make sure the run out is safe before you go.`:`Run to ${z.gps} and idle over it to mark fish before you anchor.`}\n### How to work it\nAnchor up-current so baits settle on the structure. ${slack?'Current is slack; use lighter weights.':'Add weight to hold bottom in the current.'}\n### Baits\n- Bottom: live pinfish or shrimp on a knocker rig\n- Mid-water: free-lined baitfish for mackerel\n- Sheepshead: fiddler crabs tight to the structure\n### If it's slow\nReposition 30 to 50 feet up-current, or move to the next reef.`;
    case 'pass': case 'bridge': return `### Start here\nWork the ${z.type==='bridge'?'up-current side of the pilings and the shadow line':dir==='outgoing'?'ocean side of the pass':'bay side of the pass'}.${lee}\n### How to work it\nCast up-current and let the bait swing past the structure, close to bottom.${COND.hour[i].alt<-6?' At night, fish the edge of the light.':''}\n### Lures by depth\n- Up to 12 ft: paddletail on a 1/4 to 3/8 oz jighead\n- Deeper: bucktail or jig, 1/2 to 3/4 oz\n- Pilings: live shrimp or crab on a short leader\n### If it's slow\nWait for the tide to turn, or move to the next spot on the list.`;
    case 'dock': return `### Start here\nSkip baits deep under the dock ends and along the shade line.${lee}\n### How to work it\nWork the up-current side first; fish face into the current under cover.\n### Lures\n- Weedless soft plastic skipped under the boards\n- Live shrimp free-lined into the shade\n- At night: small swimbait along the light line\n### If it's slow\nMove dock to dock and spend no more than ten casts on each.`;
    case 'dropoff': return `### Start here\nPosition on the shallow side and cast across the edge into deeper water.${lee}\n### How to work it\n${dir==='outgoing'?'Falling water pulls bait off the flat. Bring the lure from shallow to deep.':'Rising water lets fish ride up the edge. Work the top of the slope.'}\n### Lures by depth\n- Top of the edge (3 to 5 ft): paddletail on 1/8 to 1/4 oz\n- Down the slope: jig on 3/8 oz, hopped along bottom\n- Low light: topwater along the edge\n### If it's slow\nSlide along the edge to find a point, turn or cut where it bends.`;
    default: return `### Start here\n${dir==='incoming'?'Start on the edges as rising water floods in.':dir==='outgoing'?'Fish the drains and cuts where water pours off.':'Water is slack; fish the deeper edges nearby.'} Approach quietly; this is shallow water.${lee}\n### How to work it\nCast past the ${z.type==='mangrove'?'roots and pull the bait out along the edge':'edge and work the bait back across it'}.\n### Lures by depth\n- 1 to 2 ft: weedless soft plastic, or topwater at low light\n- 2 to 4 ft: shrimp imitation or paddletail on 1/8 oz\n- Slow bite: live shrimp under a popping cork\n### If it's slow\nKeep moving until you find fish or bait activity.`;
  }
}
function md(text){
  const out=[]; let inList=false;
  for (const raw of text.split('\n')){ const line = raw.trim(); if (!line){ if(inList){out.push('</ul>');inList=false;} continue; }
    if (/^#{1,6}\s/.test(line)){ if(inList){out.push('</ul>');inList=false;} out.push(`<h4>${esc(line.replace(/^#+\s*/,''))}</h4>`); }
    else if (/^[-*]\s/.test(line)){ if(!inList){out.push('<ul>');inList=true;} out.push(`<li>${esc(line.replace(/^[-*]\s*/,''))}</li>`); }
    else { if(inList){out.push('</ul>');inList=false;} out.push(`<p>${esc(line)}</p>`); } }
  if (inList) out.push('</ul>'); return out.join('');
}
const planHtml = t => `<div class="plan">${md(t)}<div class="plan-foot"><span>Built from this spot's data</span><button type="button" id="copyPlan">Copy</button></div></div>`;
function wireCopy(){ const c = $('copyPlan'); if (!c) return; c.onclick = () => { const txt = `${ZONES[sel].name}, ${dayLabel(HRS[cur].d)} ${hourLabel(cur)}\n\n${plans[sel+':'+cur]}`;
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => c.textContent='Copied', () => { const r=document.createRange(); r.selectNodeContents(c.closest('.plan')); getSelection().removeAllRanges(); getSelection().addRange(r); c.textContent='Selected'; }); }; }

// ---- install prompt
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; refresh(); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function installHtml(){
  if (standalone() || store.get('sz2-noinstall', false)) return '';
  if (deferredInstall) return `<div class="install"><span>Put Spotcast on your home screen.</span><button type="button" id="doInstall">Install</button></div>`;
  if (isIOS) return `<div class="install"><span>To install: tap Share, then “Add to Home Screen.”</span><button type="button" id="noInstall">Hide</button></div>`;
  return '';
}
function wireInstall(){
  const b = $('doInstall'); if (b) b.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; refresh(); };
  const n = $('noInstall'); if (n) n.onclick = () => { store.set('sz2-noinstall', true); refresh(); };
}

// ---- timeline
function paintDays(){
  if (!COND) return; const box = $('days'), curD = HRS[cur].d, vis = visibleZones();
  box.innerHTML = DAYS.map((D,d) => { const t = vis.length ? tierOf(bestOfDay(d, sel!=null?[ZONES[sel]]:vis).total) : TIER[3];
    return `<button type="button" class="day t-${t[1]}" data-d="${d}" aria-pressed="${d===curD}" aria-label="${dayLabel(d)}"><span class="dw">${D.wd}</span><span class="dn">${D.dn}</span><span class="bar"></span></button>`; }).join('');
  box.querySelectorAll('.day').forEach(b => b.onclick = () => setTime(hourAt(+b.dataset.d, HRS[cur].h)));
}
function paintScrub(){
  if (!COND) return; const d = HRS[cur].d, svg = $('scrubSvg'), vis = sel!=null ? [ZONES[sel]] : visibleZones(); let g = '';
  const m = map.getCenter(), stId = sel!=null ? ZONES[sel].st : nearestStation([m.lat,m.lng]), th = stId ? tideH(stId) : null;
  for (let h=0; h<24; h++){
    const i = hourAt(d,h); if (COND.hour[i].night) g += `<rect x="${h*10}" y="0" width="10" height="64" fill="#0a1a1e"/>`;
    if (vis.length){ const v = vis.reduce((mx,z) => Math.max(mx, score(z.k,i).total), 0), t = tierOf(v), bh = Math.max(4,(v/100)*46);
      g += `<rect x="${h*10+1.5}" y="${62-bh}" width="7" height="${bh}" rx="1.5" fill="${COLORS[t[1]]}" opacity="${HRS[cur].h===h?1:.62}"/>`; }
  }
  if (th){ const vals = Array.from({length:25},(_,h)=>th[Math.min(hourAt(d,Math.min(h,23))+(h===24?1:0),H-1)]), lo = Math.min(...th), hi = Math.max(...th);
    g += `<polyline points="${vals.map((v,h)=>`${h*10},${(58-(v-lo)/((hi-lo)||1)*50).toFixed(1)}`).join(' ')}" fill="none" stroke="#e9f3f1" stroke-width="1.6" vector-effect="non-scaling-stroke" opacity=".85"/>`; }
  const x = HRS[cur].h*10+5; g += `<line x1="${x}" x2="${x}" y1="0" y2="64" stroke="#62d8c7" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  svg.innerHTML = g; $('scrub').setAttribute('aria-valuenow', HRS[cur].h); $('scrub').setAttribute('aria-valuetext', hourLabel(cur));
}
(function(){
  const el = $('scrub'); let drag = false;
  const at = e => { if (!COND) return; const r = el.getBoundingClientRect(), h = clamp(Math.floor((e.clientX-r.left)/r.width*24),0,23), i = hourAt(HRS[cur].d, h); if (i!==cur) setTime(i); };
  el.addEventListener('pointerdown', e => { drag = true; el.setPointerCapture(e.pointerId); at(e); });
  el.addEventListener('pointermove', e => { if (drag) at(e); });
  el.addEventListener('pointerup', () => drag = false); el.addEventListener('pointercancel', () => drag = false);
  el.addEventListener('keydown', e => { if (e.key==='ArrowRight'){ setTime(Math.min(H-1,cur+1)); e.preventDefault(); } if (e.key==='ArrowLeft'){ setTime(Math.max(0,cur-1)); e.preventDefault(); } });
})();
$('bestBtn').onclick = () => { if (!COND) return; const vis = sel!=null ? [ZONES[sel]] : visibleZones(); if (vis.length) setTime(bestOfDay(HRS[cur].d, vis).i); };
function setTime(i){ cur = clamp(i,0,H-1); refresh(); }
function dockH(){ return document.querySelector('.dock').offsetHeight || Math.round(innerHeight*.46); }
function selectZone(k){
  sel = k; document.querySelector('.dock').classList.toggle('detail', k!=null); setDock(k!=null ? true : dockOpen); refresh();
  if (k!=null){ const z = ZONES[k], wide = matchMedia('(min-width:900px)').matches, bnds = z.layer.getBounds();
    map.fitBounds(bnds, wide ? {paddingTopLeft:[460,170], paddingBottomRight:[60,60], maxZoom:16} : {paddingTopLeft:[40,170], paddingBottomRight:[40, dockH()+20], maxZoom:16});
    $('body').scrollTop = 0; }
}

function refresh(){ paintMap(); paintStatus(); paintHead(); paintBody(); paintDays(); paintScrub(); }

// ---------------- search
const GEO = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer', EXT = `${FL.w},${FL.s},${FL.e},${FL.n}`;
let sTimer = null, sSeq = 0;
$('q').addEventListener('input', e => {
  clearTimeout(sTimer); const q = e.target.value.trim(); if (q.length < 2){ $('sugg').hidden = true; return; }
  sTimer = setTimeout(async () => { const my = ++sSeq;
    try { const j = await getJSON(`${GEO}/suggest?text=${encodeURIComponent(q)}&f=json&countryCode=USA&searchExtent=${EXT}&maxSuggestions=6`); if (my !== sSeq) return;
      const list = j.suggestions || []; $('sugg').innerHTML = list.map((s,i) => `<li><button type="button" data-i="${i}">${esc(s.text)}</button></li>`).join(''); $('sugg').hidden = !list.length;
      $('sugg').querySelectorAll('button').forEach(b => b.onclick = () => go(list[+b.dataset.i].text, list[+b.dataset.i].magicKey));
    } catch(e){ $('sugg').hidden = true; } }, 220);
});
$('searchForm').addEventListener('submit', e => { e.preventDefault(); const q = $('q').value.trim(); if (q) go(q); });
function openSearch(open){ $('searchForm').hidden = !open; $('searchBtn').hidden = open; $('searchBtn').setAttribute('aria-expanded', open); if (open){ $('layersPanel').hidden = true; setTimeout(() => $('q').focus(), 30); } else { $('q').value = ''; $('sugg').hidden = true; } }
$('searchBtn').onclick = () => openSearch(true);
$('closeSearch').onclick = () => openSearch(false);
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('searchForm').hidden) openSearch(false); });
async function go(text, magicKey){
  $('sugg').hidden = true; $('q').blur();
  try {
    let loc = null, label = text.split(',').slice(0,2).join(',');
    try { const j = await getJSON(`${GEO}/findAddressCandidates?SingleLine=${encodeURIComponent(text)}${magicKey?'&magicKey='+encodeURIComponent(magicKey):''}&f=json&maxLocations=1&searchExtent=${EXT}&countryCode=USA`); const c0 = (j.candidates||[])[0]; if (c0) loc = [c0.location.y, c0.location.x]; } catch(e){}
    if (!loc){ const j = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=1&countrycodes=us&viewbox=${FL.w},${FL.n},${FL.e},${FL.s}&bounded=1`); if (j[0]) { loc = [+j[0].lat, +j[0].lon]; label = j[0].display_name.split(',').slice(0,2).join(','); } }
    if (!loc) return toast('No match in Florida. Try a city or landmark name.');
    if (loc[0] < FL.s-.3 || loc[0] > FL.n+.3 || loc[1] < FL.w-.5 || loc[1] > FL.e+.6) return toast('That place is outside Florida. Spotcast covers Florida waters.');
    openSearch(false); placeName = label; selectZone(null); map.setView(loc, 13);
  } catch(e){ toast('Search is unavailable right now. Check your connection and try again.'); }
}
map.on('dragstart', () => { placeName = null; });
function locate(){
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  navigator.geolocation.getCurrentPosition(p => { const {latitude:la, longitude:ln} = p.coords;
    if (la < FL.s-.3 || la > FL.n+.3 || ln < FL.w-.5 || ln > FL.e+.6) return toast('You are outside Florida. Search a Florida city instead.');
    placeName = 'My location'; selectZone(null); map.setView([la, ln], 13); }, () => toast('Location permission was denied.'), {enableHighAccuracy:false, timeout:10000});
}
$('locate').onclick = locate;

// ---------------- full-screen height
// iPhone home-screen apps can stop the page one status bar short of the screen bottom; that strip already
// clears the home indicator, so the dock drops its own bottom padding there (the strip is painted the panel colour).
function fitHeight(){
  const sa = matchMedia('(display-mode: standalone)').matches || navigator.standalone, portrait = innerHeight >= innerWidth;
  document.documentElement.classList.toggle('vp-short', !!(sa && portrait && screen.height - $('app').offsetHeight > 20));
  map.invalidateSize();
}
// keep the map credit just above the dock
new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px')).observe($('dock'));
addEventListener('resize', fitHeight); addEventListener('orientationchange', () => setTimeout(fitHeight, 300)); fitHeight();

// ---------------- boot
(async function boot(){
  window.__scBoot = true;
  // when a new version takes over, reload once so it shows right away
  if (navigator.serviceWorker && navigator.serviceWorker.controller){ let done = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!done){ done = true; location.reload(); } }); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(()=>{}); });
  try { STATIONS = await getJSON('stations.json'); } catch(e){}
  const v = store.get('sz3-view', null) || (store.get('sz2-place', null) ? Object.assign({z:13}, store.get('sz2-place')) : {lat:27.632, lng:-82.72, z:13, name:'Fort De Soto, FL'});
  placeName = v.name || null;
  map.setView([v.lat, v.lng], Math.max(11, v.z || 13));
  onMove();
})();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => r.update()).catch(()=>{}));
