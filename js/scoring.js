// scoring.js
// Scoringsmotor: omsætter vejr + artsviden til en odds-procent pr. (art, lokation, dag).
// Odds er et RELATIVT indeks (0-100 %), ikke en bogstavelig sandsynlighed – det rangerer
// hvor gode forholdene er ift. artens idealforhold.

import { SPECIES } from "./species.js";
import { pocketForDate } from "./config.js";

// ---------- små hjælpere ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hourOf = (iso) => Number(iso.slice(11, 13));
const dayOf = (iso) => iso.slice(0, 10);

function avg(points, key) {
  const vals = points.map((p) => p[key]).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Minutter siden midnat for en ISO-tid.
const minutesOf = (iso) => hourOf(iso) * 60 + Number(iso.slice(14, 16));

// ---------- lys (dag/skumring/mørke) ----------
// Returnerer for en time: {daylight, lowlight, crep} faktorer i [0..1].
//   daylight  : højt i dagslys (synsjægere som hornfisk)
//   lowlight  : højt i mørke/skumring (torsk, havørred, gedde)
//   crep      : crepuskulær – topper i skumring, ok i dagslys, lav i mørke (aborre)
function lightFactors(iso, sun) {
  const day = dayOf(iso);
  const s = sun[day];
  if (!s || !s.sunrise || !s.sunset) return { daylight: 0.7, lowlight: 0.4, crep: 0.6 };
  const m = minutesOf(iso) + 30; // midt i timen
  const sr = minutesOf(s.sunrise);
  const ss = minutesOf(s.sunset);
  const tw = 75; // skumringsvindue i minutter

  if (m < sr - tw || m > ss + tw) return { daylight: 0.0, lowlight: 1.0, crep: 0.35 }; // mørke
  if (Math.abs(m - sr) <= tw || Math.abs(m - ss) <= tw) return { daylight: 0.5, lowlight: 0.85, crep: 1.0 }; // skumring
  return { daylight: 1.0, lowlight: 0.1, crep: 0.6 }; // dagslys
}

// ---------- måne (svagt signal, gratis closed-form – ingen dependency/API) ----------
// Synodisk måned fra kendt nymåne-epoke. Returnerer fase (0=ny,0.5=fuld) + belysning 0..1.
function moonInfo(date) {
  const synodic = 29.530588853;
  const epochDays = Date.UTC(2000, 0, 6, 18, 14, 0) / 86400000; // kendt nymåne
  const d = date.getTime() / 86400000;
  let phase = (((d - epochDays) % synodic) / synodic);
  if (phase < 0) phase += 1;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { phase, illum };
}

// Lille positiv effekt af fuldmåne for skumrings-/mørke-rovfisk (mest havørred).
// Bevidst lav vægt – evidensen er svag.
function moonScore(species, illum) {
  if (!species.maaneFolsom || illum == null) return null;
  return clamp(0.85 + 0.15 * illum, 0, 1);
}

function timeScore(species, points, sun) {
  if (!points.length) return 0.5;
  const lf = points.map((p) => lightFactors(p.time, sun));
  const mean = (k) => lf.reduce((a, b) => a + b[k], 0) / lf.length;
  const max = (k) => Math.max(...lf.map((b) => b[k]));
  // Bug-fix: for skumrings-/mørkearter tæller et PRIME-vindue inde i lommen meget
  // (en lang lys weekend-lomme med én god skumringstime skal ikke udvandes til bunds).
  if (species.timePref === "day") return 0.4 + 0.6 * mean("daylight");
  if (species.timePref === "lowlight") return 0.35 + 0.65 * (0.5 * mean("lowlight") + 0.5 * max("lowlight"));
  if (species.timePref === "crepuscular") return 0.35 + 0.65 * (0.5 * mean("crep") + 0.5 * max("crep"));
  return 0.8; // any
}

// ---------- vejr-delscorer ----------
function rangeScore(value, lo, hi, hardMax) {
  if (value === null) return null;
  if (value >= lo && value <= hi) return 1;
  if (value < lo) return clamp(1 - (lo - value) / Math.max(lo, 1) * 0.3, 0.7, 1); // lidt for stille
  // over ideal: aftag mod hardMax
  if (value <= hardMax) return clamp(1 - (value - hi) / Math.max(hardMax - hi, 1) * 0.75, 0.25, 1);
  return 0.12; // over hård grænse
}

function windScore(species, points) {
  const w = avg(points, "wind");
  if (w === null) return 0.7;
  const [lo, hi] = species.windIdeal;
  let s = rangeScore(w, lo, hi, species.windMax) ?? 0.7;

  // Bug-fix: blikstille er en showstopper for vindkrævende arter (havørred, torsk).
  if (species.vindKraevende && w < 2) s = Math.min(s, 0.35 + 0.25 * (w / 2));

  // Vindstød-straf (gust hentes – nu i brug): kraftige stød gør det svært/utrygt.
  const g = avg(points, "gust");
  if (g !== null && g > species.windMax) {
    s *= clamp(1 - ((g - species.windMax) / species.windMax) * 0.5, 0.55, 1);
  }
  return clamp(s, 0.1, 1);
}

// På-/fralandsvind: kun for arter med windDirPref="onshore" på åbne (ikke-skærmede) marine spots.
// Pålandsvind farver vandet og presser føde ind mod kysten – især godt for havørred.
function onshoreScore(species, points, loc) {
  if (species.windDirPref !== "onshore") return null;
  if (!loc.marint || loc.laeOmraade || loc.kystRetning == null) return null;
  const meanWind = avg(points, "wind");
  if (meanWind === null) return null;
  // cirkulært gennemsnit af vindretning
  let sx = 0, sy = 0, n = 0;
  for (const p of points) {
    if (p.windDir == null) continue;
    const r = (p.windDir * Math.PI) / 180;
    sx += Math.cos(r); sy += Math.sin(r); n++;
  }
  if (!n) return null;
  const meanDir = (Math.atan2(sy, sx) * 180) / Math.PI;
  const diff = ((meanDir - loc.kystRetning + 540) % 360) - 180; // -180..180
  const onshore = Math.cos((diff * Math.PI) / 180); // +1 fuldt pålands, -1 fralands
  const dirScore = 0.4 + 0.6 * ((onshore + 1) / 2); // 0.4 (fralands) .. 1.0 (pålands)
  const windFactor = clamp(meanWind / 5, 0, 1); // retning betyder kun noget med lidt vind
  return clamp(0.8 * (1 - windFactor) + dirScore * windFactor, 0.4, 1);
}

// Strøm ("gang i vandet") – kun marint, og kun arter hvor det betyder noget.
function currentScore(species, points, marint) {
  if (!marint || species.currentPref === "any" || !species.currentPref) return null;
  const c = avg(points, "current"); // m/s
  if (c === null) return 0.8;
  if (species.currentPref === "some") {
    if (c <= 0.4) return clamp(0.55 + (c / 0.4) * 0.45, 0.55, 1); // slack=mindre godt, op til ideal
    return clamp(1 - ((c - 0.4) / 0.8) * 0.4, 0.6, 1);            // meget strøm=lidt sværere
  }
  if (species.currentPref === "calm") return clamp(1 - c / 0.8, 0.4, 1);
  return 0.8;
}

function cloudScore(species, points) {
  const c = avg(points, "cloud");
  if (c === null) return 0.8;
  const frac = c / 100;
  if (species.cloudPref === "low") return 0.3 + 0.7 * (1 - frac);
  if (species.cloudPref === "high") return 0.3 + 0.7 * frac;
  return 0.85;
}

// Bug-fix: atmosfærisk sigtbarhed siger intet om VANDklarhed. I stedet estimeres
// vandets uklarhed (turbiditet 0..1) ud fra nylig vind, bølger og nedbør i timerne op til lommen.
function turbidity(precedingPoints, points, marint) {
  const all = [...precedingPoints, ...points];
  const recentWind = avg(all, "wind");
  const recentWave = marint ? avg(all, "wave") : null;
  const rainSum = all.map((p) => p.precip).filter((v) => v != null).reduce((a, b) => a + b, 0);
  const murkWind = recentWind == null ? 0 : clamp((recentWind - 5) / 10, 0, 1); // >15 m/s = helt uklart
  const murkWave = recentWave == null ? 0 : clamp(recentWave / 1.2, 0, 1);
  const murkRain = clamp(rainSum / 8, 0, 1);
  return clamp(0.45 * murkWind + 0.35 * murkWave + 0.35 * murkRain, 0, 1);
}

function turbidityScore(species, murk) {
  const sens = species.claritySensitivity ?? 0.4;
  if (species.turbidPref === "clear") return clamp(1 - sens * murk, 0.3, 1);
  if (species.turbidPref === "coloured") return clamp(1 - sens * Math.abs(murk - 0.45) * 1.4, 0.4, 1); // lidt farve er godt
  return 0.85; // any
}

function precipScore(points) {
  const p = avg(points, "precip");
  if (p === null) return 1;
  return clamp(1 - p * 0.09, 0.4, 1);
}

// Hård vejr-gate (vejrkode – nu i brug): torden/skybrud/sne lukker fiskeriet (og er utrygt).
// Returnerer en multiplikator 0..1 (værste time i lommen tæller).
function severeWeatherGate(points) {
  let gate = 1;
  for (const p of points) {
    const c = p.weatherCode;
    if (c == null) continue;
    let g = 1;
    if (c >= 95) g = 0.3;                 // torden
    else if (c >= 82) g = 0.65;           // voldsomme byger
    else if (c >= 71 && c <= 77) g = 0.7; // sne
    else if (c >= 85 && c <= 86) g = 0.6; // snebyger
    else if (c === 65 || c === 67) g = 0.8; // kraftig regn
    gate = Math.min(gate, g);
  }
  return gate;
}

// Lufttryk: gælder nu ALLE arter, skaleret efter trykFolsomhed (aborre/gedde mest).
// Bug-fix: trend måles over et FAST ~6-timers baglæns vindue (preceding), uafhængigt af
// lommens længde; ved for lidt historik returneres neutralt.
function pressureScore(species, points, precedingPoints) {
  const sens = species.trykFolsomhed ?? 0.4;
  const hist = precedingPoints.map((p) => p.pressure).filter((v) => v != null);
  const now = points.map((p) => p.pressure).filter((v) => v != null);
  if (!now.length || hist.length < 3) return 0.8; // for lidt historik -> neutral

  // stabilitet over det faste vindue
  const window = [...hist, now[0]];
  const spread = Math.max(...window) - Math.min(...window);
  const stability = clamp(1 - (spread - 3) / 9, 0.4, 1);

  // ~6t trend: tryk ved lommestart minus tryk 6 timer før
  const delta = now[0] - hist[0];
  let trend;
  if (delta <= -4) trend = 0.45;        // kraftigt faldende = dårligst
  else if (delta < -1.5) trend = 0.7;   // svagt faldende
  else if (delta <= 1.5) trend = 1.0;   // stabilt = bedst
  else if (delta <= 4) trend = 0.9;     // svagt stigende = godt
  else trend = 0.8;                     // hurtigt stigende = under omstilling

  const meanP = now.reduce((a, b) => a + b, 0) / now.length;
  const highBonus = clamp((meanP - 1008) / 18, 0, 1); // 1008..1026 hPa

  // rå score: tryksyge arter vægter stabilitet+tryk-niveau+trend; øvrige kun mild trend-effekt
  let raw;
  if (species.pressurePref === "stable") raw = 0.4 * stability + 0.25 * highBonus + 0.35 * trend;
  else raw = 0.5 + 0.5 * trend;
  raw = clamp(raw, 0.3, 1);

  // bland mod neutral efter følsomhed (sens=1 -> fuld effekt; lav sens -> næsten neutral)
  return clamp(1 - sens * (1 - raw), 0.3, 1);
}

function waveScore(species, points, marint) {
  if (!marint) return null; // ikke relevant for ferskvand
  const wv = avg(points, "wave");
  if (wv === null) return 0.8;
  switch (species.wavePref) {
    case "calm": return clamp(1 - wv / 1.0, 0.3, 1);
    case "light": return clamp(1 - Math.abs(wv - 0.3) / 0.9, 0.3, 1);
    case "moderate": return clamp(1 - Math.abs(wv - 0.6) / 1.1, 0.3, 1);
    default: return 0.85;
  }
}

// Vandstand: lille bonus for STIGENDE vand (skyller føde ind over lavt vand/udløb).
// Svagt signal i det næsten tidevandsløse Øresund -> lav vægt. Kun for arter med vandstandPref.
function seaLevelScore(species, points) {
  if (species.vandstandPref !== "rising") return null;
  const lv = points.map((p) => p.seaLevel).filter((v) => v != null);
  if (lv.length < 2) return null;
  const delta = lv[lv.length - 1] - lv[0]; // m over lommen
  if (delta > 0.05) return 1.0;   // tydeligt stigende
  if (delta > 0.01) return 0.9;   // svagt stigende
  if (delta >= -0.01) return 0.8; // stabilt
  if (delta >= -0.05) return 0.65; // svagt faldende
  return 0.55;                    // tydeligt faldende
}

function waterTempScore(species, waterTemp) {
  if (!species.waterTempIdeal) return null;
  if (waterTemp === null || waterTemp === undefined) return null; // ingen data -> ignorér
  const [lo, hi] = species.waterTempIdeal;
  if (waterTemp >= lo && waterTemp <= hi) return 1;
  const dist = waterTemp < lo ? lo - waterTemp : waterTemp - hi;
  return clamp(1 - dist / 8, 0.25, 1);
}

// ---------- saml ét resultat for (art, lokation, dag) ----------
function scoreSpeciesAtLocation(species, weather, dayKey, pocket, monthIdx, moonIllum) {
  const loc = weather.location;
  // Spot-omdømme (SKØN) bruges KUN til:
  //  (a) medlemskab – findes arten dokumenteret på dette spot? (ellers springes spottet over)
  //  (b) et omdømme-mærkat på pladsen i UI
  // Det indgår BEVIDST IKKE i odds-tallet – odds = kun forhold (sæson × vejr × tid).
  let spotKvalitet;
  if (loc.arter) {
    if (loc.arter[species.id] == null) return null; // ikke dokumenteret på dette spot
    spotKvalitet = loc.arter[species.id];
  } else {
    const typeScore = species.typeScore[loc.type];
    if (typeScore === undefined) return null;
    spotKvalitet = typeScore * (loc.kvalitet ?? 1);
  }

  const season = species.monthWeight[monthIdx] ?? 0;

  // timepunkter i lommen + 6 timer før (til trykberegning)
  const all = weather.hours;
  const firstIdx = all.findIndex((h) => dayOf(h.time) === dayKey && hourOf(h.time) >= pocket.startHour);
  const points = all.filter(
    (h) => dayOf(h.time) === dayKey && hourOf(h.time) >= pocket.startHour && hourOf(h.time) < pocket.endHour
  );
  if (!points.length) return null;
  const preceding = firstIdx > 0 ? all.slice(Math.max(0, firstIdx - 6), firstIdx) : [];
  const marint = weather.location.marint;

  // vandtemp: hav -> målt SST (+ offset for lune/lavvandede havne); sø -> estimat fra lufttemp-historik
  let waterTemp = marint ? avg(points, "seaTemp") : weather.estLakeTemp ?? null;
  if (waterTemp != null && marint && weather.location.tempOffset) waterTemp += weather.location.tempOffset;

  const murk = turbidity(preceding, points, marint); // vandets uklarhed 0..1

  // vandstands-trend over lommen (m) til visning
  const lvPts = points.map((p) => p.seaLevel).filter((v) => v != null);
  const seaLevelDelta = lvPts.length >= 2 ? lvPts[lvPts.length - 1] - lvPts[0] : null;

  // delscorer (null = ikke relevant for denne art/lokation -> udelades af vægtningen)
  const subs = {
    vind: { v: windScore(species, points), w: 0.16 },
    vindretning: { v: onshoreScore(species, points, weather.location), w: 0.08 },
    skydække: { v: cloudScore(species, points), w: 0.08 },
    klarhed: { v: turbidityScore(species, murk), w: 0.10 },
    nedbør: { v: precipScore(points), w: 0.06 },
    lufttryk: { v: pressureScore(species, points, preceding), w: 0.16 },
    bølger: { v: waveScore(species, points, marint), w: 0.09 },
    strøm: { v: currentScore(species, points, marint), w: 0.10 },
    vandstand: { v: seaLevelScore(species, points), w: 0.05 }, // stigende vand, svagt signal
    vandtemp: { v: waterTempScore(species, waterTemp), w: 0.15 },
    måne: { v: moonScore(species, moonIllum), w: 0.05 }, // svagt signal, lav vægt
  };

  let wsum = 0, wtot = 0;
  for (const k in subs) {
    if (subs[k].v === null) continue;
    wsum += subs[k].v * subs[k].w;
    wtot += subs[k].w;
  }
  const weatherComposite = wtot > 0 ? wsum / wtot : 0.7;
  const tScore = timeScore(species, points, weather.sun);
  const gate = severeWeatherGate(points);           // torden/skybrud/sne lukker fiskeriet

  // endelig odds = KUN forhold (sæson × vejr-gate × vejr × tid). Intet spot-skøn.
  const odds = Math.round(
    100 * season * gate * (0.45 + 0.55 * weatherComposite) * (0.5 + 0.5 * tScore)
  );

  // aggregeret vejr til visning
  const agg = {
    temp: avg(points, "temp"),
    wind: avg(points, "wind"),
    gust: avg(points, "gust"),
    pressure: avg(points, "pressure"),
    cloud: avg(points, "cloud"),
    precip: avg(points, "precip"),
    wave: avg(points, "wave"),
    current: avg(points, "current"),
    seaTemp: avg(points, "seaTemp"),
    vandtemp: waterTemp,        // hav (målt+offset) eller sø (estimat)
    vandtempEstimat: !marint,   // true = estimeret søtemp
    windDir: avg(points, "windDir"),
    turbiditet: murk,
    vejrGate: gate,
    moonIllum,
    vandstandTrend: seaLevelDelta, // m over lommen (marint)
  };

  return {
    speciesId: species.id,
    speciesNavn: species.navn,
    farve: species.farve,
    locationId: weather.location.id,
    locationNavn: weather.location.navn,
    locationType: weather.location.type,
    odds: clamp(odds, 0, 100),
    season,
    spotKvalitet,
    weatherComposite,
    timeScore: tScore,
    subs,
    agg,
    note: species.note,
  };
}

// ---------- offentligt API ----------
// Beregn alt for én dag på tværs af arter og lokationer.
// Returnerer { dayKey, ugedag, pocket, perSpecies: [...], all: [...] }
export function scoreDay(allWeather, date) {
  const dayKey = toDayKey(date);
  const pocket = pocketForDate(date);
  const monthIdx = date.getMonth() + 1;
  const moon = moonInfo(date);

  // Adskil rigtige fiskepladser fra reference-lokationer.
  const spots = allWeather.filter((w) => !w.error && !w.location.ref);
  const refKyst = allWeather.find((w) => !w.error && w.location.id === "ref-kyst");
  const refSo = allWeather.find((w) => !w.error && w.location.id === "ref-so");

  // Per-plads-resultater (forhold pr. dokumenteret spot) – til "Bedste pladser"-listen.
  const all = [];
  for (const species of SPECIES) {
    for (const weather of spots) {
      const r = scoreSpeciesAtLocation(species, weather, dayKey, pocket, monthIdx, moon.illum);
      if (r) all.push(r);
    }
  }

  // OVERORDNET art-odds = rene forhold ved reference-habitat (UAFHÆNGIGT af pladser/skøn/grej).
  const perSpecies = [];
  for (const species of SPECIES) {
    const ref = FRESH.has(species.id) ? refSo : refKyst;
    if (!ref) continue;
    const head = scoreSpeciesAtLocation(species, ref, dayKey, pocket, monthIdx, moon.illum);
    if (!head) continue;
    // bedste dokumenterede plads (kun til visnings-hint): sortér på forhold, tie-break omdømme
    const spotList = all
      .filter((r) => r.speciesId === species.id)
      .sort((a, b) => b.odds - a.odds || (b.spotKvalitet ?? 0) - (a.spotKvalitet ?? 0));
    head.bestSpot = spotList[0] ? { navn: spotList[0].locationNavn, odds: spotList[0].odds } : null;
    perSpecies.push(head);
  }
  perSpecies.sort((a, b) => b.odds - a.odds);

  return { dayKey, date, ugedag: ugedagNavn(date), pocket, perSpecies, all };
}

// Ferskvandsarter (overordnet odds beregnes ved sø-reference; resten ved kyst-reference).
const FRESH = new Set(["aborre", "gedde"]);

// Beregn for flere dage (i morgen + frem).
export function scoreUpcoming(allWeather, fromDate, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    out.push(scoreDay(allWeather, d));
  }
  return out;
}

// ---------- dato-hjælp ----------
export function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const UGEDAGE = ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"];
export function ugedagNavn(date) {
  return UGEDAGE[date.getDay()];
}
