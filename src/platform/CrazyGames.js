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
    // No interstitial in a session's first minutes: new players were getting one on their very first
    // finish, right where most of them decide whether to keep playing.
    this.sessionStart = Date.now();
    this.firstAdDelay = 360000;
    this._muteListeners = new Set();
    this._settingsListener = null;
    this._loadingState = null; // 'start' | 'stop'
    this._gameplayState = null; // 'start' | 'stop'
    this._gameplayTimes = { start: -Infinity, stop: -Infinity };
    this._lastHappy = -Infinity;
    this._gameplayTimer = null;
    this._gameplaySent = null; // 'start' | 'stop'
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

      // Flush deferred lifecycle events if init completed after startup/menu calls.
      if (this._loadingState === 'start') {
        try { this.sdk.game?.loadingStart?.(); } catch {}
      } else if (this._loadingState === 'stop') {
        try { this.sdk.game?.loadingStart?.(); } catch {}
        try { this.sdk.game?.loadingStop?.(); } catch {}
      }
      if (this._gameplayState === 'start') {
        this.flushGameplay();
      }

      // Enforce CrazyGames SDK v3 muteAudio setting and subscribe to live toggles.
      const notifyMute = (muted) => {
        const flag = Boolean(muted);
        for (const cb of this._muteListeners) {
          try { cb(flag); } catch {}
        }
      };
      if (this.sdk.game?.settings && 'muteAudio' in this.sdk.game.settings) {
        notifyMute(this.sdk.game.settings.muteAudio);
      }
      if (typeof this.sdk.game?.addSettingsChangeListener === 'function') {
        this._settingsListener = (settings) => {
          if (settings && 'muteAudio' in settings) notifyMute(settings.muteAudio);
        };
        this.sdk.game.addSettingsChangeListener(this._settingsListener);
      } else if (typeof this.sdk.audio?.addMuteListener === 'function') {
        this.sdk.audio.addMuteListener(notifyMute);
      }
    } catch (err) {
      console.warn('[CrazyGames] SDK init error:', err);
    }
  }

  /** Tell CrazyGames loading has started */
  loadingStart() {
    if (this._loadingState === 'start' || this._loadingState === 'stop') return;
    this._loadingState = 'start';
    if (!this.initialized) return;
    try {
      this.sdk?.game?.loadingStart();
    } catch {}
  }

  /** Tell CrazyGames loading has finished and the game is interactive */
  loadingStop() {
    if (this._loadingState === 'stop') return;
    const hadStart = this._loadingState === 'start';
    this._loadingState = 'stop';
    if (!this.initialized) return;
    try {
      if (!hadStart) this.sdk?.game?.loadingStart?.();
      this.sdk?.game?.loadingStop();
    } catch {}
  }

  /** Call when player enters active driving / gameplay */
  gameplayStart() {
    if (this._gameplayState === 'start') return;
    this._gameplayState = 'start';
    this.flushGameplay();
  }

  /** Call when player leaves gameplay (pause, menu, crash, or race finish) */
  gameplayStop() {
    if (this._gameplayState !== 'start') return;
    this._gameplayState = 'stop';
    this.flushGameplay();
  }

  // Coalesce rapid menu changes. The SDK throttles repeat calls to each endpoint.
  flushGameplay() {
    clearTimeout(this._gameplayTimer);
    const state = this._gameplayState;
    if (!this.initialized || state === this._gameplaySent || (state === 'stop' && !this._gameplaySent)) return;
    const now = performance.now(), delay = 1050 - (now - this._gameplayTimes[state]);
    if (delay > 0) {
      this._gameplayTimer = setTimeout(() => this.flushGameplay(), delay);
      return;
    }
    try {
      if (state === 'start') this.sdk.game?.gameplayStart?.();
      else this.sdk.game?.gameplayStop?.();
      this._gameplaySent = state;
      this._gameplayTimes[state] = now;
    } catch {}
  }

  dispose() {
    clearTimeout(this._gameplayTimer);
    if(this._settingsListener)this.sdk?.game?.removeSettingsChangeListener?.(this._settingsListener);
    this._muteListeners.clear();
  }

  /** Call on milestone / celebratory moments (new record, gold medal, achievement) */
  happytime() {
    const now = performance.now();
    if (!this.initialized || now - this._lastHappy < 1050) return;
    this._lastHappy = now;
    try {
      this.sdk?.game?.happytime();
    } catch {}
  }

  /**
   * Listen for CrazyGames site-wide mute/unmute toggles from the player.
   * Also invokes immediately if SDK settings already specify muteAudio.
   * @param {(muted: boolean) => void} callback
   */
  addMuteListener(callback) {
    if (typeof callback !== 'function') return;
    this._muteListeners.add(callback);
    if (this.initialized && this.sdk?.game?.settings && 'muteAudio' in this.sdk.game.settings) {
      try { callback(Boolean(this.sdk.game.settings.muteAudio)); } catch {}
    }
  }

  /**
   * The SDK's data module (saves follow the player's CrazyGames account) when it is available, else null.
   * Only a synchronous getItem/setItem pair is accepted; anything else leaves progress in localStorage.
   */
  get dataStorage() {
    const data = this.initialized ? this.sdk?.data : null;
    return data && typeof data.getItem === 'function' && typeof data.setItem === 'function' ? data : null;
  }

  /** Read an invite query parameter via SDK when running inside CrazyGames. */
  getInviteParam(key) {
    if (!this.initialized) return null;
    try {
      return this.sdk?.game?.getInviteParam?.(key) ?? null;
    } catch {
      return null;
    }
  }

  /** Generate a shareable CrazyGames multiplayer invite URL when supported by environment. */
  async inviteLink(params = {}) {
    if (!this.initialized || this.sdk?.environment !== 'crazygames' || typeof this.sdk?.game?.inviteLink !== 'function') {
      return null;
    }
    try {
      return await this.sdk.game.inviteLink(params);
    } catch {
      return null;
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

    if (now - this.lastAdTime < this.adCooldown || now - this.sessionStart < this.firstAdDelay) {
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
