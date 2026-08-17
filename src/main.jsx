import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import App from './App';
import './styles.css';

/*
 * =========================================================
 * PWA UPDATE MANAGER
 * =========================================================
 *
 * Vérifie automatiquement si une nouvelle version est
 * disponible et force le remplacement de l'ancien bundle.
 *
 * Objectif :
 *   git push
 *      ↓
 *   Vercel deploy
 *      ↓
 *   nouveau SW détecté
 *      ↓
 *   nouveau SW activé
 *      ↓
 *   page rechargée
 *      ↓
 *   nouvelle version affichée
 *
 * Le client ne doit pas vider le cache ni réinstaller
 * l'application pour les prochaines mises à jour.
 */

let refreshing = false;

const updateSW = registerSW({
  immediate: true,

  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    console.log('[PWA] Service worker enregistré:', swUrl);

    /*
     * Vérification immédiate au lancement.
     */
    registration.update().catch(() => {});

    /*
     * Vérification périodique.
     *
     * Une heure est volontairement utilisée :
     * suffisamment fréquente pour une app de voyage,
     * sans faire des requêtes inutiles en permanence.
     */
    window.setInterval(() => {
      registration.update().catch(() => {});
    }, 60 * 60 * 1000);
  },

  onNeedRefresh() {
    console.log('[PWA] Nouvelle version détectée.');

    /*
     * Active immédiatement le nouveau service worker
     * et recharge la page.
     */
    if (!refreshing) {
      refreshing = true;
      updateSW(true);
    }
  },

  onOfflineReady() {
    console.log('[PWA] Application prête hors ligne.');
  },

  onRegisterError(error) {
    console.error('[PWA] Erreur service worker:', error);
  },
});

/*
 * Si le nouveau service worker prend le contrôle alors que
 * la page actuelle est encore ouverte, on recharge une seule
 * fois pour récupérer le nouveau bundle JS/CSS.
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;

    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
