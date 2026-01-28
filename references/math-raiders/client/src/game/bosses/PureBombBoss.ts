import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker,
  checkPhaseShake
} from './bossEffects';

// Bomb colors - exported for config
export const BOMB_COLORS = {
  BODY: 0x3a3a50,        // Dark gray body (more visible)
  BODY_SHINE: 0x5a5a6a,  // Brighter shine
  GLOW: 0x884400,        // Stronger danger glow
  FUSE: 0x886644,        // Brown fuse
  SPARK: 0xFFAA00,       // Orange spark
  SPARK_HOT: 0xFF4400,   // Red-orange when critical
  EYE: 0xFFFFFF,         // White eyes
  PUPIL: 0x000000,       // Black pupils
};

export type BombColors = typeof BOMB_COLORS;

// Bomb-specific constants
const SHAKE_MULTIPLIER = 0.6;
const SHAKE_DURATION = 250;
const RECOIL_MULTIPLIER = 0.4;
const RECOIL_DECAY = 0.9;

// Animation
const WOBBLE_SPEED = 1.5;
const WOBBLE_RANGE = 0.03;

/**
 * Pure Pixi BombBoss - "Boomer"
 * Classic cartoon bomb with lit fuse and angry face.
 */
export class PureBombBoss {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Bomb-specific state
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: BombColors;
  private currentPhase = -1;  // Phase tracking for shake on HP thresholds
  
  // Graphics
  private bodyGraphics: PIXI.Graphics;
  private fuseGraphics: PIXI.Graphics;
  private sparkGraphics: PIXI.Graphics;
  private faceGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...BOMB_COLORS, ...colorOverrides } as BombColors;
    
    // Create graphics (order: back to front)
    this.bodyGraphics = new PIXI.Graphics();
    this.fuseGraphics = new PIXI.Graphics();
    this.sparkGraphics = new PIXI.Graphics();
    this.faceGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.fuseGraphics);
    this.container.addChild(this.sparkGraphics);
    this.container.addChild(this.faceGraphics);
    this.container.addChild(this.shieldGraphics);
    
    this.draw();
  }
  
  // ============================================================
  // PUBLIC API
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
    
    // Phase change shake (all bosses get this now)
    this.currentPhase = checkPhaseShake(healthPercent, this.currentPhase, this.effects, 7);
    
    // Wobble - more frantic when hurt (escalates at 75/50/25%)
    const wobbleMultiplier = healthPercent < 25 ? 3 : healthPercent < 50 ? 2 : healthPercent < 75 ? 1.5 : 1;
    const wobble = Math.sin(this.time * WOBBLE_SPEED * wobbleMultiplier) * WOBBLE_RANGE * wobbleMultiplier;
    this.container.rotation = wobble;
    
    // Slight hop when critical (about to explode!)
    const hopY = healthPercent < 25 ? Math.abs(Math.sin(this.time * 8)) * 5 : 0;
    
    // Apply shake + recoil + hop
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 10);
    this.container.pivot.x = -shakeOffset - this.effects.recoil;
    this.container.pivot.y = hopY;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawBody(healthPercent);
    this.drawFuse(healthPercent);
    this.drawSpark(healthPercent);
    this.drawFace(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 70);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /**
   * Main bomb body - big black circle
   */
  private drawBody(healthPercent: number): void {
    this.bodyGraphics.clear();
    
    const bodyColor = this.effects.isHit ? 0x666677 : this.colors.BODY;
    const radius = 50;
    
    // Main body
    this.bodyGraphics.circle(0, 0, radius);
    this.bodyGraphics.fill(bodyColor);
    
    // Prominent shine (visibility on dark backgrounds)
    this.bodyGraphics.circle(-18, -22, 22);
    this.bodyGraphics.fill({ color: this.colors.BODY_SHINE, alpha: 0.5 });
    
    // Flash red when critical
    if (healthPercent < 25) {
      const flash = Math.sin(this.time * 8) > 0;
      if (flash) {
        this.bodyGraphics.circle(0, 0, radius);
        this.bodyGraphics.fill({ color: 0xFF2200, alpha: 0.3 });
      }
    }
  }
  
  /**
   * Fuse at top - gets shorter as health decreases!
   */
  private drawFuse(healthPercent: number): void {
    this.fuseGraphics.clear();
    
    // Fuse hole (metal ring at top)
    this.fuseGraphics.circle(0, -50, 8);
    this.fuseGraphics.fill(0x888888);
    this.fuseGraphics.circle(0, -50, 5);
    this.fuseGraphics.fill(0x444444);
    
    // Fuse length based on health! (shorter = more danger)
    const maxFuseLength = 35;
    const fuseLength = (healthPercent / 100) * maxFuseLength + 5;
    
    // Wavy fuse line
    const fuseWave = Math.sin(this.time * 4) * 3;
    
    this.fuseGraphics.beginPath();
    this.fuseGraphics.moveTo(0, -55);
    this.fuseGraphics.quadraticCurveTo(fuseWave, -55 - fuseLength/2, 0, -55 - fuseLength);
    this.fuseGraphics.stroke({ width: 4, color: this.colors.FUSE });
  }
  
  /**
   * Spark at fuse tip - bigger and faster when hurt
   */
  private drawSpark(healthPercent: number): void {
    this.sparkGraphics.clear();
    
    // Fuse length (same calc as above)
    const maxFuseLength = 35;
    const fuseLength = (healthPercent / 100) * maxFuseLength + 5;
    const sparkY = -55 - fuseLength;
    
    // Spark size and speed based on health
    const sparkSize = healthPercent < 25 ? 12 : healthPercent < 50 ? 8 : 5;
    const sparkSpeed = healthPercent < 25 ? 12 : healthPercent < 50 ? 8 : 5;
    const sparkColor = healthPercent < 25 ? this.colors.SPARK_HOT : this.colors.SPARK;
    
    // Animated spark (flicker)
    const flicker = Math.sin(this.time * sparkSpeed) * 0.5 + 0.5;
    const currentSize = sparkSize * (0.7 + flicker * 0.6);
    
    // Main spark glow
    this.sparkGraphics.circle(0, sparkY, currentSize + 4);
    this.sparkGraphics.fill({ color: sparkColor, alpha: 0.3 });
    
    // Bright core
    this.sparkGraphics.circle(0, sparkY, currentSize);
    this.sparkGraphics.fill({ color: 0xFFFF88, alpha: 0.9 });
    
    // Small flying sparks when low health
    if (healthPercent < 50) {
      const sparkCount = healthPercent < 25 ? 4 : 2;
      for (let i = 0; i < sparkCount; i++) {
        const angle = this.time * 3 + i * (Math.PI * 2 / sparkCount);
        const dist = 10 + Math.sin(this.time * 6 + i) * 5;
        const sx = Math.cos(angle) * dist;
        const sy = sparkY + Math.sin(angle) * dist * 0.5 - 5;
        
        this.sparkGraphics.circle(sx, sy, 2);
        this.sparkGraphics.fill({ color: sparkColor, alpha: 0.7 });
      }
    }
  }
  
  /**
   * Angry face - gets angrier when hurt
   */
  private drawFace(healthPercent: number): void {
    this.faceGraphics.clear();
    
    const isPanicking = healthPercent < 50;
    const isCritical = healthPercent < 25;
    
    // Eye positions
    const eyeY = -5;
    const eyeSpacing = 18;
    const eyeSize = isCritical ? 14 : isPanicking ? 12 : 10;
    
    // Angry eyebrows (more angled when hurt)
    const browAngle = isCritical ? 0.5 : isPanicking ? 0.3 : 0.15;
    
    // Left eyebrow
    this.faceGraphics.beginPath();
    this.faceGraphics.moveTo(-eyeSpacing - 10, eyeY - eyeSize - 2);
    this.faceGraphics.lineTo(-eyeSpacing + 8, eyeY - eyeSize + 8 * browAngle);
    this.faceGraphics.stroke({ width: 4, color: 0x000000 });
    
    // Right eyebrow (mirrored)
    this.faceGraphics.beginPath();
    this.faceGraphics.moveTo(eyeSpacing + 10, eyeY - eyeSize - 2);
    this.faceGraphics.lineTo(eyeSpacing - 8, eyeY - eyeSize + 8 * browAngle);
    this.faceGraphics.stroke({ width: 4, color: 0x000000 });
    
    // Eyes - white ovals
    this.faceGraphics.ellipse(-eyeSpacing, eyeY, eyeSize * 0.7, eyeSize);
    this.faceGraphics.fill(this.colors.EYE);
    this.faceGraphics.ellipse(eyeSpacing, eyeY, eyeSize * 0.7, eyeSize);
    this.faceGraphics.fill(this.colors.EYE);
    
    // Pupils - look around, shrink when scared
    const pupilSize = isCritical ? 3 : isPanicking ? 4 : 5;
    const lookX = Math.sin(this.time * 0.8) * 2;
    const lookY = Math.cos(this.time * 0.6) * 2;
    
    this.faceGraphics.circle(-eyeSpacing + lookX, eyeY + lookY + 2, pupilSize);
    this.faceGraphics.fill(this.colors.PUPIL);
    this.faceGraphics.circle(eyeSpacing + lookX, eyeY + lookY + 2, pupilSize);
    this.faceGraphics.fill(this.colors.PUPIL);
    
    // Mouth - angry frown, opens when critical
    const mouthY = 20;
    const mouthWidth = isCritical ? 25 : 20;
    
    if (isCritical) {
      // Open mouth (yelling)
      this.faceGraphics.ellipse(0, mouthY, mouthWidth, 12);
      this.faceGraphics.fill(0x000000);
    } else {
      // Frown
      this.faceGraphics.beginPath();
      this.faceGraphics.moveTo(-mouthWidth, mouthY + 5);
      this.faceGraphics.quadraticCurveTo(0, mouthY - 8, mouthWidth, mouthY + 5);
      this.faceGraphics.stroke({ width: 4, color: 0x000000 });
    }
  }
}
