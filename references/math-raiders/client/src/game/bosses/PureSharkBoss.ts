import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker
} from './bossEffects';

// Shark colors - exported for config
export const SHARK_COLORS = {
  BODY: 0x5577AA,        // Blue-gray body
  BODY_LIGHT: 0x88AACC,  // Lighter underbelly
  FIN: 0x446699,         // Darker fin
  EYE: 0x111111,         // Dark eye
  TEETH: 0xFFFFFF,       // White teeth
};

export type SharkColors = typeof SHARK_COLORS;

// Shark-specific constants
const SHAKE_MULTIPLIER = 0.5;
const SHAKE_DURATION = 250;
const RECOIL_MULTIPLIER = 0.5;
const RECOIL_DECAY = 0.92;

// Animation tuning
const SWIM_SPEED = 1.2;
const SWIM_RANGE = 4;
const SWAY_SPEED = 0.8;
const SWAY_RANGE = 0.05;  // Rotation sway

/**
 * Pure Pixi SharkBoss - "Chomper"
 * Classic shark with dorsal fin, simple but recognizable.
 */
export class PureSharkBoss {
  public container: PIXI.Container;
  
  // Shared effect state
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  
  // Shark-specific state
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: SharkColors;
  
  // Graphics
  private bodyGraphics: PIXI.Graphics;
  private finGraphics: PIXI.Graphics;
  private tailGraphics: PIXI.Graphics;
  private faceGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...SHARK_COLORS, ...colorOverrides } as SharkColors;
    
    // Create graphics (order: back to front)
    this.tailGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.finGraphics = new PIXI.Graphics();
    this.faceGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Render order
    this.container.addChild(this.tailGraphics);
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.finGraphics);
    this.container.addChild(this.faceGraphics);
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
    
    // Swimming motion - side to side
    const swimMultiplier = healthPercent < 25 ? 1.8 : healthPercent < 50 ? 1.3 : 1.0;
    const swimX = Math.sin(this.time * SWIM_SPEED * swimMultiplier) * SWIM_RANGE;
    const swimY = Math.sin(this.time * SWIM_SPEED * 0.5) * (SWIM_RANGE * 0.5);
    
    // Sway rotation (like swimming through water)
    const sway = Math.sin(this.time * SWAY_SPEED * swimMultiplier) * SWAY_RANGE * swimMultiplier;
    this.container.rotation = sway;
    
    // Apply shake + recoil + swim
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 10);
    this.container.pivot.x = -shakeOffset - this.effects.recoil - swimX;
    this.container.pivot.y = -swimY;
    
    this.draw();
  }
  
  // ============================================================
  // DRAWING - Shark-specific
  // ============================================================
  
  private draw(): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawTail(healthPercent);
    this.drawBody(healthPercent);
    this.drawFin(healthPercent);
    this.drawFace(healthPercent);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 80);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /**
   * Tail fin - classic shark tail shape
   */
  private drawTail(healthPercent: number): void {
    this.tailGraphics.clear();
    
    const tailSwish = Math.sin(this.time * 3) * (healthPercent < 50 ? 5 : 2);
    
    // Shark tail - upper lobe bigger than lower
    this.tailGraphics.beginPath();
    this.tailGraphics.moveTo(48, 0);
    this.tailGraphics.lineTo(68 + tailSwish, -22);  // Upper lobe (bigger)
    this.tailGraphics.lineTo(56, -4);
    this.tailGraphics.lineTo(56, 4);
    this.tailGraphics.lineTo(64 + tailSwish, 16);   // Lower lobe (smaller)
    this.tailGraphics.lineTo(48, 0);
    this.tailGraphics.closePath();
    this.tailGraphics.fill(this.colors.FIN);
  }
  
  /**
   * Main body - sleek curved torpedo shape
   */
  private drawBody(healthPercent: number): void {
    this.bodyGraphics.clear();
    
    const bodyColor = this.effects.isHit ? 0xFFFFFF : this.colors.BODY;
    
    // Sleek shark body - smooth curves
    this.bodyGraphics.beginPath();
    this.bodyGraphics.moveTo(-70, 0);  // Nose tip
    this.bodyGraphics.quadraticCurveTo(-50, -22, 0, -26);   // Top curve to dorsal
    this.bodyGraphics.quadraticCurveTo(35, -22, 50, 0);     // Back top
    this.bodyGraphics.quadraticCurveTo(35, 18, 0, 20);      // Back bottom
    this.bodyGraphics.quadraticCurveTo(-50, 18, -70, 0);    // Bottom to nose
    this.bodyGraphics.closePath();
    this.bodyGraphics.fill(bodyColor);
    
    // Lighter underbelly
    this.bodyGraphics.beginPath();
    this.bodyGraphics.moveTo(-60, 4);
    this.bodyGraphics.quadraticCurveTo(-30, 16, 0, 17);
    this.bodyGraphics.quadraticCurveTo(30, 15, 45, 4);
    this.bodyGraphics.quadraticCurveTo(30, 13, 0, 15);
    this.bodyGraphics.quadraticCurveTo(-30, 14, -60, 4);
    this.bodyGraphics.closePath();
    this.bodyGraphics.fill(this.colors.BODY_LIGHT);
    
    // Gills (simple curved lines)
    for (let i = 0; i < 3; i++) {
      const gillX = 10 + i * 8;
      this.bodyGraphics.beginPath();
      this.bodyGraphics.arc(gillX, 0, 10, -0.7, 0.7, false);
      this.bodyGraphics.stroke({ width: 2, color: 0x335577, alpha: 0.5 });
    }
    
    // Scars when hurt
    if (healthPercent < 25) {
      this.bodyGraphics.moveTo(-30, -15);
      this.bodyGraphics.lineTo(-20, -5);
      this.bodyGraphics.stroke({ width: 2, color: 0x993333, alpha: 0.5 });
    }
  }
  
  /**
   * Dorsal fin - curved, natural looking
   */
  private drawFin(healthPercent: number): void {
    this.finGraphics.clear();
    
    const finTwitch = healthPercent < 50 ? Math.sin(this.time * 6) * 2 : 0;
    
    // Dorsal fin (curved triangle)
    this.finGraphics.beginPath();
    this.finGraphics.moveTo(-5, -25);
    this.finGraphics.quadraticCurveTo(5, -48, 12 + finTwitch, -50);  // Curve to tip
    this.finGraphics.lineTo(22, -25);
    this.finGraphics.closePath();
    this.finGraphics.fill(this.colors.FIN);
    
    // Pectoral fin (swept back)
    this.finGraphics.beginPath();
    this.finGraphics.moveTo(-25, 12);
    this.finGraphics.lineTo(-48, 30);
    this.finGraphics.lineTo(-35, 22);
    this.finGraphics.lineTo(-22, 16);
    this.finGraphics.closePath();
    this.finGraphics.fill(this.colors.FIN);
  }
  
  /**
   * Face - eye and mouth with teeth
   */
  private drawFace(healthPercent: number): void {
    this.faceGraphics.clear();
    
    const isPanicking = healthPercent < 50;
    const isCritical = healthPercent < 25;
    
    // Eye - small and beady
    const eyeY = -12;
    const eyeX = -38;
    const eyeSize = isCritical ? 5 : isPanicking ? 4 : 3;
    
    // Eye white
    this.faceGraphics.circle(eyeX, eyeY, eyeSize + 2);
    this.faceGraphics.fill({ color: 0xFFFFFF, alpha: 0.9 });
    
    // Pupil
    const lookX = Math.sin(this.time * 0.5) * 1;
    this.faceGraphics.circle(eyeX + lookX, eyeY, eyeSize);
    this.faceGraphics.fill(this.colors.EYE);
    
    // Angry glow at critical
    if (isCritical) {
      this.faceGraphics.circle(eyeX, eyeY, eyeSize + 4);
      this.faceGraphics.fill({ color: 0xFF0000, alpha: 0.2 + Math.sin(this.time * 4) * 0.1 });
    }
    
    // Mouth line
    this.faceGraphics.beginPath();
    this.faceGraphics.moveTo(-68, 2);
    this.faceGraphics.quadraticCurveTo(-50, 8, -30, 4);
    this.faceGraphics.stroke({ width: 2, color: 0x334455, alpha: 0.7 });
    
    // Teeth (more when hurt)
    const teethCount = isCritical ? 4 : isPanicking ? 3 : 2;
    for (let i = 0; i < teethCount; i++) {
      const toothX = -62 + i * 8;
      const toothSize = 5;
      
      this.faceGraphics.beginPath();
      this.faceGraphics.moveTo(toothX - 2, 5);
      this.faceGraphics.lineTo(toothX, 5 + toothSize);
      this.faceGraphics.lineTo(toothX + 2, 5);
      this.faceGraphics.closePath();
      this.faceGraphics.fill(this.colors.TEETH);
    }
  }
}

