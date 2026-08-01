/*
  eGS — Module de données satellite
  Source : NASA POWER (Prediction Of Worldwide Energy Resources), NASA Langley Research Center.
  API publique, gratuite, sans clé — https://power.larc.nasa.gov/docs/services/api/
  Paramètres utilisés : T2M (température à 2m, °C), RH2M (humidité relative à 2m, %),
  PRECTOTCORR (précipitations corrigées, mm/jour). Ces variables sont dérivées de
  réanalyses assimilant des observations satellitaires (dont MODIS, CERES).

  eGS.CITIES : villes gabonaises suivies, avec coordonnées.
  eGS.DISEASES : registre des maladies suivies (voir server/lib/climate.js, même logique).
  eGS.fetchCityClimate(city) : renvoie les 14 derniers jours disponibles.
  eGS.riskIndexFor(diseaseId, series) : indice de risque simplifié (0-100) pour une maladie, à visée pédagogique.
  eGS.riskIndex(series) : alias rétrocompatible, équivaut à riskIndexFor('paludisme', series).
*/
window.eGS = window.eGS || {};

eGS.CITIES = [
  { id:'libreville',  name:'Libreville',province:'Estuaire',    lat:0.3901, lon:9.4544 },
  { id:'port-gentil', name:'Port-Gentil',province:'Ogooué-Maritime',lat:-0.7193,lon:8.7815 },
  { id:'franceville', name:'Franceville',province:'Haut-Ogooué', lat:-1.6333,lon:13.5833 },
  { id:'oyem',        name:'Oyem',      province:'Woleu-Ntem',  lat:1.6,    lon:11.5667 },
  { id:'lambarene',   name:'Lambaréné', province:'Moyen-Ogooué',lat:-0.7,   lon:10.2167 },
  { id:'mouila',      name:'Mouila',    province:'Ngounié',     lat:-1.8685,lon:11.0559 },
  { id:'tchibanga',   name:'Tchibanga', province:'Nyanga',      lat:-2.9333,lon:11.0 },
  { id:'makokou',     name:'Makokou',   province:'Ogooué-Ivindo',lat:0.5667, lon:12.8667 },
  { id:'koulamoutou', name:'Koulamoutou',province:'Ogooué-Lolo', lat:-1.1333,lon:12.4833 },
];

// Registre des maladies suivies — mêmes variables NASA POWER, profils de
// sensibilité différents selon le mode de transmission :
//  - "vecteur"  : moustiques (Anophèle pour le paludisme, Aedes pour les autres)
//  - "hydrique" : liée aux précipitations/inondations et à la qualité de l'eau
//  - "autre"    : lien climatique plus indirect (saison sèche, végétation)
// ⚠️ Modèles simplifiés à visée pédagogique/exploratoire — pas des outils de
// diagnostic ni de surveillance épidémiologique certifiée.
eGS.DISEASES = [
  { id:'paludisme', name:'Paludisme', category:'vecteur',
    vector:'Moustique Anophèle',
    short:"Piqûre de moustique femelle Anophèle ; gîtes larvaires en eaux stagnantes.",
    tempOptimal:27, tempSensitivity:9,
    humidityDirection:'high', humidityRef:40, humidityFactor:100/50,
    precipProfile:'moderate',
    wTemp:0.40, wHum:0.35, wPrecip:0.25 },
  { id:'dengue', name:'Dengue', category:'vecteur',
    vector:'Moustique Aedes aegypti',
    short:'Gîtes larvaires domestiques : pneus, réservoirs, gouttières, eaux stagnantes.',
    tempOptimal:29, tempSensitivity:8,
    humidityDirection:'high', humidityRef:45, humidityFactor:100/45,
    precipProfile:'moderate',
    wTemp:0.45, wHum:0.30, wPrecip:0.25 },
  { id:'chikungunya', name:'Chikungunya', category:'vecteur',
    vector:'Moustique Aedes',
    short:'Même vecteur et dynamique climatique que la dengue.',
    tempOptimal:29, tempSensitivity:8,
    humidityDirection:'high', humidityRef:45, humidityFactor:100/45,
    precipProfile:'moderate',
    wTemp:0.45, wHum:0.30, wPrecip:0.25 },
  { id:'zika', name:'Zika', category:'vecteur',
    vector:'Moustique Aedes',
    short:'Même famille de vecteurs que la dengue et le chikungunya.',
    tempOptimal:29, tempSensitivity:8,
    humidityDirection:'high', humidityRef:45, humidityFactor:100/45,
    precipProfile:'moderate',
    wTemp:0.45, wHum:0.30, wPrecip:0.25 },
  { id:'fievre-jaune', name:'Fièvre jaune', category:'vecteur',
    vector:'Moustique Aedes (cycle sylvatique)',
    short:'Présente au Gabon ; cycle de transmission lié au couvert forestier.',
    tempOptimal:28, tempSensitivity:8,
    humidityDirection:'high', humidityRef:55, humidityFactor:100/45,
    precipProfile:'moderate',
    wTemp:0.40, wHum:0.35, wPrecip:0.25 },
  { id:'cholera', name:'Choléra', category:'hydrique',
    vector:"Eau/aliments contaminés",
    short:"Pics après fortes pluies et inondations, contamination des points d'eau.",
    tempOptimal:29, tempSensitivity:5,
    humidityDirection:'high', humidityRef:50, humidityFactor:100/50,
    precipProfile:'flood', precipFactor:1.1,
    wTemp:0.15, wHum:0.15, wPrecip:0.70 },
  { id:'typhoide', name:'Fièvre typhoïde', category:'hydrique',
    vector:"Eau/aliments contaminés",
    short:"Logique saisonnière proche du choléra, liée à l'eau contaminée.",
    tempOptimal:28, tempSensitivity:5,
    humidityDirection:'high', humidityRef:50, humidityFactor:100/50,
    precipProfile:'flood', precipFactor:1.0,
    wTemp:0.15, wHum:0.15, wPrecip:0.70 },
  { id:'diarrhees', name:'Diarrhées infectieuses', category:'hydrique',
    vector:"Rupture d'accès à l'eau potable",
    short:"Corrélées aux ruptures d'accès à l'eau potable après intempéries.",
    tempOptimal:28, tempSensitivity:4,
    humidityDirection:'high', humidityRef:50, humidityFactor:100/55,
    precipProfile:'flood', precipFactor:1.0,
    wTemp:0.10, wHum:0.15, wPrecip:0.75 },
  { id:'meningite', name:'Méningite à méningocoque', category:'autre',
    vector:"Diffusion aérienne (favorisée par l'air sec et poussiéreux)",
    short:"Lien climatique indirect à la saison sèche ; moins typique au Gabon que dans la ceinture sahélienne.",
    tempOptimal:32, tempSensitivity:6,
    humidityDirection:'low', humidityRef:55, humidityFactor:100/45,
    precipProfile:'low', precipFactor:2.5,
    wTemp:0.30, wHum:0.40, wPrecip:0.30 },
  { id:'trypanosomiase', name:'Trypanosomiase (maladie du sommeil)', category:'autre',
    vector:'Mouche tsé-tsé',
    short:"Sensible à la végétation et à l'humidité — pertinent pour une future intégration Sentinel-2.",
    tempOptimal:26, tempSensitivity:7,
    humidityDirection:'high', humidityRef:55, humidityFactor:100/40,
    precipProfile:'moderate',
    wTemp:0.35, wHum:0.40, wPrecip:0.25 },
];

eGS.DISEASE_CATEGORY_LABELS = {
  vecteur: 'Maladie à vecteur (moustique)',
  hydrique: 'Maladie hydrique',
  autre: 'Lien climatique indirect',
};

eGS.getDisease = function(id){
  return eGS.DISEASES.find(d => d.id === id) || eGS.DISEASES[0];
};

function fmtDate(d){
  return d.toISOString().slice(0,10).replace(/-/g,'');
}

// NASA POWER a un décalage de publication de quelques jours : on vise J-7 à J-20.
function dateRange(){
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 7);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 13);
  return { start: fmtDate(start), end: fmtDate(end) };
}

eGS.fetchCityClimate = async function(city){
  const { start, end } = dateRange();
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,RH2M,PRECTOTCORR&community=AG&longitude=${city.lon}&latitude=${city.lat}&start=${start}&end=${end}&format=JSON`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('NASA POWER API — réponse ' + res.status);
  const json = await res.json();
  const p = json.properties.parameter;
  const days = Object.keys(p.T2M).sort();
  const series = days.map(d => ({
    date: d,
    temp: p.T2M[d],
    humidity: p.RH2M[d],
    precip: p.PRECTOTCORR[d],
  })).filter(d => d.temp > -900 && d.humidity > -900 && d.precip > -900); // POWER renvoie -999 si absent
  return series;
};

// Indice de risque simplifié (0-100) pour une maladie donnée — PAS un outil de
// diagnostic médical ni de surveillance épidémiologique officielle.
eGS.riskIndexFor = function(diseaseId, series){
  if(!series.length) return null;
  const disease = eGS.getDisease(diseaseId);
  const avg = key => series.reduce((s,d)=>s+d[key],0) / series.length;
  const temp = avg('temp');
  const humidity = avg('humidity');
  const precipTotal = series.reduce((s,d)=>s+d.precip,0);

  const tempScore = Math.max(0, 100 - Math.abs(temp - disease.tempOptimal) * disease.tempSensitivity);

  const humScore = disease.humidityDirection === 'low'
    ? Math.min(100, Math.max(0, (disease.humidityRef - humidity) * disease.humidityFactor))
    : Math.min(100, Math.max(0, (humidity - disease.humidityRef) * disease.humidityFactor));

  let precipScore;
  if(disease.precipProfile === 'flood'){
    precipScore = Math.min(100, precipTotal * disease.precipFactor);
  } else if(disease.precipProfile === 'low'){
    precipScore = Math.max(0, 100 - precipTotal * disease.precipFactor);
  } else {
    precipScore = precipTotal <= 2 ? precipTotal * 15
                 : precipTotal <= 40 ? 30 + (precipTotal-2)*1.6
                 : Math.max(20, 100 - (precipTotal-40)*1.2);
  }

  const score = Math.round(tempScore*disease.wTemp + humScore*disease.wHum + Math.min(100,precipScore)*disease.wPrecip);
  return { score: Math.max(0, Math.min(100, score)), temp, humidity, precipTotal, diseaseId: disease.id };
};

// Rétrocompatible : l'ancien riskIndex() calculait uniquement le paludisme.
eGS.riskIndex = function(series){
  return eGS.riskIndexFor('paludisme', series);
};

eGS.riskLabel = function(score){
  if(score === null) return { label:'Indisponible', cls:'mid' };
  if(score >= 66) return { label:'Risque élevé', cls:'high' };
  if(score >= 40) return { label:'Risque modéré', cls:'mid' };
  return { label:'Risque faible', cls:'low' };
};
