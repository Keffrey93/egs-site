/*
  eGS — Assistant conversationnel à base de règles (v2).
  100% local, aucune donnée envoyée à un serveur.

  Améliorations par rapport à la v1 :
   - normalisation forte (accents, ponctuation, lettres répétées : "bonjourrrr" -> "bonjour")
   - tolérance aux fautes de frappe / variantes (distance de Levenshtein + préfixe sur chaque mot,
     donc pas besoin de lister séparément singulier/pluriel : "symptome" reconnaît "symptomes")
   - reconnaissance par SCORE : chaque règle est notée selon les indices trouvés (les expressions
     précises comptent plus que les mots isolés et ambigus), la meilleure règle l'emporte
   - beaucoup plus de sujets couverts (transmission, traitement, calcul de l'indice,
     technologies satellites, équipe, coût, confidentialité, grossesse/enfants, etc.)
*/
(function(){

  // ---------- Normalisation ----------
  function stripAccents(s){
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }
  function collapseRepeats(s){
    // "bonjourrrr" -> limite les lettres répétées 3x+ à 2 occurrences
    return s.replace(/(.)\1{2,}/g,'$1$1');
  }
  function normalize(text){
    let t = stripAccents(String(text||'').toLowerCase());
    t = t.replace(/['’]/g, ' ');
    t = t.replace(/[^a-z0-9\s?!.]/g,' ');
    t = collapseRepeats(t);
    t = t.replace(/\s+/g,' ').trim();
    return t;
  }
  function tokenize(normText){
    return normText.split(' ').filter(Boolean);
  }

  // ---------- Distance de Levenshtein (tolérance aux fautes) ----------
  function levenshtein(a, b){
    if(a === b) return 0;
    const al = a.length, bl = b.length;
    if(al === 0) return bl;
    if(bl === 0) return al;
    let prev = new Array(bl+1);
    for(let j=0;j<=bl;j++) prev[j] = j;
    for(let i=1;i<=al;i++){
      const cur = [i];
      for(let j=1;j<=bl;j++){
        const cost = a[i-1] === b[j-1] ? 0 : 1;
        cur[j] = Math.min(
          prev[j] + 1,      // suppression
          cur[j-1] + 1,     // insertion
          prev[j-1] + cost  // substitution
        );
      }
      prev = cur;
    }
    return prev[bl];
  }
  // tolérance proportionnelle à la longueur du mot : mots courts = 0 faute, moyens = 1, longs = 2
  function fuzzyThreshold(len){
    if(len <= 4) return 0;
    if(len <= 8) return 1;
    return 2;
  }
  function tokenMatches(token, keyword){
    if(token === keyword) return true;
    if(token.length < 3 || keyword.length < 3) return false; // évite les faux positifs sur mots trop courts
    // préfixe (gère pluriels/variantes : "symptomes" contient "symptome")
    if(token.startsWith(keyword) || keyword.startsWith(token)) return true;
    const dist = levenshtein(token, keyword);
    return dist <= fuzzyThreshold(keyword.length);
  }

  // Un "indice" (clue) peut être :
  //  - un mot simple -> comparé mot à mot avec tolérance aux fautes
  //  - une expression ("rendez vous", "zone a risque") -> recherchée en sous-chaîne dans le texte normalisé
  function clueMatches(normText, tokens, clue){
    const c = normalize(clue);
    if(c.includes(' ')){
      if(normText.includes(c)) return true;
      // tolère une expression écrite en un seul mot ("rendezvous")
      if(normText.includes(c.replace(/\s+/g,''))) return true;
      return false;
    }
    return tokens.some(tok => tokenMatches(tok, c));
  }

  // ---------- Base de règles ----------
  // kw : indices ; les expressions ("mal de tete") comptent plus que les mots isolés,
  // et les mots isolés ambigus (ex: "moustique", partagé entre plusieurs sujets) sont
  // volontairement peu pondérés pour laisser gagner les indices plus spécifiques.
  const RULES = [
    { id:'urgence', weight:3,
      kw:['urgence','grave','danger','dangereux','coma','confusion','convulsion',
          'forte fievre','tres malade','je vais mal','au secours','ca s aggrave'],
      a:"⚠️ En cas de signes graves (forte fièvre, confusion, convulsions), rendez-vous immédiatement au centre de santé le plus proche ou appelez les secours. Cet assistant ne remplace pas un avis médical." },

    { id:'grossesse', weight:2,
      kw:['grossesse','enceinte','femme enceinte','bebe','nourrisson','allaitement',
          'enfant','nouveau ne','pediatrique','mon fils','ma fille'],
      a:"Les enfants en bas âge et les femmes enceintes sont particulièrement vulnérables au paludisme : la prévention (moustiquaire, répulsifs adaptés) est encore plus importante, et toute fièvre doit être prise au sérieux sans délai. Le plus sûr est de prendre rapidement rendez-vous en téléconsultation ou de consulter un centre de santé." },

    { id:'symptomes', weight:1,
      kw:['symptome','signe','fievre','frisson','mal de tete','courbature','fatigue intense',
          'nausee','vomissement','je suis malade','ca ne va pas','douleurs musculaires'],
      a:"Les symptômes courants du paludisme sont : fièvre, frissons, maux de tête, douleurs musculaires et fatigue intense, apparaissant souvent 10 à 15 jours après la piqûre infectante. En cas de fièvre au Gabon, consultez rapidement un centre de santé — le paludisme se soigne bien s'il est pris à temps." },

    { id:'transmission', weight:1,
      kw:['transmission','transmet','attrape','contamine','contamination','anophele',
          'vecteur','piqure','comment on choppe','comment attrape t on','femelle'],
      a:"Le paludisme se transmet par la piqûre d'un moustique femelle du genre Anophèle, actif surtout entre le coucher et le lever du soleil. Ces moustiques se reproduisent dans les eaux stagnantes, ce qui explique le lien avec les données climatiques utilisées par eGS." },

    { id:'traitement', weight:1,
      kw:['traitement','soigner','medicament','antipaludeen','guerir','guerison',
          'comment le soigner','remede','faut il des antibiotiques'],
      a:"Le paludisme se traite avec des médicaments antipaludéens prescrits par un professionnel de santé, d'autant plus efficaces que la prise en charge est précoce. N'essayez pas de vous autotraiter : en cas de suspicion, prenez rendez-vous en téléconsultation ou rendez-vous au centre de santé le plus proche." },

    { id:'prevention', weight:1,
      kw:['prevention','eviter','proteger','protection','moustiquaire','repulsif',
          'anti moustique','insecticide','grillage','vetements longs','eau stagnante',
          'comment se proteger','comment eviter'],
      a:"Les gestes de prévention : dormir sous moustiquaire imprégnée, utiliser des répulsifs, porter des vêtements longs le soir, éliminer les eaux stagnantes autour du logement, et poser des grillages moustiquaires aux fenêtres." },

    { id:'zones-risque', weight:1,
      kw:['zone a risque','quelle ville','ou se trouve le risque','carte des risques',
          'region a risque','niveau de risque','ville risquee','ou est le risque',
          'quelles sont les zones','villes surveillees'],
      a:"Consultez la page « Données satellite » : elle affiche un indice de risque par ville, calculé à partir de données climatiques réelles (température, humidité, précipitations)." },

    { id:'calcul-indice', weight:1,
      kw:['comment est calcule','comment ca marche l indice','calcul de l indice',
          'methode de calcul','pondere','ponderation','score par variable',
          'comment vous calculez','nasa power','14 jours','indice de risque'],
      a:"L'indice combine les 14 derniers jours de données climatiques (température, humidité, précipitations) issues de l'API NASA POWER. Chaque variable obtient un score selon sa proximité avec les conditions favorables au moustique vecteur, puis les scores sont pondérés (40% température, 35% humidité, 25% précipitations) — un modèle simple, à but pédagogique." },

    { id:'technologie', weight:1,
      kw:['satellite','sentinel','landsat','smos','galileo','geolocalisation',
          'intelligence artificielle',' ia ','comment fonctionne egs','comment marche egs',
          'technologie','donnees satellitaires','c est quoi egs','koi egs','quoi egs'],
      a:"eGS croise des données climatiques satellitaires (Sentinel-2, Landsat, SMOS), la géolocalisation Galileo et l'intelligence artificielle pour estimer, ville par ville, le niveau de risque de paludisme au Gabon." },

    { id:'consultation', weight:1,
      kw:['consultation','teleconsultation','medecin','rendez vous','rdv','docteur',
          'creneau','disponibilite','annuler mon rendez vous','prendre rendez vous',
          'parler a un medecin','voir un docteur'],
      a:"Vous pouvez prendre rendez-vous en téléconsultation depuis la page « Téléconsultation », en choisissant un créneau parmi les disponibilités des 3 prochains jours et en décrivant votre motif." },

    { id:'inscription', weight:1,
      kw:['inscription','inscrire','creer un compte','creer mon profil','compte',
          'profil','s inscrire','creer un profil'],
      a:"L'inscription se fait sur la page « Inscription » — cela crée votre profil, permet de recevoir des alertes personnalisées selon votre ville et facilite vos prises de rendez-vous. Aucune donnée n'est transmise à un serveur externe." },

    { id:'alertes', weight:1,
      kw:['alerte','notification','abonnement','abonn','s abonner','etre alerte',
          'etre prevenu','suivre une ville'],
      a:"La page « Assistance » vous permet de vous abonner aux alertes d'une ville : eGS vérifie son indice de risque à partir des données NASA POWER et vous prévient s'il devient élevé." },

    { id:'confidentialite', weight:1,
      kw:['confidentialite','donnees personnelles','vie privee','securite des donnees',
          'mes donnees','protection des donnees','rgpd'],
      a:"eGS fonctionne principalement dans votre navigateur : aucune donnée personnelle n'est transmise à un serveur externe lors de l'inscription. Seules les données climatiques publiques (NASA POWER) sont interrogées pour calculer les indices de risque." },

    { id:'equipe', weight:1,
      kw:['equipe','team gandalf','qui etes vous','qui a cree','qui a fait','fondateurs',
          'createurs','developpeurs','qui vous etes'],
      a:"eGS est porté par Team Gandalf, une équipe de cinq profils complémentaires en stratégie, développement et design. Vous pouvez découvrir chaque membre sur la page « Équipe »." },

    { id:'cout', weight:1,
      kw:['cout','prix','tarif','gratuit','payant','combien ca coute','modele economique'],
      a:"L'utilisation d'eGS (assistant, indice de risque, alertes, inscription) est gratuite. Le projet, lui, a un coût de structure estimé à 150 315 € pour passer de l'idée à un service opérationnel — voir la page « Équipe » pour le détail du modèle économique." },

    { id:'stats-officielles', weight:1,
      kw:['combien de cas','statistique','statistiques','chiffres officiels','bilan',
          'combien de morts','combien de personnes touchees','chiffres du paludisme'],
      a:"Selon l'OMS (World Malaria Report 2024, données Gabon validées au 14/11/2024) : 137 856 cas présumés et confirmés recensés en 2023, dont 59 248 confirmés en secteur public, pour 205 décès rapportés. L'OMS estime le nombre réel de cas à environ 569 800 sur l'année. Détail sur la page « Données satellite »." },

    { id:'salutation', weight:1,
      kw:['bonjour','bonsoir','salut','coucou','hello','hey','bjr'],
      a:"Bonjour ! Je suis l'assistant eGS. Je peux vous renseigner sur les symptômes, la prévention, les zones à risque, la téléconsultation, les alertes ou l'équipe du projet." },

    { id:'remerciement', weight:1,
      kw:['merci','je te remercie'],
      a:"Avec plaisir. N'hésitez pas si vous avez d'autres questions." },

    { id:'au-revoir', weight:1,
      kw:['au revoir','a bientot','bye','a plus','ciao','bonne journee','bonne soiree'],
      a:"Au revoir, prenez soin de vous ! N'hésitez pas à revenir si vous avez d'autres questions sur le paludisme ou sur eGS." },

    { id:'aide', weight:1,
      kw:['aide','menu','options','que peux tu faire','tu peux faire quoi',
          'aide moi','je ne comprends pas','de quoi tu peux parler'],
      a:"Je peux vous renseigner sur : les symptômes et la prévention du paludisme, les zones à risque, la prise de rendez-vous en téléconsultation, l'inscription, les alertes par ville, et le fonctionnement d'eGS. Posez votre question librement, ou utilisez les suggestions ci-dessus." },
  ];

  const FALLBACK = "Je n'ai pas toutes les données pour répondre précisément à cela. Vous pouvez reformuler, ou consulter directement un professionnel de santé pour toute question médicale. Tapez « aide » pour voir les sujets que je connais.";

  // ---------- Moteur de correspondance par score ----------
  function scoreRules(text){
    const normText = ' ' + normalize(text) + ' '; // espaces de bord pour les indices du type ' ia '
    const tokens = tokenize(normText);
    const scored = RULES.map(rule => {
      let score = 0, matched = 0;
      for(const clue of rule.kw){
        if(clueMatches(normText, tokens, clue)){
          matched++;
          score += rule.weight * (clue.trim().includes(' ') ? 1.6 : 1); // les expressions précises comptent plus
        }
      }
      return { rule, score, matched };
    }).filter(s => s.matched > 0);

    scored.sort((a,b) => b.score - a.score);
    return scored;
  }

  function reply(text){
    const scored = scoreRules(text);
    if(scored.length === 0) return { text: FALLBACK, ruleId: null };
    const best = scored[0];
    return { text: best.rule.a, ruleId: best.rule.id };
  }

  window.eGSChat = {
    reply: function(text){ return reply(text).text; }, // API simple
    replyWithContext: reply,                            // renvoie aussi l'id de la règle déclenchée
    _internal: { normalize, tokenize, levenshtein, scoreRules } // exposé pour tests/débogage
  };
})();
