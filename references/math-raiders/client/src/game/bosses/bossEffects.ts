import * as PIXI from 'pixi.js';

/**
 * Shared Boss Effects - Pure Functions + Data
 * 
 * Bob Nystrom approved: Functions operate on data, no inheritance.
 * Each boss owns its state, these functions just do the work.
 */

// ============================================================
// EFFECT STATE
// ============================================================

export interface EffectState {
  isHit: boolean;
  hitEndTime: number;
  showShield: boolean;
  shieldEndTime: number;
  shakeAmplitude: number;
  shakeEndTime: number;  // No setTimeout, same pattern as flash/shield
  recoil: number;
}

export const createEffectState = (): EffectState => ({
  isHit: false,
  hitEndTime: 0,
  showShield: false,
  shieldEndTime: 0,
  shakeAmplitude: 0,
  shakeEndTime: 0,
  recoil: 0,
});

// ============================================================
// EFFECT TRIGGERS - Pure functions, mutate the state passed in
// ============================================================

export const triggerFlash = (state: EffectState, duration = 60): void => {
  state.isHit = true;
  state.hitEndTime = Date.now() + duration;
};

export const triggerShield = (state: EffectState, duration = 1500): void => {
  state.showShield = true;
  state.shieldEndTime = Date.now() + duration;
};

export const triggerShake = (
  state: EffectState,
  amplitude: number,
  multiplier: number,
  durationMs: number
): void => {
  state.shakeAmplitude = amplitude * multiplier;
  state.shakeEndTime = Date.now() + durationMs;
};

export const triggerRecoil = (state: EffectState, amount: number, multiplier: number): void => {
  state.recoil = amount * multiplier;
};

// ============================================================
// EFFECT UPDATE - Call once per frame
// ============================================================

export const updateEffects = (state: EffectState, now: number, recoilDecay: number): void => {
  // Clear expired flash
  if (state.isHit && now > state.hitEndTime) {
    state.isHit = false;
  }
  
  // Clear expired shield
  if (state.showShield && now > state.shieldEndTime) {
    state.showShield = false;
  }
  
  // Clear expired shake
  if (state.shakeAmplitude > 0 && now > state.shakeEndTime) {
    state.shakeAmplitude = 0;
  }
  
  // Decay recoil (spring physics)
  if (state.recoil > 0.1) {
    state.recoil *= recoilDecay;
  } else {
    state.recoil = 0;
  }
};

// ============================================================
// PHASE CHANGE SHAKE - Shared across all bosses
// ============================================================

/**
 * Check for phase transitions and trigger shake when crossing thresholds.
 * Returns the new phase (0-3) so the boss can track it.
 * 
 * Phases: 0 = 100-75%, 1 = 75-50%, 2 = 50-25%, 3 = 25-0%
 */
export const checkPhaseShake = (
  hpPercent: number,
  currentPhase: number,
  effects: EffectState,
  shakeAmplitude = 8,
  shakeMultiplier = 0.5,
  shakeDuration = 300
): number => {
  const newPhase = hpPercent > 75 ? 0 : hpPercent > 50 ? 1 : hpPercent > 25 ? 2 : 3;
  if (newPhase !== currentPhase && currentPhase >= 0) {
    triggerShake(effects, shakeAmplitude, shakeMultiplier, shakeDuration);
  }
  return newPhase;
};

// ============================================================
// SHARED SHIELD DRAWING - Identical hexagon across all bosses
// ============================================================

export const drawShield = (
  graphics: PIXI.Graphics,
  time: number,
  radius = 80,
  sides = 6,
  color = 0x00BFFF  // Cyan default, override for fire boss etc.
): void => {
  graphics.clear();
  
  const pulse = Math.sin(time * 6) * 5;
  
  // Outer glow
  graphics.circle(0, 0, radius + pulse + 20);
  graphics.fill({ color, alpha: 0.1 });
  
  // Hexagon outline
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * (radius + pulse);
    const y = Math.sin(angle) * (radius + pulse);
    if (i === 0) {
      graphics.moveTo(x, y);
    } else {
      graphics.lineTo(x, y);
    }
  }
  graphics.closePath();
  graphics.fill({ color, alpha: 0.2 });
  graphics.stroke({ width: 3, color, alpha: 0.8 });
  
  // Inner energy lines
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * (radius + pulse);
    const y = Math.sin(angle) * (radius + pulse);
    graphics.moveTo(0, 0);
    graphics.lineTo(x, y);
  }
  graphics.stroke({ width: 1, color, alpha: 0.5 });
};

// ============================================================
// TICKER HELPERS - Shared lifecycle management
// ============================================================

export interface TickerState {
  app: PIXI.Application | null;
  tickerFn: ((ticker: PIXI.Ticker) => void) | null;
}

export const createTickerState = (): TickerState => ({
  app: null,
  tickerFn: null,
});

export const registerTicker = (
  state: TickerState,
  app: PIXI.Application,
  updateFn: (delta: number) => void
): void => {
  state.app = app;
  state.tickerFn = (ticker) => updateFn(ticker.deltaTime);
  app.ticker.add(state.tickerFn);
};

export const unregisterTicker = (state: TickerState): void => {
  if (state.app && state.tickerFn) {
    state.app.ticker.remove(state.tickerFn);
    state.tickerFn = null;
    state.app = null;
  }
};

