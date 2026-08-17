import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRegisterSW } from 'virtual:pwa-register/react';

import App from './App';
import './styles.css';

/*
 * =========================================================
 * PWA UPDATE BANNER
 * =========================================================
 *
 * Mode VitePWA: registerType: 'prompt'
 *
 * - aucune mise à jour forcée pendant la saisie;
 * - une bannière apparaît lorsqu'un nouveau SW attend;
 * - "Plus tard" ferme la bannière;
 * - "Mettre à jour" active le nouveau SW + reload.
 */

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

function PwaUpdateBanner() {
  const [updating, setUpdating] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,

    onRegisteredSW(swUrl, registration) {
      if (!registration) return;

      console.log(
        '[PWA] Service worker enregistré:',
        swUrl,
      );

      /*
       * On évite volontairement registration.update()
       * immédiatement après l'enregistrement.
       *
       * Workbox utilise une heuristique temporelle et les
       * updates trop rapprochés peuvent être catégorisés
       * comme événements externes.
       */

      const checkForUpdate = async () => {
        if (!navigator.onLine) return;
        if (registration.installing) return;

        try {
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
          console.debug(
            '[PWA] Vérification impossible:',
            error,
          );
        }
      };

      /*
       * Vérification périodique.
       */
      window.setInterval(
        checkForUpdate,
        UPDATE_INTERVAL_MS,
      );

      /*
       * Sur iPhone/PWA, on vérifie aussi lorsqu'on revient
       * dans l'app, mais seulement si l'enregistrement existe
       * depuis plus d'une minute.
       */
      const registeredAt = Date.now();

      document.addEventListener(
        'visibilitychange',
        () => {
          if (
            document.visibilityState === 'visible' &&
            Date.now() - registeredAt > 65_000
          ) {
            checkForUpdate();
          }
        },
      );
    },

    onRegisterError(error) {
      console.error(
        '[PWA] Erreur service worker:',
        error,
      );
    },
  });

  function dismissUpdate() {
    setNeedRefresh(false);
    setOfflineReady(false);
  }

  async function installUpdate() {
    if (updating) return;

    try {
      setUpdating(true);

      console.log(
        '[PWA] Installation de la nouvelle version…',
      );

      await updateServiceWorker(true);
    } catch (error) {
      console.error(
        '[PWA] Mise à jour impossible:',
        error,
      );

      setUpdating(false);
    }
  }

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      className="pwaUpdateBanner"
      role="status"
      aria-live="polite"
    >
      <div
        className="pwaUpdateBannerIcon"
        aria-hidden="true"
      >
        ↑
      </div>

      <div className="pwaUpdateBannerContent">
        <strong>
          Nouvelle version disponible
        </strong>

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
          {updating
            ? "Mise à jour…"
            : "Mettre à jour"}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaUpdateBanner />
  </React.StrictMode>
);
