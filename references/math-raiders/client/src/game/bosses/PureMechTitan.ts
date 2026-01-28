import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker,
  checkPhaseShake
} from './bossEffects';

// Mech colors - exported for config
export const MECH_COLORS = {
  ARMOR: 0x2C3E50,
  ARMOR_LIGHT: 0x34495E,
  CORE: 0x00FFFF,
  WARNING: 0xFF6B6B,
  WEAPON: 0x95A5A6,
  THRUST: 0xFF8C00,
};

export type MechColors = typeof MECH_COLORS;

// Mech-specific constants (heavier, slower feel)
const SHAKE_MULTIPLIER = 0.6;
const SHAKE_DURATION = 450;
const RECOIL_MULTIPLIER = 1.2;
const RECOIL_DECAY = 0.92;

/**
 * Pure Pixi MechTitan - "Titan"
 * Uses shared bossEffects for common behavior.
 * Unique: heavy mechanical feel, warning lights, legs, weapon arms.
 */
export class PureMechTitan {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Mech-specific state
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: MechColors;
  private currentPhase = -1;  // Phase tracking for shake on HP thresholds
  
  // Graphics
  private legsContainer: PIXI.Container;
  private leftLegGraphics: PIXI.Graphics;
  private rightLegGraphics: PIXI.Graphics;
  private leftArmContainer: PIXI.Container;
  private leftArmGraphics: PIXI.Graphics;
  private rightArmContainer: PIXI.Container;
  private rightArmGraphics: PIXI.Graphics;
  private torsoContainer: PIXI.Container;
  private torsoGraphics: PIXI.Graphics;
  private coreGraphics: PIXI.Graphics;
  private headContainer: PIXI.Container;
  private headGraphics: PIXI.Graphics;
  private sparksGraphics: PIXI.Graphics;
  private smokeGraphics: PIXI.Graphics;  // Smoke at critical HP
  private warningGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false; // Skip event traversal (perf tip from PixiJS docs)
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...MECH_COLORS, ...colorOverrides } as MechColors;
    
    // Create legs
    this.legsContainer = new PIXI.Container();
    this.legsContainer.y = 60;
    this.leftLegGraphics = new PIXI.Graphics();
    this.rightLegGraphics = new PIXI.Graphics();
    this.legsContainer.addChild(this.leftLegGraphics);
    this.legsContainer.addChild(this.rightLegGraphics);
    
    // Create arms
    this.leftArmContainer = new PIXI.Container();
    this.leftArmContainer.x = -55;
    this.leftArmContainer.y = -30;
    this.leftArmGraphics = new PIXI.Graphics();
    this.leftArmContainer.addChild(this.leftArmGraphics);
    
    this.rightArmContainer = new PIXI.Container();
    this.rightArmContainer.x = 55;
    this.rightArmContainer.y = -30;
    this.rightArmGraphics = new PIXI.Graphics();
    this.rightArmContainer.addChild(this.rightArmGraphics);
    
    // Create torso
    this.torsoContainer = new PIXI.Container();
    this.torsoGraphics = new PIXI.Graphics();
    this.coreGraphics = new PIXI.Graphics();
    this.torsoContainer.addChild(this.torsoGraphics);
    this.torsoContainer.addChild(this.coreGraphics);
    
    // Create head
    this.headContainer = new PIXI.Container();
    this.headGraphics = new PIXI.Graphics();
    this.headContainer.addChild(this.headGraphics);
    
    // Effects
    this.sparksGraphics = new PIXI.Graphics();
    this.smokeGraphics = new PIXI.Graphics();
    this.warningGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.legsContainer);
    this.container.addChild(this.leftArmContainer);
    this.container.addChild(this.rightArmContainer);
    this.container.addChild(this.torsoContainer);
    this.container.addChild(this.warningGraphics);
    this.container.addChild(this.headContainer);
    this.container.addChild(this.smokeGraphics);  // Smoke behind sparks
    this.container.addChild(this.sparksGraphics);
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
  
  public triggerFlash(duration = 60): void {
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
    
    updateEffects(this.effects, now, RECOIL_DECAY);
    
    // Phase change shake (all bosses get this now)
    const hpPercent = (this.health / this.maxHealth) * 100;
    this.currentPhase = checkPhaseShake(hpPercent, this.currentPhase, this.effects, 8);
    
    // Apply shake + recoil (mech uses pivot like slime)
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 8);
    this.container.pivot.x = -shakeOffset - this.effects.recoil;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING - All mech-specific
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    const breathe = Math.sin(this.time * 0.8) * 0.5 + 0.5;
    this.torsoContainer.y = breathe * 3;
    
    // Arm swing escalates at 75/50/25%
    const armSwing = healthPercent < 25 ? 0.2 : healthPercent < 50 ? 0.15 : healthPercent < 75 ? 0.1 : 0.08;
    this.leftArmContainer.rotation = Math.sin(this.time * 2) * armSwing;
    this.rightArmContainer.rotation = Math.sin(this.time * 2 + Math.PI) * armSwing;
    
    this.headContainer.y = -70 + Math.sin(this.time * 1.2) * 4;
    
    this.drawLegs();
    this.drawArms();
    this.drawTorso();
    this.drawCore(healthPercent);
    this.drawWarningLights(healthPercent);
    this.drawHead(healthPercent);
    this.drawSmoke(healthPercent);
    this.drawSparks(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 100);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  private drawWarningLights(healthPercent: number): void {
    this.warningGraphics.clear();
    if (healthPercent >= 50) return;
    
    const intensity = 1 - (healthPercent / 50);
    const blinkSpeed = 4 + intensity * 4;
    const blink = Math.sin(this.time * blinkSpeed) > 0;
    
    if (blink) {
      this.warningGraphics.circle(0, 0, 6);
      this.warningGraphics.fill({ color: 0xFF0000, alpha: 0.9 * intensity });
      
      if (healthPercent < 25) {
        this.warningGraphics.circle(-25, -10, 4);
        this.warningGraphics.circle(25, -10, 4);
        this.warningGraphics.fill({ color: 0xFF3300, alpha: 0.7 * intensity });
      }
    }
  }
  
  private drawLegs(): void {
    // Left leg
    this.leftLegGraphics.clear();
    this.leftLegGraphics.x = -30;
    
    this.leftLegGraphics.moveTo(-15, 0);
    this.leftLegGraphics.lineTo(-10, 50);
    this.leftLegGraphics.lineTo(10, 50);
    this.leftLegGraphics.lineTo(15, 0);
    this.leftLegGraphics.closePath();
    this.leftLegGraphics.fill(this.colors.ARMOR);
    
    this.leftLegGraphics.roundRect(-18, 50, 36, 8, 3);
    this.leftLegGraphics.fill(this.colors.ARMOR_LIGHT);
    
    this.leftLegGraphics.circle(0, 25, 6);
    this.leftLegGraphics.fill(this.colors.ARMOR_LIGHT);
    
    // Right leg
    this.rightLegGraphics.clear();
    this.rightLegGraphics.x = 30;
    
    this.rightLegGraphics.moveTo(-15, 0);
    this.rightLegGraphics.lineTo(-10, 50);
    this.rightLegGraphics.lineTo(10, 50);
    this.rightLegGraphics.lineTo(15, 0);
    this.rightLegGraphics.closePath();
    this.rightLegGraphics.fill(this.colors.ARMOR);
    
    this.rightLegGraphics.roundRect(-18, 50, 36, 8, 3);
    this.rightLegGraphics.fill(this.colors.ARMOR_LIGHT);
    
    this.rightLegGraphics.circle(0, 25, 6);
    this.rightLegGraphics.fill(this.colors.ARMOR_LIGHT);
  }
  
  private drawArms(): void {
    const armorColor = this.effects.isHit ? 0x4A5E70 : this.colors.ARMOR;
    
    // Left arm
    this.leftArmGraphics.clear();
    this.leftArmGraphics.roundRect(-12, 0, 24, 50, 5);
    this.leftArmGraphics.fill(armorColor);
    
    this.leftArmGraphics.circle(0, 0, 10);
    this.leftArmGraphics.fill(this.colors.ARMOR_LIGHT);
    this.leftArmGraphics.circle(0, 50, 8);
    this.leftArmGraphics.fill(this.colors.ARMOR_LIGHT);
    
    this.leftArmGraphics.moveTo(-10, 50);
    this.leftArmGraphics.lineTo(10, 50);
    this.leftArmGraphics.lineTo(8, 90);
    this.leftArmGraphics.lineTo(-8, 90);
    this.leftArmGraphics.closePath();
    this.leftArmGraphics.fill(armorColor);
    
    this.leftArmGraphics.roundRect(-6, 90, 12, 15, 3);
    this.leftArmGraphics.fill(this.colors.WEAPON);
    
    // Right arm
    this.rightArmGraphics.clear();
    this.rightArmGraphics.roundRect(-12, 0, 24, 50, 5);
    this.rightArmGraphics.fill(armorColor);
    
    this.rightArmGraphics.circle(0, 0, 10);
    this.rightArmGraphics.fill(this.colors.ARMOR_LIGHT);
    this.rightArmGraphics.circle(0, 50, 8);
    this.rightArmGraphics.fill(this.colors.ARMOR_LIGHT);
    
    this.rightArmGraphics.moveTo(-10, 50);
    this.rightArmGraphics.lineTo(10, 50);
    this.rightArmGraphics.lineTo(8, 90);
    this.rightArmGraphics.lineTo(-8, 90);
    this.rightArmGraphics.closePath();
    this.rightArmGraphics.fill(armorColor);
    
    this.rightArmGraphics.roundRect(-6, 90, 12, 15, 3);
    this.rightArmGraphics.fill(this.colors.WEAPON);
  }
  
  private drawTorso(): void {
    this.torsoGraphics.clear();
    
    const armorColor = this.effects.isHit ? 0x4A5E70 : this.colors.ARMOR;
    
    this.torsoGraphics.moveTo(-50, -40);
    this.torsoGraphics.lineTo(50, -40);
    this.torsoGraphics.lineTo(40, 40);
    this.torsoGraphics.lineTo(-40, 40);
    this.torsoGraphics.closePath();
    this.torsoGraphics.fill(armorColor);
    
    this.torsoGraphics.moveTo(-50, -40);
    this.torsoGraphics.lineTo(40, 40);
    this.torsoGraphics.moveTo(50, -40);
    this.torsoGraphics.lineTo(-40, 40);
    this.torsoGraphics.moveTo(-50, 0);
    this.torsoGraphics.lineTo(50, 0);
    this.torsoGraphics.stroke({ width: 2, color: 0x000000, alpha: 0.3 });
    
    this.torsoGraphics.roundRect(-60, -50, 20, 25, 3);
    this.torsoGraphics.fill(this.colors.ARMOR_LIGHT);
    this.torsoGraphics.roundRect(40, -50, 20, 25, 3);
    this.torsoGraphics.fill(this.colors.ARMOR_LIGHT);
  }
  
  private drawCore(healthPercent: number): void {
    this.coreGraphics.clear();
    
    const systemSpeed = healthPercent < 30 ? 8 : 4;
    const pulse = Math.sin(this.time * systemSpeed) * 0.5 + 0.5;
    const coreSize = 18 + pulse * 6;
    const coreColor = healthPercent < 25 ? this.colors.WARNING : this.colors.CORE;
    
    this.coreGraphics.circle(0, 0, coreSize + 10);
    this.coreGraphics.fill({ color: coreColor, alpha: 0.2 });
    
    this.coreGraphics.circle(0, 0, coreSize + 5);
    this.coreGraphics.fill({ color: coreColor, alpha: 0.4 });
    
    this.coreGraphics.circle(0, 0, coreSize);
    this.coreGraphics.fill({ color: coreColor, alpha: 0.9 });
    
    this.coreGraphics.circle(0, 0, coreSize * 0.4);
    this.coreGraphics.fill({ color: 0xFFFFFF, alpha: 0.8 });
  }
  
  private drawHead(healthPercent: number): void {
    this.headGraphics.clear();
    
    const armorColor = this.effects.isHit ? 0x4A5E70 : this.colors.ARMOR;
    
    const size = 30;
    for (let i = 0; i <= 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * size;
      const y = Math.sin(angle) * (size * 0.7);
      if (i === 0) {
        this.headGraphics.moveTo(x, y);
      } else {
        this.headGraphics.lineTo(x, y);
      }
    }
    this.headGraphics.closePath();
    this.headGraphics.fill(armorColor);
    
    const visorColor = healthPercent < 25 ? this.colors.WARNING : this.colors.CORE;
    this.headGraphics.roundRect(-25, -5, 50, 8, 4);
    this.headGraphics.fill({ color: visorColor, alpha: 0.9 });
    
    const glowPulse = Math.sin(this.time * 4) * 0.3 + 0.7;
    this.headGraphics.roundRect(-25, -5, 50, 8, 4);
    this.headGraphics.fill({ color: visorColor, alpha: 0.3 * glowPulse });
    
    this.headGraphics.roundRect(-3, -25, 6, 15, 2);
    this.headGraphics.fill(this.colors.WEAPON);
    this.headGraphics.circle(0, -25, 4);
    this.headGraphics.fill({ color: this.colors.WARNING, alpha: glowPulse });
  }
  
  private drawSparks(healthPercent: number): void {
    this.sparksGraphics.clear();
    if (healthPercent > 25) return;
    
    for (let i = 0; i < 5; i++) {
      const sparkX = Math.sin(this.time * 7 + i) * 70;
      const sparkY = Math.cos(this.time * 5 + i) * 50 - 20;
      const sparkSize = 2 + Math.sin(this.time * 10 + i) * 2;
      
      this.sparksGraphics.star(sparkX, sparkY, 4, sparkSize * 2, sparkSize);
      this.sparksGraphics.fill({ color: 0xFFAA00, alpha: 0.8 });
    }
  }
  
  // Static smoke source positions (Chromebook: no per-frame allocation)
  private static readonly SMOKE_SOURCES = [
    { x: -50, y: -30 },  // Left shoulder
    { x: 50, y: -30 },   // Right shoulder  
    { x: 0, y: -85 },    // Head vent
  ] as const;
  
  /**
   * Smoke - mechanical failure at 50%, more at 25%
   * Rising smoke puffs from joints indicate system breakdown
   * Chromebook-friendly: 6 particles × 2 fills = 12 draw calls max
   */
  private drawSmoke(healthPercent: number): void {
    this.smokeGraphics.clear();
    if (healthPercent > 50) return;
    
    const intensity = healthPercent < 25 ? 1.0 : 0.5;
    const smokeCount = healthPercent < 25 ? 6 : 3;
    
    for (let i = 0; i < smokeCount; i++) {
      const source = PureMechTitan.SMOKE_SOURCES[i % PureMechTitan.SMOKE_SOURCES.length];
      
      // Each puff rises and expands
      const cycle = (this.time * 0.4 + i * 0.3) % 2;
      const riseY = source.y - cycle * 60;  // Rise up
      const driftX = source.x + Math.sin(this.time * 2 + i) * 15;  // Drift sideways
      const size = 8 + cycle * 20;  // Expand as it rises
      const alpha = intensity * (1 - cycle / 2) * 0.4;  // Fade out
      
      if (alpha > 0.05) {
        // Dark smoke puff
        this.smokeGraphics.circle(driftX, riseY, size);
        this.smokeGraphics.fill({ color: 0x333344, alpha });
        
        // Lighter inner core
        this.smokeGraphics.circle(driftX - 2, riseY - 2, size * 0.5);
        this.smokeGraphics.fill({ color: 0x555566, alpha: alpha * 0.6 });
      }
    }
  }
}
