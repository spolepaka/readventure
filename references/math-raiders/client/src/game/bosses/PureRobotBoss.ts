import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker,
  checkPhaseShake
} from './bossEffects';

// Health-based eye colors
const HEALTH_COLORS = {
  HIGH: 0x00FF00,
  MEDIUM: 0xFFFF00,
  LOW: 0xFF8800,
  CRITICAL: 0xFF0000
};

// Core color shifts with health (cyan → yellow → orange → red)
const CORE_COLORS = {
  HIGH: 0x00D9FF,     // Cyan (healthy)
  MEDIUM: 0xFFFF00,   // Yellow (75%)
  LOW: 0xFF8800,      // Orange (50%)
  CRITICAL: 0xFF0000  // Red (25%)
};

function getCoreColor(healthPercent: number): number {
  if (healthPercent > 75) return CORE_COLORS.HIGH;
  if (healthPercent > 50) return CORE_COLORS.MEDIUM;
  if (healthPercent > 25) return CORE_COLORS.LOW;
  return CORE_COLORS.CRITICAL;
}

// Robot colors - exported for config
export const ROBOT_COLORS = {
  BODY: 0x4A5568,
  HEAD: 0x2D3748,
  ARMS: 0x718096,
  ANTENNA: 0xE2E8F0,
  CORE: 0x00D9FF,
};

export type RobotColors = typeof ROBOT_COLORS;

// Robot-specific constants
const SHAKE_MULTIPLIER = 1.0;
const SHAKE_DURATION = 300;
const RECOIL_MULTIPLIER = 1.0;
const RECOIL_DECAY = 0.85;

/**
 * Pure Pixi RobotBoss - "Clank"
 * Uses shared bossEffects for common behavior.
 * Unique: mechanical arms, energy core, angry aura, sparks.
 */
export class PureRobotBoss {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Robot-specific state
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: RobotColors;
  private currentPhase = -1;  // Phase tracking for shake on HP thresholds
  
  // Graphics
  private angryAuraGraphics: PIXI.Graphics;
  private bodyGraphics: PIXI.Graphics;
  private sparksGraphics: PIXI.Graphics;
  private leftArmContainer: PIXI.Container;
  private leftArmGraphics: PIXI.Graphics;
  private rightArmContainer: PIXI.Container;
  private rightArmGraphics: PIXI.Graphics;
  private coreContainer: PIXI.Container;
  private coreGraphics: PIXI.Graphics;
  private headContainer: PIXI.Container;
  private headGraphics: PIXI.Graphics;
  private antennaContainer: PIXI.Container;
  private antennaGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false; // Skip event traversal (perf tip from PixiJS docs)
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...ROBOT_COLORS, ...colorOverrides } as RobotColors;
    
    // Create graphics
    this.angryAuraGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.sparksGraphics = new PIXI.Graphics();
    
    this.leftArmContainer = new PIXI.Container();
    this.leftArmGraphics = new PIXI.Graphics();
    this.leftArmContainer.addChild(this.leftArmGraphics);
    
    this.rightArmContainer = new PIXI.Container();
    this.rightArmGraphics = new PIXI.Graphics();
    this.rightArmContainer.addChild(this.rightArmGraphics);
    
    this.coreContainer = new PIXI.Container();
    this.coreGraphics = new PIXI.Graphics();
    this.coreContainer.addChild(this.coreGraphics);
    this.coreContainer.y = 10;
    
    this.headContainer = new PIXI.Container();
    this.headGraphics = new PIXI.Graphics();
    this.headContainer.addChild(this.headGraphics);
    
    this.antennaContainer = new PIXI.Container();
    this.antennaGraphics = new PIXI.Graphics();
    this.antennaContainer.addChild(this.antennaGraphics);
    this.antennaContainer.y = -35;
    this.headContainer.addChild(this.antennaContainer);
    
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.angryAuraGraphics);
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.sparksGraphics);
    this.container.addChild(this.leftArmContainer);
    this.container.addChild(this.rightArmContainer);
    this.container.addChild(this.coreContainer);
    this.container.addChild(this.headContainer);
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
    this.currentPhase = checkPhaseShake(hpPercent, this.currentPhase, this.effects, 5);
    
    // Apply shake + recoil to position
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 10);
    this.container.x = 400 - this.effects.recoil + shakeOffset;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING - All robot-specific
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawAngryAura(healthPercent);
    this.drawBody();
    this.drawSparks(healthPercent);
    
    // Arm movement escalates at 75/50/25%
    const armSwing = healthPercent < 25 ? 6 : healthPercent < 50 ? 5 : healthPercent < 75 ? 4 : 3;
    const armAmount = healthPercent < 25 ? 10 : healthPercent < 50 ? 8 : healthPercent < 75 ? 7 : 6;
    this.leftArmContainer.x = -60 + Math.sin(this.time * armSwing) * armAmount;
    this.leftArmContainer.rotation = Math.sin(this.time * (healthPercent < 50 ? 3 : 2)) * (healthPercent < 50 ? 0.15 : 0.1);
    this.drawArm(this.leftArmGraphics);
    
    this.rightArmContainer.x = 60 + Math.sin(this.time * armSwing + Math.PI) * armAmount;
    this.rightArmContainer.rotation = Math.sin(this.time * (healthPercent < 50 ? 3 : 2) + Math.PI) * (healthPercent < 50 ? 0.15 : 0.1);
    this.drawArm(this.rightArmGraphics);
    
    this.drawCore(healthPercent);
    
    this.headContainer.y = -60 + Math.sin(this.time * 2) * 8;
    this.drawHead();
    this.drawAntenna(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 80);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  private drawAngryAura(healthPercent: number): void {
    this.angryAuraGraphics.clear();
    if (healthPercent >= 50) return;
    
    const intensity = 1 - (healthPercent / 50);
    const breathSpeed = 3 + intensity * 2;
    const breathAmount = Math.sin(this.time * breathSpeed) * 0.5 + 0.5;
    
    const outerRadius = 120 + breathAmount * 40 * intensity;
    this.angryAuraGraphics.circle(0, 0, outerRadius);
    this.angryAuraGraphics.fill({ color: 0xFF0000, alpha: 0.15 * intensity });
    
    const midRadius = 85 + breathAmount * 25 * intensity;
    this.angryAuraGraphics.circle(0, 0, midRadius);
    this.angryAuraGraphics.fill({ color: 0xFF3333, alpha: 0.2 * intensity });
    
    const innerRadius = 55 + breathAmount * 20 * intensity;
    this.angryAuraGraphics.circle(0, 0, innerRadius);
    this.angryAuraGraphics.fill({ color: 0xFF6666, alpha: 0.25 * intensity * (0.7 + breathAmount * 0.3) });
    
    this.angryAuraGraphics.circle(0, 0, outerRadius - 10);
    this.angryAuraGraphics.stroke({ width: 2, color: 0xFF0000, alpha: 0.4 * intensity * breathAmount });
    
    const corePulse = (Math.sin(this.time * 5) + 1) / 2;
    const coreRadius = 35 + corePulse * 15 * intensity;
    this.angryAuraGraphics.circle(0, 0, coreRadius);
    this.angryAuraGraphics.fill({ color: 0xFF0000, alpha: (0.2 + corePulse * 0.3) * intensity });
    
    if (healthPercent < 25) {
      const spikePulse = Math.sin(this.time * 4) * 0.3 + 0.7;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + this.time * 0.5;
        const spikeLength = 80 + Math.sin(this.time * 7 + i) * 20;
        this.angryAuraGraphics.moveTo(Math.cos(angle) * 60, Math.sin(angle) * 60);
        this.angryAuraGraphics.lineTo(Math.cos(angle) * spikeLength, Math.sin(angle) * spikeLength);
      }
      this.angryAuraGraphics.stroke({ width: 2, color: 0xFF0000, alpha: spikePulse * intensity });
    }
  }
  
  private drawBody(): void {
    this.bodyGraphics.clear();
    const bodyColor = this.effects.isHit ? 0x7A8A9A : this.colors.BODY;
    this.bodyGraphics.roundRect(-50, -30, 100, 80, 10);
    this.bodyGraphics.fill(bodyColor);
    
    this.bodyGraphics.moveTo(-50, 0);
    this.bodyGraphics.lineTo(50, 0);
    this.bodyGraphics.moveTo(0, -30);
    this.bodyGraphics.lineTo(0, 50);
    this.bodyGraphics.stroke({ width: 2, color: 0x000000, alpha: 0.3 });
  }
  
  private drawSparks(healthPercent: number): void {
    this.sparksGraphics.clear();
    if (healthPercent >= 25) return;
    
    // Deterministic sparks using sin/cos (no random = no jitter)
    for (let i = 0; i < 3; i++) {
      const sparkX = Math.sin(this.time * 8 + i * 2.5) * 50;
      const sparkY = Math.cos(this.time * 6 + i * 1.8) * 40;
      const sparkSize = 2 + Math.sin(this.time * 12 + i) * 2;
      
      this.sparksGraphics.star(sparkX, sparkY, 4, sparkSize, sparkSize * 0.5);
      this.sparksGraphics.fill({ color: 0xFFFF00, alpha: 0.8 });
    }
  }
  
  private drawArm(g: PIXI.Graphics): void {
    g.clear();
    g.roundRect(-10, -5, 20, 60, 5);
    g.fill(this.colors.ARMS);
    g.circle(0, 0, 8);
    g.fill(this.colors.BODY);
  }
  
  private drawCore(healthPercent: number): void {
    this.coreGraphics.clear();
    
    // Core color shifts with health (cyan → yellow → orange → red)
    const coreColor = getCoreColor(healthPercent);
    
    // Pulse speed increases as health drops
    const pulseSpeed = healthPercent < 25 ? 6 : healthPercent < 50 ? 5 : healthPercent < 75 ? 4 : 3;
    
    const glowSize = 20 + Math.sin(this.time * pulseSpeed) * 5;
    this.coreGraphics.circle(0, 0, glowSize);
    this.coreGraphics.fill({ color: coreColor, alpha: 0.3 });
    
    const coreSize = 12 + Math.sin(this.time * pulseSpeed * 1.5) * 3;
    this.coreGraphics.circle(0, 0, coreSize);
    this.coreGraphics.fill({ color: coreColor, alpha: 0.8 });
  }
  
  private drawHead(): void {
    this.headGraphics.clear();
    
    const headColor = this.effects.isHit ? 0x5A6A7A : this.colors.HEAD;
    this.headGraphics.circle(0, 0, 35);
    this.headGraphics.fill(headColor);
    
    this.headGraphics.roundRect(-25, -15, 50, 25, 5);
    this.headGraphics.fill(0x1A202C);
    
    const eyeColor = this.effects.showShield ? 0x00BFFF : this.getEyeColor((this.health / this.maxHealth) * 100);
    this.headGraphics.circle(-10, 0, 5);
    this.headGraphics.fill(eyeColor);
    this.headGraphics.circle(10, 0, 5);
    this.headGraphics.fill(eyeColor);
  }
  
  private drawAntenna(healthPercent: number): void {
    this.antennaGraphics.clear();
    
    this.antennaGraphics.moveTo(0, 0);
    this.antennaGraphics.lineTo(0, -20);
    this.antennaGraphics.stroke({ width: 3, color: this.colors.ANTENNA });
    
    // Antenna blinks faster as health drops (warning signal!)
    const blinkSpeed = healthPercent < 25 ? 10 : healthPercent < 50 ? 6 : healthPercent < 75 ? 4 : 2;
    const isBlinking = healthPercent < 75 && Math.sin(this.time * blinkSpeed) > 0.3;
    
    const pulseSize = this.effects.showShield 
      ? 8 + Math.sin(this.time * 8) * 3 
      : 5 + Math.sin(this.time * 4) * 2;
    
    // Antenna color matches core color, blinks on/off when hurt
    const coreColor = getCoreColor(healthPercent);
    const ballColor = this.effects.showShield ? 0xFF6600 : coreColor;
    const ballAlpha = isBlinking ? 1.0 : (healthPercent < 75 ? 0.4 : 0.8);
    
    this.antennaGraphics.circle(0, -20, pulseSize);
    this.antennaGraphics.fill({ color: ballColor, alpha: ballAlpha });
  }
  
  private getEyeColor(healthPercent: number): number {
    if (healthPercent > 75) return HEALTH_COLORS.HIGH;
    if (healthPercent > 50) return HEALTH_COLORS.MEDIUM;
    if (healthPercent > 25) return HEALTH_COLORS.LOW;
    return HEALTH_COLORS.CRITICAL;
  }
}
