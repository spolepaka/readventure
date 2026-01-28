import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker,
  checkPhaseShake
} from './bossEffects';

// Ghost colors - exported for config (pale/ethereal, not saturated)
export const GHOST_COLORS = {
  BODY: 0xCCDDEE,        // Very pale blue-white
  BODY_CORE: 0xDDEEFF,   // Almost white
  WISP: 0x99BBDD,        // Subtle blue wisps
  EYE_GLOW: 0xFFFFFF,    // Pure white eyes
  EYE_INNER: 0x334455,   // Dark pupils
  PARTICLES: 0xBBDDFF,   // Pale particles
  MOUTH: 0x223344,       // Dark mouth interior
};

// Shift color toward sickly purple as ghost loses HP
function shiftToSickly(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xFF;
  const g = (hex >> 8) & 0xFF;
  const b = hex & 0xFF;
  
  // Target: sickly purple (more red, less green, keep blue)
  const targetR = Math.min(255, r + 40);  // Push toward purple
  const targetG = Math.max(0, g - 60);    // Drain green (sickly)
  const targetB = b;                       // Keep blue
  
  const newR = Math.round(r + (targetR - r) * amount);
  const newG = Math.round(g + (targetG - g) * amount);
  const newB = Math.round(b + (targetB - b) * amount);
  
  return (newR << 16) | (newG << 8) | newB;
}

export type GhostColors = typeof GHOST_COLORS;

// Ghost-specific constants
const SHAKE_MULTIPLIER = 0.4;  // Less shake (floaty)
const SHAKE_DURATION = 400;    // Longer, more ethereal
const RECOIL_MULTIPLIER = 0.5; // Less recoil (weightless)
const RECOIL_DECAY = 0.92;     // Slower decay (drifts)

// Animation tuning - ghosts drift slowly, don't bounce
const HOVER_SPEED = 0.6;      // Slow, languid
const HOVER_RANGE_Y = 8;      // Gentle float, not bounce
const HOVER_RANGE_X = 6;      // Slight drift emphasis
const PULSE_SPEED = 2.5;
const BASE_ALPHA = 0.75;
const FLICKER_RECOVERY = 0.015;

/**
 * Pure Pixi GhostBoss - "Specter"
 * Uses shared bossEffects for common behavior.
 * Unique: floaty hover, translucent layers, trailing wisps, ethereal particles.
 */
export class PureGhostBoss {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Ghost-specific state
  private time = 0;
  private flickerAlpha = 1.0;  // For hit effect
  private health: number;
  private maxHealth: number;
  private currentPhase = -1;  // Phase tracking for shake on HP thresholds
  private colors: GhostColors;
  
  // Graphics
  private bodyGraphics: PIXI.Graphics;
  private coreGraphics: PIXI.Graphics;
  private wispsGraphics: PIXI.Graphics;
  private eyesGraphics: PIXI.Graphics;
  private particlesGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...GHOST_COLORS, ...colorOverrides } as GhostColors;
    
    // Create graphics (order: back to front)
    this.wispsGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.coreGraphics = new PIXI.Graphics();
    this.particlesGraphics = new PIXI.Graphics();
    this.eyesGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.wispsGraphics);
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.coreGraphics);
    this.container.addChild(this.particlesGraphics);
    this.container.addChild(this.eyesGraphics);
    this.container.addChild(this.shieldGraphics);
    
    this.draw();
  }
  
  // ============================================================
  // PUBLIC API - Implements BossInstance interface
  // ============================================================
  
  public registerWithApp(app: PIXI.Application): void {
    registerTicker(this.ticker, app, (delta) => this.update(delta));
  }
  
  public updateHealth(health: number, maxHealth: number): void {
    this.health = health;
    this.maxHealth = maxHealth;
  }
  
  public triggerFlash(duration = 80): void {
    triggerFlash(this.effects, duration);
    this.flickerAlpha = 0.3; // Ghost-specific: flicker/fade on hit
  }
  
  public triggerShield(duration = 1500): void {
    triggerShield(this.effects, duration);
  }
  
  public triggerShake(amplitude: number): void {
    triggerShake(this.effects, amplitude, SHAKE_MULTIPLIER, SHAKE_DURATION);
    this.flickerAlpha = 0.4;
  }
  
  public triggerRecoil(amount: number): void {
    triggerRecoil(this.effects, amount, RECOIL_MULTIPLIER);
    this.flickerAlpha = 0.2;
  }
  
  public destroy(): void {
    unregisterTicker(this.ticker);
    if (this.container && !this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
  
  // ============================================================
  // GAME LOOP
  // ============================================================
  
  private update(delta: number): void {
    if (!this.container.parent) return;
    
    this.time += delta * 0.016;
    const now = Date.now();
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    // Update shared effects
    updateEffects(this.effects, now, RECOIL_DECAY);
    
    // Phase change shake (all bosses get this now)
    this.currentPhase = checkPhaseShake(healthPercent, this.currentPhase, this.effects, 6);
    
    // Ghost-specific: slow flicker recovery (ghost phases back in)
    if (this.flickerAlpha < 1.0) {
      this.flickerAlpha = Math.min(1.0, this.flickerAlpha + FLICKER_RECOVERY);
    }
    
    // === PHASE-BASED MOVEMENT ===
    // Ghost gets slightly faster as it loses health (unsettled, calm escalation)
    const panicMultiplier = healthPercent < 25 ? 1.3 : healthPercent < 50 ? 1.2 : healthPercent < 75 ? 1.1 : 1.0;
    const hoverSpeed = HOVER_SPEED * panicMultiplier;
    const hoverY = Math.sin(this.time * hoverSpeed) * HOVER_RANGE_Y;
    const hoverX = Math.sin(this.time * 0.7 * panicMultiplier) * HOVER_RANGE_X;
    
    // Very gentle wobble when critical (uneasy, not frantic)
    const jitterX = healthPercent < 25 ? Math.sin(this.time * 6) * 0.8 : 0;
    const jitterY = healthPercent < 25 ? Math.cos(this.time * 5) * 0.5 : 0;
    
    // Subtle squash/stretch - ghosts are ethereal, not squishy
    const squashStretch = 1 + Math.sin(this.time * hoverSpeed) * 0.02;
    this.container.scale.x = squashStretch;
    this.container.scale.y = 1 + (1 - squashStretch) * 0.4;
    
    // === PHASE-BASED TRANSPARENCY ===
    // Ghost fades as it loses grip on reality
    const healthAlpha = healthPercent < 25 ? 0.45 : healthPercent < 50 ? 0.55 : healthPercent < 75 ? 0.65 : BASE_ALPHA;
    const pulseSpeed = PULSE_SPEED * (healthPercent < 50 ? 1.5 : 1.0);  // Faster pulse when hurt
    const pulseAlpha = Math.sin(this.time * pulseSpeed) * 0.1;
    this.container.alpha = healthAlpha + pulseAlpha;
    
    // Apply shake + recoil + hover + jitter
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 8);
    this.container.pivot.x = -shakeOffset - this.effects.recoil - hoverX + jitterX;
    this.container.pivot.y = -hoverY + jitterY;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING - Ghost-specific
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawWisps(healthPercent);
    this.drawBody(healthPercent);
    this.drawCore(healthPercent);
    this.drawParticles(healthPercent);
    this.drawEyes(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 85);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /**
   * Trailing wisps - ghostly essence escaping as health drops
   * More wisps = ghost losing its form
   * Wisps also shift color with body
   */
  private drawWisps(healthPercent: number): void {
    this.wispsGraphics.clear();
    if (healthPercent > 75) return;  // Start showing at 75%
    
    // More wisps as health drops (essence leaking out)
    const wispCount = healthPercent < 25 ? 5 : healthPercent < 50 ? 3 : 2;
    const wispSpeed = healthPercent < 25 ? 0.8 : healthPercent < 50 ? 0.6 : 0.4;
    const baseAlpha = this.flickerAlpha * (healthPercent < 25 ? 0.6 : 0.4);
    
    // Wisps shift color with body
    const sickliness = Math.min(0.6, (100 - healthPercent) / 166);
    const wispColor = shiftToSickly(this.colors.WISP, sickliness);
    
    for (let i = 0; i < wispCount; i++) {
      const phase = (this.time * wispSpeed + i * 0.5) % 2;
      const wispY = 75 + phase * 30;
      const wispX = Math.sin(this.time * 1.5 + i * 2) * (10 + i * 3);
      const wispSize = 6 - phase * 2.5;
      const alpha = baseAlpha * (1 - phase / 2);
      
      this.wispsGraphics.circle(wispX, wispY, wispSize);
      this.wispsGraphics.fill({ color: wispColor, alpha });
    }
  }
  
  /**
   * Main ghost body - pale, ethereal, very different from slime
   * Hit flicker applied here (not container) so eyes stay visible
   * Color shifts toward sickly purple as HP drops
   */
  private drawBody(healthPercent: number): void {
    this.bodyGraphics.clear();
    
    // Color shift: ghost gets sickly purple as it loses HP
    // 100% HP = 0% shifted, 0% HP = 60% shifted (noticeable but not garish)
    const sickliness = Math.min(0.6, (100 - healthPercent) / 166);
    const baseColor = shiftToSickly(this.colors.BODY, sickliness);
    const bodyColor = this.effects.isHit ? 0xFFFFFF : baseColor;
    
    // Hit flicker - body phases out dramatically, eyes don't
    const hitAlpha = this.flickerAlpha < 1 ? this.flickerAlpha * 0.3 : 1;
    
    // Outer glow - more contrast
    this.drawGhosttyShape(this.bodyGraphics, 70, 98, bodyColor, 0.35 * hitAlpha);
    
    // Main body
    this.drawGhosttyShape(this.bodyGraphics, 55, 80, bodyColor, 0.95 * hitAlpha);
  }
  
  /**
   * Draw ghost: dome top + flared body + wavy bottom
   */
  private drawGhosttyShape(g: PIXI.Graphics, width: number, height: number, color: number, alpha: number): void {
    const halfW = width / 2;
    const domeRadius = halfW;  // Dome is semicircle matching body width
    const bodyTop = -domeRadius;  // Where dome meets body
    const bodyBottom = height - domeRadius;  // Bottom of body before waves
    
    // Flare: bottom is wider than top
    const flareAmount = width * 0.2;  // 20% wider at bottom
    const bottomHalfW = halfW + flareAmount;
    
    // Wave parameters for bottom edge
    const waveCount = 3;
    const bottomWidth = bottomHalfW * 2;
    const waveWidth = bottomWidth / waveCount;
    const waveHeight = 15 + Math.sin(this.time * 2.5) * 3;
    
    g.beginPath();
    
    // Start at left side of dome bottom
    g.moveTo(-halfW, bodyTop);
    
    // Left side - curve outward (flare)
    g.quadraticCurveTo(-halfW - flareAmount * 0.3, bodyBottom * 0.5, -bottomHalfW, bodyBottom);
    
    // Wavy bottom edge (3 smooth waves)
    for (let i = 0; i < waveCount; i++) {
      const startX = -bottomHalfW + waveWidth * i;
      const midX = startX + waveWidth / 2;
      const endX = startX + waveWidth;
      const waveOffset = Math.sin(this.time * 3 + i * 1.2) * 4;
      
      // Quadratic curve down then up
      g.quadraticCurveTo(midX, bodyBottom + waveHeight + waveOffset, endX, bodyBottom);
    }
    
    // Right side - curve inward (reverse flare back to dome width)
    g.quadraticCurveTo(halfW + flareAmount * 0.3, bodyBottom * 0.5, halfW, bodyTop);
    
    // Dome (semicircle arc from right to left)
    g.arc(0, bodyTop, domeRadius, 0, Math.PI, true);
    
    g.closePath();
    g.fill({ color, alpha });
  }
  
  /**
   * Inner core - subtle highlight (keep it simple like Ghostty)
   */
  private drawCore(_healthPercent: number): void {
    // Ghostty style is minimal - skip the core shine for cleaner look
    this.coreGraphics.clear();
  }
  
  /**
   * Ethereal particles - floating around when hurt
   */
  private drawParticles(healthPercent: number): void {
    this.particlesGraphics.clear();
    if (healthPercent > 60) return;
    
    const intensity = 1 - (healthPercent / 60);
    const particleCount = healthPercent < 25 ? 6 : 4;
    
    for (let i = 0; i < particleCount; i++) {
      // Orbiting particles
      const orbitRadius = 50 + Math.sin(this.time * 2 + i) * 10;
      const angle = this.time * 1.5 + (i * Math.PI * 2 / particleCount);
      const px = Math.cos(angle) * orbitRadius;
      const py = Math.sin(angle) * orbitRadius * 0.5 - 10;
      const size = 4 + Math.sin(this.time * 4 + i * 2) * 2;
      const alpha = this.flickerAlpha * intensity * 0.7;
      
      const particleColor = healthPercent < 25 ? 0xFF6666 : this.colors.PARTICLES;
      
      this.particlesGraphics.circle(px, py, size);
      this.particlesGraphics.fill({ color: particleColor, alpha });
    }
  }
  
  /**
   * Ghost eyes - white ovals with dark pupils that look around
   * Eyes stay visible even when body flickers (container handles overall fade)
   * At critical health: eyes glow bright (desperate last energy)
   */
  private drawEyes(healthPercent: number): void {
    this.eyesGraphics.clear();
    
    // Eyes in dome area
    const eyeY = -22;
    const eyeSpacing = 14;
    
    // Phase-based eye behavior
    const isAgitated = healthPercent < 75;
    const isPanicking = healthPercent < 50;
    const isCritical = healthPercent < 25;
    
    // Eyes get bigger when scared, pupils dilate
    const eyeWidth = isCritical ? 10 : isPanicking ? 9 : 8;
    const eyeHeight = isCritical ? 12 : isPanicking ? 11 : 10;
    const pupilSize = isCritical ? 2 : isPanicking ? 2.5 : 3;  // Pupils shrink in fear
    
    // Pupils dart around faster when panicking
    const lookSpeed = isCritical ? 2.0 : isPanicking ? 1.2 : isAgitated ? 0.7 : 0.4;
    const lookRange = isCritical ? 2.5 : isPanicking ? 1.8 : 1.0;
    const lookX = Math.sin(this.time * lookSpeed) * lookRange;
    const lookY = Math.cos(this.time * lookSpeed * 0.8) * lookRange * 0.8;
    
    // Eye glow at critical (bright, pulsing)
    const eyeColor = isCritical ? 0xFFFFFF : this.colors.EYE_GLOW;
    const glowPulse = isCritical ? 0.3 + Math.sin(this.time * 6) * 0.2 : 0;
    
    // Left eye outer glow (only at critical)
    if (isCritical) {
      this.eyesGraphics.ellipse(-eyeSpacing, eyeY, eyeWidth + 4, eyeHeight + 4);
      this.eyesGraphics.fill({ color: 0xAADDFF, alpha: glowPulse });
    }
    
    // Left eye
    this.eyesGraphics.ellipse(-eyeSpacing, eyeY, eyeWidth, eyeHeight);
    this.eyesGraphics.fill({ color: eyeColor, alpha: 1 });
    
    // Left pupil
    this.eyesGraphics.circle(-eyeSpacing + lookX, eyeY + lookY + 1, pupilSize);
    this.eyesGraphics.fill({ color: this.colors.EYE_INNER, alpha: 1 });
    
    // Right eye outer glow (only at critical)
    if (isCritical) {
      this.eyesGraphics.ellipse(eyeSpacing, eyeY, eyeWidth + 4, eyeHeight + 4);
      this.eyesGraphics.fill({ color: 0xAADDFF, alpha: glowPulse });
    }
    
    // Right eye
    this.eyesGraphics.ellipse(eyeSpacing, eyeY, eyeWidth, eyeHeight);
    this.eyesGraphics.fill({ color: eyeColor, alpha: 1 });
    
    // Right pupil
    this.eyesGraphics.circle(eyeSpacing + lookX, eyeY + lookY + 1, pupilSize);
    this.eyesGraphics.fill({ color: this.colors.EYE_INNER, alpha: 1 });
    
    // Wailing mouth - appears at critical, ghost is screaming
    if (isCritical) {
      const mouthY = eyeY + 24;
      // Pulsing scream - mouth opens and closes rapidly
      const mouthOpen = 5 + Math.sin(this.time * 10) * 3;
      const mouthWidth = 10 + Math.sin(this.time * 6) * 2;
      
      // Dark mouth interior
      this.eyesGraphics.ellipse(0, mouthY, mouthWidth, mouthOpen);
      this.eyesGraphics.fill({ color: this.colors.MOUTH, alpha: 0.9 });
      
      // Inner shadow (depth)
      this.eyesGraphics.ellipse(0, mouthY + 1, mouthWidth * 0.6, mouthOpen * 0.5);
      this.eyesGraphics.fill({ color: 0x111122, alpha: 0.7 });
    }
  }
}

