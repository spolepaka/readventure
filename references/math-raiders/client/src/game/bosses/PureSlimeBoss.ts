import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker,
  checkPhaseShake
} from './bossEffects';

// Slime colors - exported for config
export const SLIME_COLORS = {
  BODY: 0x00FF88,      // Bright green
  BODY_DARK: 0x00AA55, // Darker green for shading
  SHINE: 0xFFFFFF,     // White highlight
  EYE_WHITE: 0xFFFFFF,
  EYE_PUPIL: 0x000000,
  DRIP: 0x00FF88,      // Same as body
};

export type SlimeColors = typeof SLIME_COLORS;

// Slime-specific constants
const SHAKE_MULTIPLIER = 0.5;
const SHAKE_DURATION = 300;
const RECOIL_MULTIPLIER = 0.7;
const RECOIL_DECAY = 0.85;

// Lighten a hex color by blending toward white
function lightenColor(hex: number, amount: number = 0.4): number {
  const r = (hex >> 16) & 0xFF;
  const g = (hex >> 8) & 0xFF;
  const b = hex & 0xFF;
  
  const newR = Math.min(255, Math.round(r + (255 - r) * amount));
  const newG = Math.min(255, Math.round(g + (255 - g) * amount));
  const newB = Math.min(255, Math.round(b + (255 - b) * amount));
  
  return (newR << 16) | (newG << 8) | newB;
}

// Desaturate a color (blend toward gray) - slime looks "sickly" as HP drops
function desaturateColor(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xFF;
  const g = (hex >> 8) & 0xFF;
  const b = hex & 0xFF;
  
  // Calculate luminance (perceived brightness)
  const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  
  // Blend toward gray
  const newR = Math.round(r + (gray - r) * amount);
  const newG = Math.round(g + (gray - g) * amount);
  const newB = Math.round(b + (gray - b) * amount);
  
  return (newR << 16) | (newG << 8) | newB;
}

/**
 * Pure Pixi SlimeBoss - "Gloop"
 * Uses shared bossEffects for common behavior.
 * Unique: squish animation, wobble physics, drips, sweat drops, color shift.
 */
export class PureSlimeBoss {
  public container: PIXI.Container;
  
  // Shared effect state (flash, shield, shake, recoil)
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Slime-specific state
  private time = 0;
  private squish = 1.0;
  private health: number;
  private maxHealth: number;
  private colors: SlimeColors;
  private currentPhase = -1;  // Phase tracking for shake on HP thresholds
  
  // Graphics (pre-allocated, reused every frame)
  private bodyGraphics: PIXI.Graphics;
  private eyesContainer: PIXI.Container;
  private eyesGraphics: PIXI.Graphics;
  private shineGraphics: PIXI.Graphics;
  private dripsGraphics: PIXI.Graphics;
  private sweatGraphics: PIXI.Graphics;  // Sweat drops when worried/panicking
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false; // Skip event traversal (perf tip from PixiJS docs)
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...SLIME_COLORS, ...colorOverrides } as SlimeColors;
    
    // Create graphics (order: back to front)
    this.dripsGraphics = new PIXI.Graphics();
    this.sweatGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.shineGraphics = new PIXI.Graphics();
    
    this.eyesContainer = new PIXI.Container();
    this.eyesContainer.y = -10;
    this.eyesGraphics = new PIXI.Graphics();
    this.eyesContainer.addChild(this.eyesGraphics);
    
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.dripsGraphics);
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.shineGraphics);
    this.container.addChild(this.sweatGraphics);  // Sweat drops on top of body
    this.container.addChild(this.eyesContainer);
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
  
  public triggerFlash(duration = 60): void {
    triggerFlash(this.effects, duration);
    this.squish = 0.85; // Slime-specific: compress on hit
  }
  
  public triggerShield(duration = 1500): void {
    triggerShield(this.effects, duration);
  }
  
  public triggerShake(amplitude: number): void {
    triggerShake(this.effects, amplitude, SHAKE_MULTIPLIER, SHAKE_DURATION);
    this.squish = 0.7; // Slime-specific: extra squish
  }
  
  public triggerRecoil(amount: number): void {
    triggerRecoil(this.effects, amount, RECOIL_MULTIPLIER);
    this.squish = 0.6; // Slime-specific: big squish on recoil
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
    
    // Update shared effects (flash timeout, shield timeout, recoil decay)
    updateEffects(this.effects, now, RECOIL_DECAY);
    
    // Phase change shake (all bosses get this now)
    const hpPercent = (this.health / this.maxHealth) * 100;
    this.currentPhase = checkPhaseShake(hpPercent, this.currentPhase, this.effects, 6);
    
    // Slime-specific: squish spring recovery
    if (this.squish < 1.0) {
      this.squish = Math.min(1.0, this.squish + 0.05);
    }
    
    // Apply shake + recoil to position
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 12);
    this.container.pivot.x = -shakeOffset - this.effects.recoil;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING - All slime-specific
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawDrips(healthPercent);
    this.drawBody(healthPercent);
    this.drawShine();
    this.drawSweat(healthPercent);  // Sweat drops when worried/panicking
    this.drawEyes(healthPercent);
    
    // Shield uses shared drawing
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 80);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /**
   * Sweat drops - universal panic signal kids understand
   * Appear at 50% HP, more at 25% HP
   */
  private drawSweat(healthPercent: number): void {
    this.sweatGraphics.clear();
    if (healthPercent >= 50) return;
    
    // More sweat as HP drops: 50% = 1 drop, 25% = 2 drops
    const dropCount = healthPercent < 25 ? 2 : 1;
    
    for (let i = 0; i < dropCount; i++) {
      // Drops fly off the side of the head
      const side = i === 0 ? -1 : 1;  // Left side first, then right
      const baseX = side * 35;  // Start from side of slime
      
      // Animation: drops arc outward and down
      const cycle = (this.time * 1.5 + i * 0.5) % 2;
      const arcX = baseX + side * cycle * 15;  // Move outward
      const arcY = -25 + cycle * 25 - Math.sin(cycle * Math.PI) * 20;  // Arc trajectory
      
      // Fade out as drop falls
      const alpha = Math.max(0, 1 - cycle * 0.6);
      if (alpha < 0.1) continue;
      
      // Classic anime sweat drop shape (teardrop)
      const dropSize = 6;
      this.sweatGraphics.moveTo(arcX, arcY - dropSize * 1.5);  // Top point
      this.sweatGraphics.bezierCurveTo(
        arcX + dropSize, arcY - dropSize,  // Control 1
        arcX + dropSize, arcY + dropSize,  // Control 2
        arcX, arcY + dropSize              // End bottom
      );
      this.sweatGraphics.bezierCurveTo(
        arcX - dropSize, arcY + dropSize,  // Control 1
        arcX - dropSize, arcY - dropSize,  // Control 2
        arcX, arcY - dropSize * 1.5        // Back to top
      );
      this.sweatGraphics.fill({ color: 0x88CCFF, alpha });  // Light blue
      
      // White highlight on drop
      this.sweatGraphics.circle(arcX - 1, arcY - dropSize * 0.3, 2);
      this.sweatGraphics.fill({ color: 0xFFFFFF, alpha: alpha * 0.8 });
    }
  }
  
  private drawBody(healthPercent: number): void {
    this.bodyGraphics.clear();
    
    // Color shift: slime gets progressively paler/sickly as HP drops
    // 100% HP = 0% desaturated, 0% HP = 50% desaturated (not too washed out)
    const desaturation = Math.min(0.5, (100 - healthPercent) / 200);
    const baseBodyColor = desaturateColor(this.colors.BODY, desaturation);
    const baseShadeColor = desaturateColor(this.colors.BODY_DARK, desaturation);
    
    // Hit flash uses lightened version of the (possibly desaturated) color
    const bodyColor = this.effects.isHit ? lightenColor(baseBodyColor, 0.4) : baseBodyColor;
    const shadeColor = this.effects.isHit ? lightenColor(baseShadeColor, 0.3) : baseShadeColor;
    
    // Wobble escalates at 75/50/25%
    const wobbleSpeed = healthPercent < 25 ? 5 : healthPercent < 50 ? 4 : healthPercent < 75 ? 3 : 2.5;
    const wobbleAmount = healthPercent < 25 ? 0.2 : healthPercent < 50 ? 0.15 : healthPercent < 75 ? 0.12 : 0.1;
    
    const segments = 6;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const wobble = Math.sin(this.time * wobbleSpeed + i) * wobbleAmount;
      const radius = 50 + wobble * 10;
      const offsetX = Math.cos(angle) * (30 + wobble * 5);
      const offsetY = Math.sin(angle) * (30 + wobble * 5) * this.squish;
      
      this.bodyGraphics.circle(offsetX, offsetY, radius);
    }
    this.bodyGraphics.fill({ color: bodyColor, alpha: 0.9 });
    
    this.bodyGraphics.circle(0, 0, 40 * this.squish);
    this.bodyGraphics.fill({ color: shadeColor, alpha: 0.7 });
  }
  
  private drawShine(): void {
    this.shineGraphics.clear();
    
    const shineX = -15 + Math.sin(this.time * 2) * 3;
    const shineY = -20 + Math.cos(this.time * 2) * 2;
    
    this.shineGraphics.circle(shineX, shineY, 12);
    this.shineGraphics.fill({ color: this.colors.SHINE, alpha: 0.6 });
    
    this.shineGraphics.circle(shineX - 5, shineY - 5, 6);
    this.shineGraphics.fill({ color: this.colors.SHINE, alpha: 0.8 });
  }
  
  private drawEyes(healthPercent: number): void {
    this.eyesGraphics.clear();
    
    const leftEyeY = Math.sin(this.time * 3) * 3;
    const rightEyeY = Math.sin(this.time * 3 + 1) * 3;
    const eyeSize = healthPercent < 25 ? 10 : 8;
    const pupilSize = healthPercent < 25 ? 6 : 4;
    
    this.eyesGraphics.circle(-15, leftEyeY, eyeSize);
    this.eyesGraphics.fill(this.colors.EYE_WHITE);
    this.eyesGraphics.circle(-15, leftEyeY + 1, pupilSize);
    this.eyesGraphics.fill(this.colors.EYE_PUPIL);
    
    this.eyesGraphics.circle(15, rightEyeY, eyeSize);
    this.eyesGraphics.fill(this.colors.EYE_WHITE);
    this.eyesGraphics.circle(15, rightEyeY + 1, pupilSize);
    this.eyesGraphics.fill(this.colors.EYE_PUPIL);
  }
  
  private drawDrips(healthPercent: number): void {
    this.dripsGraphics.clear();
    if (healthPercent > 50) return;
    
    // Drips also desaturate with body color
    const desaturation = Math.min(0.5, (100 - healthPercent) / 200);
    const dripColor = desaturateColor(this.colors.DRIP, desaturation);
    
    for (let i = 0; i < 3; i++) {
      const dripX = -30 + i * 30;
      const dripY = 40 + Math.sin(this.time * 4 + i) * 10;
      const dripSize = 3 + Math.sin(this.time * 5 + i) * 1;
      
      this.dripsGraphics.ellipse(dripX, dripY, dripSize, dripSize * 1.5);
    }
    this.dripsGraphics.fill({ color: dripColor, alpha: 0.6 });
  }
}
