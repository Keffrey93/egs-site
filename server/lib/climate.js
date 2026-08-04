/*
  eGS — Module de données satellite et calcul de risque multi-maladies (côté serveur).
  Source unique de vérité pour les scores de risque, réutilisée par le tableau de
  bord (GET /api/risques), les alertes (lib/notify.js) et le chatbot.

  ⚠️ Ces indices sont des estimations pédagogiques basées sur des heuristiques
  climatiques simples (température, humidité, précipitations issues de NASA
  POWER). ILS NE CONSTITUENT PAS UN OUTIL DE DIAGNOSTIC OU DE SURVEILLANCE
  ÉPIDÉMIOLOGIQUE VALIDÉ — à ne jamais présenter comme tel.
*/
'use strict';

const CITIES = [
  { id: 'libreville',   name: 'Libreville',   province: 'Estuaire',       lat: 0.3901,  lon: 9.4544 },
  { id: 'port-gentil',  name: 'Port-Gentil',  province: 'Ogooué-Maritime', lat: -0.7193, lon: 8.7815 },
  { id: 'franceville',  name: 'Franceville',  province: 'Haut-Ogooué',    lat: -1.6333, lon: 13.5833 },
  { id: 'oyem',         name: 'Oyem',         province: 'Woleu-Ntem',     lat: 1.6,     lon: 11.5667 },
  { id: 'lambarene',    name: 'Lambaréné',    province: 'Moyen-Ogooué',   lat: -0.7,    lon: 10.2167 },
  { id: 'mouila',       name: 'Mouila',       province: 'Ngounié',        lat: -1.8685, lon: 11.0559 },
  { id: 'tchibanga',    name: 'Tchibanga',    province: 'Nyanga',         lat: -2.9333, lon: 11.0 },
  { id: 'makokou',      name: 'Makokou',      province: 'Ogooué-Ivindo',  lat: 0.5667,  lon: 12.8667 },
  { id: 'koulamoutou',  name: 'Koulamoutou',  province: 'Ogooué-Lolo',    lat: -1.1333, lon: 12.4833 },
];

function fmtDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// NASA POWER a un décalage de publication de quelques jours : on vise J-7 à J-20.
function dateRange() {
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 7);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 13);
  return { start: fmtDate(start), end: fmtDate(end) };
}

async function fetchCityClimate(city) {
  const { start, end } = dateRange();
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,RH2M,PRECTOTCORR&community=AG&longitude=${city.lon}&latitude=${city.lat}&start=${start}&end=${end}&format=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('NASA POWER API — réponse ' + res.status);
  const json = await res.json();
  const p = json.properties.parameter;
  const days = Object.keys(p.T2M).sort();
  return days
    .map(d => ({ date: d, temp: p.T2M[d], humidity: p.RH2M[d], precip: p.PRECTOTCORR[d] }))
    .filter(d => d.temp > -900 && d.humidity > -900 && d.precip > -900); // POWER renvoie -999 si absent
}

function summarize(series) {
  const avg = key => series.reduce((s, d) => s + d[key], 0) / series.length;
  return {
    temp: avg('temp'),
    humidity: avg('humidity'),
    precipTotal: series.reduce((s, d) => s + d.precip, 0),
  };
}

// ---------- Fonctions de score génériques (0-100), réutilisées par plusieurs maladies ----------
function tempBell(temp, optimal, spread) {
  return Math.max(0, 100 - Math.abs(temp - optimal) * spread);
}
function humidityLinear(humidity, floor, range) {
  return Math.min(100, Math.max(0, (humidity - floor) * (100 / range)));
}
function humidityInverse(humidity, ceiling, range) {
  return Math.min(100, Math.max(0, (ceiling - humidity) * (100 / range)));
}
// Courbe "gîtes larvaires" : peu de pluie = peu d'eau stagnante, trop de pluie = ça rince/emporte les gîtes.
function precipVector(precipTotal) {
  const score = precipTotal <= 2 ? precipTotal * 15
    : precipTotal <= 40 ? 30 + (precipTotal - 2) * 1.6
    : Math.max(20, 100 - (precipTotal - 40) * 1.2);
  return Math.min(100, score);
}
// Courbe "inondation / contamination de l'eau" : le risque croît avec le cumul de pluie.
function precipFlood(precipTotal) {
  return Math.min(100, precipTotal * 2.2);
}
// Courbe "saison sèche" : le risque croît quand il pleut peu (poussière, promiscuité).
function precipDry(precipTotal) {
  return Math.min(100, Math.max(0, 100 - precipTotal * 3));
}

// ---------- Registre des maladies ----------
// Chaque entrée : label affiché, vecteur/mode de transmission, et compute(avg) -> score 0-100.
const DISEASES = {
  paludisme: {
    label: 'Paludisme',
    vector: 'Moustique Anophèle',
    description: "L'Anophèle se développe entre 20 et 30°C ; l'eau stagnante après la pluie favorise les gîtes larvaires.",
    compute: avg => tempBell(avg.temp, 27, 9) * 0.4 + humidityLinear(avg.humidity, 40, 50) * 0.35 + precipVector(avg.precipTotal) * 0.25,
  },
  dengue: {
    label: 'Dengue',
    vector: 'Moustique Aedes aegypti',
    description: "Aedes aegypti préfère des températures plus chaudes que l'Anophèle et se reproduit dans de petits récipients d'eau, y compris en ville.",
    compute: avg => tempBell(avg.temp, 29, 8) * 0.45 + humidityLinear(avg.humidity, 45, 45) * 0.3 + precipVector(avg.precipTotal) * 0.25,
  },
  chikungunya: {
    label: 'Chikungunya',
    vector: 'Moustique Aedes (même vecteur que la dengue)',
    description: "Même vecteur et donc même dynamique climatique que la dengue.",
    compute: avg => tempBell(avg.temp, 29, 8) * 0.45 + humidityLinear(avg.humidity, 45, 45) * 0.3 + precipVector(avg.precipTotal) * 0.25,
  },
  zika: {
    label: 'Zika',
    vector: 'Moustique Aedes (même vecteur que la dengue)',
    description: "Même vecteur et donc même dynamique climatique que la dengue.",
    compute: avg => tempBell(avg.temp, 29, 8) * 0.45 + humidityLinear(avg.humidity, 45, 45) * 0.3 + precipVector(avg.precipTotal) * 0.25,
  },
  fievre_jaune: {
    label: 'Fièvre jaune',
    vector: 'Moustique Aedes (cycle urbain et sylvatique)',
    description: "Vecteur Aedes également ; le cycle sylvatique (forêt) n'est pas modélisé ici faute de donnée de couvert forestier.",
    compute: avg => tempBell(avg.temp, 28, 8) * 0.4 + humidityLinear(avg.humidity, 45, 45) * 0.3 + precipVector(avg.precipTotal) * 0.3,
  },
  cholera: {
    label: 'Choléra',
    vector: 'Eau et aliments contaminés',
    description: "Le risque suit surtout le cumul de précipitations : fortes pluies et inondations favorisent la contamination des points d'eau.",
    compute: avg => precipFlood(avg.precipTotal) * 0.7 + humidityLinear(avg.humidity, 50, 40) * 0.3,
  },
  typhoide: {
    label: 'Fièvre typhoïde',
    vector: 'Eau et aliments contaminés',
    description: "Même logique que le choléra (eau contaminée), avec une courbe de risque un peu plus progressive.",
    compute: avg => precipFlood(avg.precipTotal) * 0.55 + humidityLinear(avg.humidity, 50, 40) * 0.25 + tempBell(avg.temp, 28, 10) * 0.2,
  },
  diarrhees: {
    label: 'Diarrhées infectieuses',
    vector: 'Eau et aliments contaminés',
    description: "Corrélées aux ruptures d'accès à l'eau potable après de fortes pluies ou inondations.",
    compute: avg => precipFlood(avg.precipTotal) * 0.6 + humidityLinear(avg.humidity, 50, 40) * 0.4,
  },
  meningite: {
    label: 'Méningite à méningocoque',
    vector: 'Transmission respiratoire (gouttelettes)',
    description: "Le risque est classiquement associé à la saison sèche (air sec, poussière, promiscuité) — plus pertinent pour la ceinture sahélienne que pour le climat équatorial du Gabon, généralement humide toute l'année.",
    compute: avg => precipDry(avg.precipTotal) * 0.5 + humidityInverse(avg.humidity, 70, 40) * 0.5,
  },
  trypanosomiase: {
    label: 'Trypanosomiase (maladie du sommeil)',
    vector: 'Mouche tsé-tsé',
    description: "La mouche tsé-tsé affectionne les zones humides et boisées proches des points d'eau ; approximé ici par une humidité élevée et une température modérée.",
    compute: avg => humidityLinear(avg.humidity, 55, 35) * 0.5 + tempBell(avg.temp, 25, 7) * 0.3 + precipVector(avg.precipTotal) * 0.2,
  },
};

// Calcule le score de toutes les maladies à partir d'une même série climatique
// (une seule requête NASA POWER par ville, réutilisée pour toutes les maladies).
function computeAllRisks(series) {
  if (!series.length) return null;
  const avg = summarize(series);
  const scores = {};
  for (const [id, disease] of Object.entries(DISEASES)) {
    const raw = disease.compute(avg);
    scores[id] = {
      id,
      label: disease.label,
      vector: disease.vector,
      score: Math.max(0, Math.min(100, Math.round(raw))),
    };
  }
  return { ...avg, diseases: scores };
}

// Rétrocompatibilité : ancien indice paludisme seul (utilisé nulle part d'autre
// désormais, mais conservé au cas où).
function riskIndex(series) {
  const all = computeAllRisks(series);
  if (!all) return null;
  return { score: all.diseases.paludisme.score, temp: all.temp, humidity: all.humidity, precipTotal: all.precipTotal };
}

module.exports = { CITIES, DISEASES, fetchCityClimate, computeAllRisks, riskIndex };
