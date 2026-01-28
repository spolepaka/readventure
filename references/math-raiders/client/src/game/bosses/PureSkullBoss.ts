import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker,
  checkPhaseShake
} from './bossEffects';

// Skull colors - exported for config
export const SKULL_COLORS = {
  BONE: 0xF5F0E6,          // Creamy bone white
  BONE_SHADOW: 0xD4C9B5,   // Darker bone shadow
  SOCKET: 0x1A1A1A,        // Dark eye sockets
  SOCKET_GLOW: 0xFF3300,   // Red glow when hurt
  NOSE: 0x2A2A2A,          // Nose hole
  TEETH: 0xF0EBD8,         // Slightly yellower teeth
  CRACK: 0x8B8070,         // Crack color
};

// Bone yellows/ages as skull takes damage (white → yellowed → brown-ish)
function ageBoneColor(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xFF;
  const g = (hex >> 8) & 0xFF;
  const b = hex & 0xFF;
  
  // Target: aged/yellowed bone (more yellow, less blue)
  const targetR = Math.min(255, r);           // Keep red
  const targetG = Math.max(0, g - 30);        // Slightly less green
  const targetB = Math.max(0, b - 80);        // Much less blue (yellowing)
  
  const newR = Math.round(r + (targetR - r) * amount);
  const newG = Math.round(g + (targetG - g) * amount);
  const newB = Math.round(b + (targetB - b) * amount);
  
  return (newR << 16) | (newG << 8) | newB;
}

export type SkullColors = typeof SKULL_COLORS;

// Skull-specific constants
const SHAKE_MULTIPLIER = 0.6;
const SHAKE_DURATION = 250;
const RECOIL_MULTIPLIER = 0.4;
const RECOIL_DECAY = 0.9;

// Animation
const FLOAT_SPEED = 1.2;
const FLOAT_RANGE = 6;

/**
 * Pure Pixi SkullBoss - "Bonehead" or similar
 * Classic skull with eye socket glow, cracks, and chattering jaw.
 */
export class PureSkullBoss {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Skull-specific state
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: SkullColors;
  private currentPhase = -1;  // Phase tracking for shake on HP thresholds
  
  // Graphics
  private craniumGraphics: PIXI.Graphics;
  private jawGraphics: PIXI.Graphics;
  private socketsGraphics: PIXI.Graphics;
  private teethGraphics: PIXI.Graphics;
  private cracksGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...SKULL_COLORS, ...colorOverrides } as SkullColors;
    
    // Create graphics (order: back to front)
    this.craniumGraphics = new PIXI.Graphics();
    this.jawGraphics = new PIXI.Graphics();
    this.socketsGraphics = new PIXI.Graphics();
    this.teethGraphics = new PIXI.Graphics();
    this.cracksGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.craniumGraphics);
    this.container.addChild(this.jawGraphics);
    this.container.addChild(this.socketsGraphics);
    this.container.addChild(this.teethGraphics);
    this.container.addChild(this.cracksGraphics);
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
    
    // Gentle float
    const floatY = Math.sin(this.time * FLOAT_SPEED) * FLOAT_RANGE;
    
    // Slight tilt that increases when hurt
    const tiltAmount = healthPercent < 25 ? 0.08 : healthPercent < 50 ? 0.04 : 0.02;
    const tilt = Math.sin(this.time * 2) * tiltAmount;
    this.container.rotation = tilt;
    
    // Shake when critical
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 10);
    this.container.pivot.x = -shakeOffset - this.effects.recoil;
    this.container.pivot.y = -floatY;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawCranium(healthPercent);
    this.drawJaw(healthPercent);
    this.drawSockets(healthPercent);
    this.drawTeeth(healthPercent);
    this.drawCracks(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 70);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /**
   * Main skull cranium - lightbulb shape like emoji
   * Bone yellows/ages as it takes damage
   */
  private drawCranium(healthPercent: number): void {
    this.craniumGraphics.clear();
    
    // Bone ages/yellows as HP drops (100% = 0% aged, 0% = 50% aged)
    const aging = Math.min(0.5, (100 - healthPercent) / 200);
    const agedBone = ageBoneColor(this.colors.BONE, aging);
    const agedShadow = ageBoneColor(this.colors.BONE_SHADOW, aging);
    
    const boneColor = this.effects.isHit ? 0xFFFFFF : agedBone;
    
    // Main cranium - round top
    this.craniumGraphics.ellipse(0, -15, 55, 50);
    this.craniumGraphics.fill(boneColor);
    
    // Lower jaw/chin area - rounded bottom, not triangular
    this.craniumGraphics.beginPath();
    this.craniumGraphics.moveTo(-50, 5);
    this.craniumGraphics.quadraticCurveTo(-40, 30, -30, 40);
    this.craniumGraphics.quadraticCurveTo(0, 50, 30, 40);
    this.craniumGraphics.quadraticCurveTo(40, 30, 50, 5);
    this.craniumGraphics.closePath();
    this.craniumGraphics.fill(boneColor);
    
    // Subtle shading on upper left
    this.craniumGraphics.ellipse(-18, -30, 18, 22);
    this.craniumGraphics.fill({ color: agedShadow, alpha: 0.15 });
  }
  
  /**
   * Lower jaw - now integrated into cranium shape
   */
  private drawJaw(_healthPercent: number): void {
    this.jawGraphics.clear();
  }
  
  /**
   * Eye sockets - big simple ovals like emoji, glow when hurt
   */
  private drawSockets(healthPercent: number): void {
    this.socketsGraphics.clear();
    
    const isPanicking = healthPercent < 50;
    const isCritical = healthPercent < 25;
    
    const socketY = -15;
    const socketSpacing = 22;
    const socketW = 13;
    const socketH = 16;
    
    // Glow intensity based on health
    let glowAlpha = 0;
    if (isCritical) {
      glowAlpha = 0.6 + Math.sin(this.time * 6) * 0.3;
    } else if (isPanicking) {
      glowAlpha = 0.3 + Math.sin(this.time * 3) * 0.15;
    } else if (healthPercent < 75) {
      glowAlpha = 0.1;
    }
    
    // Eye socket glow (behind sockets)
    if (glowAlpha > 0) {
      this.socketsGraphics.ellipse(-socketSpacing, socketY, socketW + 4, socketH + 4);
      this.socketsGraphics.fill({ color: this.colors.SOCKET_GLOW, alpha: glowAlpha });
      this.socketsGraphics.ellipse(socketSpacing, socketY, socketW + 4, socketH + 4);
      this.socketsGraphics.fill({ color: this.colors.SOCKET_GLOW, alpha: glowAlpha });
    }
    
    // Simple oval eye sockets
    this.socketsGraphics.ellipse(-socketSpacing, socketY, socketW, socketH);
    this.socketsGraphics.fill(this.colors.SOCKET);
    this.socketsGraphics.ellipse(socketSpacing, socketY, socketW, socketH);
    this.socketsGraphics.fill(this.colors.SOCKET);
    
    // Nose - triangle pointing up (point at top, flat at bottom)
    const noseY = 12;
    this.socketsGraphics.beginPath();
    this.socketsGraphics.moveTo(0, noseY);         // top point
    this.socketsGraphics.lineTo(-10, noseY + 15);  // bottom left
    this.socketsGraphics.lineTo(10, noseY + 15);   // bottom right
    this.socketsGraphics.closePath();
    this.socketsGraphics.fill(this.colors.NOSE);
  }
  
  /**
   * Teeth - simple row hanging from chin like emoji
   * Teeth also yellow with age
   */
  private drawTeeth(healthPercent: number): void {
    this.teethGraphics.clear();
    
    const isCritical = healthPercent < 25;
    const isPanicking = healthPercent < 50;
    
    // Teeth age/yellow with bone
    const aging = Math.min(0.5, (100 - healthPercent) / 200);
    const teethColor = ageBoneColor(this.colors.TEETH, aging);
    
    // Jaw chatter offset
    let jawOffset = 0;
    if (isCritical) {
      jawOffset = Math.abs(Math.sin(this.time * 15)) * 4;
    } else if (isPanicking) {
      jawOffset = Math.abs(Math.sin(this.time * 8)) * 2;
    }
    
    const teethY = 45 + jawOffset;
    const teethCount = 4;
    const teethWidth = 11;
    const teethHeight = 16;
    const gap = 3;
    const totalWidth = teethCount * teethWidth + (teethCount - 1) * gap;
    const startX = -totalWidth / 2;
    
    // Simple rectangular teeth
    for (let i = 0; i < teethCount; i++) {
      const x = startX + i * (teethWidth + gap);
      
      this.teethGraphics.roundRect(x, teethY, teethWidth, teethHeight, 2);
      this.teethGraphics.fill(teethColor);
    }
  }
  
  /**
   * Cracks appear as health decreases
   */
  private drawCracks(healthPercent: number): void {
    this.cracksGraphics.clear();
    
    if (healthPercent >= 75) return;
    
    const crackAlpha = healthPercent < 25 ? 1 : healthPercent < 50 ? 0.8 : 0.5;
    
    // First crack (appears at 75%) - on left side of forehead
    this.cracksGraphics.beginPath();
    this.cracksGraphics.moveTo(-25, -55);
    this.cracksGraphics.lineTo(-30, -40);
    this.cracksGraphics.lineTo(-22, -25);
    this.cracksGraphics.stroke({ width: 2, color: this.colors.CRACK, alpha: crackAlpha });
    
    // Branch
    this.cracksGraphics.beginPath();
    this.cracksGraphics.moveTo(-30, -40);
    this.cracksGraphics.lineTo(-40, -35);
    this.cracksGraphics.stroke({ width: 1.5, color: this.colors.CRACK, alpha: crackAlpha });
    
    if (healthPercent < 50) {
      // Second crack (appears at 50%) - on right side
      this.cracksGraphics.beginPath();
      this.cracksGraphics.moveTo(20, -50);
      this.cracksGraphics.lineTo(28, -35);
      this.cracksGraphics.lineTo(22, -20);
      this.cracksGraphics.stroke({ width: 2, color: this.colors.CRACK, alpha: crackAlpha });
    }
    
    if (healthPercent < 25) {
      // Third crack (critical) - center top
      this.cracksGraphics.beginPath();
      this.cracksGraphics.moveTo(0, -60);
      this.cracksGraphics.lineTo(-5, -45);
      this.cracksGraphics.lineTo(5, -35);
      this.cracksGraphics.stroke({ width: 2.5, color: this.colors.CRACK, alpha: 1 });
      
      // Branch from center
      this.cracksGraphics.beginPath();
      this.cracksGraphics.moveTo(-5, -45);
      this.cracksGraphics.lineTo(10, -42);
      this.cracksGraphics.stroke({ width: 1.5, color: this.colors.CRACK, alpha: 1 });
    }
  }
}
