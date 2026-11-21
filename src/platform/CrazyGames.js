/**
 * CrazyGames SDK v3 Wrapper
 * Documentation: https://docs.crazygames.com/sdk/html5/v3/
 *
 * Handles game lifecycle events (loading, gameplay start/stop, happytime)
 * and advertisements (midgame and rewarded ads) with built-in cooldowns
 * and safe fallback for non-CrazyGames environments (local, Vercel, etc.).
 */
export class CrazyGamesPlatform {
  constructor() {
    this.sdk = null;
    this.initialized = false;
    this.lastAdTime = 0;
    // CrazyGames recommends at least 3 minutes between midgame ads
    this.adCooldown = 180000;
  }

  /**
   * Initializes the CrazyGames SDK if present on window.
   */
  async init() {
    if (typeof window === 'undefined' || !window.CrazyGames?.SDK) {
      console.info('[CrazyGames] SDK script not detected; running in standalone mode.');
      return;
    }
    try {
      this.sdk = window.CrazyGames.SDK;
      await this.sdk.init();
      this.initialized = true;
      console.info('[CrazyGames] Initialized. Environment:', this.sdk.environment);
    } catch (err) {
      console.warn('[CrazyGames] SDK init error:', err);
    }
  }

  /** Tell CrazyGames loading has started */
  loadingStart() {
    try {
      this.sdk?.game?.loadingStart();
    } catch {}
  }

  /** Tell CrazyGames loading has finished and the game is interactive */
  loadingStop() {
    try {
      this.sdk?.game?.loadingStop();
    } catch {}
  }

  /** Call when player enters active driving / gameplay */
  gameplayStart() {
    try {
      this.sdk?.game?.gameplayStart();
    } catch {}
  }

  /** Call when player leaves gameplay (pause, menu, crash, or race finish) */
  gameplayStop() {
    try {
      this.sdk?.game?.gameplayStop();
    } catch {}
  }

  /** Call on milestone / celebratory moments (new record, gold medal, achievement) */
  happytime() {
    try {
      this.sdk?.game?.happytime();
    } catch {}
  }

  /**
   * Listen for CrazyGames site-wide mute/unmute toggles from the player.
   * @param {(muted: boolean) => void} callback
   */
  addMuteListener(callback) {
    try {
      this.sdk?.audio?.addMuteListener((muted) => {
        callback(Boolean(muted));
      });
    } catch (e) {
      console.warn('[CrazyGames] Failed to register mute listener:', e);
    }
  }

  /**
   * Requests a midgame (interstitial) ad.
   * Ensures game audio is silenced and game state paused during ad.
   *
   * @param {Object} options
   * @param {() => void} [options.onStart] Triggered when the ad begins (pause audio & game)
   * @param {() => void} [options.onFinish] Triggered when the ad ends or errors (resume audio & game)
   */
  async requestMidgameAd({ onStart, onFinish } = {}) {
    const now = Date.now();
    // Enforce cooldown and verify initialization
    if (!this.initialized || !this.sdk?.ad?.requestAd) {
      onFinish?.();
      return;
    }

    if (now - this.lastAdTime < this.adCooldown) {
      onFinish?.();
      return;
    }

    let handled = false;
    const finishOnce = () => {
      if (handled) return;
      handled = true;
      this.lastAdTime = Date.now();
      onFinish?.();
    };

    try {
      await this.sdk.ad.requestAd('midgame', {
        adStarted: () => {
          onStart?.();
        },
        adFinished: () => {
          finishOnce();
        },
        adError: (error) => {
          console.warn('[CrazyGames] Midgame ad error:', error);
          finishOnce();
        },
      });
    } catch (err) {
      console.warn('[CrazyGames] Midgame ad request rejected:', err);
      finishOnce();
    }
  }

  /**
   * Requests a rewarded ad (e.g. for bonus reward, nitro, or cosmetic unlock).
   *
   * @param {Object} options
   * @param {() => void} [options.onStart]
   * @param {() => void} [options.onReward] Triggered only if player watched the ad
   * @param {() => void} [options.onFinish] Triggered when ad closes (whether rewarded or not)
   */
  async requestRewardedAd({ onStart, onReward, onFinish } = {}) {
    if (!this.initialized || !this.sdk?.ad?.requestAd) {
      onFinish?.();
      return;
    }

    let handled = false;
    const finishOnce = () => {
      if (handled) return;
      handled = true;
      onFinish?.();
    };

    try {
      await this.sdk.ad.requestAd('rewarded', {
        adStarted: () => {
          onStart?.();
        },
        adFinished: () => {
          try {
            onReward?.();
          } finally {
            finishOnce();
          }
        },
        adError: (error) => {
          console.warn('[CrazyGames] Rewarded ad error:', error);
          finishOnce();
        },
      });
    } catch (err) {
      console.warn('[CrazyGames] Rewarded ad request rejected:', err);
      finishOnce();
    }
  }
}
