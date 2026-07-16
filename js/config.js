// config.js
// Lokationer og tidslommer (de to "lommer" fra opgaven).
// Alt er data-drevet, så du let kan tilføje/justere spots og tider.
//
// arter: { artId: kvalitet 0..1 } – DOKUMENTERET per-art-kvalitet for spottet.
//   Kun arter i denne tabel rangeres for spottet (resten regnes ikke til stede).
//   Kilder: oceankaj.dk, udeogfiske.dk, fishingindenmark.info, lystfiskeri.dk,
//   sportsfiskeren.dk, naturibyen.dk, DTU Aqua/SGAVM, TV2 Kosmopol (nutidstjek 2024-2025).
//
// Lokationstyper (kun til label/onshore/marine-logik):
//   kyst = åben kyst | mole = mole/kaj/havn dybt vand | brak = brakvand/udløb | sø = ferskvand
export const LOCATIONS = [
  // ---------- Kyst / mole / havn (marine) ----------
  {
    id: "amager-strand",
    navn: "Amager Strand (kyst)",
    type: "kyst",
    lat: 55.6557, lon: 12.6519,
    marint: true, kystRetning: 95,
    arter: { havorred: 0.90, hornfisk: 0.85, torsk: 0.50 },
    note: "Stærk havørredkyst (store fisk, tobis sidst på foråret), hornfisk i maj, torsk over stenbund.",
  },
  {
    id: "amager-mole",
    navn: "Kastrup Havn / moler (mole)",
    type: "mole",
    lat: 55.6360, lon: 12.6585,
    marint: true, kystRetning: 100,
    arter: { sild: 0.85, hornfisk: 0.80, makrel: 0.70, havorred: 0.55, torsk: 0.50 },
    note: "Molearme giver fint sildefiskeri om foråret; også hornfisk og makrel.",
  },
  {
    id: "nordhavn",
    navn: "Nordhavn / Orientkaj (mole)",
    type: "mole",
    lat: 55.7080, lon: 12.6000,
    marint: true, kystRetning: 75,
    arter: { hornfisk: 0.95, makrel: 0.90, torsk: 0.80, sild: 0.80, havorred: 0.60 },
    note: "Tippen + dybe bassiner (Orientkaj/Sundkaj/Docken): top hornfisk (tang/varieret bund), makrel og torsk.",
  },
  {
    id: "oceankaj",
    navn: "Oceankaj (Nordhavn, dyb kaj)",
    type: "mole",
    lat: 55.7150, lon: 12.6090,
    marint: true, kystRetning: 80,
    arter: { makrel: 0.95, torsk: 0.85, hornfisk: 0.80, sild: 0.70, havorred: 0.60 },
    note: "Stikker langt ud i Øresund – hurtigt dybt. Top makrel ved spidsen, torsk, hornfisk. (Adgang kan variere.)",
  },
  {
    id: "provestenen",
    navn: "Prøvestenen (havn)",
    type: "brak",
    lat: 55.6790, lon: 12.6280,
    marint: true, laeOmraade: true, tempOffset: 2,
    arter: { hornfisk: 0.95, multe: 0.85, havorred: 0.80, makrel: 0.60, torsk: 0.50 },
    note: "Favorit-hornfiskeplads (tang/varieret bund); lun havn med multe; gode blankfisk-chancer.",
  },
  {
    id: "slusen",
    navn: "Slusen (Sjællandsbroen)",
    type: "brak",
    lat: 55.6360, lon: 12.5430,
    marint: true,
    arter: { havorred: 1.00, hornfisk: 0.80, multe: 0.75, gedde: 0.70, aborre: 0.60 },
    note: "Strøm ved slusen + lunt vand fra værket = havørred året rundt (også vinter). Hornfisk, multe, aborre/gedde.",
  },
  {
    id: "sydhavnen",
    navn: "Sydhavnen (brak/udløb)",
    type: "brak",
    lat: 55.6385, lon: 12.5450,
    marint: true, laeOmraade: true, tempOffset: 1,
    arter: { havorred: 0.80, multe: 0.70, aborre: 0.65, gedde: 0.65, hornfisk: 0.40 },
    note: "Brakvand – gode blankfisk-chancer, multe, aborre/gedde. (Bemærk: havne-forurening rapporteret 2025.)",
  },
  {
    id: "sluseholmen",
    navn: "Sluseholmen (kanaler)",
    type: "brak",
    lat: 55.6345, lon: 12.5380,
    marint: true, laeOmraade: true, tempOffset: 1,
    arter: { aborre: 0.85, gedde: 0.85, havorred: 0.50 },
    note: "Skærmede brakvandskanaler – aborre og gedde (storfanger-plads).",
  },
  {
    id: "sydamager",
    navn: "Sydamager / Kongelunden (kyst)",
    type: "kyst",
    lat: 55.5800, lon: 12.5950,
    marint: true, kystRetning: 110,
    arter: { hornfisk: 0.80, havorred: 0.80 },
    note: "Sydamagers kyst (ålegræs + sten): mange hornfisk i maj, god havørredkyst.",
  },

  // ---------- Ferskvandssøer (nutidstjekket 2024-2025) ----------
  {
    id: "emdrup-so",
    navn: "Emdrup Sø (sø)",
    type: "sø",
    lat: 55.7220, lon: 12.5530,
    marint: false, tempAlpha: 0.25,
    arter: { gedde: 0.90, aborre: 0.55 },
    note: "Kendt for store gedder. Skalle-domineret, så aborre mere moderat.",
  },
  {
    id: "bagsvaerd-so",
    navn: "Bagsværd Sø (sø)",
    type: "sø",
    lat: 55.7600, lon: 12.4580,
    marint: false, tempAlpha: 0.16,
    arter: { gedde: 0.60, aborre: 0.60 },
    note: "Sø ved arbejdspladsen. NB: observation 2024 om at søen måske ikke er klaret nok op endnu – usikker.",
  },
];

// Reference-lokationer: bruges KUN til at beregne artens OVERORDNEDE forhold-odds
// (sæson × vejr × tid) uafhængigt af de konkrete fiskepladser. Vises ikke som spots.
//   ref-kyst = repræsentativt Øresund-punkt (saltvandsarter)
//   ref-so   = repræsentativ sø (ferskvandsarter)
export const REF_LOCATIONS = [
  { id: "ref-kyst", navn: "Øresund (reference)", type: "kyst", lat: 55.690, lon: 12.650, marint: true, kystRetning: 95, ref: true },
  { id: "ref-so",   navn: "Sø (reference)",      type: "sø",   lat: 55.760, lon: 12.458, marint: false, tempAlpha: 0.18, ref: true },
];

// Tidslommer: hverdag 18-22, weekend 12-20.
export const POCKETS = {
  hverdag: { navn: "Hverdag", startHour: 18, endHour: 22 },
  weekend: { navn: "Weekend", startHour: 12, endHour: 20 },
};

// Returnér den relevante lomme for en given dato (lør/søn = weekend).
export function pocketForDate(date) {
  const dag = date.getDay(); // 0 = søn, 6 = lør
  return dag === 0 || dag === 6 ? POCKETS.weekend : POCKETS.hverdag;
}

// Hvor mange dage frem vi henter/viser.
export const FORECAST_DAYS = 7;

export const TIMEZONE = "Europe/Copenhagen";
