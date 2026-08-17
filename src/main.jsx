import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import { createRoot } from 'react-dom/client';
import { useRegisterSW } from 'virtual:pwa-register/react';

import App from './App';
import './styles.css';

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

const PULL_TRIGGER_PX = 82;
const PULL_MAX_PX = 118;


/*
 * =========================================================
 * PWA UPDATE SYSTEM
 * =========================================================
 */

function PwaUpdateSystem() {
  const [updating, setUpdating] = useState(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [checking, setChecking] = useState(false);

  const startYRef = useRef(null);
  const pullingRef = useRef(false);
  const registrationRef = useRef(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,

    onRegisteredSW(swUrl, registration) {
      if (!registration) return;

      registrationRef.current = registration;

      console.log(
        '[PWA] Service worker enregistré:',
        swUrl,
      );

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

      window.setInterval(
        checkForUpdate,
        UPDATE_INTERVAL_MS,
      );

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

  /*
   * =========================================================
   * PULL TO CHECK UPDATE
   * =========================================================
   *
   * Fonctionne uniquement lorsque la page est déjà au top.
   */

  useEffect(() => {
    function handleTouchStart(event) {
      if (window.scrollY > 0) return;
      if (!event.touches?.length) return;

      startYRef.current = event.touches[0].clientY;
      pullingRef.current = true;
    }

    function handleTouchMove(event) {
      if (!pullingRef.current) return;
      if (startYRef.current === null) return;

      /*
       * Si l'utilisateur a commencé à scroller la page,
       * on abandonne le pull custom.
       */
      if (window.scrollY > 0) {
        pullingRef.current = false;
        setPullDistance(0);
        return;
      }

      const currentY = event.touches[0].clientY;
      const rawDistance = currentY - startYRef.current;

      if (rawDistance <= 0) {
        setPullDistance(0);
        return;
      }

      /*
       * Résistance progressive, plus naturelle sur iPhone.
       */
      const resisted = Math.min(
        PULL_MAX_PX,
        rawDistance * 0.58,
      );

      setPullDistance(resisted);
    }

    async function handleTouchEnd() {
      if (!pullingRef.current) {
        startYRef.current = null;
        return;
      }

      pullingRef.current = false;
      startYRef.current = null;

      const shouldCheck =
        pullDistance >= PULL_TRIGGER_PX;

      setPullDistance(0);

      if (!shouldCheck) return;
      if (checking) return;

      const registration = registrationRef.current;

      if (!registration) return;

      try {
        setChecking(true);

        console.log(
          '[PWA] Vérification manuelle de mise à jour…',
        );

        /*
         * Force le navigateur à revalider sw.js.
         */
        await registration.update();

        /*
         * Laisse quelques centaines de ms au nouveau
         * service worker pour passer en waiting.
         *
         * Si une mise à jour est disponible,
         * useRegisterSW fera passer needRefresh à true
         * et la bannière existante apparaîtra.
         */
        await new Promise((resolve) =>
          window.setTimeout(resolve, 700),
        );
      } catch (error) {
        console.error(
          '[PWA] Vérification manuelle impossible:',
          error,
        );
      } finally {
        setChecking(false);
      }
    }

    window.addEventListener(
      'touchstart',
      handleTouchStart,
      { passive: true },
    );

    window.addEventListener(
      'touchmove',
      handleTouchMove,
      { passive: true },
    );

    window.addEventListener(
      'touchend',
      handleTouchEnd,
      { passive: true },
    );

    window.addEventListener(
      'touchcancel',
      handleTouchEnd,
      { passive: true },
    );

    return () => {
      window.removeEventListener(
        'touchstart',
        handleTouchStart,
      );

      window.removeEventListener(
        'touchmove',
        handleTouchMove,
      );

      window.removeEventListener(
        'touchend',
        handleTouchEnd,
      );

      window.removeEventListener(
        'touchcancel',
        handleTouchEnd,
      );
    };
  }, [pullDistance, checking]);

  function dismissUpdate() {
    setNeedRefresh(false);
    setOfflineReady(false);
  }

  async function installUpdate() {
    if (updating) return;

    try {
      setUpdating(true);
      await updateServiceWorker(true);
    } catch (error) {
      console.error(
        '[PWA] Mise à jour impossible:',
        error,
      );

      setUpdating(false);
    }
  }

  const pullProgress = Math.min(
    1,
    pullDistance / PULL_TRIGGER_PX,
  );

  return (
    <>
      <div
        className={[
          'pwaPullRefresh',
          pullDistance > 0 ? 'visible' : '',
          pullProgress >= 1 ? 'ready' : '',
          checking ? 'checking' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          '--pull-distance': `${pullDistance}px`,
          '--pull-progress': pullProgress,
        }}
        aria-hidden="true"
      >
        <div className="pwaPullRefreshBubble">
          <span className="pwaPullRefreshIcon">
            {checking
              ? '↻'
              : pullProgress >= 1
                ? '✓'
                : '↓'}
          </span>

          <span className="pwaPullRefreshText">
            {checking
              ? 'Recherche d’une mise à jour…'
              : pullProgress >= 1
                ? 'Relâche pour vérifier'
                : 'Tire pour vérifier'}
          </span>
        </div>
      </div>

      {needRefresh && (
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
                ? 'Mise à jour…'
                : 'Mettre à jour'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}


createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaUpdateSystem />
  </React.StrictMode>
);
