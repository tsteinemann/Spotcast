'use strict';
// =====================================================================
// Spotcast — spots load for whatever part of Florida or Georgia is on screen.
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
const FL = {s:24.3, w:-87.7, n:35.05, e:-79.8}; // Florida and Georgia
const inGAcoast = (la, ln) => la > 30.68 && la < 32.3 && ln > -82.1 && ln < -80.4; // Georgia's tidal coast
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
  reef:     {label:'Reef',          pref:'moving',   deep:true,  shelter:false, wind:'reef', base:3, depth:'', structure:'Man-made reef'},
  point:    {label:'Point',         pref:'lake',     deep:true,  shelter:false, wind:'point', base:4, depth:'Drops from shallow to deep', structure:'Lake point: shallow flat that tapers into deeper water; bait and bass move up and down it'},
  cove:     {label:'Cove',          pref:'lake',     deep:false, shelter:true,  wind:'shel', base:2, depth:'Shallow pocket', structure:'Cove or pocket off the main lake: spawning flats in spring, shad push in during fall'}
};
function speciesFor(type, lat, lng){
  if (inGAcoast(lat, lng)){ // Georgia: no snook; trout, reds and flounder inshore, sea bass and sheepshead on the reefs
    switch (type){
      case 'pass': case 'bridge': return ['Redfish','Sheepshead','Black drum','Flounder'];
      case 'dock': return ['Sheepshead','Redfish','Black drum'];
      case 'reef': return ['Black sea bass','Sheepshead','Spadefish','Cobia'];
      default: return ['Redfish','Speckled trout','Flounder','Black drum'];
    }
  }
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
let GA = {inlets:[], reefs:[], reefGroups:[], inshore:[], ramps:[], marinas:[]}; // Georgia sounds, reefs, ramps, marinas (georgia.json)
const GA_READY = fetch('georgia.json').then(r => r.json()).then(j => { GA = Object.assign(GA, j); }).catch(() => {});
const ZONES = [];                     // every spot loaded so far
const ZONE_IDS = new Set();
let COND = null;                      // conditions for the area: wind, sun, moon, water temp
const TIDES = new Map();              // station id -> {ev, name, h, hT0} | promise
let SCORE = new Map();                // memo: zoneIndex*1000+hour -> score
let cur = 0, sel = null, placeName = null;
const plans = {};

// ---------------- map
const map = L.map('map', {zoomControl:false, zoomSnap:.5, minZoom:7, maxZoom:19, maxBounds:[[23.6,-88.6],[35.4,-79.0]], tap:false});
map.attributionControl.setPrefix(false); map.attributionControl.setPosition('bottomleft');
map.createPane('habitat').style.zIndex = 410;
map.createPane('zones').style.zIndex = 450;
map.createPane('labels').style.zIndex = 430; map.getPane('labels').style.pointerEvents = 'none';
// Satellite = Esri World Imagery everywhere, with newer free imagery laid on top where it exists (newest last = on top):
// NOAA post-storm aerials (Debby, Helene, Milton 2024; Isaias Oct 2026) and Sarasota's Dec 2025–Jan 2026 city aerials.
// Safari holds on to a canvas's memory until garbage collection; shrinking it to zero frees it right away. Every
// canvas-drawn tile (cleaned imagery, shaded relief, contours) is released the moment it scrolls off the map.
L.GridLayer.mergeOptions({keepBuffer:1}); // hold one ring of off-screen tiles instead of two
L.GridLayer.addInitHook(function(){ this.on('tileunload', e => { const t = e.tile; if (t && t.getContext){ t.width = 0; t.height = 0; } }); });
const NEWER = [ // [tileset, west, south, east, north, max native zoom]
  ['20240807a',-83.2876,28.7999,-82.5374,29.4751,20],['20240808a',-83.7251,29.3624,-82.5499,30.4251,20],['20240812a',-82.6501,28.4999,-82.4999,28.9001,20],
  ['20240927a',-85.7501,29.5749,-85.0124,30.1751,21],['20240927b',-85.2126,29.5624,-84.1624,30.2001,20],['20240928a',-83.7126,29.4499,-83.3374,29.9751,20],
  ['20240928b',-83.4376,27.8874,-82.4374,29.7126,21],['20240929a',-83.1001,27.8999,-82.5749,29.2251,21],['20240929b',-82.7876,27.1999,-82.4749,27.8501,21],
  ['20240930a',-82.5751,27.5874,-82.3249,27.9876,21],['20240930b',-82.8751,27.6874,-82.6874,28.2376,21],['20240930c',-82.6001,26.8999,-82.3124,27.3251,20],
  ['20241001a',-82.8501,27.8249,-82.3374,28.1501,21],['20241001b',-82.8626,27.8499,-82.8124,27.9376,21],['20241002a',-82.7626,27.6874,-82.4624,28.0876,19],
  ['20241002b',-82.7876,28.1999,-82.5874,28.5501,21],['20241002c',-83.4626,28.4999,-82.5124,29.7126,20],
  ['20241011a',-82.8126,27.1499,-82.4124,27.6626,20],['20241011b',-82.5126,26.6499,-82.1499,27.2001,20],['20241011c',-82.7251,27.1499,-82.4499,27.4876,20],
  ['20241011d',-82.8876,27.6249,-82.6124,28.2626,20],['20241012a',-82.3001,26.0624,-81.7124,26.7876,19],['20241012b',-82.1001,26.3374,-81.8124,26.9251,21],
  ['20241012c',-82.8001,27.6749,-82.5499,28.0876,20],['20241013a',-82.2876,26.4624,-81.7874,27.0501,20],['20241013b',-82.3501,26.8499,-82.1249,27.1126,20],
  ['20241013c',-81.3001,29.2249,-81.0124,29.6876,20],['20241013d',-81.1251,28.5249,-80.5374,29.3001,20],['20241014a',-82.9126,27.4874,-82.3499,28.1126,19],
  ['20241014b',-82.4001,27.8374,-80.4999,28.6126,19],
  ['20261010a',-85.3626,29.6374,-85.2624,29.8501,20],['20261011a',-88.0626,29.9749,-85.4749,30.4876,19],['20261011b',-87.3876,30.3249,-86.7999,30.6001,19],
  ['20261012a',-89.2001,30.1124,-86.8624,30.8126,19],['20261013a',-85.5751,29.6249,-85.2249,30.0501,19]];
const ArcExport = L.TileLayer.extend({ getTileUrl(c){ const sz = 2*MERC/2**c.z, x0 = -MERC + c.x*sz, y1 = MERC - c.y*sz;
  return `${this._url}?bbox=${x0},${y1-sz},${x0+sz},${y1}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`; } });
// Esri leaves some water areas solid black at close zooms (e.g. parts of Charlotte Harbor). Those pure-black pixels are made
// see-through, and a lower-detail copy of the same imagery underneath fills them in.
const CleanTiles = L.TileLayer.extend({
  createTile(coords, done){
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const g = c.getContext('2d', {willReadFrequently:true}); g.drawImage(img, 0, 0, 256, 256);
      try { const d = g.getImageData(0, 0, 256, 256), p = d.data; let n = 0;
        for (let i=0; i<p.length; i+=4) if (p[i] < 7 && p[i+1] < 7 && p[i+2] < 7){ p[i+3] = 0; n++; }
        if (n) g.putImageData(d, 0, 0); } catch(e){}
      done(null, c); };
    img.onerror = e => done(e, c);
    img.src = this.getTileUrl(coords);
    return c;
  }
});
const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const sat = L.layerGroup([
  // the low-detail fill is stepped so no tile is ever blown up more than 8x: one z10 tile stretched to z18-19 is a
  // 65,000-pixel-wide image, which makes iPhone Safari run out of memory and reload the page while zooming
  L.tileLayer(ESRI_IMG, {maxNativeZoom:10, maxZoom:13, zIndex:0, crossOrigin:'anonymous'}),
  new CleanTiles(ESRI_IMG, {minZoom:14, maxNativeZoom:13, maxZoom:16, zIndex:0}),
  new CleanTiles(ESRI_IMG, {minZoom:17, maxNativeZoom:16, maxZoom:19, zIndex:0}),
  new CleanTiles(ESRI_IMG, {maxNativeZoom:18, maxZoom:19, zIndex:1, attribution:'Imagery © Esri, Maxar'}),
  ...NEWER.map(([id,w,s,e,n,mz], i) => L.tileLayer(`https://stormscdn.ngs.noaa.gov/${id}-rgb/{z}/{x}/{y}`, {bounds:[[s,w],[n,e]], minZoom:11, maxNativeZoom:mz, maxZoom:19, zIndex:2+i, attribution: i===0 ? 'NOAA NGS, City of Sarasota' : ''})),
  new ArcExport('https://srqgis.sarasotafl.gov/server/rest/services/City_Aerials_2026/MapServer/export', {bounds:[[27.27,-82.60],[27.40,-82.46]], minZoom:12, maxZoom:19, zIndex:2+NEWER.length})
]);
const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {pane:'labels', maxNativeZoom:18, maxZoom:19});
const zoneRenderer = L.canvas({pane:'zones', padding:.15, tolerance:6});
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
const TYPE_CHIPS = [['pass','Passes'],['bridge','Bridges'],['flat','Flats'],['mangrove','Mangroves'],['oyster','Oyster bars'],['dock','Docks'],['reef','Reefs'],['dropoff','Drop-offs'],['point','Lake points'],['cove','Lake coves']];
const SHOW = new Set(store.get('sz3-types', TYPE_CHIPS.map(t => t[0]).filter(k => k !== 'dropoff')));
['point','cove'].forEach(k => { if (!store.get('sc-lake-types', false)) SHOW.add(k); }); store.set('sc-lake-types', true); // new lake types start on
function paintTypeChips(){
  $('typeChips').innerHTML = TYPE_CHIPS.map(([k,l]) => `<button type="button" data-k="${k}" aria-pressed="${SHOW.has(k)}">${l}</button>`).join('');
  $('typeChips').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; SHOW.has(k) ? SHOW.delete(k) : SHOW.add(k); store.set('sz3-types', [...SHOW]);
    ZONES.forEach(z => { if (z.type !== k) return; SHOW.has(k) ? zoneLayer.addLayer(z.layer) : zoneLayer.removeLayer(z.layer); });
    if (sel != null && !SHOW.has(ZONES[sel].type)) selectZone(null); paintTypeChips(); refresh(); });
}
const OVS = ['labels','contours','fuel','ramps','oyster','reefs','hardbottom','bait','radar','winds','currents','wtemp'];
const LS = Object.assign({base:'sat', labels:true, contours:false, fuel:true, ramps:true, oyster:false, reefs:true, hardbottom:false, bait:true, radar:false, winds:false, currents:false, wtemp:false}, store.get('sz2-layers', {}));
const OV = {oyster:L.layerGroup(), reefs:L.layerGroup(), hardbottom:L.layerGroup()};
// ---- places: public fuel docks (FWC marina inventory) and public boat ramps (FWC Boat Ramp Finder, via UF GeoPlan)
map.createPane('places').style.zIndex = 460;
const tc = t => String(t||'').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Sr|Us|Cr|Fwc|Ne|Nw|Se|Sw)\b/g, m => m.toUpperCase());
const blank = v => v == null || !String(v).trim() || /^(unknown|n\/?a|none|0)$/i.test(String(v).trim());
const telLink = p => { const d = String(p||'').replace(/[^\d]/g,''); return d.length >= 10 ? `<a href="tel:${d.slice(-10)}">${esc(String(p).trim())}</a>` : ''; };
const ICONS = {
  fuel:'<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M4 10h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  ramp:'<path d="M3 17l18-7"/><path d="M7 13.5l2.2-4.3h6.5l1.6 2"/><circle cx="7" cy="19" r="1.6"/><path d="M2 21h20"/>',
  bait:'<path d="M2 12c3-5 9-6 14-3l4-3v12l-4-3c-5 3-11 2-14-3z"/><circle cx="7.5" cy="11" r=".6"/>'
};
const placeIcon = k => L.divIcon({className:'pl-ic pl-'+k, iconSize:[30,30], iconAnchor:[15,15], popupAnchor:[0,-14],
  html:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`});
const prow = (label, val) => val ? `<div class="pc-row"><span>${label}</span><b>${val}</b></div>` : '';
const pcard = (title, sub, rows, foot) => `<div class="pc"><div class="pc-t">${esc(title)}</div>${sub?`<div class="pc-s">${sub}</div>`:''}<div class="pc-rows">${rows}</div>${foot||''}</div>`;
const dirLink = (la,ln) => `<a class="pc-btn" href="https://maps.apple.com/?daddr=${la},${ln}" target="_blank" rel="noopener">Directions</a>`;
// only the markers near the view are put on the map, so ~1,900 points stay light on a phone
function PlaceSet(kind, minZoom){ const all = [], layer = L.layerGroup(); let loaded = false, loading = null;
  const sync = () => { if (!map.hasLayer(layer)) return; const b = map.getBounds().pad(0.3), on = map.getZoom() >= minZoom;
    all.forEach(m => { const want = on && b.contains(m.getLatLng()); if (want && !layer.hasLayer(m)) layer.addLayer(m); else if (!want && layer.hasLayer(m)) layer.removeLayer(m); }); };
  map.on('moveend', sync);
  return {layer, all, sync, kind, load(fn){ if (loaded) { sync(); return; } if (loading) return; loading = fn().then(ms => { ms.forEach(m => all.push(m)); loaded = true; sync(); }).catch(() => toast('Could not load '+({fuel:'fuel docks',ramp:'boat ramps',bait:'bait shops'}[kind]||kind)+' right now.')).finally(() => loading = null); }};
}
const FUEL = PlaceSet('fuel', 9), RAMPS = PlaceSet('ramp', 10);
// hours and VHF are not in the state data; look them up in OpenStreetMap when a fuel dock is opened (best effort)
const OSM_CACHE = new Map();
async function osmExtras(la, ln){
  const key = la.toFixed(4)+','+ln.toFixed(4); if (OSM_CACHE.has(key)) return OSM_CACHE.get(key);
  const q = `[out:json][timeout:12];(nwr(around:220,${la},${ln})["leisure"="marina"];nwr(around:220,${la},${ln})["amenity"="fuel"];nwr(around:220,${la},${ln})["waterway"="fuel"];nwr(around:220,${la},${ln})["seamark:type"~"harbour|small_craft_facility"];);out tags center;`;
  let out = {};
  for (const host of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
    try { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(host, {method:'POST', body:'data='+encodeURIComponent(q), headers:{'Content-Type':'application/x-www-form-urlencoded'}, signal:ctl.signal}); clearTimeout(t);
      if (!r.ok) continue; const j = await r.json();
      for (const e of (j.elements||[])){ const g = e.tags||{};
        out.hours = out.hours || g.opening_hours || g['seamark:small_craft_facility:opening_hours'];
        out.vhf = out.vhf || g.vhf || g['vhf_channel'] || g['contact:vhf'] || g['communication:vhf'] || g['seamark:communication:channel'] || g['seamark:radio_station:channel'];
        out.phone = out.phone || g.phone || g['contact:phone'];
        out.web = out.web || g.website || g['contact:website']; }
      break;
    } catch(e){}
  }
  OSM_CACHE.set(key, out); return out;
}
const prettyHours = h => esc(h).replace(/\bMo\b/g,'Mon').replace(/\bTu\b/g,'Tue').replace(/\bWe\b/g,'Wed').replace(/\bTh\b/g,'Thu').replace(/\bFr\b/g,'Fri').replace(/\bSa\b/g,'Sat').replace(/\bSu\b/g,'Sun').replace(/\bPH\b/g,'holidays').replace(/;\s*/g,'<br>').replace(/^24\/7$/,'Open 24 hours');
const prettyVhf = v => 'Ch '+esc(String(v).replace(/^\s*(ch(annel)?\.?\s*)/i,'').replace(/;\s*/g,', '));
function fuelCard(p, la, ln, x){
  const fuels = [p.Gas==='G'?'Gas':'', /^[DY]$/.test(p.Diesel||'')?'Diesel':''].filter(Boolean).join(' + ') || 'Fuel';
  const phone = telLink(p.Phone) || (x && x.phone ? telLink(x.phone) : '');
  const hours = x === null ? '<i>Checking…</i>' : (x && x.hours ? prettyHours(x.hours) : '<i>Not listed</i>');
  const vhf = x === null ? '<i>Checking…</i>' : (x && x.vhf ? prettyVhf(x.vhf) : '<i>Not listed</i>');
  const web = x && x.web ? ` <a class="pc-btn ghost" href="${esc(/^https?:/.test(x.web)?x.web:'https://'+x.web)}" target="_blank" rel="noopener">Website</a>` : '';
  return pcard(p.Name || 'Public fuel dock', `<span class="pc-tag">${fuels}</span> Public fuel dock`,
    prow('Phone', phone) + prow('Hours', hours) + prow('VHF', vhf) + prow('Water', p.Wat_Name ? esc(tc(p.Wat_Name)) : '') + prow('Address', p.Street ? esc(p.Street)+(p.City?', '+esc(p.City):'') : ''),
    `<div class="pc-foot">${dirLink(la,ln)}${web}</div><div class="pc-note">Hours and VHF from OpenStreetMap when available. Call ahead.</div>`);
}
function loadFuel(){ FUEL.load(async () => {
  const where = "(Gas='G' OR Diesel IN ('D','Y')) AND Fuel_Access='Public Fuel Dock' AND Status LIKE 'Op%'";
  const j = await getJSON('https://gis.myfwc.com/hosting/rest/services/Open_Data/Marinas_Florida/MapServer/6/query?where='+encodeURIComponent(where)+'&outFields=Name,Street,City,Phone,Gas,Diesel,Wat_Name&outSR=4326&f=geojson');
  const icon = placeIcon('fuel');
  return (j.features||[]).map(f => { const p = f.properties||{}, [ln,la] = f.geometry.coordinates;
    const m = L.marker([la,ln], {pane:'places', icon, title:p.Name||'Public fuel dock', keyboard:false});
    placeTap(m, async tok => { showPlace(fuelCard(p, la, ln, null), m, tok); const x = await osmExtras(la, ln); showPlace(fuelCard(p, la, ln, x), m, tok, true); });
    return m; });
}); }
function rampCard(p, la, ln){
  const fee = p.ISFEEREQUI === 'YES' ? (p.FEEAMOUNT > 0 ? '$'+(+p.FEEAMOUNT).toFixed(p.FEEAMOUNT % 1 ? 2 : 0) : 'Yes') : (p.ISFEEREQUI === 'NO' ? 'Free' : '');
  const lanes = p.TOTALLANES > 0 ? p.TOTALLANES + (p.TOTALLANES > 1 ? ' lanes' : ' lane') : '';
  const notes = !blank(p.OPERATIONA) ? p.OPERATIONA : (!blank(p.RAMPSTATUS) ? p.RAMPSTATUS : '');
  const note = notes ? `<div class="pc-desc">${esc(notes.charAt(0) + notes.slice(1).toLowerCase())}</div>` : '';
  const web = !blank(p.URL) ? ` <a class="pc-btn ghost" href="${esc(p.URL.trim())}" target="_blank" rel="noopener">Website</a>` : '';
  return pcard(tc(p.RAMPNAME) || 'Public boat ramp', `Public boat ramp${p.ACCESSTYPE && /COMMERCIAL/.test(p.ACCESSTYPE) ? ' · privately run' : ''}`,
    prow('Hours', !blank(p.HOURS) ? esc(tc(p.HOURS)).replace(/\b(Am|Pm)\b/g, m => m.toUpperCase()) : '<i>Not listed</i>') + prow('Fee', fee) + prow('Ramp', [lanes, p.TRAILER > 0 ? p.TRAILER+' trailer spots' : ''].filter(Boolean).join(' · '))
    + prow('Restroom', p.ISRESTROOM === 'YES' ? 'Yes' : p.ISRESTROOM === 'NO' ? 'No' : '') + prow('Phone', telLink(p.CONTACTPHO))
    + prow('Water', !blank(p.WATERBODYN) ? esc(tc(p.WATERBODYN)) : '') + prow('Address', !blank(p.STREET1) ? esc(tc(p.STREET1))+(p.CITY?', '+esc(tc(p.CITY)):'') : ''),
    note + `<div class="pc-foot">${dirLink(la,ln)}${web}</div>`);
}
function loadRamps(){ RAMPS.load(async () => {
  await GA_READY;
  const where = "ACCESSTYPE LIKE '%GENERAL PUBLIC%' AND STATUS='OPEN FOR BUSINESS' AND RAMPTYPE IN ('STAND ALONE RAMP','BOAT RAMP WITHIN MARINA')";
  const fields = 'RAMPNAME,STREET1,CITY,HOURS,CONTACTPHO,ISFEEREQUI,FEEAMOUNT,TOTALLANES,TRAILER,ISRESTROOM,WATERBODYN,ACCESSTYPE,OPERATIONA,RAMPSTATUS,URL';
  const base = 'https://callisto.at.geoplan.ufl.edu/arcgis/rest/services/est/Coastal/MapServer/1/query?where='+encodeURIComponent(where)+'&outFields='+fields+'&outSR=4326&f=geojson';
  const pages = await Promise.all([0,1000].map(off => getJSON(base+'&resultOffset='+off+'&resultRecordCount=1000')));
  const icon = placeIcon('ramp');
  const ga = (GA.ramps||[]).map(([nm, la, ln, fee, hrs, op]) => { const m = L.marker([la,ln], {pane:'places', icon, title:nm||'Boat ramp', keyboard:false});
    placeTap(m, tok => showPlace(pcard(nm || 'Boat ramp', 'Boat ramp'+(op ? ' · '+esc(op) : ''), prow('Hours', hrs ? prettyHours(hrs) : '<i>Not listed</i>') + prow('Fee', fee === 'no' ? 'Free' : fee === 'yes' ? 'Yes' : ''),
      `<div class="pc-foot">${dirLink(la,ln)}</div><div class="pc-note">From OpenStreetMap. Check with the operator for hours and fees.</div>`), m, tok)); return m; });
  return ga.concat(pages.flatMap(j => j.features||[]).map(f => { const p = f.properties||{}, [ln,la] = f.geometry.coordinates;
    const m = L.marker([la,ln], {pane:'places', icon, title:tc(p.RAMPNAME)||'Boat ramp', keyboard:false});
    placeTap(m, tok => showPlace(rampCard(p, la, ln), m, tok)); return m; }));
}); }
OV.fuel = FUEL.layer; OV.ramps = RAMPS.layer;
// tapping a fuel dock or ramp opens a card above the dock (more reliable on iPhone than map popups)
let placeTok = 0, placeOn = null;
function placeTap(m, open){ let last = 0;
  const go = e => { const now = Date.now(); if (now - last < 450) return; last = now; if (e && e.originalEvent) L.DomEvent.stop(e.originalEvent); open(++placeTok); };
  m.on('click', go);
  m.on('add', () => { const el = m.getElement(); if (el && !el.__tap){ el.__tap = 1; let sx = 0, sy = 0, moved = false;
      el.addEventListener('touchstart', ev => { const t = ev.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; }, {passive:true});
      el.addEventListener('touchmove', ev => { const t = ev.touches[0]; if (Math.hypot(t.clientX-sx, t.clientY-sy) > 10) moved = true; }, {passive:true});
      el.addEventListener('touchend', ev => { if (moved) return; ev.preventDefault(); go(); lastPinAt = Date.now(); }, {passive:false}); } });
}
function showPlace(html, m, tok, update){
  if (update && tok !== placeTok) return; // a newer card was opened meanwhile
  const el = $('placeCard'); $('placeBody').innerHTML = html; el.hidden = false; $('app').classList.add('pop-open');
  if (placeOn && placeOn !== m && placeOn.getElement()) placeOn.getElement().classList.remove('pl-on');
  placeOn = m; if (m.getElement()) m.getElement().classList.add('pl-on');
  if (!update){ const pt = map.latLngToContainerPoint(m.getLatLng()), top = (document.querySelector('.top')?.offsetHeight||140)+30, bottom = map.getSize().y - (document.querySelector('.dock')?.offsetHeight||160) - el.offsetHeight - 24;
    if (pt.y < top || pt.y > bottom) map.panBy([0, pt.y - (top + Math.max(0,bottom-top)/2)], {animate:true}); }
}
// ---- coordinates: decimal (phones, Google/Apple Maps) and degrees + decimal minutes (most chartplotters)
const fmtDec = (la, ln) => la.toFixed(5) + ', ' + ln.toFixed(5);
const fmtDDM = (la, ln) => { const f = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a); return `${d}° ${((a-d)*60).toFixed(3)}' ${v >= 0 ? p : n}`; }; return f(la,'N','S') + '  ' + f(ln,'E','W'); };
function copyText(txt, btn){
  const done = () => { if (btn){ const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = t, 1400); } else toast('Copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => fallback());
  else fallback();
  function fallback(){ const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly',''); ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch(e){ toast(txt); } ta.remove(); }
}
function coordBlock(la, ln){
  return `<div class="coords"><button type="button" class="coord" data-copy="${fmtDec(la,ln)}"><span>Decimal</span><b>${fmtDec(la,ln)}</b><i>Copy</i></button>
    <button type="button" class="coord" data-copy="${fmtDDM(la,ln)}"><span>Chartplotter</span><b>${fmtDDM(la,ln)}</b><i>Copy</i></button></div>`;
}
const wireCoords = root => root.querySelectorAll('.coord').forEach(b => b.onclick = e => { e.stopPropagation(); copyText(b.dataset.copy, b.querySelector('i')); });
// press and hold anywhere on the map to drop a pin and get its coordinates
const PIN_ICON = L.divIcon({className:'drop-pin', iconSize:[28,40], iconAnchor:[14,38],
  html:'<svg width="28" height="40" viewBox="0 0 28 40" aria-hidden="true"><path d="M14 1C6.8 1 1 6.7 1 13.8 1 23.5 14 39 14 39s13-15.5 13-25.2C27 6.7 21.2 1 14 1z" fill="#62d8c7" stroke="#06211d" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="#06211d"/></svg>'});
let pin = null, lastPinAt = 0;
function dropPin(ll){
  const now = Date.now(); if (now - lastPinAt < 800) return; lastPinAt = now;
  if (navigator.vibrate) try { navigator.vibrate(15); } catch(e){}
  const la = ll.lat, ln = ll.lng;
  if (pin) map.removeLayer(pin);
  pin = L.marker(ll, {icon:PIN_ICON, pane:'places', keyboard:false, interactive:false}).addTo(map);
  const v = demAt(la, ln), ft = v === null ? null : -(v+0.2)*3.28084;
  const depth = ft === null ? '' : ft >= 0.5 ? `About ${Math.round(ft)} ft deep at low tide` : 'On land or exposed at low tide';
  const near = nearName([la, ln]);
  const html = pcard('Dropped pin', `Near ${esc(near)}${depth ? ' · ' + depth : ''}`, coordBlock(la, ln),
    `<div class="pc-foot"><button type="button" class="pc-btn" id="pinShare">Share</button><a class="pc-btn ghost" href="https://maps.apple.com/?ll=${la.toFixed(6)},${ln.toFixed(6)}&q=Spotcast%20pin" target="_blank" rel="noopener">Open in Maps</a></div><div class="pc-note">Depth is from NOAA's elevation model and is approximate. Not for navigation.</div>`);
  showPlace(html, pin, ++placeTok);
  wireCoords($('placeBody'));
  $('pinShare').onclick = () => { const txt = `Spotcast pin near ${near}\n${fmtDec(la,ln)}\n${fmtDDM(la,ln)}\nhttps://maps.apple.com/?ll=${la.toFixed(6)},${ln.toFixed(6)}`;
    if (navigator.share) navigator.share({title:'Spotcast pin', text:txt}).catch(()=>{}); else copyText(txt, $('pinShare')); };
}
map.on('contextmenu', e => dropPin(e.latlng));
(function(){ // long-press fallback for touch screens that don't send a context menu event
  const el = map.getContainer(); let t = null, sx = 0, sy = 0;
  const cancel = () => { if (t){ clearTimeout(t); t = null; } };
  el.addEventListener('touchstart', e => { cancel(); if (e.touches.length !== 1 || e.target.closest('.leaflet-marker-icon')) return; const p = e.touches[0]; sx = p.clientX; sy = p.clientY;
    t = setTimeout(() => { t = null; const r = el.getBoundingClientRect(); dropPin(map.containerPointToLatLng([sx - r.left, sy - r.top])); }, 550); }, {passive:true});
  el.addEventListener('touchmove', e => { const p = e.touches[0]; if (e.touches.length !== 1 || Math.hypot(p.clientX-sx, p.clientY-sy) > 10) cancel(); }, {passive:true});
  el.addEventListener('touchend', cancel, {passive:true}); el.addEventListener('touchcancel', cancel, {passive:true});
})();
function closePlace(){ if (pin){ map.removeLayer(pin); pin = null; } $('placeCard').hidden = true; $('app').classList.remove('pop-open'); if (placeOn && placeOn.getElement()) placeOn.getElement().classList.remove('pl-on'); placeOn = null; placeTok++; }
$('placeClose').onclick = closePlace;
// ---------------- weather and water layers
// NOAA nautical chart (ENC chart display service) as a third base map
const chart = L.tileLayer.wms('https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer',
  {layers:'0,1,2,3,4,5,6,7', format:'image/png', transparent:false, version:'1.3.0', maxZoom:19, tileSize:512, zoomOffset:-1, attribution:'Chart: NOAA ENC'});
// radar: NEXRAD base reflectivity from Iowa State Mesonet, the last 50 minutes in 5-minute frames, looped
map.createPane('radar').style.zIndex = 420; map.getPane('radar').style.pointerEvents = 'none';
const RADAR_STEPS = [50,45,40,35,30,25,20,15,10,5,0];
const radar = {frames:[], group:L.layerGroup(), idx:RADAR_STEPS.length-1, timer:null, playing:true, built:0, refresh:null};
function buildRadar(){
  radar.group.clearLayers(); const bust = Math.floor(Date.now()/300e3);
  radar.frames = RADAR_STEPS.map(m => L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${m?'-m'+String(m).padStart(2,'0')+'m':''}/{z}/{x}/{y}.png?_=${bust}`,
    {pane:'radar', opacity:0, maxNativeZoom:15, maxZoom:19, keepBuffer:1, updateWhenZooming:false, attribution: m===0 ? 'Radar: NEXRAD via Iowa State Mesonet' : ''}));
  radar.built = Date.now(); showRadarFrame(radar.idx);
}
function showRadarFrame(k){
  // only the frame on screen and the next one are on the map; eleven full tile sets at once is too much for a phone
  radar.idx = k; const nx = (k+1) % radar.frames.length;
  radar.frames.forEach((f,j) => { const want = j===k || j===nx; if (want && !radar.group.hasLayer(f)) radar.group.addLayer(f); else if (!want && radar.group.hasLayer(f)) radar.group.removeLayer(f); f.setOpacity(j===k ? .6 : 0); });
  const base = Math.floor(Date.now()/300e3)*300e3, t = base - RADAR_STEPS[k]*60e3;
  $('radarTime').textContent = `Radar · ${fmtTime(t)}${k===RADAR_STEPS.length-1?' · now':''}`;
  $('radarTrack').innerHTML = RADAR_STEPS.map((_,j) => `<i class="${j===k?'on':''}"></i>`).join('');
}
function radarTick(){ if (!radar.playing) return; const last = RADAR_STEPS.length-1; const n = radar.idx >= last ? 0 : radar.idx+1;
  showRadarFrame(n); clearTimeout(radar.timer); radar.timer = setTimeout(radarTick, n === last ? 1800 : 550); }
map.on('movestart zoomstart', () => { if (radar.timer) { clearTimeout(radar.timer); radar.timer = null; radar.held = true; } });
map.on('moveend', () => { if (radar.held && LS.radar){ radar.held = false; radar.timer = setTimeout(radarTick, 900); } });
function radarOn(on){
  $('radarBar').hidden = !on; clearTimeout(radar.timer); clearInterval(radar.refresh);
  if (!on){ map.removeLayer(radar.group); return; }
  if (!radar.frames.length || Date.now() - radar.built > 5*60e3) buildRadar();
  radar.group.addTo(map); radar.timer = setTimeout(radarTick, 900);
  radar.refresh = setInterval(() => { buildRadar(); }, 5*60e3);
}
$('radarPlay').onclick = () => { radar.playing = !radar.playing; $('radarPlay').textContent = radar.playing ? '❚❚' : '▶'; $('radarPlay').setAttribute('aria-label', radar.playing ? 'Pause radar' : 'Play radar');
  if (radar.playing) radarTick(); else clearTimeout(radar.timer); };
$('radarTrack').onclick = e => { const r = $('radarTrack').getBoundingClientRect(), k = clamp(Math.floor((e.clientX-r.left)/r.width*RADAR_STEPS.length),0,RADAR_STEPS.length-1);
  radar.playing = false; $('radarPlay').textContent = '▶'; clearTimeout(radar.timer); showRadarFrame(k); };

// arrows for wind and tidal currents follow the hour on the timeline
map.createPane('arrows').style.zIndex = 455; map.getPane('arrows').style.pointerEvents = 'none';
const arrowIcon = (toDeg, len, color, text) => L.divIcon({className:'arrow-ic', iconSize:[0,0], iconAnchor:[0,0],
  html:`<div style="transform:translate(-50%,-50%)"><svg width="${len+8}" height="${len+8}" viewBox="-${(len+8)/2} -${(len+8)/2} ${len+8} ${len+8}" style="transform:rotate(${toDeg}deg)"><path d="M0 ${len/2} L0 -${len/2-5}" stroke="#000" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/><path d="M0 ${len/2} L0 -${len/2-5}" stroke="${color}" stroke-width="3" stroke-linecap="round"/><path d="M-5 -${len/2-6} L0 -${len/2} L5 -${len/2-6}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${text}</span></div>`});
// wind: a small grid of Open-Meteo points over the view, every hour for the week
const winds = {layer:L.layerGroup([], {pane:'arrows'}), pts:[], area:null, busy:false};
async function loadWinds(){
  if (!map._loaded) return;
  const b = map.getBounds(), key = [b.getSouth(),b.getWest(),b.getNorth(),b.getEast()].map(v=>v.toFixed(2)).join(',');
  if (winds.busy || (winds.area && winds.area.contains(b) && winds.z >= map.getZoom()-1.5)) { paintWinds(); return; }
  winds.busy = true; const pb = b.pad(.15), N = 4, M = 5, la = [], ln = [];
  for (let r=0;r<N;r++) for (let c=0;c<M;c++){ la.push((pb.getSouth()+(r+.5)*(pb.getNorth()-pb.getSouth())/N).toFixed(3)); ln.push((pb.getWest()+(c+.5)*(pb.getEast()-pb.getWest())/M).toFixed(3)); }
  try { let j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${ln.join(',')}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph&timezone=GMT&forecast_days=8`);
    if (!Array.isArray(j)) j = [j];
    winds.pts = j.map((p,k) => { const m = new Map(); p.hourly.time.forEach((t,q) => m.set(Date.parse(t+':00Z'), q)); return {ll:[+la[k], +ln[k]], m, ws:p.hourly.wind_speed_10m, wd:p.hourly.wind_direction_10m}; });
    winds.area = pb; winds.z = map.getZoom(); void key;
  } catch(e){ toast('Wind arrows are not available right now.'); }
  winds.busy = false; paintWinds();
}
function paintWinds(){
  winds.layer.clearLayers(); if (!LS.winds || !HRS.length) return; const t = Math.round(HRS[cur].t/3600e3)*3600e3;
  winds.pts.forEach(p => { const q = p.m.get(t); if (q == null) return; const sp = Math.round(p.ws[q]), from = p.wd[q];
    const col = sp >= 18 ? '#ff5466' : sp >= 12 ? '#ffb547' : '#e9f3f1';
    winds.layer.addLayer(L.marker(p.ll, {pane:'arrows', interactive:false, keyboard:false, icon:arrowIcon(from+180, 20+Math.min(sp,25), col, `${sp} mph`)})); });
}
// tidal currents: NOAA current stations in view, using the same predictions the spot scores use
const currents = {layer:L.layerGroup([], {pane:'arrows'})};
function paintCurrents(){
  currents.layer.clearLayers(); if (!LS.currents || !map._loaded || map.getZoom() < 10 || !HRS.length) return;
  const b = map.getBounds(), c = map.getCenter(), inView = (STATIONS.cur||[]).filter(s => b.contains([s[1],s[2]]))
    .sort((a,d) => distKm([c.lat,c.lng],[a[1],a[2]]) - distKm([c.lat,c.lng],[d[1],d[2]])).slice(0, 30);
  inView.forEach(s => { ensureCur(s); const C = CURS.get(s[0]), v = curV(s[0]); if (!C || !v || v[cur] == null) return; const kt = v[cur], a = Math.abs(kt);
    const icon = a < .2 ? L.divIcon({className:'wt-ic', iconSize:[0,0], html:`<div>Slack</div>`}) : arrowIcon(kt >= 0 ? C.flood : C.ebb, 16 + Math.min(a,3)*10, a >= 1.5 ? '#ff8a3d' : '#62d8c7', `${a.toFixed(1)} kt`);
    currents.layer.addLayer(L.marker([s[1],s[2]], {pane:'arrows', interactive:false, keyboard:false, icon})); });
}
// water temperature at NOAA stations in view (latest reading)
const wtemps = {layer:L.layerGroup([], {pane:'arrows'}), got:new Map()};
function paintWtemp(){
  wtemps.layer.clearLayers(); if (!LS.wtemp || !map._loaded) return; const b = map.getBounds().pad(.2);
  (STATIONS.wt||[]).filter(s => b.contains([s[1],s[2]])).forEach(s => {
    const g = wtemps.got.get(s[0]);
    if (!g || (g.t && Date.now()-g.t > 30*60e3)){ if (!g || !g.busy){ wtemps.got.set(s[0], {busy:true});
      getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature&station=${s[0]}&date=latest&units=english&time_zone=gmt&format=json&application=spotcast`)
        .then(j => { wtemps.got.set(s[0], {t:Date.now(), v: j.data ? +j.data[0].v : null}); paintWtemp(); }).catch(() => wtemps.got.set(s[0], {t:Date.now(), v:null})); } return; }
    if (g.v == null) return;
    wtemps.layer.addLayer(L.marker([s[1],s[2]], {pane:'arrows', interactive:false, keyboard:false, icon:L.divIcon({className:'wt-ic', iconSize:[0,0], html:`<div>${Math.round(g.v)}°F</div>`})})); });
}
// bait and tackle shops: a statewide list built from OpenStreetMap plus hand-checked local shops (baits.json),
// so it loads instantly and doesn't depend on a busy public server; only markers near the view are on the map
const BAIT = PlaceSet('bait', 10);
function loadBait(){ BAIT.load(async () => {
  const rows = await getJSON('baits.json'), icon = placeIcon('bait');
  return rows.map(([name, la, ln, hours, phone, web, addr, live, note]) => {
    const g = {name, opening_hours:hours, phone, website:web, addr, live, note};
    const m = L.marker([la,ln], {pane:'places', icon, title:name||'Bait and tackle', keyboard:false});
    placeTap(m, tok => showPlace(baitCard(g, la, ln), m, tok)); return m; });
}); }
function baitCard(g, la, ln){
  const ref = sel != null ? ZONES[sel] : null, from = ref ? ref.c : (() => { const c = map.getCenter(); return [c.lat, c.lng]; })();
  const mi = distKm(from, [la, ln]) * 0.621371, web = g.website;
  return pcard(g.name || 'Bait and tackle', `Bait and tackle${g.live ? ' · <span class="pc-tag">Live bait</span>' : ''}`,
    prow('Distance', `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi ${ref ? 'from '+esc(ref.name) : 'from map center'}`) + prow('Hours', g.opening_hours ? prettyHours(g.opening_hours) : '<i>Not listed</i>') + prow('Phone', telLink(g.phone)) + prow('Address', g.addr ? esc(g.addr) : ''),
    `${g.note ? `<div class="pc-desc">${esc(g.note)}</div>` : ''}<div class="pc-foot">${dirLink(la,ln)}${web ? ` <a class="pc-btn ghost" href="${esc(/^https?:/.test(web)?web:'https://'+web)}" target="_blank" rel="noopener">Website</a>` : ''}</div><div class="pc-note">Call ahead to check what live bait they have.</div>`);
}
OV.bait = BAIT.layer; OV.winds = winds.layer; OV.currents = currents.layer; OV.wtemp = wtemps.layer;
function paintTimeLayers(){ paintWinds(); paintCurrents(); }
map.on('moveend', () => { if (LS.winds) loadWinds(); if (LS.currents) paintCurrents(); if (LS.wtemp) paintWtemp(); });
function applyLayers(){
  [sat, relief, chart].forEach(b => map.hasLayer(b) && map.removeLayer(b));
  (LS.base==='relief' ? relief : LS.base==='chart' ? chart : sat).addTo(map);
  document.querySelectorAll('[data-base]').forEach(b => b.setAttribute('aria-pressed', b.dataset.base===LS.base));
  $('depthKey').hidden = !(LS.base==='relief' || LS.contours);
  OVS.forEach(k => $('ov-'+k).checked = !!LS[k]);
  LS.labels && LS.base !== 'chart' ? labels.addTo(map) : map.removeLayer(labels);
  if (LS.contours){ if (map.hasLayer(contours)) contours.redraw(); else contours.addTo(map); } else map.removeLayer(contours);
  ['oyster','reefs','hardbottom','fuel','ramps','bait','winds','currents','wtemp'].forEach(k => LS[k] ? OV[k].addTo(map) : map.removeLayer(OV[k]));
  if (LS.fuel) setTimeout(loadFuel); if (LS.ramps) setTimeout(loadRamps); if (LS.bait) setTimeout(loadBait);
  if (LS.winds) setTimeout(loadWinds); else winds.layer.clearLayers();
  paintCurrents(); paintWtemp(); radarOn(!!LS.radar);
  store.set('sz2-layers', LS);
}
document.querySelectorAll('[data-base]').forEach(b => b.onclick = () => { LS.base = b.dataset.base; applyLayers(); });
OVS.forEach(k => $('ov-'+k).onchange = e => { LS[k] = e.target.checked;
  if (e.target.checked && k === 'winds') LS.currents = false; if (e.target.checked && k === 'currents') LS.winds = false; // one set of arrows at a time
  applyLayers(); });
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
  br2: 'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Non_FDOT_Bridges_20240418/FeatureServer/21',
  nbi: 'https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0' // national bridge inventory (Georgia)
};
function query(url, bb, extra={}){
  const p = new URLSearchParams(Object.assign({where:'1=1', geometry:bb.join(','), geometryType:'esriGeometryEnvelope', inSR:'4326', spatialRel:'esriSpatialRelIntersects', outSR:'4326', outFields:'*', f:'geojson', resultRecordCount:'1500'}, extra));
  return getJSON(url+'/query?'+p).then(j => j.features || []).catch(() => []);
}
const ringsOf = g => !g ? [] : (g.type==='Polygon' ? [g.coordinates] : g.type==='MultiPolygon' ? g.coordinates : []).map(p => p.map(r => r.map(([x,y]) => [y,x])));
const linesOf = g => !g ? [] : (g.type==='LineString' ? [g.coordinates] : g.type==='MultiLineString' ? g.coordinates : []).map(l => l.map(([x,y]) => [y,x]));
function nearName(c){ // "near Jupiter Inlet" from the closest tide station
  let best = null, bd = 1e9; for (const s of STATIONS.tide){ const d = (s[1]-c[0])**2 + ((s[2]-c[1])*0.9)**2; if (d < bd){ bd = d; best = s; } }
  if (bd > 0.16){ // inland: the nearest lake we know about, then the nearest named ramp
    let L = null, ld = 30; for (const x of LAKES.values()){ const d = distKm(c, x.c); if (d < ld){ ld = d; L = x; } } if (L) return shortLake(L.name);
    const r = nearRamp(c, 25); if (r) return r; return c[0] > 30.7 && c[1] > -85.6 ? 'Georgia' : 'Florida'; }
  return best ? best[3].split(',')[0].replace(/\s*\(.*?\)\s*/g,' ').trim() : 'Florida';
}

const CELL = 0.1, cellsDone = new Set(), cellsBusy = new Set();
const cellKey = (lat,lng) => Math.floor(lat/CELL)+':'+Math.floor(lng/CELL);
// ---------------- lakes (inland Georgia and Florida): spots from lake outlines (USGS National Hydrography Dataset),
// bridges from the National Bridge Inventory, marinas; rated on season, water temperature, lake level, wind, moon and light
const NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12';
const LAKES = new Map();   // NHD objectid -> {name, rings:[outer, ...holes], box, c, gauge}
const LAKE_GAUGES = [[/lanier/i,'02334400',1071],[/allatoona/i,'02393500',840],[/west point/i,'02339400',635],[/walter f\.? george|eufaula/i,'02343240',190],[/carters/i,'02381400',1074]];
const LEVELS = new Map();  // USGS site -> {now, d24, d72, full, t} | {loading} | {failed}
const isInland = c => !STATIONS.tide.some(st => Math.abs(st[1]-c[0]) < 0.5 && Math.abs(st[2]-c[1]) < 0.6 && distKm(c, [st[1], st[2]]) < 45);
function ensureLevel(g){
  if (!g || LEVELS.has(g[0])) return; LEVELS.set(g[0], {loading:true});
  getJSON(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${g[0]}&parameterCd=00062,62614,62615&period=P4D`).then(j => {
    const ts = (j.value && j.value.timeSeries || []).find(t => t.values[0].value.length); if (!ts) throw 0;
    const v = ts.values[0].value.map(x => ({t:Date.parse(x.dateTime), v:+x.value})).filter(x => !isNaN(x.v)), last = v[v.length-1];
    const ago = h => { const t = last.t - h*3600e3; let b = v[0]; for (const x of v) if (Math.abs(x.t-t) < Math.abs(b.t-t)) b = x; return last.v - b.v; };
    LEVELS.set(g[0], {now:last.v, d24:ago(24), d72:ago(72), full:g[2], t:last.t}); SCORE.clear(); refreshSoon();
  }).catch(() => LEVELS.set(g[0], {failed:true}));
}
const lakeLevel = z => z.lake && z.lake.gauge ? LEVELS.get(z.lake.gauge[0]) : null;
function inLake(L, p){ const pip = (p, ring) => { let ins = false; for (let i=0, j=ring.length-1; i<ring.length; j=i++){ const a=ring[i], b=ring[j]; if ((a[0]>p[0]) !== (b[0]>p[0]) && p[1] < (b[1]-a[1])*(p[0]-a[0])/(b[0]-a[0]) + a[1]) ins = !ins; } return ins; };
  if (p[0] < L.box[0] || p[0] > L.box[2] || p[1] < L.box[1] || p[1] > L.box[3]) return false;
  if (!pip(p, L.rings[0])) return false; for (let k=1;k<L.rings.length;k++) if (pip(p, L.rings[k])) return false; return true; }
const shortLake = n => String(n||'the lake').replace(/^Lake\s+Sidney\s+Lanier$/i,'Lake Lanier').replace(/^Walter F\.? George Lake$/i,'Lake Walter F. George');
function nearRamp(c, km=4){ let best = null, bd = km; for (const r of (GA.places||[]).concat(GA.ramps||[])){ if (!r[0]) continue; const d = distKm(c, [r[1], r[2]]); if (d < bd){ bd = d; best = r[0]; } } return best && best.replace(/\s*(boat\s*)?(ramp|launch|landing)\s*$/i,'').replace(/\s*-\s*Lake .*$/i,'').trim(); }
async function lakeSpots(s, w, bb, inBox){
  const feats = await query(NHD, [w-0.02, s-0.02, w+CELL+0.02, s+CELL+0.02], {where:'areasqkm >= 1.5 AND ftype IN (390,436)', outFields:'gnis_name,areasqkm,objectid', maxAllowableOffset:'0.0002', geometryPrecision:'5'});
  feats.forEach(f => { const p = f.properties||{}, id = p.OBJECTID ?? p.objectid; if (LAKES.has(id)) return;
    const polys = ringsOf(f.geometry); if (!polys.length) return; const poly = polys.sort((a,b) => b[0].length - a[0].length)[0];
    let a0=90,a1=-90,n0=180,n1=-180, sa=0, sn=0; for (const q of poly[0]){ a0=Math.min(a0,q[0]); a1=Math.max(a1,q[0]); n0=Math.min(n0,q[1]); n1=Math.max(n1,q[1]); sa+=q[0]; sn+=q[1]; }
    const name = p.GNIS_NAME || p.gnis_name || 'Lake', g = LAKE_GAUGES.find(x => x[0].test(name));
    LAKES.set(id, {id, name, rings:poly, box:[a0,n0,a1,n1], c:[sa/poly[0].length, sn/poly[0].length], gauge: g ? [g[1], null, g[2]] : null, area:p.AREASQKM||p.areasqkm||0});
    if (g) ensureLevel([g[1], null, g[2]]); });
  const lakes = [...LAKES.values()].filter(L => L.box[2] >= s && L.box[0] <= s+CELL && L.box[3] >= w && L.box[1] <= w+CELL);
  const out = [], mk = (type, name, c, geom, L, extra={}) => { const id = type+':'+c[0].toFixed(4)+','+c[1].toFixed(4); if (ZONE_IDS.has(id) || !inBox(c)) return; ZONE_IDS.add(id);
    out.push(Object.assign({id, type, name, c, geom, species:lakeSpecies(type, L), lake:{name:shortLake(L.name), id:L.id, gauge:L.gauge}}, TYPES[type], extra)); };
  const off = (p, dx, dy, m) => [p[0] + dy*m/111320, p[1] + dx*m/(111320*Math.cos(p[0]*Math.PI/180))];
  for (const L of lakes){
    // walk every shoreline (outer edge and islands) every ~120 m and measure how much water surrounds each point
    const samples = [];
    L.rings.forEach(ring => { for (let i=0;i<ring.length-1;i++){ const A = ring[i], B = ring[i+1], n = Math.max(1, Math.round(distKm(A,B)/0.12));
      for (let k=0;k<n;k++){ const p = [A[0]+(B[0]-A[0])*k/n, A[1]+(B[1]-A[1])*k/n]; if (!inBox(p)) continue;
        let wet = 0, vx = 0, vy = 0; for (let d=0; d<16; d++){ const a = d*Math.PI/8, dx = Math.cos(a), dy = Math.sin(a); for (const r of [130, 260]) if (inLake(L, off(p, dx, dy, r))){ wet++; vx += dx; vy += dy; } }
        const len = Math.hypot(vx, vy) || 1; samples.push({p, frac: wet/32, dx: vx/len, dy: vy/len}); } } });
    const pick = (list, minKm, max) => { const kept = []; for (const x of list){ if (kept.length >= max) break; if (kept.every(k => distKm(k.p, x.p) >= minKm)) kept.push(x); } return kept; };
    const label = c => { const r = nearRamp(c, 2.5); return r ? `near ${r}` : `on ${shortLake(L.name)}`; };
    pick(samples.filter(x => x.frac >= 0.62).sort((a,b) => b.frac - a.frac), 0.7, 8).forEach(x => { const c = off(x.p, x.dx, x.dy, 70);
      if (inLake(L, c)) mk('point', `Point ${label(c)}`, c, {poly:circle(c[0], c[1], 140, 14)}, L); });
    pick(samples.filter(x => x.frac <= 0.27 && x.frac >= 0.09).sort((a,b) => a.frac - b.frac), 0.9, 4).forEach(x => { const c = off(x.p, x.dx, x.dy, 60);
      if (inLake(L, c)) mk('cove', `Cove ${label(c)}`, c, {poly:circle(c[0], c[1], 150, 14)}, L); });
  }
  // bridges that cross a lake, and marinas on one
  if (lakes.length){
    const br = await query(SRC.nbi, bb, {where:"SERVICE_UND_042B IN ('5','6','7','8','9') AND STRUCTURE_LEN_MT_049 >= 40", outFields:'FEATURES_DESC_006A,FACILITY_CARRIED_007'}); const seen = [];
    br.forEach(f => { const p = f.properties||{}, c = [f.geometry.coordinates[1], f.geometry.coordinates[0]]; if (seen.some(q => distKm(q, c) < 0.3)) return;
      const L = lakes.find(L => inLake(L, c) || [0,1,2,3].some(k => inLake(L, off(c, Math.cos(k*Math.PI/2), Math.sin(k*Math.PI/2), 60)))); if (!L) return; seen.push(c);
      const road = tc(String(p.FACILITY_CARRIED_007||'').replace(/\s+/g,' ')); mk('bridge', `${road || 'Bridge'} bridge, ${shortLake(L.name)}`, c, {poly:circle(c[0], c[1], 110, 12)}, L, {depth:'Channel under the span', structure:'Bridge pilings and riprap; the channel swing under the span holds bait, crappie and bass'}); });
    (GA.marinas||[]).forEach(([nm, la, ln]) => { if (!nm || !inBox([la, ln])) return; const L = lakes.find(L => [0,1,2,3,4,5,6,7].some(k => inLake(L, off([la,ln], Math.cos(k*Math.PI/4), Math.sin(k*Math.PI/4), 150)))); if (!L) return;
      let c = [la, ln]; if (!inLake(L, c)) for (let k=0;k<8;k++){ const q = off([la,ln], Math.cos(k*Math.PI/4), Math.sin(k*Math.PI/4), 150); if (inLake(L, q)){ c = q; break; } }
      mk('dock', nm, c, {poly:circle(c[0], c[1], 80, 12)}, L, {structure:'Marina docks: shade, brush and lights; crappie and spots hold under the slips'}); });
  }
  return out;
}
function lakeSpecies(type, L){
  const n = (L && L.name) || '', spots = /lanier|allatoona|carters|hartwell|burton|chatuge|nottely|blue ridge|rabun/i.test(n), stripers = /lanier|allatoona|hartwell|thurmond|clarks hill|russell|west point|seminole|carters/i.test(n);
  const bass = spots ? ['Spotted bass','Largemouth bass'] : ['Largemouth bass'];
  switch (type){
    case 'point': return bass.concat(stripers ? ['Striped bass'] : [], ['Crappie']);
    case 'cove': return ['Largemouth bass','Crappie'].concat(stripers ? ['Striped bass'] : [], ['Bream']);
    case 'bridge': return ['Crappie'].concat(bass, stripers ? ['Striped bass'] : []);
    default: return ['Crappie'].concat(bass, ['Bream']);
  }
}
async function loadCell(key){
  if (cellsDone.has(key) || cellsBusy.has(key)) return; cellsBusy.add(key); setLoading();
  const [iy, ix] = key.split(':').map(Number), s = iy*CELL, w = ix*CELL, bb = [w, s, w+CELL, s+CELL];
  const inBox = c => c[0]>=s && c[0]<s+CELL && c[1]>=w && c[1]<w+CELL;
  if (isInland([s+CELL/2, w+CELL/2])){ // inland: lakes only, no tides or coastal habitat
    let add = []; try { add = await lakeSpots(s, w, bb, inBox); } catch(e){}
    cellsBusy.delete(key); cellsDone.add(key);
    add.forEach(z => { z.k = ZONES.length; ZONES.push(z); drawZone(z); });
    setLoading(); refresh(); return;
  }
  const simp = {maxAllowableOffset:'0.00004', geometryPrecision:'5', outFields:'OBJECTID'};
  // depth tiles for the cell plus a 2 km margin (z13)
  const PAD = 0.02, tx0 = Math.floor(lng2t(w-PAD,13)), tx1 = Math.floor(lng2t(w+CELL+PAD,13)), ty0 = Math.floor(lat2t(s+CELL+PAD,13)), ty1 = Math.floor(lat2t(s-PAD,13)), tiles = [];
  for (let x=tx0;x<=tx1;x++) for (let y=ty0;y<=ty1;y++) tiles.push([x,y]);
  const [inlets, reefs, oys, flats, mangs, marinas, hb1, hb2, br1, br2, nbi, dem] = await Promise.all([
    query(SRC.inlets,bb), query(SRC.reefs,bb), query(SRC.oyster,bb,simp), query(SRC.flats,bb,simp), query(SRC.mangroves,bb,{maxAllowableOffset:'0.0001', geometryPrecision:'5', outFields:'OBJECTID'}),
    query(SRC.marinas,bb,{outFields:'Name,Usage,Wat_Name'}), query(SRC.hb1,bb,simp), query(SRC.hb2,bb,Object.assign({}, simp, {where:"Geoform = 'Coral Reef and Hardbottom'"})),
    query(SRC.br1,bb,{outFields:'OBJECTID'}), query(SRC.br2,bb,{outFields:'OBJECTID'}),
    inGAcoast(s+CELL/2, w+CELL/2) ? query(SRC.nbi,bb,{where:"STATE_CODE_001='13' AND SERVICE_UND_042B IN ('5','6','7','8','9') AND STRUCTURE_LEN_MT_049 >= 50", outFields:'FEATURES_DESC_006A,FACILITY_CARRIED_007,STRUCTURE_LEN_MT_049'}) : Promise.resolve([]),
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
  // shallow coasts (Big Bend, Nature Coast, Florida Bay) rarely reach 6 ft near shore, so the bar adapts:
  // seed from 6 ft water if there's a fair amount of it, otherwise 3.5 ft, otherwise 2.5 ft; channels need 2 ft (1.5 ft on shallow coasts)
  let deep = 0, mid = 0; for (let i=0;i<GN;i++){ if (dep[i] >= 6) deep++; else if (dep[i] >= 3.5) mid++; }
  const seedFt = deep > GN*0.01 ? 6 : (deep+mid) > GN*0.01 ? 3.5 : 2.5, chanFt = seedFt === 6 ? 2 : 1.5;
  for (let i=0;i<GN;i++) if (dep[i] >= seedFt){ nav[i] = 1; Q[qt++] = i; }
  while (qh < qt){ const i = Q[qh++], q = i%GW, r = (i/GW)|0;
    for (const [a,b] of NB8){ const qq=q+a, rr=r+b; if (qq<0||rr<0||qq>=GW||rr>=GH) continue; const j = rr*GW+qq; if (!nav[j] && dep[j] >= chanFt){ nav[j] = 1; Q[qt++] = j; } } }
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
  // ---- Georgia coast: sounds, bridges from the national inventory, state reefs and marinas
  if (inGAcoast(s+CELL/2, w+CELL/2)){
    const water = (c, minFt, maxM) => { // nearest point at least minFt deep within maxM metres
      if (depthFt(c[0],c[1]) >= minFt) return c;
      for (let r = 30; r <= maxM; r += 30) for (let k=0;k<16;k++){ const a = k*Math.PI/8, q = [c[0]+Math.sin(a)*r/111320, c[1]+Math.cos(a)*r/(111320*Math.cos(c[0]*Math.PI/180))]; if (depthFt(q[0],q[1]) >= minFt) return q; }
      return null; };
    const deepest = (c, rM) => { let best = null, bd = -1; for (let r = 0; r <= rM; r += 100) for (let k=0;k<(r?16:1);k++){ const a = k*Math.PI/8, q = [c[0]+Math.sin(a)*r/111320, c[1]+Math.cos(a)*r/(111320*Math.cos(c[0]*Math.PI/180))], d = depthFt(q[0],q[1]); if (d != null && d > bd){ bd = d; best = q; } } return best || c; };
    GA.inlets.forEach(([nm, la, ln]) => { if (!inBox([la, ln])) return; const c = deepest([la, ln], 1500);
      push('pass', nm, c, {poly:circle(c[0],c[1],450)}, {structure:'Sound entrance between barrier islands; strong tidal flow, rips and deep holes along the bars'}); });
    GA.reefGroups.forEach(([nm, la, ln, n]) => { if (!inBox([la, ln])) return;
      push('reef', nm, [la, ln], {poly:circle(la, ln, 400, 12)}, {depth:'Offshore', structure:`Georgia DNR offshore reef: ${n} mapped structures (vessels, barges, reef balls, concrete)`, gps:`${la.toFixed(5)}, ${ln.toFixed(5)}`}); });
    GA.inshore.forEach(([nm, la, ln]) => { if (!inBox([la, ln])) return;
      push('reef', nm+' inshore reef', [la, ln], {poly:circle(la, ln, 120, 12)}, {depth:'Inshore', structure:'Georgia DNR inshore reef in a sound or river', gps:`${la.toFixed(5)}, ${ln.toFixed(5)}`}); });
    GA.reefs.concat(GA.inshore).forEach(([nm, la, ln]) => { if (!inBox([la, ln])) return;
      OV.reefs.addLayer(L.circleMarker([la, ln], {pane:'habitat', radius:5, color:'#08161a', weight:1.5, fillColor:'#ff8a3d', fillOpacity:1}).bindPopup(`<b>${esc(nm)}</b><br>Georgia DNR artificial reef<br>${la.toFixed(5)}, ${ln.toFixed(5)}`)); });
    const seenBr = [];
    nbi.forEach(f => { const p = f.properties || {}, c0 = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
      if (seenBr.some(q => distKm(q, c0) < 0.25)) return; seenBr.push(c0); // twin spans count once
      const c = water(c0, 3, 150); if (!c) return; const over = tc(String(p.FEATURES_DESC_006A||'').replace(/\s+/g,' ')), road = tc(String(p.FACILITY_CARRIED_007||'').replace(/\s+/g,' '));
      push('bridge', over ? `${road || 'Bridge'} over ${over}` : 'Bridge near '+nearName(c), c, {poly:circle(c[0],c[1],90,12)}, {depth:`${Math.round(depthFt(c[0],c[1]))} ft near the span (approx.)`}); });
    GA.marinas.forEach(([nm, la, ln]) => { if (!inBox([la, ln]) || !nm || /yacht club|condo|private/i.test(nm)) return; const c = water([la, ln], 1, 150); if (!c) return;
      push('dock', nm, c, {poly:circle(c[0],c[1],60,12)}, {structure:'Marina docks and pilings; shade by day, lights at night'}); });
  }
  // hard bottom overlay
  hb1.concat(hb2).flatMap(f => ringsOf(f.geometry)).forEach(r => OV.hardbottom.addLayer(L.polygon(r, {pane:'habitat', color:'#d9b3ff', weight:.8, fillColor:'#c48cff', fillOpacity:.38, interactive:false})));
  // register
  cellsBusy.delete(key); cellsDone.add(key);
  add.forEach(z => { z.k = ZONES.length; ZONES.push(z); z.st = nearestStation(z.c); drawZone(z); if (z.st) ensureTide(z.st);
    // passes, bridges and drop-offs near a NOAA current station score on the predicted current itself
    if (/^(pass|bridge|dropoff)$/.test(z.type)){ const cs = nearestCur(z.c, 3); if (cs){ z.cs = cs[0]; ensureCur(cs); } } });
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
  if (!TIDES.has(id)) ensureTide(id); // fetch on first use (e.g. the station nearest the map center)
  const T = TIDES.get(id); if (!T || !T.ev) return null;
  if (T.hT0 !== T0){ const ev = T.ev; T.h = HRS.map(({t}) => { for (let k=0;k<ev.length-1;k++){ const a=ev[k], b=ev[k+1]; if (t>=a.t && t<=b.t){ const f=(t-a.t)/(b.t-a.t); return a.v+(b.v-a.v)*(1-Math.cos(Math.PI*f))/2; } } return ev[ev.length-1].v; }); T.hT0 = T0; }
  return T.h;
}
let condSeq = 0;
const WMO_TEXT = c => c >= 95 ? 'Thunderstorms' : c >= 80 ? 'Rain showers' : c >= 61 ? 'Rain' : c >= 51 ? 'Drizzle' : c >= 45 ? 'Fog' : c === 3 ? 'Cloudy' : c === 2 ? 'Partly cloudy' : c === 1 ? 'Mostly sunny' : 'Sunny';
async function loadConditions(c){
  const seq = ++condSeq;
  const tzGuess = (c[1] < -85.0 && c[0] > 29.5) ? 'America/Chicago' : 'America/New_York';
  const base = {c, wx:null, waterTemp:null};
  let tz = tzGuess, periods = null;
  try { const pt = await getJSON(`https://api.weather.gov/points/${c[0].toFixed(4)},${c[1].toFixed(4)}`); tz = pt.properties.timeZone || tz;
    // the NWS grid endpoints often fail once and then succeed, so try up to three times
    for (let k=0; k<3 && !(periods && periods.length); k++){ try { periods = (await getJSON(pt.properties.forecastHourly)).properties.periods; } catch(e){ await new Promise(r => setTimeout(r, 1200*(k+1))); } } } catch(e){}
  if (!periods || !periods.length){ // backup forecast: Open-Meteo (free, no key) in the same shape as the NWS hourly periods
    try { const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${c[0].toFixed(4)}&longitude=${c[1].toFixed(4)}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,weather_code,is_day&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=GMT&forecast_days=8`);
      const h = j.hourly; periods = h.time.map((t,k) => ({startTime:t+':00Z', windSpeed:Math.round(h.wind_speed_10m[k])+' mph', windDirection:card(h.wind_direction_10m[k]), temperature:Math.round(h.temperature_2m[k]),
        probabilityOfPrecipitation:{value:h.precipitation_probability[k]}, shortForecast:WMO_TEXT(h.weather_code[k])})); } catch(e){} }
  if (seq !== condSeq) return;
  TZ = tz; buildClock();
  // wind per hour
  const P = (periods||[]).map(p => { const sp = (p.windSpeed||'0').match(/\d+/g)||['0']; return {t:Date.parse(p.startTime), ws:Math.max(...sp.map(Number)), wd:DIR_DEG[p.windDirection] ?? 0, temp:p.temperature, pop:(p.probabilityOfPrecipitation||{}).value ?? 0, sf:p.shortForecast||''}; });
  // per hour: [wind mph, wind dir, temp, rain chance %, short forecast, forecast covers this hour]
  base.wx = HRS.map(({t}) => { if (!P.length) return [10,90,null,0,'',false]; let b=P[0]; for (const p of P) if (Math.abs(p.t-t) < Math.abs(b.t-t)) b=p; return [b.ws, b.wd, b.temp, b.pop, b.sf, Math.abs(b.t-t) <= 2*3600e3]; });
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
  const exP = loadExtras(c);
  if (wt && bd < 80){ try { const j = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature&station=${wt[0]}&date=latest&units=english&time_zone=gmt&format=json&application=spotcast`); if (j.data){ base.waterTemp = +j.data[0].v; base.wtName = wt[3]; } } catch(e){} }
  base.ex = await exP;
  if (seq !== condSeq) return;
  COND = base; SCORE.clear();
  const now = (Date.now()-T0)/3600e3; if (!condReady){ cur = clamp(Math.ceil(now),0,H-1); condReady = true; } else cur = clamp(cur,0,H-1);
  refresh();
}
let condReady = false;

// ---- extra conditions per hour: pressure and its 3-hour trend, cloud, visibility (Open-Meteo forecast),
// and waves, swell, surface current and sea temperature (Open-Meteo marine). Best effort: any of it may be missing.
async function loadExtras(c){
  const ll = `latitude=${c[0].toFixed(3)}&longitude=${c[1].toFixed(3)}`;
  const idx = j => { const m = new Map(); (j && j.hourly ? j.hourly.time : []).forEach((t,k) => m.set(Date.parse(t+':00Z'), k)); return m; };
  const [fc, mr] = await Promise.all([
    getJSON(`https://api.open-meteo.com/v1/forecast?${ll}&hourly=pressure_msl,cloud_cover,visibility,temperature_2m&temperature_unit=fahrenheit&timezone=GMT&past_days=7&forecast_days=8`).catch(() => null),
    getJSON(`https://marine-api.open-meteo.com/v1/marine?${ll}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&length_unit=imperial&timezone=GMT&forecast_days=8&cell_selection=sea`).catch(() => null)]);
  const fi = idx(fc), mi = idx(mr), num = v => v == null || isNaN(v) ? null : +v;
  const at = (j, m, key, t) => { if (!j) return null; const k = m.get(Math.round(t/3600e3)*3600e3); return k == null ? null : num(j.hourly[key][k]); };
  // lake surface temperature tracks the last five days of air temperature closely enough to pick the season's pattern
  const airAvg = t => { if (!fc) return null; let sum = 0, n = 0; for (let h = 0; h < 120; h += 3){ const v = at(fc,fi,'temperature_2m', t - h*3600e3); if (v != null){ sum += v; n++; } } return n >= 10 ? sum/n : null; };
  return HRS.map(({t}) => {
    const air = airAvg(t), lakeT = air == null ? null : c[0] >= 30.7 ? 0.5*(air + 2) + 0.5*lakeClimo(t) : air + 2; // Georgia: half recent air, half the lake's seasonal norm
    const p = at(fc,fi,'pressure_msl',t), p3 = at(fc,fi,'pressure_msl',t-3*3600e3), vis = at(fc,fi,'visibility',t), cv = at(mr,mi,'ocean_current_velocity',t), sst = at(mr,mi,'sea_surface_temperature',t);
    return {p, dp3: p != null && p3 != null ? p - p3 : null, cloud: at(fc,fi,'cloud_cover',t), vis: vis == null ? null : vis/1609.34,
      wh: at(mr,mi,'wave_height',t), wp: at(mr,mi,'wave_period',t), wdir: at(mr,mi,'wave_direction',t),
      sh: at(mr,mi,'swell_wave_height',t), sp: at(mr,mi,'swell_wave_period',t), sdir: at(mr,mi,'swell_wave_direction',t),
      cv: cv == null ? null : cv/1.852, cd: at(mr,mi,'ocean_current_direction',t), sst: sst == null ? null : sst*9/5+32, lakeT};
  });
}
const exAt = i => (COND && COND.ex && COND.ex[i]) || {};
const waterTempAt = i => COND.waterTemp ?? exAt(i).sst ?? null;

// ---- tidal currents: NOAA current predictions (peak flood, peak ebb, slack), smoothed to every hour; flood is positive
const CURS = new Map();
function nearestCur(c, maxKm){ let best=null, bd=1e9; for (const s of (STATIONS.cur||[])){ const d = distKm(c,[s[1],s[2]]); if (d < bd){ bd=d; best=s; } } return best && bd <= maxKm ? best : null; }
function ensureCur(s){
  if (CURS.has(s[0])) return; CURS.set(s[0], {loading:true, name:s[3]});
  getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=currents_predictions&station=${s[0]}&bin=${s[4]||1}&begin_date=${ymd(Date.now()-86400e3)}&range=216&interval=MAX_SLACK&units=english&time_zone=gmt&format=json&application=spotcast`)
    .then(j => { const cp = j.current_predictions && j.current_predictions.cp; if (!cp || !cp.length) throw 0;
      CURS.set(s[0], {name:s[3], flood:cp[0].meanFloodDir, ebb:cp[0].meanEbbDir, ev:cp.map(p => ({t:Date.parse(p.Time.replace(' ','T')+':00Z'), v:+p.Velocity_Major}))});
      SCORE.clear(); refreshSoon(); })
    .catch(() => CURS.set(s[0], {name:s[3], failed:true}));
}
function curV(id){
  const C = CURS.get(id); if (!C || !C.ev) return null;
  if (C.hT0 !== T0){ const ev = C.ev; C.h = HRS.map(({t}) => { for (let k=0;k<ev.length-1;k++){ const a=ev[k], b=ev[k+1]; if (t>=a.t && t<=b.t){ const f=(t-a.t)/(b.t-a.t); return a.v+(b.v-a.v)*(1-Math.cos(Math.PI*f))/2; } } return null; }); C.hT0 = T0; }
  return C.h;
}
// ---- tide swing: the rise or fall of the tide you're fishing, against the station's average swing
function tideSwing(id, i){
  const T = TIDES.get(id); if (!T || !T.ev || T.ev.length < 3) return null;
  const ev = T.ev, t = T0 + i*3600e3;
  if (T.avg == null){ let s = 0; for (let k=1;k<ev.length;k++) s += Math.abs(ev[k].v-ev[k-1].v); T.avg = s/(ev.length-1); }
  for (let k=0;k<ev.length-1;k++) if (t >= ev[k].t && t <= ev[k+1].t){ const sw = Math.abs(ev[k+1].v-ev[k].v); return {sw, ratio: T.avg > 0 ? sw/T.avg : 1}; }
  return null;
}
function tideTurns(id, d){ // highs and lows on day d
  const T = TIDES.get(id); if (!T || !T.ev) return [];
  const a = T0 + DAYS[d].idx[0]*3600e3, b = a + DAYS[d].idx.length*3600e3, ev = T.ev, out = [];
  for (let k=1;k<ev.length-1;k++) if (ev[k].t >= a && ev[k].t < b) out.push({t:ev[k].t, v:ev[k].v, hi: ev[k].v > ev[k-1].v});
  return out;
}

// ---------------- scoring
// ---- lake factor (35): where fish are this time of year, from estimated water temperature and the month, plus lake level
// Typical surface temperature by month for Lanier-type reservoirs (°F); deep lakes lag the air, so the estimate leans on this.
const LAKE_CLIMO = [51,51,55,64,73,79,83,85,82,75,66,57];
function lakeClimo(t){ const dt = new Date(t), m = dt.getMonth(), f = (dt.getDate() - 15) / 30, n = f >= 0 ? (m + 1) % 12 : (m + 11) % 12;
  return LAKE_CLIMO[m] + (LAKE_CLIMO[n] - LAKE_CLIMO[m]) * Math.abs(f); }
// Turnover: the layers mix from mid-October until about Christmas (Georgia DNR). Turned water in creek backs goes dark and foamy.
const inTurnover = (T, month) => (month === 9 && T < 70) || month === 10 || (month === 11 && T >= 50);
function lakeSeason(T, month){
  if (T == null) T = LAKE_CLIMO[month];
  const fall = month >= 8 && month <= 11, t = Math.round(T), turn = inTurnover(T, month);
  const TURN = ' The lake may be turning over: skip creeks with dark, coffee-colored water and foam, and fish clear water on the main lake.';
  if (T < 50 || (T < 54 && (month <= 1 || month === 11))) return {k:'winter', txt:`About ${t}°F water: winter. Stripers push into the middle and backs of creeks after bait, so watch for gulls and loons. Bass and crappie hold deep on channel ledges, bluffs and deep docks and bite slowly.`};
  if (T < 60) return fall ? {k:'latefall', turn, txt:`About ${t}°F water and cooling: late fall. Bait balls up on main-lake points and creek mouths, and stripers start moving into the creeks.${turn ? TURN : ''}`} : {k:'prespawn', txt:`About ${t}°F water and warming: pre-spawn. Bass stage on rocky points heading into coves, and herring and stripers move up the creeks.`};
  if (T < 68) return fall ? {k:'fall', turn, txt:`About ${t}°F water and cooling: fall. Stripers and spotted bass school on main-lake humps and points, and some shad push into creek backs.${turn ? TURN : ''}`} : {k:'spawn', txt:`About ${t}°F water: spawn. Largemouth and crappie move shallow into protected coves; spotted bass bed deeper on gravel points.`};
  if (T < 78 && !fall && month >= 3 && month <= 5) return {k:'herring', txt:`About ${t}°F water: herring and shad spawn. Bait spawns on hard banks at first light, like clay points, riprap, bridge pilings and marina walls, and stripers and spotted bass crash it. Fish points, bridges and docks early.`};
  if (T < 80) return fall ? {k:'fall', turn, txt:`About ${t}°F water and cooling: early fall. Fish start leaving their summer depths and school on points and humps.${turn ? TURN : ''}`} : {k:'postspawn', txt:`About ${t}°F water: post-spawn into early summer. Fish move out to points, docks and the first drop.`};
  return {k:'summer', txt:`About ${t}°F water: summer. The lake stratifies; stripers drop below the thermocline (about 30 ft) and bass go to deep points and humps. Early and late are best.`};
}
const SEASON_FIT = { // [point, cove, bridge, dock] out of 30
  winter:[24,22,26,22], prespawn:[27,22,22,22], spawn:[22,30,18,26], herring:[30,14,28,27], postspawn:[28,16,22,25], summer:[27,9,23,22], fall:[27,26,22,22], latefall:[27,20,24,22] };
const SEASON_NAME = {winter:'winter', prespawn:'pre-spawn', spawn:'spawn', herring:'herring spawn', postspawn:'post-spawn', summer:'summer', fall:'fall', latefall:'late fall'};
function lakeFactor(z, i){
  const ex = exAt(i), month = new Date(HRS[i].t).getMonth(), S = lakeSeason(ex.lakeT, month), col = {point:0, cove:1, bridge:2, dock:3}[z.type] ?? 0;
  let val = SEASON_FIT[S.k][col], why = S.txt, sign = val >= 24 ? 2 : val >= 18 ? 1 : -1;
  if (S.turn){ if (z.type === 'cove'){ val -= 6; sign = Math.min(sign, 1); } else if (z.type === 'point') val += 1; } // turnover reaches creek backs first
  const fits = val >= 24 ? ` ${z.label}s fit that pattern well.` : val < 18 ? ` ${z.label}s are off the main pattern right now.` : '';
  const lv = lakeLevel(z);
  if (lv && lv.now != null){ const d = lv.d24;
    if (d > 0.15 && !z.deep){ val += 5; why += ` Lake up ${d.toFixed(1)} ft in a day: rising water floods new cover and pulls fish shallow.`; }
    else if (d > 0.15){ val += 2; why += ` Lake up ${d.toFixed(1)} ft in a day.`; }
    else if (d < -0.15 && !z.deep){ val -= 4; why += ` Lake down ${Math.abs(d).toFixed(1)} ft in a day: falling water pulls fish off the bank.`; }
    else if (d < -0.15){ val += 2; why += ` Lake falling ${Math.abs(d).toFixed(1)} ft a day, which pulls fish out to points and channels.`; }
    else val += 1;
  } else val += 1;
  return {val: clamp(val, 4, 35), why:[sign, why + fits]};
}
// Four core factors make the base (tide 35, wind 25, moon 20, light 20 = 100), then small extras add or take
// points: spot type, pressure trend, water temperature for the main species, seas, sky and storms.
const FACTORS = [['tide','Tide',35,'#5aa9ff'],['wind','Wind',25,'#ff8a3d'],['moon','Moon',20,'#c48cff'],['light','Light',20,'#ffd23d']];
const SP_TEMP = { // ideal water temperature band, °F, and where the bite shuts down
  'Snook':[70,84,60], 'Redfish':[66,82,52], 'Speckled trout':[60,76,50], 'Flounder':[58,74,48], 'Sheepshead':[55,72,48], 'Black drum':[58,76,48],
  'Mangrove snapper':[72,86,62], 'Spanish mackerel':[70,84,64], 'Gag grouper':[62,78,54], 'Black sea bass':[54,70,46], 'Spadefish':[68,84,60], 'Cobia':[68,84,62]
};
const SPOT_BONUS = {pass:'Passes funnel bait and fish through one place.', dropoff:'Edges hold fish on most tides.', bridge:'Bridges hold fish in almost any condition.',
  flat:'Mapped flat with room to find fish.', mangrove:'Mangrove edges hold fish most of the year.', oyster:'Shell bars hold bait and fish.', reef:'Structure holds fish year round.', dock:'Docks hold fish but see a lot of pressure.'};
function score(k, i){
  const key = k*1000+i; if (SCORE.has(key)) return SCORE.get(key);
  if (SCORE.size > 6000){ let n = 0; for (const kk of SCORE.keys()){ SCORE.delete(kk); if (++n >= 2000) break; } } // keep memory flat on a phone
  const z = ZONES[k], hr = COND.hour[i], ex = exAt(i);
  // ---- tide (35)
  let tide = 14, tideWhy = [-1,'No tide prediction nearby yet, so this rating leans on wind, moon and light.'], r = 0, v = null, cur = null, swing = null;
  const h = z.st ? tideH(z.st) : null, cv = z.cs ? curV(z.cs) : null;
  if (z.lake){ const L = lakeFactor(z, i); tide = L.val; tideWhy = L.why; }
  else if (h){
    v = h[i]; r = (h[Math.min(i+1,H-1)] - h[Math.max(i-1,0)])/2;
    let mag = Math.abs(r), dir = r>0?'incoming':'outgoing', s = Math.min(1, mag/0.22), slack = mag < 0.04;
    if (cv && cv[i] != null){ // a nearby current station beats the tide-height slope for moving water
      const kt = cv[i], C = CURS.get(z.cs); cur = {kt, name:C.name, dir: kt >= 0 ? 'flood' : 'ebb'};
      s = Math.min(1, Math.abs(kt)/1.2); slack = Math.abs(kt) < 0.25; dir = kt >= 0 ? 'incoming' : 'outgoing';
    }
    const curTxt = cur ? ` ${Math.abs(cur.kt).toFixed(1)} kt ${cur.dir} at ${cur.name}.` : '';
    if (slack){ tide = 6; tideWhy = [-1,`Slack ${cur?'current':'tide'}. Expect a slow bite until the water starts moving.`]; }
    else if (z.pref==='moving'){ tide = 8+21*s; tideWhy = [s>.55?2:1, `${cur?'Current':'Tide'} ${s>.55?'moving well':'starting to move'}, pushing bait past the structure.${curTxt}`]; }
    else if (dir===z.pref){ tide = 12+23*s; tideWhy = [s>.55?2:1, `${cap(dir)} ${cur?'current':'tide'} ${s>.55?'running well':'starting to move'}. ${z.label} fish best on the ${z.pref}.${curTxt}`]; }
    else { tide = 6+4*s; tideWhy = [-1, `${cur?'Current':'Tide'} is ${dir==='incoming'?'coming in':'going out'}. ${z.label} fish best on the ${z.pref}.${curTxt}`]; }
    swing = tideSwing(z.st, i);
    if (swing && !slack){
      tide = Math.min(35, tide * clamp(0.7 + 0.3*swing.ratio, 0.75, 1.12));
      if (swing.ratio < 0.75) tideWhy = [tideWhy[0] > 0 ? 1 : tideWhy[0], tideWhy[1] + ` Only ${swing.sw.toFixed(1)} ft of swing, so less push than usual.`];
      else if (swing.ratio > 1.25) tideWhy = [tideWhy[0], tideWhy[1] + ` Big ${swing.sw.toFixed(1)} ft swing, so the water really moves.`];
    }
  }
  // ---- wind (25)
  const [ws, wd] = COND.wx[i];
  let wind, windWhy;
  if (z.wind==='point'){ const good = ws >= 5 && ws <= 15, calm = ws < 4; wind = good ? 25 : calm ? 15 : ws > 22 ? 11 : 19;
    windWhy = good ? [1, `A ${ws} mph ${card(wd)} wind pushes bait onto wind-blown points. Fish the side the wind hits.`] : calm ? [-1, 'Calm water. Fish are easier to spook; go deeper or use finesse baits.'] : [ws > 22 ? -2 : -1, `${ws} mph ${card(wd)} wind. Rough on open water; fish points out of the worst of it.`]; }
  else if (z.wind==='shel'){ wind = ws>14 ? 25 : 21; windWhy = [ws>14?1:0, `Protected water, so the ${ws} mph ${card(wd)} wind matters less.`]; }
  else if (z.wind==='reef'){ const pen = clamp((ws-8)/10,0,1); wind = 25*(1-pen); windWhy = pen>.6 ? [-2, `${ws} mph ${card(wd)} wind. Rough for running offshore.`] : pen>.25 ? [-1, `${ws} mph ${card(wd)} wind. Expect a bumpy ride out.`] : [1, `Light ${card(wd)} wind. Good conditions to run out and anchor.`]; }
  else if (z.wind==='flat'){ const pen = clamp((ws-10)/10,0,1)*0.7, calm = ws <= 2 ? 0.25 : 0; wind = 25*(1-pen-calm);
    windWhy = pen>.35 ? [-1, `${ws} mph ${card(wd)} wind will muddy a shallow flat. Work the lee side.`] : calm ? [-1, 'Slick calm. Easy to spot fish, harder to fool them. Use long casts and light lures.'] : [1, `A ${ws} mph ${card(wd)} breeze is workable on the flat.`]; }
  else { const pen = clamp((ws-12)/12,0,1)*0.6; wind = 25*(1-pen); windWhy = pen>.3 ? [-1, `${ws} mph ${card(wd)} wind. Fish the protected side.`] : [1, `The ${ws} mph ${card(wd)} wind stays fishable here.`]; }
  // ---- moon (20)
  let solWhy = null;
  if (hr.sol >= 10) solWhy = hr.major ? [2, `Major feeding window: moon ${hr.mjUp?'overhead':'underfoot'} at ${hourLabel(hr.mjAt)}.`] : [1, `Minor feeding window: moon on the horizon at ${hourLabel(hr.mnAt)}.`];
  const moonTxt = solWhy ? solWhy[1] : `No feeding window this hour. Next ${Math.abs(hr.mjAt-i) < Math.abs(hr.mnAt-i) ? 'major' : 'minor'} around ${hourLabel(Math.abs(hr.mjAt-i) < Math.abs(hr.mnAt-i) ? hr.mjAt : hr.mnAt)}.`;
  // ---- light (20)
  let light, lightWhy = null;
  if (hr.dS <= 1.5){ light = 20; lightWhy = [2, `Low light around ${hr.srNear?'sunrise':'sunset'} (${hourLabel(hr.srNear?hr.sr:hr.ss)}).`]; }
  else if (hr.alt < -6){ light = z.deep ? 15 : 9; lightWhy = (z.type==='bridge'||z.type==='dock') ? [2,'Night bite. Fish the shadow line under the lights.'] : z.type==='pass' ? [1,'Night bite. Fish current lines in the pass.'] : z.type==='reef' ? [-1,'Dark offshore. Run out only if you know the water.'] : [-1,'Dark on shallow water. Hard to read and fish.']; if (z.type==='bridge'||z.type==='dock') light = 14; }
  else { light = z.deep ? 12 : 7; if (z.type==='dock'||z.type==='bridge') { light = 10; lightWhy = [1,'Bright sun pushes fish into the shade under the structure.']; } else if (!z.deep) lightWhy = [-1,'High sun on shallow water. Fish push to edges and shade.']; }
  const f = [
    {k:'tide', val:tide, why: tideWhy[1]},
    {k:'wind', val:wind, why: windWhy[1]},
    {k:'moon', val:hr.sol, why: moonTxt},
    {k:'light', val:light, why: lightWhy ? lightWhy[1] : 'Mid-day light on deeper water. Fish hold near bottom and structure.'}
  ].map(x => Object.assign(x, {label: z.lake && x.k==='tide' ? 'Lake' : FACTORS.find(F => F[0]===x.k)[1], max: FACTORS.find(F => F[0]===x.k)[2], color: FACTORS.find(F => F[0]===x.k)[3]}));
  const base = f.reduce((a,x) => a + x.val, 0);
  // ---- extras
  const extras = [];
  if (z.base) extras.push({k:'spot', label:'Spot', pts:z.base, why: SPOT_BONUS[z.type] || ''});
  if (ex.dp3 != null){ const d = ex.dp3; // hPa over 3 hours
    const e = d <= -2 ? [1, `Pressure dropping fast (${(d*0.02953).toFixed(2)} inHg in 3 hours). Fish feed hard, but weather may follow.`]
      : d <= -0.5 ? [3, 'Pressure easing down. Fish tend to feed best ahead of a change.']
      : d >= 1.5 ? [-4, 'Pressure climbing fast behind a front. Fish often go tight-lipped.']
      : d >= 0.5 ? [1, 'Pressure rising slowly. Steady, normal bite.']
      : [0, 'Pressure steady.'];
    extras.push({k:'pressure', label:'Pressure', pts:e[0] - (ex.p > 1024 && e[0] >= 0 ? 1 : 0), why: e[1] + (ex.p ? ` ${(ex.p*0.02953).toFixed(2)} inHg.` : '')}); }
  const wt = waterTempAt(i), sp = (z.species||[]).find(n => SP_TEMP[n]);
  if (wt != null && sp && !z.lake){ const [lo, hi, off] = SP_TEMP[sp], t = Math.round(wt);
    const e = t >= lo && t <= hi ? [2, `${t}°F water is ideal for ${sp.toLowerCase()}.`] : t < off ? [-5, `${t}°F water is cold for ${sp.toLowerCase()}. Fish deep, slow and in the afternoon.`]
      : t < lo ? [-2, `${t}°F water is on the cool side for ${sp.toLowerCase()}. Warmest part of the day is best.`] : t > hi + 4 ? [-3, `${t}°F water is hot. Fish deeper water and low light.`] : [-1, `${t}°F water is a little warm for ${sp.toLowerCase()}.`];
    extras.push({k:'water', label:'Water', pts:e[0], why:e[1]}); }
  if (ex.wh != null && /^(pass|reef|bridge)$/.test(z.type)){ const w = ex.wh;
    const e = z.type==='reef' ? (w < 1.5 ? [1, `${w.toFixed(1)} ft seas. Easy run and easy to hold over the reef.`] : w < 3 ? [0, `${w.toFixed(1)} ft seas. Manageable.`] : [-4, `${w.toFixed(1)} ft seas. Rough offshore.`])
      : (w < 2 ? [0, `${w.toFixed(1)} ft seas and calm in the pass.`] : w < 4 ? [0, `${w.toFixed(1)} ft seas.`] : [-3, `${w.toFixed(1)} ft seas stacking up in the pass. Use caution.`]);
    extras.push({k:'seas', label:'Seas', pts:e[0], why:e[1]}); }
  if (ex.cloud != null && !hr.night && !z.deep){
    if (ex.cloud >= 70) extras.push({k:'sky', label:'Sky', pts:1, why:'Overcast. Low light keeps fish shallow and less spooky.'});
    else if (ex.cloud <= 15 && hr.alt > 35) extras.push({k:'sky', label:'Sky', pts:-1, why:'Bluebird sky on shallow water. Fish spook easily.'}); }
  const sf = COND.wx[i][4] || '', pop = COND.wx[i][3] || 0; let wxPen = 0;
  if (/thunder/i.test(sf)){ wxPen = 8; extras.push({k:'storm', label:'Storms', pts:-8, why:'Thunderstorms in the forecast. Get off the water if you hear thunder.'}); }
  else if (pop >= 70){ wxPen = 3; extras.push({k:'storm', label:'Rain', pts:-3, why:`${pop}% chance of rain this hour.`}); }
  const extra = extras.reduce((a,x) => a + x.pts, 0);
  const total = clamp(Math.round(base + extra), 0, 100);
  const exWhy = extras.filter(x => x.pts !== 0 && x.k !== 'spot').map(x => [Math.sign(x.pts) * (Math.abs(x.pts) >= 3 ? 2 : 1), x.why]);
  const why = [tideWhy, windWhy, solWhy, lightWhy, ...exWhy].filter(Boolean).filter(w => w[0]!==0).sort((a,b) => Math.abs(b[0])-Math.abs(a[0]) || b[0]-a[0]);
  const out = {total, tier:tierOf(total), why, f, extras, base:Math.round(base), extra, storm: wxPen >= 8, wxPen, tide:{v, r, dir: r>0?'incoming':'outgoing', cur, swing}, ws, wd};
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
map.on('click', () => { if (Date.now() - lastPinAt > 700) closePlace(); $('layersPanel').hidden = true; if (!$('searchForm').hidden) openSearch(false); });
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
const KIND_ORDER = ['pass','bridge','dropoff','flat','mangrove','oyster','dock','reef','point','cove'];
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
    if (moved){ dragged = Date.now(); if (open && dy > 50) toggleDock(false); } };
  head.addEventListener('pointerup', end);
  // a plain tap is handled on click (which lands on the header itself), not on pointerup: toggling on pointerup moved the
  // dock first, so the browser's click then landed on whatever slid under the finger (often a spot in the list)
  let dragged = 0;
  head.addEventListener('click', () => { if (Date.now() - dragged < 400) return; if (sel != null) selectZone(null); else toggleDock($('dock').classList.contains('collapsed')); }); head.addEventListener('pointercancel', () => { y0 = null; dock.style.transform = ''; });
})();
setDock(dockOpen);
// ---- marine conditions for the area at the selected hour
const MOON_NAMES = [[.03,'New moon'],[.22,'Waxing crescent'],[.28,'First quarter'],[.47,'Waxing gibbous'],[.53,'Full moon'],[.72,'Waning gibbous'],[.78,'Last quarter'],[.97,'Waning crescent'],[1.01,'New moon']];
function moonName(t){ const ph = SunCalc.getMoonIllumination(new Date(t)).phase; return MOON_NAMES.find(m => ph < m[0])[1]; }
// lake guides (guide.html): which lakes have one, matched by name
const GUIDES = [['lanier',/lanier/i],['allatoona',/allatoona/i],['hartwell',/hartwell/i],['westpoint',/west point/i],['wfgeorge',/george|eufaula/i],['oconee',/oconee/i],['sinclair',/sinclair/i],['thurmond',/thurmond|clarks hill/i],['russell',/russell/i],['carters',/carters/i]];
const guideFor = name => { const g = name && GUIDES.find(([, re]) => re.test(name)); return g ? g[0] : null; };
const GUIDE_C = {lanier:[34.25,-83.95], allatoona:[34.16,-84.65], hartwell:[34.45,-82.85], westpoint:[33.0,-85.1], wfgeorge:[31.8,-85.1], oconee:[33.5,-83.3], sinclair:[33.2,-83.3], thurmond:[33.8,-82.35], russell:[34.1,-82.7], carters:[34.62,-84.65]};
const guideNear = c => { let best = null, bd = 30; for (const k in GUIDE_C){ const d = distKm(c, GUIDE_C[k]); if (d < bd){ bd = d; best = k; } } return best; };
const guideLink = (name, i, c) => { const g = guideFor(name) || (c ? guideNear(c) : null); return g ? `<a class="guide-btn" href="guide.html?lake=${g}&m=${new Date(HRS[i] ? HRS[i].t : Date.now()).getMonth() + 1}">Lake guide: where the fish are this month →</a>` : ''; };
function marineHtml(i){
  if (!COND) return '';
  { const m = map.getCenter(); if (isInland([m.lat, m.lng])){ const ex = exAt(i), [ws, wd] = COND.wx[i], hr = COND.hour[i], cell = (v, l) => `<div>${v != null ? `<b>${v}</b>` : '<b>—</b>'}<span>${l}</span></div>`;
    const near = [...LAKES.values()].sort((a,b) => distKm([m.lat,m.lng], a.c) - distKm([m.lat,m.lng], b.c))[0], lv = near && near.gauge ? LEVELS.get(near.gauge[0]) : null, trend = ex.dp3 == null ? '' : ex.dp3 <= -0.5 ? ' ↓' : ex.dp3 >= 0.5 ? ' ↑' : ' →';
    return `<div class="mc"><div class="mc-h"><span class="eyebrow">${esc(near ? shortLake(near.name) : 'Lake')} · ${hourLabel(i)}</span><small>USGS · NWS · Open-Meteo</small></div><div class="mc-g">
      ${cell(ex.lakeT != null ? Math.round(ex.lakeT)+'°F' : null, 'Water (est.)')}${cell(lv && lv.now != null ? lv.now.toFixed(1)+' ft' : null, 'Lake level')}${cell(lv && lv.now != null ? (lv.d24 >= 0 ? '+' : '')+lv.d24.toFixed(2)+' ft' : null, 'Last 24 hours')}${cell(`${card(wd)} ${ws}`, 'Wind mph')}
      ${cell(ex.p != null ? (ex.p*0.02953).toFixed(2)+trend : null, 'Pressure inHg')}${cell(Math.round(hr.moon*100)+'%', moonName(T0+i*3600e3))}${cell(ex.vis != null ? (ex.vis >= 10 ? '10+' : ex.vis.toFixed(1))+' mi' : null, 'Visibility')}${cell((S => SEASON_NAME[S.k] + (S.turn ? ', turnover' : ''))(lakeSeason(ex.lakeT, new Date(HRS[i].t).getMonth())), 'Pattern')}
    </div>${guideLink(near && near.name, i, [m.lat, m.lng])}</div>`; } } const ex = exAt(i), wt = waterTempAt(i), [ws, wd] = COND.wx[i], hr = COND.hour[i];
  const dash = '<b>—</b>', cell = (val, label) => `<div>${val != null ? `<b>${val}</b>` : dash}<span>${label}</span></div>`;
  const trend = ex.dp3 == null ? '' : ex.dp3 <= -0.5 ? ' ↓' : ex.dp3 >= 0.5 ? ' ↑' : ' →';
  const sr = fmtTime(T0 + hr.sr*3600e3), ss = fmtTime(T0 + hr.ss*3600e3);
  return `<div class="mc"><div class="mc-h"><span class="eyebrow">Marine conditions · ${hourLabel(i)}</span><small>NOAA · NWS · Open-Meteo</small></div><div class="mc-g">
    ${cell(wt != null ? Math.round(wt)+'°F' : null, 'Water temp')}
    ${cell(ex.wh != null ? ex.wh.toFixed(1)+' ft' : null, ex.wp ? `Waves · ${ex.wp.toFixed(0)}s` : 'Waves')}
    ${cell(ex.sh != null ? ex.sh.toFixed(1)+' ft' : null, ex.sdir != null ? `Swell · ${card(ex.sdir)}` : 'Swell')}
    ${cell(ex.cv != null ? ex.cv.toFixed(1)+' kt' : null, ex.cd != null ? `Current · ${card(ex.cd)}` : 'Current')}
    ${cell(`${card(wd)} ${ws}`, 'Wind mph')}
    ${cell(ex.p != null ? (ex.p*0.02953).toFixed(2)+trend : null, 'Pressure inHg')}
    ${cell(Math.round(hr.moon*100)+'%', moonName(T0+i*3600e3))}
    ${cell(ex.vis != null ? (ex.vis >= 10 ? '10+' : ex.vis.toFixed(1))+' mi' : null, 'Visibility')}
  </div><p class="note" style="margin:8px 0 0">Sunrise ${sr} · Sunset ${ss}</p></div>`;
}
function paintBody(){
  const el = $('body');
  if (!COND){ el.innerHTML = `<div class="eyebrow">Loading conditions</div><div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>`; return; }
  if (map.getZoom() < 11 && sel == null){ el.innerHTML = `<div class="empty"><b>Zoom in to see spots</b>Spots load automatically once you zoom in on the water.</div>${installHtml()}`; wireInstall(); return; }
  if (sel != null) return paintSpot();
  const vis = visibleZones();
  if (!vis.length){ el.innerHTML = cellsBusy.size ? `<div class="eyebrow">Finding spots in view</div><div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>` : `<div class="empty"><b>No mapped spots in view</b>Pan to the coast or zoom out a little. Spots come from passes, bridges, drop-offs, flats, mangroves, oyster bars, docks and reefs.</div>${installHtml()}`; wireInstall(); return; }
  const ranked = vis.map(z => ({z, s:score(z.k,cur)})).sort((a,b) => b.s.total-a.s.total);
  const counts = {}; vis.forEach(z => counts[z.type] = (counts[z.type]||0)+1);
  el.innerHTML = `${marineHtml(cur)}<div class="list-head"><span class="eyebrow">${vis.length} spots in view · best at ${hourLabel(cur)}</span><span class="legend">${TIER.map(t=>`<span class="t-${t[1]}"><i class="dot"></i>${t[2]}</span>`).join('')}</span></div>
    <ol class="rank">${ranked.slice(0,30).map((r,n)=>`<li><button type="button" class="t-${r.s.tier[1]}" data-k="${r.z.k}"><span class="n">${n+1}</span><span class="nm">${esc(r.z.name)} <span class="kind">· ${r.z.label}</span><span class="why">${esc(shortWhy(r.s))}</span></span><span class="pill">${r.s.tier[2]}</span></button></li>`).join('')}</ol>
    ${ranked.length>30?`<p class="note">Showing the top 30. Zoom in to narrow the list.</p>`:''}
    <p class="note">${KIND_ORDER.filter(k=>counts[k]).map(k=>`${counts[k]} ${TYPES[k].label.toLowerCase()}`).join(' · ')}</p>
    ${installHtml()}
    <p class="note">Spots are generated from FWC habitat maps, FDOT bridges and the NOAA depth model, then rated each hour from NOAA tides, the NWS wind forecast, moon and sun. A starting point, not local knowledge. Not for navigation.</p>`;
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => selectZone(+b.dataset.k));
  wireInstall();
}
// ---- score breakdown: the ring, four factor bars, the extras and the reasons behind each
let dnaOpen = store.get('sc-why-open', false);
function ringSvg(total, tier){
  const R = 34, C = 2*Math.PI*R, f = clamp(total,0,100)/100;
  return `<svg class="dna-ring" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--line)" stroke-width="7"/>
    <circle cx="42" cy="42" r="${R}" fill="none" stroke="${COLORS[tier[1]]}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C*f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 42 42)"/></svg>`;
}
function dnaHtml(s){
  const bars = s.f.map(x => `<div class="dna-f"><div class="dna-l"><span>${x.label}</span><b style="color:${x.color}">${Math.round(x.val)}<small>/${x.max}</small></b></div><div class="dna-bar"><i style="width:${(x.val/x.max*100).toFixed(0)}%;background:${x.color}"></i></div></div>`).join('');
  const sign = s.extra >= 0 ? '+' : '−', ex = Math.abs(s.extra);
  const reasons = s.f.map(x => `<li><span class="dna-pts" style="color:${x.color}">${Math.round(x.val)}</span><span><b>${x.label}</b>${esc(x.why)}</span></li>`).join('')
    + s.extras.map(x => `<li class="${x.pts>0?'up':x.pts<0?'down':''}"><span class="dna-pts">${x.pts>0?'+':x.pts<0?'−':''}${Math.abs(x.pts)}</span><span><b>${x.label}</b>${esc(x.why)}</span></li>`).join('');
  return `<div class="dna t-${s.tier[1]}">
    <div class="dna-top"><div class="dna-score">${ringSvg(s.total, s.tier)}<div class="dna-n"><b>${s.total}</b><span>${s.tier[2]}</span></div></div><div class="dna-fs">${bars}</div></div>
    <button type="button" class="dna-x" id="dnaWhy" aria-expanded="${dnaOpen}"><span>${s.extras.length ? `<b>${sign}${ex}</b> from extras` : 'No extras'}</span><span class="dna-math">${s.base} ${sign} ${ex} = ${s.total}</span><span class="dna-tg">${dnaOpen?'Hide':'Why'}</span></button>
    <ul class="dna-why" ${dnaOpen?'':'hidden'}>${reasons}</ul></div>`;
}
function wireDna(){ const b = $('dnaWhy'); if (!b) return; b.onclick = () => { dnaOpen = !dnaOpen; store.set('sc-why-open', dnaOpen); b.setAttribute('aria-expanded', dnaOpen);
  b.querySelector('.dna-tg').textContent = dnaOpen ? 'Hide' : 'Why'; b.nextElementSibling.hidden = !dnaOpen; }; }
function stormNote(z, b){ // flag storms in or right after the best window
  for (let i = b.from; i <= Math.min(H-1, b.to+2); i++){ const w = COND.wx[i]; if (/thunder/i.test(w[4]||'')) return `<div class="warn">⚡ Storms in the forecast around ${hourLabel(i)}. Watch the radar layer and get off the water if you hear thunder.</div>`; }
  return '';
}
function tideTurnsHtml(z, d){
  if (z.lake){ const lv = lakeLevel(z), T = exAt(cur).lakeT;
    const lvl = lv && lv.now != null ? `<div class="turn hi"><span>Level</span><b>${lv.now.toFixed(1)} ft</b><small>${lv.full ? (lv.now - lv.full >= 0 ? '+' : '') + (lv.now - lv.full).toFixed(1) + ' vs full' : 'USGS'}</small></div><div class="turn ${lv.d24 >= 0 ? 'hi' : 'lo'}"><span>24 hours</span><b>${lv.d24 >= 0 ? '+' : ''}${lv.d24.toFixed(2)} ft</b><small>${lv.d72 >= 0 ? '+' : ''}${lv.d72.toFixed(1)} in 3 days</small></div>` : '';
    return `<div class="turns">${lvl}<div class="turn"><span>Water</span><b>${T != null ? Math.round(T)+'°F' : '—'}</b><small>estimated</small></div></div>${lv && lv.now != null ? '' : '<p class="note">No live lake level gauge for this lake, so the rating leans on season, wind, moon and light.</p>'}`; }
  if (!z.st) return ''; const tt = tideTurns(z.st, d); if (!tt.length) return '';
  const C = z.cs && CURS.get(z.cs), cv = z.cs && curV(z.cs), now = cv && cv[cur] != null ? cv[cur] : null;
  return `<div class="turns">${tt.map(x => `<div class="turn ${x.hi?'hi':'lo'}"><span>${x.hi?'↑ High':'↓ Low'}</span><b>${x.v.toFixed(1)} ft</b><small>${fmtTime(x.t)}</small></div>`).join('')}</div>
    ${now != null ? `<p class="note">Current at ${esc(C.name)}: <b>${Math.abs(now).toFixed(1)} kt ${now >= 0 ? 'flood' : 'ebb'}</b> at ${hourLabel(cur)} (NOAA prediction).</p>` : ''}`;
}
function paintSpot(){
  const el = $('body'), z = ZONES[sel], s = score(sel,cur), d = HRS[cur].d, b = bestOfDay(d, [z]), key = sel+':'+cur;
  const stName = z.st ? (TIDES.get(z.st)||{}).name : null;
  el.innerHTML = `<div class="spot-head t-${s.tier[1]}"><h2>${esc(z.name)}</h2>
      <button class="close" type="button" aria-label="Back to all spots" id="closeSpot"><svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="meta"><span class="pill">${s.tier[2]}</span><span>${z.label} · ${hourLabel(cur)} · score ${s.total}/100</span></div></div>
    ${dnaHtml(s)}
    <div class="best"><span><span class="eyebrow">Best on ${DAYS[d].wd}</span><br><b>${hourLabel(b.from)}${b.to>b.from?'–'+hourLabel(b.to+1):''}</b> · ${tierOf(b.total)[2]} ${b.total}</span>${b.i!==cur?`<button type="button" id="goBest">Show this time</button>`:''}</div>
    ${stormNote(z, b)}
    ${tideTurnsHtml(z, d)}
    <dl class="facts">
      <dt>Fishes best</dt><dd>${z.lake ? 'Depends on the season (see Lake above)' : z.pref==='moving'?'Any moving tide':cap(z.pref)+' tide'}</dd>
      ${z.depth?`<dt>Depth</dt><dd>${esc(z.depth)}</dd>`:''}
      <dt>Structure</dt><dd>${esc(z.structure)}</dd>
      <dt>GPS</dt><dd>${coordBlock(z.c[0], z.c[1])}</dd>
      ${z.lake ? `<dt>Lake</dt><dd>${esc(z.lake.name)}${guideFor(z.lake.name) ? ` · <a href="guide.html?lake=${guideFor(z.lake.name)}&m=${new Date(HRS[cur].t).getMonth() + 1}">Lake guide</a>` : ''}</dd>` : `<dt>Tide station</dt><dd>${esc(stName || 'None nearby')}</dd>`}
      <dt>Species</dt><dd class="chips">${z.species.map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</dd>
    </dl>
    <button class="plan-btn" type="button" id="planBtn">Game plan for ${hourLabel(cur)}</button>
    <div id="planOut">${plans[key]?planHtml(plans[key]):''}</div>`;
  $('closeSpot').onclick = () => selectZone(null);
  wireDna();
  const gb = $('goBest'); if (gb) gb.onclick = () => setTime(b.i);
  wireCoords($('body'));
  $('planBtn').onclick = () => { plans[key] = gamePlan(z, s, cur); const out = $('planOut'); out.innerHTML = planHtml(plans[key]); wireCopy();
    // reveal: the plan rises in and the panel scrolls so its top sits just under the button
    const body = $('body'), top = body.scrollTop + out.getBoundingClientRect().top - body.getBoundingClientRect().top - 64;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => body.scrollTo({top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth'})); };
  wireCopy();
}
function shortWhy(s){ const up = s.why.filter(w=>w[0]>0)[0], dn = s.why.filter(w=>w[0]<0)[0]; return ((up||dn||[0,''])[1]).split('. ')[0]; }

// ---- game plan
function gamePlan(z, s, i){
  if (z.lake){ const SS = lakeSeason(exAt(i).lakeT, new Date(HRS[i].t).getMonth()), S = SS.k, [ws] = COND.wx[i], low = COND.hour[i].dS <= 1.5 || COND.hour[i].alt < 0;
    const deep = /winter|summer/.test(S), shallowBite = /^(spawn|fall|prespawn)$/.test(S);
    const turnNote = SS.turn ? '\n### Turnover check\nIf the water back here looks dark, coffee-colored or foamy, it has turned over. Leave and fish clear water on the main lake.' : '';
    if (z.type === 'cove' && S === 'winter') return `### Start here\nIdle from the middle of the cove toward the back and watch for gulls, loons and fish rolling on top. Winter stripers push in here after bait.\n### How to work it\nIf fish are up, cast to them. If not, set out freelines and downlines with herring and work slowly back, or troll an umbrella rig. Bass and crappie sit deeper, near the mouth and on deep docks.\n### Baits\n- Stripers on top: lead-head fluke, bucktail or small jerkbait\n- Stripers down: blueback herring or trout on a downline, or a four-arm umbrella rig after a cold front\n- Crappie: jig shot under the deepest docks and let fall until it stops\n### If it's slow\nTry the next creek; winter fish move a lot, so keep looking until you see them on top or on the graph.`;
    if (z.type === 'point' && S === 'herring') return `### Start here\nBe here at first light. Herring and shad spawn on the hard clay or rock edge of the point, and stripers and spotted bass crash them. ${ws >= 5 ? `Start on the side the ${ws} mph wind is blowing into.` : ''}\n### How to work it\nStay off the bank and cast parallel to it, then work the end of the point and any brush in 15 to 35 ft once the sun is up.\n### Baits\n- Topwater: walking bait, popper or wake bait at dawn\n- Subsurface: 1/4 oz ball-head swimbait, underspin or white spinnerbait\n- Live: herring pitched to the point or on a freeline\n- Later: shaky head or drop shot on the brush\n### If it's slow\nTry a red clay point or a marina wall nearby, where the spawn may be later.`;
    if (z.type === 'cove') return `### Start here\n${shallowBite ? 'Work the back half of the cove and any flat pockets; that is where fish are now.' : 'Start at the mouth of the cove where it meets deeper water; fish are not far back this time of year.'}${turnNote}\n### How to work it\nMove slowly and fan-cast the bank, docks and laydowns. ${ws > 12 ? 'Fish the windy side first.' : 'Keep casts long in calm water.'}\n### Baits\n- Shallow: weightless soft plastic, squarebill crankbait, or a spinnerbait\n- Crappie: small jig or minnow around brush and dock posts\n- ${low ? 'Low light: topwater walking bait or buzzbait' : 'Bright sun: shaky head or wacky rig in the shade'}\n### If it's slow\nBack out toward the mouth and the first drop, or try the next cove.`;
    if (z.type === 'bridge') return `### Start here\nFish the pilings and riprap where the channel swings under the span.${S === 'herring' ? ' At first light, herring and shad spawn on the pilings and riprap; throw topwater, a swimbait or a fluke tight to them.' : ''}\n### How to work it\nWork the shady side of the pilings, then the riprap corners. ${deep ? 'Fish deep and slow along the channel edge.' : 'Cast to the riprap and pilings and bring baits down the slope.'}\n### Baits\n- Crappie: 1/16 oz jig or live minnow tight to the pilings\n- Bass: crankbait along the riprap, jig on the piling bases\n- Stripers: live herring or a bucktail where bait shows on the graph\n### If it's slow\nTry the other side of the bridge, or move to a nearby point.`;
    if (z.type === 'dock') return `### Start here\nSkip baits under the deepest docks and the slips closest to the channel.${S === 'herring' ? ' At first light, run a spinnerbait, underspin or fluke parallel to the marina walls, where herring spawn.' : ''}\n### How to work it\nFish the shady side and the walkway posts; ten casts a dock, then move.\n### Baits\n- Crappie: small jig skipped under the slips, or a minnow under a float\n- Bass: shaky head or wacky rig skipped into the shade\n- Bream: crickets or worms near the walkways\n### If it's slow\nMove to docks with brush or deeper water under them.`;
    return `### Start here\n${deep ? 'Idle the point and find where it drops into deeper water; fish sit on that break.' : 'Start shallow on the point and work out toward the drop.'} ${ws >= 5 ? `Fish the side the ${ws} mph wind is blowing into.` : ''}\n### How to work it\nPosition off the point and cast up onto it, bringing baits down the slope.\n### Baits by depth\n- Shallow end: crankbait, spinnerbait, ${low ? 'or topwater at low light' : 'or a swimbait'}\n- The break: jig or Carolina rig dragged down the slope\n- Deep: drop shot or spoon ${S==='winter' ? 'right on the bottom' : 'where bait shows on the graph'}\n### If it's slow\nTry the next point, or the secondary points leading into a cove.`;
  }
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
// simple weather under the timeline: one cell per 3 hours of the selected day (icon, temp, wind)
const WX_ICONS = {
  sun:'<circle cx="12" cy="12" r="4.2" fill="#ffd23d" stroke="none"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="#ffd23d"/>',
  moon:'<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" fill="#cfe3ea" stroke="none"/>',
  partly:'<circle cx="9" cy="9" r="3.6" fill="#ffd23d" stroke="none"/><path d="M9 2.8v1.6M2.8 9h1.6M4.6 4.6l1.1 1.1M13.4 4.6l-1.1 1.1" stroke="#ffd23d"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8 19z" fill="#cfd8dc" stroke="none"/>',
  partlyN:'<path d="M14 9.5A4.5 4.5 0 0 1 8.5 4a4.5 4.5 0 1 0 5.5 5.5z" fill="#cfe3ea" stroke="none"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8 19z" fill="#aab8bd" stroke="none"/>',
  cloud:'<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 7 18z" fill="#aab8bd" stroke="none"/>',
  rain:'<path d="M7 14h10a3.6 3.6 0 0 0 0-7.2 5 5 0 0 0-9.6 1.4A2.9 2.9 0 0 0 7 14z" fill="#aab8bd" stroke="none"/><path d="M8.5 16.5l-1 2.5M12.5 16.5l-1 2.5M16.5 16.5l-1 2.5" stroke="#7fd6ee"/>',
  storm:'<path d="M7 13h10a3.6 3.6 0 0 0 0-7.2 5 5 0 0 0-9.6 1.4A2.9 2.9 0 0 0 7 13z" fill="#8a989d" stroke="none"/><path d="M12.5 13.5l-2.5 4h3l-2 4" stroke="#ffd23d" fill="none"/>',
  fog:'<path d="M4 9h16M6 13h12M4 17h16" stroke="#aab8bd"/>'
};
function wxIcon(sf, pop, night){
  const t = (sf||'').toLowerCase();
  const k = /thunder|storm/.test(t) ? 'storm' : (/rain|shower|drizzle/.test(t) || pop >= 50) ? 'rain' : /fog|haze|mist/.test(t) ? 'fog'
    : /mostly cloudy|cloudy|overcast/.test(t) && !/partly|mostly sunny|mostly clear/.test(t) ? 'cloud' : /partly|mostly sunny|mostly clear|few clouds/.test(t) ? (night ? 'partlyN' : 'partly') : (night ? 'moon' : 'sun');
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WX_ICONS[k]}</svg>`;
}
function paintWx(){
  const el = $('wxrow'); if (!el) return;
  if (!COND || COND.noWind){ el.hidden = true; return; }
  const d = HRS[cur].d, cells = [];
  for (let h=1; h<24; h+=3){ const i = hourAt(d, h), w = COND.wx[i], on = Math.floor(HRS[cur].h/3) === Math.floor(h/3);
    if (!w[5]){ cells.push(`<div class="wx${on?' on':''}"><span class="wx-na">—</span></div>`); continue; }
    cells.push(`<div class="wx${on?' on':''}" title="${esc(w[4]||'')}${w[3]?` · ${w[3]}% rain`:''}">${wxIcon(w[4], w[3]||0, COND.hour[i].night)}<b>${w[2]!=null?w[2]+'°':''}</b><span>${card(w[1])} ${w[0]}</span></div>`); }
  el.innerHTML = cells.join(''); el.hidden = false;
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
// one button: "Best time" jumps to the best hour; once you're off the current hour it becomes "Current time" to jump back
const nowIdx = () => clamp(Math.ceil((Date.now()-T0)/3600e3), 0, H-1);
function paintBest(){ const b = $('bestBtn'), atNow = !COND || cur === nowIdx(); b.textContent = atNow ? 'Best time' : 'Current time'; b.setAttribute('aria-label', atNow ? 'Jump to the best time today' : 'Back to the current time'); }
$('bestBtn').onclick = () => { if (!COND) return;
  if (cur !== nowIdx()){ setTime(nowIdx()); return; }
  const vis = sel!=null ? [ZONES[sel]] : visibleZones(); if (vis.length) setTime(bestOfDay(HRS[cur].d, vis).i); };
function setTime(i){ cur = clamp(i,0,H-1); refresh(); }
function dockH(){ return document.querySelector('.dock').offsetHeight || Math.round(innerHeight*.46); }
function selectZone(k){
  sel = k; document.querySelector('.dock').classList.toggle('detail', k!=null); setDock(k!=null ? true : dockOpen); refresh();
  if (k!=null){ const z = ZONES[k], wide = matchMedia('(min-width:900px)').matches, bnds = z.layer.getBounds();
    // fit the spot into the strip of map between the header and the dock; on small phones that strip can be thin,
    // so cap the bottom padding and never zoom out past 13 (spots disappear below 11)
    const H0 = map.getSize().y, topPad = 170, botPad = Math.min(dockH()+20, Math.max(40, H0 - topPad - 140));
    map.fitBounds(bnds, wide ? {paddingTopLeft:[460,170], paddingBottomRight:[60,60], maxZoom:16} : {paddingTopLeft:[40,topPad], paddingBottomRight:[40, botPad], maxZoom:16, animate:false});
    if (map.getZoom() < 13){ map.setZoom(13, {animate:false}); const c = map.latLngToContainerPoint(bnds.getCenter()), want = topPad + Math.max(60, (H0 - topPad - dockH())/2); map.panBy([0, c.y - want], {animate:false}); }
    $('body').scrollTop = 0; }
}

function refresh(){ paintMap(); paintStatus(); paintHead(); paintBody(); paintDays(); paintScrub(); paintWx(); paintBest(); paintTimeLayers(); }

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
$('closeSearch').onclick = () => { openSearch(false); if (typeof planPending !== 'undefined') planPending = false; };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('searchForm').hidden) openSearch(false); });
async function go(text, magicKey){
  $('sugg').hidden = true; $('q').blur();
  try {
    let loc = null, label = text.split(',').slice(0,2).join(',');
    try { const j = await getJSON(`${GEO}/findAddressCandidates?SingleLine=${encodeURIComponent(text)}${magicKey?'&magicKey='+encodeURIComponent(magicKey):''}&f=json&maxLocations=1&searchExtent=${EXT}&countryCode=USA`); const c0 = (j.candidates||[])[0]; if (c0) loc = [c0.location.y, c0.location.x]; } catch(e){}
    if (!loc){ const j = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=1&countrycodes=us&viewbox=${FL.w},${FL.n},${FL.e},${FL.s}&bounded=1`); if (j[0]) { loc = [+j[0].lat, +j[0].lon]; label = j[0].display_name.split(',').slice(0,2).join(','); } }
    if (!loc) return toast('No match in Florida or Georgia. Try a city, lake or landmark name.');
    if (loc[0] < FL.s-.3 || loc[0] > FL.n+.3 || loc[1] < FL.w-.5 || loc[1] > FL.e+.6) return toast('That place is outside Florida and Georgia. Spotcast covers waters in both states.');
    openSearch(false); placeName = label; selectZone(null); map.setView(loc, 13);
  } catch(e){ toast('Search is unavailable right now. Check your connection and try again.'); }
}
map.on('dragstart', () => { placeName = null; });
// ---- my location: blue dot + accuracy ring, kept up to date while the app is open
const ME_ICON = L.divIcon({className:'me-dot', iconSize:[22,22], iconAnchor:[11,11], html:'<i></i><b></b>'});
let me = null, meRing = null, meWatch = null, meLast = null;
function showMe(p){
  const {latitude:la, longitude:ln, accuracy:acc} = p.coords, ll = [la, ln]; meLast = p;
  if (!me){
    meRing = L.circle(ll, {radius:acc||30, pane:'places', color:'#2f8cff', weight:1, opacity:.5, fillColor:'#2f8cff', fillOpacity:.12, interactive:false}).addTo(map);
    me = L.marker(ll, {icon:ME_ICON, pane:'places', zIndexOffset:1000, keyboard:false, title:'My location'}).addTo(map);
    placeTap(me, tok => { const q = meLast.coords, la2 = q.latitude, ln2 = q.longitude;
      showPlace(pcard('My location', `Accurate to about ${Math.max(1, Math.round((q.accuracy||0)*3.28084))} ft`, coordBlock(la2, ln2),
        `<div class="pc-foot"><button type="button" class="pc-btn" id="meShare">Share</button></div>`), me, tok);
      wireCoords($('placeBody'));
      $('meShare').onclick = () => { const txt = `My location\n${fmtDec(la2,ln2)}\n${fmtDDM(la2,ln2)}\nhttps://maps.apple.com/?ll=${la2.toFixed(6)},${ln2.toFixed(6)}`;
        if (navigator.share) navigator.share({title:'My location', text:txt}).catch(()=>{}); else copyText(txt, $('meShare')); }; });
  } else { me.setLatLng(ll); meRing.setLatLng(ll).setRadius(acc||30); }
}
function watchMe(){
  if (meWatch !== null || !navigator.geolocation) return;
  meWatch = navigator.geolocation.watchPosition(showMe, () => {}, {enableHighAccuracy:true, maximumAge:5000, timeout:20000});
}
function stopMe(){ if (meWatch !== null){ navigator.geolocation.clearWatch(meWatch); meWatch = null; } }
// save battery: stop following when the app is in the background, resume when it comes back
document.addEventListener('visibilitychange', () => { if (!me) return; document.visibilityState === 'visible' ? watchMe() : stopMe(); });
function locate(){
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  const go = p => { $('locate').classList.remove('busy'); const {latitude:la, longitude:ln} = p.coords; showMe(p); watchMe();
    if (la < FL.s-.3 || la > FL.n+.3 || ln < FL.w-.5 || ln > FL.e+.6) return toast('You are outside Florida and Georgia. Search a city in either state instead.');
    placeName = 'My location'; selectZone(null); map.setView([la, ln], Math.max(map.getZoom(), 14)); };
  // a fix from the last minute is good enough to center on right away
  if (meLast && Date.now() - meLast.timestamp < 60000) return go(meLast);
  $('locate').classList.add('busy');
  const fail = e => { $('locate').classList.remove('busy'); toast(e && e.code === 1 ? 'Location is off for Spotcast. Turn it on in Settings > Privacy > Location Services.' : 'Could not find your location. Try again.'); };
  navigator.geolocation.getCurrentPosition(go, e => { if (e && e.code === 1) return fail(e);
    // precise fix was slow; take a quicker rough one (the live dot sharpens it after)
    navigator.geolocation.getCurrentPosition(go, fail, {enableHighAccuracy:false, timeout:10000, maximumAge:60000}); },
    {enableHighAccuracy:true, timeout:8000, maximumAge:10000});
  watchMe();
}
// if location was already allowed, show the dot from the start without asking
try { navigator.permissions && navigator.permissions.query({name:'geolocation'}).then(r => { if (r.state === 'granted') watchMe(); }).catch(()=>{}); } catch(e){}
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
// keep the map controls clear of the header and the dock; if there isn't room, drop the +/- buttons (pinch still zooms)
function fitRail(){
  document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px');
  const rail = document.querySelector('.rail'), top = document.querySelector('.top'); if (!rail || !top) return;
  rail.classList.remove('tight');
  const room = $('app').clientHeight - $('dock').offsetHeight - top.getBoundingClientRect().bottom - 24;
  if (rail.offsetHeight > room) rail.classList.add('tight');
}
new ResizeObserver(fitRail).observe($('dock')); new ResizeObserver(fitRail).observe($('app'));
addEventListener('resize', fitHeight); addEventListener('orientationchange', () => setTimeout(fitHeight, 300)); fitHeight();

// ---------------- crash notes
// iPhone Safari reloads the page with "A problem repeatedly occurred" when it runs out of memory. Spotcast keeps a small
// note of what was on screen; if the last session ended without the page closing normally, it offers to copy that note.
const CRUMB = 'sc-crumb', crumbErrs = [], crumbHist = []; let crumbPrev = null;
try { crumbPrev = JSON.parse(localStorage.getItem(CRUMB) || 'null'); } catch(e){}
function crumb(alive = true){
  try { const ok = map._loaded, c = ok ? map.getCenter() : null;
    if (ok){ const z = map.getZoom(), last = crumbHist[crumbHist.length-1]; if (!last || last[0] !== z) { crumbHist.push([z, Math.round((Date.now()-performance.timeOrigin)/1000)]); if (crumbHist.length > 10) crumbHist.shift(); } }
    localStorage.setItem(CRUMB, JSON.stringify({alive, t:Date.now(), v:typeof SW_V !== 'undefined' ? SW_V : '', z: ok ? map.getZoom() : null, c: c ? [+c.lat.toFixed(3), +c.lng.toFixed(3)] : null,
      base:LS.base, on:OVS.filter(k => LS[k]), zones:ZONES.length, imgs:document.images.length, canv:document.querySelectorAll('canvas').length, sel, hist:crumbHist, errs:crumbErrs.slice(-5),
      mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1e6) : null, up:Math.round((Date.now()-performance.timeOrigin)/1000)}));
  } catch(e){}
}
addEventListener('error', e => { crumbErrs.push(String(e.message||e).slice(0,160)); crumb(); });
addEventListener('unhandledrejection', e => { crumbErrs.push('promise: '+String((e.reason && e.reason.message) || e.reason).slice(0,140)); });
setInterval(() => { if (document.visibilityState === 'visible') crumb(); }, 2500);
map.on('zoomend moveend', () => crumb());
addEventListener('pagehide', () => crumb(false));
document.addEventListener('visibilitychange', () => crumb(document.visibilityState === 'visible'));
function crashNote(){
  const p = crumbPrev; if (!p || !p.alive || Date.now() - p.t > 20*60e3) return;
  const txt = `Spotcast crash note\nwhen: ${new Date(p.t).toLocaleString()}\nzoom ${p.z} at ${p.c}\nbase ${p.base}; layers: ${(p.on||[]).join(', ')}\nspots ${p.zones}, images ${p.imgs}, canvases ${p.canv}, spot open: ${p.sel != null}\nzoom history: ${(p.hist||[]).map(h => h[0]+'@'+h[1]+'s').join(' ')}\nup ${p.up}s${p.errs && p.errs.length ? '\nerrors: '+p.errs.join(' | ') : ''}`;
  $('placeBody').innerHTML = pcard('Spotcast reloaded unexpectedly', 'Safari restarted the page, usually because it ran out of memory.',
    `<pre class="crash-pre">${esc(txt)}</pre>`, `<div class="pc-foot"><button type="button" class="pc-btn" id="crashCopy">Copy details</button></div><div class="pc-note">Paste this to whoever is fixing Spotcast. It shows what was on screen, nothing personal.</div>`);
  $('placeCard').hidden = false; $('app').classList.add('pop-open');
  $('crashCopy').onclick = () => copyText(txt, $('crashCopy'));
}

// ---------------- boot
(async function boot(){
  window.__scBoot = true;
  // block page zoom from pinches and double-taps on the panels (iOS ignores user-scalable=no); the map's own pinch zoom is untouched
  ['gesturestart','gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), {passive:false}));
  // (double-tap zoom on the panels is already off via touch-action:manipulation, so quick repeated taps still register)
  // where supported (Android home-screen app), lock to portrait
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(()=>{}); } catch(e){}
  // when a new version takes over, reload once so it shows right away
  if (navigator.serviceWorker && navigator.serviceWorker.controller){ let done = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!done){ done = true; location.reload(); } }); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(()=>{}); });
  crashNote(); crumb();
  try { STATIONS = await getJSON('stations.json'); } catch(e){}
  await GA_READY;
  const v = store.get('sz3-view', null) || (store.get('sz2-place', null) ? Object.assign({z:13}, store.get('sz2-place')) : {lat:27.632, lng:-82.72, z:13, name:'Fort De Soto, FL'});
  placeName = v.name || null;
  map.setView([v.lat, v.lng], Math.max(11, v.z || 13));
  onMove();
})();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => r.update()).catch(()=>{}));
