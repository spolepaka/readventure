import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker
} from './bossEffects';

// UFO colors - exported for config
export const UFO_COLORS = {
  BODY: 0x778899,        // Slate gray hull
  BODY_LIGHT: 0x99AABB,  // Lighter gray panels
  DOME: 0x88CCFF,        // Blue-tinted glass dome
  DOME_SHINE: 0xCCEEFF,  // Dome highlight
  LIGHTS: 0x44FF88,      // Green lights (classic UFO)
  LIGHTS_ALT: 0xFF4444,  // Red warning lights
  EYE_GLOW: 0x111111,    // Dark alien eyes (classic gray alien)
  EYE_INNER: 0x000000,   // Pure black pupils
};

export type UFOColors = typeof UFO_COLORS;

// UFO-specific constants
const SHAKE_MULTIPLIER = 0.3;
const SHAKE_DURATION = 300;
const RECOIL_MULTIPLIER = 0.4;
const RECOIL_DECAY = 0.94;

// Animation tuning
const HOVER_SPEED = 0.8;
const HOVER_RANGE_Y = 6;
const TILT_SPEED = 0.5;
const TILT_RANGE = 0.08;  // Radians
const LIGHT_COUNT = 6;

/**
 * Pure Pixi UFOBoss - "Invader"
 * Classic flying saucer with dome, eyes, and blinking lights.
 */
export class PureUFOBoss {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // UFO-specific state
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: UFOColors;
  
  // Graphics
  private bodyGraphics: PIXI.Graphics;
  private domeGraphics: PIXI.Graphics;
  private lightsGraphics: PIXI.Graphics;
  private eyesGraphics: PIXI.Graphics;
  private beamGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...UFO_COLORS, ...colorOverrides } as UFOColors;
    
    // Create graphics (order: back to front)
    this.beamGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.lightsGraphics = new PIXI.Graphics();
    this.domeGraphics = new PIXI.Graphics();
    this.eyesGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.beamGraphics);
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.lightsGraphics);
    this.container.addChild(this.domeGraphics);
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
  }
  
  public triggerShield(duration = 1500): void {
    triggerShield(this.effects, duration);
  }
  
  public triggerShake(amplitude: number): void {
    triggerShake(this.effects, amplitude, SHAKE_MULTIPLIER, SHAKE_DURATION);
  }
  
  public triggerRecoil(amount: number): void {
    triggerRecoil(this.effects, amount, RECOIL_MULTIPLIER);
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
    
    // Hover motion
    const hoverY = Math.sin(this.time * HOVER_SPEED) * HOVER_RANGE_Y;
    
    // Tilt wobble - more erratic when hurt
    const tiltMultiplier = healthPercent < 25 ? 1.8 : healthPercent < 50 ? 1.3 : 1.0;
    const tilt = Math.sin(this.time * TILT_SPEED * tiltMultiplier) * TILT_RANGE * tiltMultiplier;
    this.container.rotation = tilt;
    
    // Apply shake + recoil + hover
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 10);
    this.container.pivot.x = -shakeOffset - this.effects.recoil;
    this.container.pivot.y = -hoverY;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING - UFO-specific
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawBeam(healthPercent);
    this.drawBody(healthPercent);
    this.drawLights(healthPercent);
    this.drawDome(healthPercent);
    this.drawEyes(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 90);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /**
   * Tractor beam - appears when hurt (UFO losing power, flickering)
   */
  private drawBeam(healthPercent: number): void {
    this.beamGraphics.clear();
    if (healthPercent > 50) return;
    
    const intensity = 1 - (healthPercent / 50);
    const beamFlicker = Math.sin(this.time * 8) > 0 ? 1 : 0.3;
    
    // Cone beam from bottom
    this.beamGraphics.moveTo(0, 15);
    this.beamGraphics.lineTo(-30 - intensity * 20, 80);
    this.beamGraphics.lineTo(30 + intensity * 20, 80);
    this.beamGraphics.closePath();
    this.beamGraphics.fill({ color: this.colors.LIGHTS, alpha: 0.15 * intensity * beamFlicker });
  }
  
  /**
   * Main saucer body - ellipse hull
   */
  private drawBody(healthPercent: number): void {
    this.bodyGraphics.clear();
    
    const bodyColor = this.effects.isHit ? 0xFFFFFF : this.colors.BODY;
    
    // Main saucer (wide ellipse)
    this.bodyGraphics.ellipse(0, 0, 65, 20);
    this.bodyGraphics.fill(bodyColor);
    
    // Top ridge (where dome sits)
    this.bodyGraphics.ellipse(0, -8, 35, 10);
    this.bodyGraphics.fill(this.colors.BODY_LIGHT);
    
    // Bottom rim detail
    this.bodyGraphics.ellipse(0, 8, 55, 8);
    this.bodyGraphics.fill({ color: 0x556677, alpha: 0.6 });
    
    // Damage cracks at low health
    if (healthPercent < 25) {
      this.bodyGraphics.moveTo(-30, -5);
      this.bodyGraphics.lineTo(-20, 5);
      this.bodyGraphics.lineTo(-35, 10);
      this.bodyGraphics.stroke({ width: 2, color: 0x333333, alpha: 0.6 });
      
      this.bodyGraphics.moveTo(25, 0);
      this.bodyGraphics.lineTo(35, 8);
      this.bodyGraphics.stroke({ width: 2, color: 0x333333, alpha: 0.6 });
    }
  }
  
  /**
   * Lights around the rim - smooth rotation, one bright at a time
   */
  private drawLights(healthPercent: number): void {
    this.lightsGraphics.clear();
    
    // Rotation speed increases when hurt
    const rotationSpeed = healthPercent < 25 ? 1.5 : healthPercent < 50 ? 1.0 : 0.5;
    const lightRadius = 55;
    const lightColor = healthPercent < 25 ? this.colors.LIGHTS_ALT : this.colors.LIGHTS;
    
    // Which light is "active" (smoothly rotating)
    const activeLight = (this.time * rotationSpeed) % LIGHT_COUNT;
    
    for (let i = 0; i < LIGHT_COUNT; i++) {
      const angle = (i / LIGHT_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * lightRadius;
      const y = Math.sin(angle) * 8;  // Flattened for ellipse perspective
      
      // Distance from active light (wrapping around)
      const dist = Math.min(
        Math.abs(activeLight - i),
        Math.abs(activeLight - i + LIGHT_COUNT),
        Math.abs(activeLight - i - LIGHT_COUNT)
      );
      
      // Brightness falls off from active light
      const brightness = Math.max(0, 1 - dist * 0.4);
      
      if (brightness > 0.1) {
        // Glow
        this.lightsGraphics.circle(x, y, 5 + brightness * 2);
        this.lightsGraphics.fill({ color: lightColor, alpha: 0.2 * brightness });
        
        // Core
        this.lightsGraphics.circle(x, y, 2 + brightness * 2);
        this.lightsGraphics.fill({ color: lightColor, alpha: 0.5 + brightness * 0.4 });
      } else {
        // Dim base light (always visible)
        this.lightsGraphics.circle(x, y, 2);
        this.lightsGraphics.fill({ color: lightColor, alpha: 0.2 });
      }
    }
  }
  
  /**
   * Glass dome with alien visible inside
   */
  private drawDome(healthPercent: number): void {
    this.domeGraphics.clear();
    
    // Dome (semicircle arc)
    this.domeGraphics.arc(0, -8, 28, Math.PI, 0, false);
    this.domeGraphics.lineTo(28, -8);
    this.domeGraphics.lineTo(-28, -8);
    this.domeGraphics.closePath();
    this.domeGraphics.fill({ color: this.colors.DOME, alpha: 0.7 });
    
    // Dome shine/highlight
    this.domeGraphics.arc(-8, -18, 10, Math.PI, 0, false);
    this.domeGraphics.fill({ color: this.colors.DOME_SHINE, alpha: 0.4 });
    
    // Dome crack at critical health
    if (healthPercent < 25) {
      this.domeGraphics.moveTo(-5, -30);
      this.domeGraphics.lineTo(0, -20);
      this.domeGraphics.lineTo(8, -28);
      this.domeGraphics.stroke({ width: 2, color: 0xFFFFFF, alpha: 0.5 });
    }
  }
  
  /**
   * Alien eyes visible through dome
   */
  private drawEyes(healthPercent: number): void {
    this.eyesGraphics.clear();
    
    const eyeY = -22;
    const eyeSpacing = 10;
    
    // Phase-based behavior
    const isPanicking = healthPercent < 50;
    const isCritical = healthPercent < 25;
    
    // Eye size (bigger when scared)
    const eyeWidth = isCritical ? 7 : isPanicking ? 6 : 5;
    const eyeHeight = isCritical ? 10 : isPanicking ? 9 : 8;
    const pupilSize = isCritical ? 2 : 2.5;
    
    // Eyes dart around when panicking
    const lookSpeed = isCritical ? 3 : isPanicking ? 1.5 : 0.6;
    const lookRange = isCritical ? 2 : isPanicking ? 1.5 : 1;
    const lookX = Math.sin(this.time * lookSpeed) * lookRange;
    const lookY = Math.cos(this.time * lookSpeed * 0.7) * lookRange * 0.5;
    
    // Eye glow when critical
    if (isCritical) {
      const glowPulse = 0.3 + Math.sin(this.time * 5) * 0.2;
      this.eyesGraphics.ellipse(-eyeSpacing, eyeY, eyeWidth + 3, eyeHeight + 3);
      this.eyesGraphics.ellipse(eyeSpacing, eyeY, eyeWidth + 3, eyeHeight + 3);
      this.eyesGraphics.fill({ color: this.colors.EYE_GLOW, alpha: glowPulse });
    }
    
    // Left eye
    this.eyesGraphics.ellipse(-eyeSpacing, eyeY, eyeWidth, eyeHeight);
    this.eyesGraphics.fill({ color: this.colors.EYE_GLOW, alpha: 0.9 });
    
    // Left pupil
    this.eyesGraphics.circle(-eyeSpacing + lookX, eyeY + lookY, pupilSize);
    this.eyesGraphics.fill({ color: this.colors.EYE_INNER, alpha: 1 });
    
    // Right eye
    this.eyesGraphics.ellipse(eyeSpacing, eyeY, eyeWidth, eyeHeight);
    this.eyesGraphics.fill({ color: this.colors.EYE_GLOW, alpha: 0.9 });
    
    // Right pupil
    this.eyesGraphics.circle(eyeSpacing + lookX, eyeY + lookY, pupilSize);
    this.eyesGraphics.fill({ color: this.colors.EYE_INNER, alpha: 1 });
  }
}

