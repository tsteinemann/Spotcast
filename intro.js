'use strict';
// =====================================================================
// First-open intro: four screens. Shown once; "Show intro" in the layers menu replays it.
// =====================================================================
const INTRO = [
  { title:'Find where they’re biting', body:'Spotcast maps passes, bridges, drop-offs, flats, mangroves, oyster bars, docks and reefs, then rates each one every hour from live tides, wind, moon and light.',
    art:`<svg viewBox="0 0 280 170" role="img" aria-label="Map with rated fishing spots"><rect width="280" height="170" rx="16" fill="#123a44"/><path d="M0 0h120c-10 30 8 52 -6 80s14 60 -4 90H0z" fill="#2c4a3a"/><path d="M120 0c-10 30 8 52-6 80s14 60-4 90" fill="none" stroke="#e9dea8" stroke-width="3" opacity=".7"/>
      <path d="M150 28l40-8 22 26-18 30-38-6z" fill="#ff5466" fill-opacity=".28" stroke="#ff5466" stroke-width="2"/><path d="M128 120c30-14 60-10 92 6" fill="none" stroke="#ffb547" stroke-width="6" stroke-linecap="round"/>
      <path d="M210 92l30-6 16 22-26 14-22-10z" fill="#7fd6ee" fill-opacity=".25" stroke="#7fd6ee" stroke-width="2"/><circle cx="240" cy="40" r="6" fill="#ff8a3d" stroke="#08161a" stroke-width="2"/>
      <g font-family="Barlow Semi Condensed,Arial Narrow,sans-serif" font-weight="700" font-size="11"><rect x="134" y="142" width="36" height="18" rx="9" fill="#ff5466"/><text x="152" y="155" text-anchor="middle" fill="#0b1a1e">HOT</text><rect x="176" y="142" width="46" height="18" rx="9" fill="#ffb547"/><text x="199" y="155" text-anchor="middle" fill="#0b1a1e">GREAT</text><rect x="228" y="142" width="42" height="18" rx="9" fill="#7fd6ee"/><text x="249" y="155" text-anchor="middle" fill="#0b1a1e">GOOD</text></g></svg>` },
  { title:'Pick your time, get a game plan', body:'Slide the timeline or tap Best time to see when each spot peaks this week. Tap a spot for what to throw and how to work it. Planning ahead? The calendar button builds a trip plan for any days up to a week out.',
    art:`<svg viewBox="0 0 280 170" role="img" aria-label="Hourly timeline and trip plan"><rect width="280" height="170" rx="16" fill="#0f2025"/>
      <g>${[34,28,22,30,44,58,66,60,48,40,52,70,82,74,56,44].map((h,i)=>`<rect x="${18+i*15.5}" y="${110-h}" width="10" height="${h}" rx="2" fill="${h>=70?'#ff5466':h>=56?'#ffb547':h>=40?'#7fd6ee':'#71848b'}"/>`).join('')}</g>
      <path d="M14 86c30-24 60-24 90 0s60 24 90 0 50-20 74-6" fill="none" stroke="#e9f3f1" stroke-width="2" opacity=".85"/><line x1="214" x2="214" y1="22" y2="114" stroke="#62d8c7" stroke-width="2.5"/>
      <rect x="18" y="124" width="244" height="34" rx="10" fill="#162c32"/><rect x="26" y="132" width="18" height="18" rx="4" fill="none" stroke="#62d8c7" stroke-width="2"/><path d="M26 138h18M31 129v6M39 129v6" stroke="#62d8c7" stroke-width="2"/>
      <text x="54" y="145" font-family="Barlow,sans-serif" font-size="12" fill="#e9f3f1">Sat · Best 6–9 AM · Bridge</text><rect x="214" y="132" width="40" height="18" rx="9" fill="#ff5466"/><text x="234" y="145" text-anchor="middle" font-family="Barlow Semi Condensed,sans-serif" font-weight="700" font-size="11" fill="#0b1a1e">HOT</text></svg>` },
  { title:'Make the map yours', body:'Open layers to switch to shaded depth relief or contours, show man-made reefs, natural hard bottom and oyster beds, and choose which kinds of spots appear. Drop-offs start off to keep the map clean.',
    art:`<svg viewBox="0 0 280 170" role="img" aria-label="Map layers"><rect width="280" height="170" rx="16" fill="#0f2025"/>
      <g transform="translate(30 30)"><path d="M70 0l70 30-70 30L0 30z" fill="#26629f"/><path d="M0 52l70 30 70-30" fill="none" stroke="#c48cff" stroke-width="6" stroke-linejoin="round"/><path d="M0 74l70 30 70-30" fill="none" stroke="#62d8c7" stroke-width="6" stroke-linejoin="round"/>
      <circle cx="56" cy="26" r="5" fill="#ff8a3d"/><circle cx="86" cy="34" r="5" fill="#ff8a3d"/><path d="M30 30c20-10 50 14 80 0" fill="none" stroke="#e9f3f1" stroke-width="1.5" opacity=".7"/></g>
      <g font-family="Barlow,sans-serif" font-weight="600" font-size="11"><rect x="186" y="34" width="76" height="22" rx="11" fill="#62d8c7"/><text x="224" y="49" text-anchor="middle" fill="#06211d">Relief</text><rect x="186" y="62" width="76" height="22" rx="11" fill="#62d8c7"/><text x="224" y="77" text-anchor="middle" fill="#06211d">Reefs</text>
      <rect x="186" y="90" width="76" height="22" rx="11" fill="none" stroke="#24414a"/><text x="224" y="105" text-anchor="middle" fill="#93aeab">Drop-offs</text><rect x="186" y="118" width="76" height="22" rx="11" fill="#62d8c7"/><text x="224" y="133" text-anchor="middle" fill="#06211d">Flats</text></g></svg>` },
  { title:'Launch and fuel up', body:'Public boat ramps and public fuel docks are on the map. Tap one for hours, fees, lanes and parking, or phone and VHF, plus one-tap directions.',
    art:`<svg viewBox="0 0 280 170" role="img" aria-label="Boat ramps and fuel docks"><rect width="280" height="170" rx="16" fill="#123a44"/><path d="M0 110c40-10 70 6 110-4s60-26 100-20 50 10 70 6V170H0z" fill="#2c4a3a"/>
      <g><circle cx="70" cy="98" r="15" fill="#1d6e8c" stroke="#fff" stroke-width="2.5"/><path d="M60 104l20-8M64 101l2.5-5h7l2 2.3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></g>
      <g><circle cx="150" cy="84" r="15" fill="#fff" stroke="#0b1f24" stroke-width="2.5"/><path d="M144 93V77a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M144 82h10M154 80h2a2 2 0 0 1 2 2v6" stroke="#0b1f24" stroke-width="2" fill="none" stroke-linecap="round"/></g>
      <rect x="176" y="18" width="92" height="74" rx="10" fill="#0f2025" stroke="#24414a"/><text x="186" y="36" font-family="Barlow Semi Condensed,sans-serif" font-weight="700" font-size="12" fill="#e9f3f1">City Marina</text>
      <text x="186" y="52" font-family="Barlow,sans-serif" font-size="10" fill="#93aeab">Gas + Diesel</text><text x="186" y="66" font-family="Barlow,sans-serif" font-size="10" fill="#93aeab">VHF Ch 16 · 7a–6p</text><rect x="186" y="73" width="52" height="13" rx="6" fill="#62d8c7"/><text x="212" y="83" text-anchor="middle" font-family="Barlow,sans-serif" font-weight="700" font-size="8.5" fill="#06211d">Directions</text></svg>` }
];
let introAt = 0;
function showIntro(){
  const el = $('intro'); el.hidden = false; introAt = 0; paintIntro();
}
function endIntro(){ $('intro').hidden = true; store.set('sz3-intro-seen', true); }
function paintIntro(){
  const s = INTRO[introAt], last = introAt === INTRO.length-1;
  $('introSlide').innerHTML = `<div class="in-art">${s.art}</div><h2 id="introTitle">${s.title}</h2><p>${s.body}</p>`;
  $('introSlide').classList.remove('in-anim'); void $('introSlide').offsetWidth; $('introSlide').classList.add('in-anim');
  $('introDots').innerHTML = INTRO.map((_,i) => `<i class="${i===introAt?'on':''}"></i>`).join('');
  $('introNext').textContent = last ? 'Start fishing' : 'Next'; $('introSkip').style.visibility = last ? 'hidden' : 'visible';
}
$('introNext').onclick = () => { if (introAt < INTRO.length-1){ introAt++; paintIntro(); } else endIntro(); };
$('introSkip').onclick = endIntro;
$('introAgain').onclick = () => { $('layersPanel').hidden = true; showIntro(); };
(function(){ // swipe between screens
  const el = $('introSlide'); let x0 = null;
  el.addEventListener('touchstart', e => x0 = e.touches[0].clientX, {passive:true});
  el.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -40 && introAt < INTRO.length-1){ introAt++; paintIntro(); } else if (dx > 40 && introAt > 0){ introAt--; paintIntro(); } }, {passive:true});
})();
addEventListener('keydown', e => { if ($('intro').hidden) return; if (e.key === 'ArrowRight') $('introNext').click(); else if (e.key === 'ArrowLeft' && introAt > 0){ introAt--; paintIntro(); } else if (e.key === 'Escape') endIntro(); });
if (!store.get('sz3-intro-seen', false)) showIntro();
