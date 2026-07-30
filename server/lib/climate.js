/*
  eGS — Module de données satellite (côté serveur).
  Même source et même logique que assets/satellite.js (NASA POWER), portées ici
  pour permettre le calcul de l'indice de risque sans navigateur, depuis la
  tâche planifiée d'alertes.
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

// Indice de risque simplifié (0-100) — PAS un outil de diagnostic médical.
function riskIndex(series) {
  if (!series.length) return null;
  const avg = key => series.reduce((s, d) => s + d[key], 0) / series.length;
  const temp = avg('temp');
  const humidity = avg('humidity');
  const precipTotal = series.reduce((s, d) => s + d.precip, 0);

  const tempScore = Math.max(0, 100 - Math.abs(temp - 27) * 9);
  const humScore = Math.min(100, Math.max(0, (humidity - 40) * (100 / 50)));
  const precipScore = precipTotal <= 2 ? precipTotal * 15
    : precipTotal <= 40 ? 30 + (precipTotal - 2) * 1.6
    : Math.max(20, 100 - (precipTotal - 40) * 1.2);

  const score = Math.round(tempScore * 0.4 + humScore * 0.35 + Math.min(100, precipScore) * 0.25);
  return { score: Math.max(0, Math.min(100, score)), temp, humidity, precipTotal };
}

module.exports = { CITIES, fetchCityClimate, riskIndex };
