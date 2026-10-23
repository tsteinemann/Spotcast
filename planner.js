'use strict';
// =====================================================================
// Trip planner: pick days up to a week out for the place on the map; each day gets
// the weather (wind, rain), tides, sun and moon, and a rough game plan built from the
// same hourly spot ratings the map uses, adjusted for rain.
// =====================================================================
let planDays = new Set([0]), planPending = false;

function openPlanner(){
  $('planner').hidden = false; $('app').classList.add('planner-open');
  paintPlanner(); setTimeout(() => $('plannerClose').focus(), 30);
}
function closePlanner(){ $('planner').hidden = true; $('app').classList.remove('planner-open'); }

function planZones(){
  if (!COND) return [];
  const c = map.getCenter(), ll = [c.lat, c.lng];
  return ZONES.filter(z => SHOW.has(z.type) && distKm(ll, z.c) <= 12);
}
function paintPlanner(){
  const c = map.getCenter(), where = placeName || ('Near ' + nearName([c.lat, c.lng]));
  $('planWhere').textContent = where;
  if (!DAYS.length){ $('planDays').innerHTML = ''; return; }
  $('planDays').innerHTML = DAYS.map((D,d) => `<button type="button" data-d="${d}" aria-pressed="${planDays.has(d)}"><span>${d===0?'Today':D.wd}</span><b>${D.mo} ${D.dn}</b></button>`).join('');
  $('planDays').querySelectorAll('button').forEach(b => b.onclick = () => { const d = +b.dataset.d; planDays.has(d) ? planDays.delete(d) : planDays.add(d); if (!planDays.size) planDays.add(d); paintPlanner(); });
  $('planBuild').disabled = !COND;
}

// ---- helpers
const rainPen = (pop, sf) => (/thunder/i.test(sf||'') ? 10 : 0) + (pop >= 70 ? 14 : pop >= 50 ? 9 : pop >= 30 ? 4 : 0);
function tideEvents(d){
  const c = map.getCenter(), st = nearestStation([c.lat, c.lng]), T = st && TIDES.get(st);
  if (!T || !T.ev) return null;
  const a = T0 + DAYS[d].idx[0]*3600e3, b = a + DAYS[d].idx.length*3600e3, ev = T.ev, out = [];
  for (let k=1;k<ev.length-1;k++) if (ev[k].t >= a && ev[k].t < b) out.push({t:ev[k].t, v:ev[k].v, hi: ev[k].v > ev[k-1].v});
  return out;
}
const fmtT = ms => fmtTime(ms).replace(' AM','a').replace(' PM','p');
const firstLine = (txt, head) => { const m = txt.split('\n'), i = m.findIndex(l => l.trim() === '### '+head); return i >= 0 && m[i+1] ? m[i+1].replace(/^[-*]\s*/,'').trim() : ''; };
const firstBullet = txt => (txt.split('\n').find(l => /^\s*-\s/.test(l)) || '').replace(/^\s*-\s*/,'');

function planDay(d, zones){
  const ix = DAYS[d].idx.filter(i => HRS[i].h >= 5 && HRS[i].h <= 20);
  const wx = ix.map(i => COND.wx[i]), known = wx.some(w => w[5]);
  const winds = wx.map(w => w[0]), pops = wx.map(w => w[3] || 0);
  const sfs = wx.map(w => w[4]).filter(Boolean), sfTop = sfs.length ? Object.entries(sfs.reduce((m,s) => (m[s]=(m[s]||0)+1, m), {})).sort((a,b)=>b[1]-a[1])[0][0] : '';
  const thunder = sfs.some(s => /thunder/i.test(s));
  // best spot each hour, after rain penalty
  const hourly = ix.map(i => { let best = null; for (const z of zones){ const s = score(z.k, i); if (!best || s.total > best.s.total) best = {z, s}; }
    const w = COND.wx[i], adj = best ? best.s.total - rainPen(w[3]||0, w[4]) : 0; return {i, best, adj}; });
  if (!hourly.length || !hourly.some(h => h.best)) return {d, known, empty:true};
  const pick = (exclude) => { let top = null; for (const h of hourly) if (h.best && !exclude(h.i) && (!top || h.adj > top.adj)) top = h; if (!top) return null;
    let a = top.i, b = top.i; const ok = i => { const h = hourly.find(x => x.i === i); return h && !exclude(i) && h.adj >= top.adj - 5; };
    while (ok(a-1)) a--; while (ok(b+1)) b++; return {...top, from:a, to:b}; };
  const w1 = pick(() => false), w2 = w1 && pick(i => i >= w1.from - 2 && i <= w1.to + 2);
  const windMax = Math.max(...winds), popMax = Math.max(...pops);
  let verdict = w1.adj >= 75 ? ['great','Good day'] : w1.adj >= 60 ? ['good','Fishable'] : ['fair','Tough day'];
  if (windMax >= 22 || (thunder && popMax >= 50)) verdict = ['hot','Rough day'];
  const sr = COND.hour[DAYS[d].idx[12] ?? DAYS[d].idx[0]], majors = [...new Set(DAYS[d].idx.map(i => COND.hour[i].mjAt).filter(x => DAYS[d].idx.includes(Math.floor(x))))];
  return {d, known, w1, w2, windMin:Math.min(...winds), windMax, wd:wx[Math.floor(wx.length/2)][1], popMax, sfTop, thunder, verdict, sr:sr.sr, ss:sr.ss, majors, tides:tideEvents(d)};
}
function windowHtml(w, label){
  const z = w.best.z, s = score(z.k, w.i), txt = gamePlan(z, s, w.i);
  const how = firstLine(txt, 'Start here'), lure = firstBullet(txt);
  return `<div class="pw"><div class="pw-h"><span class="eyebrow">${label}</span><b>${hourLabel(w.from)}–${hourLabel(w.to+1)}</b><span class="pill t-${s.tier[1]}">${s.tier[2]}</span></div>
    <div class="pw-spot">${esc(z.name)} <span class="kind">· ${z.label}</span></div>
    <div class="pw-line"><span>Fish for</span>${esc(z.species.slice(0,3).join(', '))}</div>
    ${how?`<div class="pw-line"><span>How</span>${esc(how)}</div>`:''}${lure?`<div class="pw-line"><span>Bait</span>${esc(lure)}</div>`:''}
    <button type="button" class="pw-go" data-k="${z.k}" data-i="${w.i}">Show on map</button></div>`;
}
function dayHtml(p){
  const D = DAYS[p.d], head = `<div class="pd-h"><b>${p.d===0?'Today':D.wd}, ${D.mo} ${D.dn}</b>${p.empty?'':`<span class="pill t-${p.verdict[0]}">${p.verdict[1]}</span>`}</div>`;
  if (p.empty) return `<section class="pd">${head}<p class="note">No spots loaded near here yet. Zoom in on the water and try again.</p></section>`;
  const tides = p.tides && p.tides.length ? p.tides.map(t => `${t.hi?'High':'Low'} ${fmtT(t.t)}`).join(' · ') : 'No tide station nearby';
  const wind = p.known ? `${card(p.wd)} ${p.windMin===p.windMax?p.windMax:p.windMin+'–'+p.windMax} mph` : 'Forecast not out yet';
  const rain = p.known ? `${p.popMax}%${p.thunder?' · storms possible':''}` : '—';
  return `<section class="pd">${head}
    <dl class="pd-c"><dt>Wind</dt><dd>${wind}</dd><dt>Rain</dt><dd>${rain}</dd>${p.known&&p.sfTop?`<dt>Sky</dt><dd>${esc(p.sfTop)}</dd>`:''}
      <dt>Tides</dt><dd>${tides}</dd><dt>Sun</dt><dd>Up ${fmtT(T0+p.sr*3600e3)} · Down ${fmtT(T0+p.ss*3600e3)}</dd>${p.majors.length?`<dt>Feeding</dt><dd>Moon overhead/underfoot ${p.majors.map(x=>fmtT(T0+x*3600e3)).join(', ')}</dd>`:''}</dl>
    ${p.known?'':'<p class="note">Wind and rain for this day are not in the forecast yet, so this plan leans on tides, moon and light. Check back closer to the date.</p>'}
    ${windowHtml(p.w1, 'Best window')}${p.w2?windowHtml(p.w2, 'Also good'):''}</section>`;
}
function planText(plans){
  return `Spotcast trip plan: ${$('planWhere').textContent}\n\n` + plans.map(p => { const D = DAYS[p.d]; if (p.empty) return `${D.wd} ${D.mo} ${D.dn}: no spots loaded`;
    const w = p.w1, z = w.best.z; return `${D.wd} ${D.mo} ${D.dn} (${p.verdict[1]})\nWind ${p.known?card(p.wd)+' '+p.windMin+'-'+p.windMax+' mph, rain '+p.popMax+'%':'not forecast yet'}\nTides: ${(p.tides||[]).map(t => (t.hi?'High ':'Low ')+fmtT(t.t)).join(', ')||'n/a'}\nBest: ${hourLabel(w.from)}-${hourLabel(w.to+1)} at ${z.name} (${z.label}) for ${z.species.slice(0,3).join(', ')}${p.w2?`\nAlso: ${hourLabel(p.w2.from)}-${hourLabel(p.w2.to+1)} at ${p.w2.best.z.name}`:''}`; }).join('\n\n');
}
function buildPlan(){
  const out = $('planOut');
  if (!COND){ out.innerHTML = '<p class="note">Still loading conditions. Try again in a moment.</p>'; return; }
  if (map.getZoom() < 11){ out.innerHTML = '<p class="note">Zoom in on the area you want to fish first, so spots can load.</p>'; return; }
  const zones = planZones();
  if (!zones.length){ out.innerHTML = cellsBusy.size ? '<p class="note">Spots are still loading here. Try again in a few seconds.</p>' : '<p class="note">No mapped spots near here. Move the map to the coast and try again.</p>'; return; }
  const plans = [...planDays].sort((a,b)=>a-b).map(d => planDay(d, zones));
  const ok = plans.filter(p => !p.empty), rank = p => (p.w1 ? p.w1.adj : 0) - (p.verdict[0]==='hot' ? 30 : 0), top = ok.slice().sort((a,b) => rank(b) - rank(a))[0];
  const summary = top && ok.length > 1 ? `<div class="pl-sum"><span class="eyebrow">Best day of your trip</span><b>${top.d===0?'Today':DAYS[top.d].wd+', '+DAYS[top.d].mo+' '+DAYS[top.d].dn} · ${hourLabel(top.w1.from)}–${hourLabel(top.w1.to+1)}</b><span>${esc(top.w1.best.z.name)}</span></div>` : '';
  out.innerHTML = summary + plans.map(dayHtml).join('') + `<div class="pl-foot"><button type="button" class="pc-btn ghost" id="planCopy">Copy plan</button><span class="note">Based on ${zones.length} spots within about 7 miles, NWS forecast and NOAA tides. Weather changes; check again before you go.</span></div>`;
  out.querySelectorAll('.pw-go').forEach(b => b.onclick = () => { closePlanner(); setTime(+b.dataset.i); selectZone(+b.dataset.k); });
  $('planCopy').onclick = () => { const txt = planText(plans);
    if (navigator.share) navigator.share({title:'Spotcast trip plan', text:txt}).catch(()=>{});
    else (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => $('planCopy').textContent = 'Copied', () => toast('Copy is not available here.')); };
  out.scrollIntoView({behavior:'smooth', block:'start'});
}
$('planBtn2').onclick = openPlanner;
$('plannerClose').onclick = closePlanner;
$('planBuild').onclick = buildPlan;
$('planChange').onclick = () => { planPending = true; closePlanner(); openSearch(true); };
// after a search moves the map, come back to the planner once spots have had a moment to load
map.on('moveend', () => { if (!planPending) return; planPending = false; setTimeout(() => { openPlanner(); $('planOut').innerHTML = ''; }, 1800); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('planner').hidden) closePlanner(); });
