/*
  eGS — Gère l'affichage de la navigation selon l'état de connexion.
  Le token de session est stocké dans localStorage ('egs_token'). Ce script
  ne fait AUCUNE vérification serveur ici (juste une bascule d'affichage
  immédiate) — chaque page qui a besoin de données protégées (ex. profil.html)
  doit elle-même vérifier le token auprès de l'API (GET /api/auth/me), car un
  token présent en local peut être expiré ou invalide.
*/
(function () {
  function applyNavState() {
    const token = localStorage.getItem('egs_token');
    const cta = document.getElementById('nav-cta');
    const loginItem = document.getElementById('nav-login-item');

    if (token) {
      if (cta) { cta.textContent = 'Mon profil'; cta.setAttribute('href', 'profil.html'); }
      if (loginItem) loginItem.style.display = 'none';
    } else {
      if (cta) { cta.textContent = "S'inscrire"; cta.setAttribute('href', 'inscription.html'); }
      if (loginItem) loginItem.style.display = '';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyNavState);
  } else {
    applyNavState();
  }
})();
