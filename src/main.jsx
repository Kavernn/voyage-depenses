import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import App from './App';
import './styles.css';

/*
 * =========================================================
 * PWA UPDATE MANAGER
 * =========================================================
 *
 * Une nouvelle version n'est jamais appliquée pendant que
 * l'utilisateur travaille.
 *
 * Quand elle est disponible :
 *
 *   Nouvelle version disponible
 *   [Plus tard] [Mettre à jour]
 *
 * Le clic sur "Mettre à jour" active le nouveau SW et
 * recharge l'application.
 */

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let updateServiceWorker = null;
let notifyUpdateAvailable = null;
let updateWaiting = false;

const updateSW = registerSW({
  immediate: true,

  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    console.log('[PWA] Service worker enregistré:', swUrl);

    const checkForUpdate = async () => {
      if (!navigator.onLine) return;

      try {
        const response = await fetch(swUrl, {
          cache: 'no-store',
        });

        if (response.ok) {
          await registration.update();
        }
      } catch (error) {
        console.debug(
          '[PWA] Vérification de mise à jour impossible:',
          error,
        );
      }
    };

    checkForUpdate();

    window.setInterval(
      checkForUpdate,
      UPDATE_INTERVAL_MS,
    );

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    });
  },

  onNeedRefresh() {
    console.log('[PWA] Nouvelle version disponible.');

    updateWaiting = true;

    if (notifyUpdateAvailable) {
      notifyUpdateAvailable();
    }
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

updateServiceWorker = updateSW;


/*
 * =========================================================
 * UPDATE BANNER
 * =========================================================
 */

function PwaUpdateBanner() {
  const [visible, setVisible] = useState(updateWaiting);
  const [updating, setUpdating] = useState(false);

  /*
   * Permet au callback onNeedRefresh(), situé hors de React,
   * d'afficher la bannière.
   */
  notifyUpdateAvailable = () => {
    setVisible(true);
  };

  async function installUpdate() {
    if (!updateServiceWorker || updating) return;

    try {
      setUpdating(true);

      /*
       * true = demande au nouveau service worker de prendre
       * immédiatement le contrôle puis recharge l'application.
       */
      await updateServiceWorker(true);
    } catch (error) {
      console.error(
        '[PWA] Impossible d’appliquer la mise à jour:',
        error,
      );

      setUpdating(false);
    }
  }

  function dismissUpdate() {
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="pwaUpdateBanner"
      role="status"
      aria-live="polite"
    >
      <div className="pwaUpdateBannerIcon" aria-hidden="true">
        ↑
      </div>

      <div className="pwaUpdateBannerContent">
        <strong>Nouvelle version disponible</strong>

        <span>
          Une mise à jour de l’application est prête.
        </span>
      </div>

      <div className="pwaUpdateBannerActions">
        <button
          type="button"
          className="pwaUpdateLater"
          onClick={dismissUpdate}
          disabled={updating}
        >
          Plus tard
        </button>

        <button
          type="button"
          className="pwaUpdateNow"
          onClick={installUpdate}
          disabled={updating}
        >
          {updating ? "Mise à jour…" : "Mettre à jour"}
        </button>
      </div>
    </div>
  );
}


/*
 * =========================================================
 * APPLICATION
 * =========================================================
 */

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaUpdateBanner />
  </React.StrictMode>
);
