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
 * registerType: 'autoUpdate' est configuré dans vite.config.js.
 *
 * Ce module :
 * - enregistre immédiatement le service worker;
 * - laisse vite-plugin-pwa gérer l'activation/reload;
 * - vérifie la présence d'une nouvelle version au lancement;
 * - revérifie périodiquement pendant que l'app reste ouverte.
 *
 * Aucun double reload manuel via controllerchange.
 */

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

registerSW({
  immediate: true,

  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    console.log('[PWA] Service worker enregistré:', swUrl);

    const checkForUpdate = async () => {
      if (registration.installing) return;
      if (!navigator.onLine) return;

      try {
        /*
         * Vérifie d'abord que le sw.js distant est accessible
         * sans réutiliser une réponse HTTP mise en cache.
         */
        const response = await fetch(swUrl, {
          cache: 'no-store',
          headers: {
            'cache': 'no-store',
            'cache-control': 'no-cache',
          },
        });

        if (response.ok) {
          await registration.update();
        }
      } catch (error) {
        /*
         * Une perte de réseau ne doit jamais casser l'app.
         */
        console.debug(
          '[PWA] Vérification de mise à jour impossible:',
          error,
        );
      }
    };

    /*
     * Vérification immédiatement après l'enregistrement.
     */
    checkForUpdate();

    /*
     * Puis une fois par heure si l'application reste ouverte.
     */
    window.setInterval(
      checkForUpdate,
      UPDATE_INTERVAL_MS,
    );

    /*
     * Important sur mobile/PWA :
     * quand l'utilisateur revient dans l'application après
     * l'avoir laissée en arrière-plan, on revérifie aussi.
     */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    });
  },

  onOfflineReady() {
    console.log('[PWA] Application prête hors ligne.');
  },

  onRegisterError(error) {
    console.error(
      '[PWA] Erreur service worker:',
      error,
    );
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
