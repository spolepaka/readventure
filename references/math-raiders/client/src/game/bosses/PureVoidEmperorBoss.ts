import * as PIXI from 'pixi.js';
import type { BossInstance } from './bossConfig';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker
} from './bossEffects';

// Void Emperor - Brighter crimson villain
export const VOID_EMPEROR_COLORS = {
  // Dark with visible red undertone
  HELMET: 0x221015,        // Dark with red tint
  HELMET_LIGHT: 0x4A2530,  // Brighter maroon highlights
  VISOR: 0xFF1133,         // Menacing red visor
  VISOR_GLOW: 0xFF3355,    // Red glow
  BODY: 0x140810,          // Dark (red undertone)
  BODY_LIGHT: 0x3A1820,    // Brighter maroon armor
  
  // Cape
  CAPE: 0x221012,          // Dark crimson cape
  CAPE_DARK: 0x100608,     // Shadow
  CAPE_EDGE: 0xFF2255,     // Bright red edge
  
  // Accents
  EMBLEM: 0xFF0033,        // Blood red emblem
  EMBLEM_GLOW: 0xFF4466,
  GAUNTLET: 0x2A1218,      // Maroon
  GAUNTLET_LIGHT: 0x502028, // Brighter maroon
  FIST_GLOW: 0xFF0055,     // Crimson energy
  
  // Effects
  GLOW: 0x440020,          // Dark red aura
  PARTICLE: 0xFF3377,      // Crimson particles
  EDGE: 0x6A3540,          // Maroon edge
  
  // Armor accents
  SHOULDER_EDGE: 0x7A4550, // Shoulder pad edge
  KNEE_EDGE: 0x6A3038,     // Knee/boot edge
  ORB_INNER: 0xFF6688,     // Energy orb inner glow
  SHIELD: 0x9933FF,        // Purple void shield
} as const;

export type VoidEmperorColors = typeof VOID_EMPEROR_COLORS;

// =============================================================================
// PHASE SYSTEM - Villain's reaction as they take damage
// CONFIDENT → ANNOYED → ENRAGED → DESPERATE
// =============================================================================

type PhaseName = 'CONFIDENT' | 'ANNOYED' | 'ENRAGED' | 'DESPERATE';

interface PhaseData {
  threshold: number;        // Enter phase when HP% drops below this
  particleCount: number;    // Rising embers count
  particleSpeed: number;    // Ember rise speed
  effectIntensity: number;  // Overall effect intensity (0.0 - 1.0)
  capeSpeed: number;        // Cape flutter speed
  visorPulse: number;       // Visor pulse speed
  scale: number;            // Boss scale (slight growth when enraged)
}

const PHASES: Record<PhaseName, PhaseData> = {
  CONFIDENT: {
    threshold: 100,  // 100-76% HP
    particleCount: 5,
    particleSpeed: 0.25,
    effectIntensity: 0.15,
    capeSpeed: 1.5,
    visorPulse: 2,
    scale: 1.0,
  },
  ANNOYED: {
    threshold: 75,   // 75-51% HP
    particleCount: 8,
    particleSpeed: 0.35,
    effectIntensity: 0.25,
    capeSpeed: 2.0,
    visorPulse: 3,
    scale: 1.02,
  },
  ENRAGED: {
    threshold: 50,   // 50-26% HP
    particleCount: 12,
    particleSpeed: 0.5,
    effectIntensity: 0.4,
    capeSpeed: 2.5,
    visorPulse: 5,
    scale: 1.05,
  },
  DESPERATE: {
    threshold: 25,   // 25-0% HP
    particleCount: 18,
    particleSpeed: 0.7,
    effectIntensity: 0.6,
    capeSpeed: 3.0,
    visorPulse: 6,
    scale: 1.08,
  },
};

const PHASE_ORDER: PhaseName[] = ['CONFIDENT', 'ANNOYED', 'ENRAGED', 'DESPERATE'];

// Static arm poses - avoid allocating arrays every frame
interface ArmPose {
  leftUpper: readonly number[][];
  leftForearm: readonly number[][];
  leftFist: readonly number[];
  rightUpper: readonly number[][];
  rightForearm: readonly number[][];
  rightFist: readonly number[];
}

const ARM_POSES: Record<PhaseName, ArmPose> = {
  CONFIDENT: {
    leftUpper: [[-32, -20], [-48, 0], [-50, 35], [-38, 38], [-36, 5], [-28, -15]],
    leftForearm: [[-50, 38], [-55, 55], [-58, 70], [-48, 75], [-40, 60], [-38, 40]],
    leftFist: [-52, 72],
    rightUpper: [[32, -20], [48, 0], [50, 35], [38, 38], [36, 5], [28, -15]],
    rightForearm: [[50, 38], [55, 55], [58, 70], [48, 75], [40, 60], [38, 40]],
    rightFist: [52, 72],
  },
  ANNOYED: {
    leftUpper: [[-32, -18], [-55, -10], [-70, 5], [-65, 15], [-50, 5], [-28, -12]],
    leftForearm: [[-70, 8], [-80, 20], [-85, 35], [-75, 40], [-68, 28], [-65, 12]],
    leftFist: [-82, 38],
    rightUpper: [[32, -18], [55, -10], [70, 5], [65, 15], [50, 5], [28, -12]],
    rightForearm: [[70, 8], [80, 20], [85, 35], [75, 40], [68, 28], [65, 12]],
    rightFist: [82, 38],
  },
  ENRAGED: {
    leftUpper: [[-32, -18], [-50, -25], [-55, -40], [-45, -45], [-42, -30], [-28, -12]],
    leftForearm: [[-52, -42], [-58, -55], [-55, -70], [-45, -68], [-42, -55], [-45, -42]],
    leftFist: [-52, -68],
    rightUpper: [[32, -18], [50, -25], [55, -40], [45, -45], [42, -30], [28, -12]],
    rightForearm: [[52, -42], [58, -55], [55, -70], [45, -68], [42, -55], [45, -42]],
    rightFist: [52, -68],
  },
  DESPERATE: {
    leftUpper: [[-32, -18], [-60, -5], [-75, 15], [-68, 25], [-55, 10], [-28, -12]],
    leftForearm: [[-75, 18], [-90, 30], [-95, 45], [-85, 50], [-78, 38], [-72, 22]],
    leftFist: [-92, 48],
    rightUpper: [[32, -18], [60, -5], [75, 15], [68, 25], [55, 10], [28, -12]],
    rightForearm: [[75, 18], [90, 30], [95, 45], [85, 50], [78, 38], [72, 22]],
    rightFist: [92, 48],
  },
};

function getPhase(hpPercent: number): PhaseData {
  for (let i = PHASE_ORDER.length - 1; i >= 0; i--) {
    const phaseName = PHASE_ORDER[i];
    if (hpPercent <= PHASES[phaseName].threshold) {
      return PHASES[phaseName];
    }
  }
  return PHASES.CONFIDENT;
}

/**
 * Void Emperor - Ultimate Villain Boss
 * 
 * 4-phase system: CONFIDENT → ANNOYED → ENRAGED → DESPERATE
 * Effects intensify as HP drops.
 */
// Shared effect constants
const SHAKE_MULTIPLIER = 0.5;
const SHAKE_DURATION = 300;
const RECOIL_MULTIPLIER = 0.6;
const RECOIL_DECAY = 0.88;

export class PureVoidEmperorBoss implements BossInstance {
  public container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private glowGraphics: PIXI.Graphics;
  private particleGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  private hp: number;
  private maxHp: number;
  private time: number = 0;
  
  // Shared effects system (same as Nova)
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  private baseX: number;
  private baseY: number;
  private currentPhase: PhaseName = 'CONFIDENT';
  
  private colors: VoidEmperorColors;

  constructor(x: number, y: number, hp: number, maxHp: number, colorOverrides?: Partial<VoidEmperorColors>) {
    this.colors = { ...VOID_EMPEROR_COLORS, ...colorOverrides };
    this.hp = hp;
    this.maxHp = maxHp;
    this.baseX = x;
    this.baseY = y;
    
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    
    // Glow layer (behind)
    this.glowGraphics = new PIXI.Graphics();
    this.container.addChild(this.glowGraphics);
    
    // Main graphics
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    // Particles (front)
    this.particleGraphics = new PIXI.Graphics();
    this.container.addChild(this.particleGraphics);
    
    // Shield (frontmost)
    this.shieldGraphics = new PIXI.Graphics();
    this.container.addChild(this.shieldGraphics);
    
    this.draw();
  }

  private getPhaseName(hpPercent: number): PhaseName {
    if (hpPercent <= 25) return 'DESPERATE';
    if (hpPercent <= 50) return 'ENRAGED';
    if (hpPercent <= 75) return 'ANNOYED';
    return 'CONFIDENT';
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    
    // Get current phase based on HP
    const hpPercent = this.maxHp > 0 ? (this.hp / this.maxHp) * 100 : 100;
    const phase = getPhase(hpPercent);
    const phaseName = this.getPhaseName(hpPercent);
    
    // Draw order: cape → legs → body → arms → helmet → visor
    this.drawCape(g, phase);
    this.drawLegs(g);
    this.drawBody(g);
    this.drawArms(g, phaseName);
    this.drawHelmet(g);
    this.drawVisor(g, phase);
    this.drawEmblem(g);
    
    this.drawGlow(phase);
    this.drawParticles(phase);
    this.drawShieldEffect();
  }
  
  /**
   * SHIELD - Dark void shield (wrong answer feedback)
   */
  private drawShieldEffect(): void {
    const g = this.shieldGraphics;
    
    if (this.effects.showShield) {
      // Purple void shield - distinct from Nova's blue
      drawShield(g, this.time, 80, 6, this.colors.SHIELD);
    } else {
      g.clear();
    }
  }

  /**
   * CAPE - Dark cape with bright red edge glow (rim lighting)
   */
  private drawCape(g: PIXI.Graphics, phase: PhaseData): void {
    const wave = Math.sin(this.time * phase.capeSpeed) * (4 + phase.effectIntensity * 4);
    
    // Main cape
    g.beginPath();
    g.moveTo(-32, -28);
    g.quadraticCurveTo(-60, 50, -55 + wave, 140);
    g.lineTo(55 - wave, 140);
    g.quadraticCurveTo(60, 50, 32, -28);
    g.closePath();
    g.fill({ color: this.colors.CAPE });
    
    // Cape fold
    g.beginPath();
    g.moveTo(-15, -20);
    g.quadraticCurveTo(-35, 60, -30 + wave, 135);
    g.lineTo(0, 140);
    g.quadraticCurveTo(-5, 60, -5, -20);
    g.closePath();
    g.fill({ color: this.colors.CAPE_DARK, alpha: 0.6 });
    
    // BRIGHT RED glowing edges (rim light - this is the key!)
    const edgePulse = 0.7 + Math.sin(this.time * 3) * 0.3;
    g.setStrokeStyle({ width: 4, color: this.colors.CAPE_EDGE, alpha: edgePulse });
    g.beginPath();
    g.moveTo(-55 + wave, 140);
    g.quadraticCurveTo(-60, 50, -32, -28);
    g.stroke();
    g.beginPath();
    g.moveTo(55 - wave, 140);
    g.quadraticCurveTo(60, 50, 32, -28);
    g.stroke();
    
    // Bottom edge glow too
    g.beginPath();
    g.moveTo(-55 + wave, 140);
    g.lineTo(55 - wave, 140);
    g.stroke();
  }

  /**
   * BODY - Armored torso with shoulder pads
   */
  private drawBody(g: PIXI.Graphics): void {
    // SHOULDER PADS - Arthas-style (large, spiked, prominent)
    // Left shoulder - main plate
    g.beginPath();
    g.moveTo(-30, -30);   // Inner top
    g.lineTo(-55, -35);   // Spike tip (points UP and OUT)
    g.lineTo(-58, -15);   // Outer edge
    g.lineTo(-50, 0);     // Bottom outer
    g.lineTo(-32, -8);    // Bottom inner
    g.closePath();
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.setStrokeStyle({ width: 2, color: this.colors.SHOULDER_EDGE });
    g.stroke();
    
    // Left shoulder spike accent
    g.beginPath();
    g.moveTo(-48, -30);
    g.lineTo(-55, -35);
    g.lineTo(-52, -20);
    g.closePath();
    g.fill({ color: this.colors.EMBLEM }); // Red spike tip!
    
    // Right shoulder - main plate
    g.beginPath();
    g.moveTo(30, -30);
    g.lineTo(55, -35);
    g.lineTo(58, -15);
    g.lineTo(50, 0);
    g.lineTo(32, -8);
    g.closePath();
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.setStrokeStyle({ width: 2, color: this.colors.SHOULDER_EDGE });
    g.stroke();
    
    // Right shoulder spike accent
    g.beginPath();
    g.moveTo(48, -30);
    g.lineTo(55, -35);
    g.lineTo(52, -20);
    g.closePath();
    g.fill({ color: this.colors.EMBLEM }); // Red spike tip!
    
    // Main torso
    g.beginPath();
    g.moveTo(0, -35);
    g.lineTo(32, -25);
    g.lineTo(28, 5);
    g.lineTo(22, 28);
    g.lineTo(20, 40);
    g.lineTo(-20, 40);
    g.lineTo(-22, 28);
    g.lineTo(-28, 5);
    g.lineTo(-32, -25);
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.setStrokeStyle({ width: 2, color: this.colors.HELMET_LIGHT });
    g.stroke();
    
    // Dark center panel
    g.beginPath();
    g.moveTo(0, -32);
    g.lineTo(15, -20);
    g.lineTo(12, 25);
    g.lineTo(0, 35);
    g.lineTo(-12, 25);
    g.lineTo(-15, -20);
    g.closePath();
    g.fill({ color: this.colors.BODY });
    
    // Belt
    g.beginPath();
    g.moveTo(-22, 32);
    g.lineTo(22, 32);
    g.lineTo(20, 42);
    g.lineTo(-20, 42);
    g.closePath();
    g.fill({ color: this.colors.HELMET_LIGHT });
  }

  /**
   * LEGS - Solid legs with edge definition
   */
  private drawLegs(g: PIXI.Graphics): void {
    // LEFT LEG
    // Thigh
    g.beginPath();
    g.moveTo(-8, 40);
    g.lineTo(-24, 40);
    g.lineTo(-38, 75);
    g.lineTo(-20, 78);
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.HELMET_LIGHT });
    g.stroke();
    
    // Knee guard
    g.ellipse(-28, 78, 12, 8);
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.KNEE_EDGE });
    g.stroke();
    
    // Shin
    g.beginPath();
    g.moveTo(-38, 82);
    g.lineTo(-42, 115);
    g.lineTo(-18, 118);
    g.lineTo(-18, 82);
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.HELMET_LIGHT });
    g.stroke();
    
    // Boot
    g.beginPath();
    g.moveTo(-45, 115);
    g.lineTo(-48, 135);
    g.lineTo(-15, 135);
    g.lineTo(-15, 118);
    g.closePath();
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.setStrokeStyle({ width: 2, color: this.colors.KNEE_EDGE });
    g.stroke();
    
    // RIGHT LEG - Mirror
    g.beginPath();
    g.moveTo(8, 40);
    g.lineTo(24, 40);
    g.lineTo(38, 75);
    g.lineTo(20, 78);
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.HELMET_LIGHT });
    g.stroke();
    
    g.ellipse(28, 78, 12, 8);
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.KNEE_EDGE });
    g.stroke();
    
    g.beginPath();
    g.moveTo(38, 82);
    g.lineTo(42, 115);
    g.lineTo(18, 118);
    g.lineTo(18, 82);
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.HELMET_LIGHT });
    g.stroke();
    
    g.beginPath();
    g.moveTo(45, 115);
    g.lineTo(48, 135);
    g.lineTo(15, 135);
    g.lineTo(15, 118);
    g.closePath();
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.setStrokeStyle({ width: 2, color: this.colors.KNEE_EDGE });
    g.stroke();
  }

  /**
   * ARMS - Uses static pose data, no per-frame allocation
   */
  private drawArms(g: PIXI.Graphics, phaseName: PhaseName): void {
    const pose = ARM_POSES[phaseName];
    const fistPulse = 0.35 + Math.sin(this.time * 4) * 0.2;
    
    this.drawArmPose(g, fistPulse, pose);
    this.drawEnergyOrb(g, phaseName, pose.rightFist[0], pose.rightFist[1]);
  }
  
  private drawArmPose(g: PIXI.Graphics, fistPulse: number, pose: ArmPose): void {
    // Left upper arm
    g.beginPath();
    for (let i = 0; i < pose.leftUpper.length; i++) {
      const [x, y] = pose.leftUpper[i];
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.setStrokeStyle({ width: 2, color: this.colors.HELMET_LIGHT });
    g.stroke();
    
    // Left forearm
    g.beginPath();
    for (let i = 0; i < pose.leftForearm.length; i++) {
      const [x, y] = pose.leftForearm[i];
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.stroke();
    
    // Left fist (smaller, plain armored fist - orb is the focus)
    g.circle(pose.leftFist[0], pose.leftFist[1], 9);
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    
    // Right upper arm
    g.beginPath();
    for (let i = 0; i < pose.rightUpper.length; i++) {
      const [x, y] = pose.rightUpper[i];
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.stroke();
    
    // Right forearm
    g.beginPath();
    for (let i = 0; i < pose.rightForearm.length; i++) {
      const [x, y] = pose.rightForearm[i];
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill({ color: this.colors.BODY_LIGHT });
    g.stroke();
    
    // Right fist
    g.circle(pose.rightFist[0], pose.rightFist[1], 12);
    g.fill({ color: this.colors.GAUNTLET_LIGHT });
    g.ellipse(pose.rightFist[0], pose.rightFist[1], 16, 14);
    g.fill({ color: this.colors.FIST_GLOW, alpha: fistPulse });
  }
  
  /**
   * DARK ENERGY ORB - Layered glowing orb of power in right hand
   */
  private drawEnergyOrb(g: PIXI.Graphics, phaseName: PhaseName, fistX: number, fistY: number): void {
    // Offset orb slightly forward from fist
    const orbX = fistX + 8;
    const orbY = fistY;
    
    // Phase-based intensity
    const phaseIntensity = {
      'CONFIDENT': 0.6,
      'ANNOYED': 0.75,
      'ENRAGED': 0.9,
      'DESPERATE': 1.0,
    }[phaseName];
    
    const baseSize = 14 + phaseIntensity * 6; // Grows with phase
    const pulse = 0.7 + Math.sin(this.time * 5) * 0.3;
    const fastPulse = 0.6 + Math.sin(this.time * 12) * 0.4;
    
    // Layer 1: Mid glow (pulsing ring)
    g.circle(orbX, orbY, baseSize * 1.5 * pulse);
    g.fill({ color: this.colors.EMBLEM, alpha: 0.25 * pulse });
    
    // Layer 2: Core orb (solid)
    g.circle(orbX, orbY, baseSize);
    g.fill({ color: this.colors.EMBLEM });
    
    // Layer 3: Inner bright core
    g.circle(orbX, orbY, baseSize * 0.6);
    g.fill({ color: this.colors.ORB_INNER, alpha: 0.9 });
    
    // Layer 4: White hot center
    g.circle(orbX, orbY, baseSize * 0.25);
    g.fill({ color: 0xFFFFFF, alpha: fastPulse });
    
    // Layer 5: Energy crackling lines (static burst, not spinning)
    const numCrackles = Math.floor(3 + phaseIntensity * 2);
    for (let i = 0; i < numCrackles; i++) {
      // Fixed angles, just pulse in length
      const angle = (i * Math.PI * 2 / numCrackles) - Math.PI / 2; // Start from top
      const length = baseSize * (1.0 + Math.sin(this.time * 6 + i * 2) * 0.5);
      
      g.beginPath();
      g.moveTo(orbX, orbY);
      g.lineTo(
        orbX + Math.cos(angle) * length,
        orbY + Math.sin(angle) * length
      );
      g.stroke({ color: this.colors.PARTICLE, width: 2, alpha: 0.6 * fastPulse });
    }
  }

  /**
   * HELMET - Angular dark helmet with visible edge
   */
  private drawHelmet(g: PIXI.Graphics): void {
    const headY = -55;
    
    // Helmet outline/edge glow (drawn first, slightly larger)
    g.beginPath();
    g.moveTo(0, headY - 32);
    g.lineTo(24, headY - 16);
    g.lineTo(27, headY + 6);
    g.lineTo(22, headY + 22);
    g.lineTo(0, headY + 27);
    g.lineTo(-22, headY + 22);
    g.lineTo(-27, headY + 6);
    g.lineTo(-24, headY - 16);
    g.closePath();
    g.fill({ color: this.colors.CAPE_EDGE, alpha: 0.6 });
    
    // Main helmet - solid dark
    g.beginPath();
    g.moveTo(0, headY - 30);
    g.lineTo(22, headY - 15);
    g.lineTo(25, headY + 5);
    g.lineTo(20, headY + 20);
    g.lineTo(0, headY + 25);
    g.lineTo(-20, headY + 20);
    g.lineTo(-25, headY + 5);
    g.lineTo(-22, headY - 15);
    g.closePath();
    g.fill({ color: this.colors.HELMET });
    
    // Helmet edge stroke for definition
    g.setStrokeStyle({ width: 2, color: this.colors.HELMET_LIGHT });
    g.beginPath();
    g.moveTo(0, headY - 30);
    g.lineTo(22, headY - 15);
    g.lineTo(25, headY + 5);
    g.lineTo(20, headY + 20);
    g.lineTo(0, headY + 25);
    g.lineTo(-20, headY + 20);
    g.lineTo(-25, headY + 5);
    g.lineTo(-22, headY - 15);
    g.closePath();
    g.stroke();
    
    // Helmet ridge/crest (brighter)
    g.beginPath();
    g.moveTo(0, headY - 28);
    g.lineTo(10, headY - 10);
    g.lineTo(0, headY + 5);
    g.lineTo(-10, headY - 10);
    g.closePath();
    g.fill({ color: this.colors.HELMET_LIGHT });
    
    // "Horns" with outline
    g.beginPath();
    g.moveTo(-22, headY - 15);
    g.lineTo(-32, headY - 28);
    g.lineTo(-25, headY - 10);
    g.closePath();
    g.fill({ color: this.colors.HELMET_LIGHT });
    g.setStrokeStyle({ width: 1.5, color: this.colors.CAPE_EDGE });
    g.stroke();
    
    g.beginPath();
    g.moveTo(22, headY - 15);
    g.lineTo(32, headY - 28);
    g.lineTo(25, headY - 10);
    g.closePath();
    g.fill({ color: this.colors.HELMET_LIGHT });
    g.stroke();
  }

  /**
   * VISOR - Menacing red glow (the eyes of evil)
   */
  private drawVisor(g: PIXI.Graphics, phase: PhaseData): void {
    const visorY = -55;
    
    // Main visor shape (angry/narrow)
    g.beginPath();
    g.moveTo(-18, visorY);
    g.lineTo(-12, visorY - 5);
    g.lineTo(12, visorY - 5);
    g.lineTo(18, visorY);
    g.lineTo(12, visorY + 3);
    g.lineTo(-12, visorY + 3);
    g.closePath();
    g.fill({ color: this.colors.VISOR });
    
    // Visor glow pulse - faster when enraged
    const glowPulse = 0.4 + Math.sin(this.time * phase.visorPulse) * (0.2 + phase.effectIntensity * 0.3);
    g.beginPath();
    g.moveTo(-20, visorY);
    g.lineTo(-14, visorY - 7);
    g.lineTo(14, visorY - 7);
    g.lineTo(20, visorY);
    g.lineTo(14, visorY + 5);
    g.lineTo(-14, visorY + 5);
    g.closePath();
    g.fill({ color: this.colors.VISOR_GLOW, alpha: glowPulse });
  }

  /**
   * EMBLEM - Dark power symbol on chest
   */
  private drawEmblem(g: PIXI.Graphics): void {
    const emblemY = -5;
    const size = 12;
    
    // Diamond shape (dark power emblem)
    g.beginPath();
    g.moveTo(0, emblemY - size);
    g.lineTo(size, emblemY);
    g.lineTo(0, emblemY + size);
    g.lineTo(-size, emblemY);
    g.closePath();
    g.fill({ color: this.colors.EMBLEM });
    
    // Inner glow
    const pulse = 0.5 + Math.sin(this.time * 2) * 0.3;
    g.beginPath();
    g.moveTo(0, emblemY - size * 0.6);
    g.lineTo(size * 0.6, emblemY);
    g.lineTo(0, emblemY + size * 0.6);
    g.lineTo(-size * 0.6, emblemY);
    g.closePath();
    g.fill({ color: this.colors.EMBLEM_GLOW, alpha: pulse });
  }

  /**
   * GROUND VOID - Dark portal beneath his feet
   */
  private drawGlow(phase: PhaseData): void {
    const g = this.glowGraphics;
    g.clear();

    const intensity = phase.effectIntensity;
    const pulse = 0.85 + Math.sin(this.time * 2.5) * 0.15;
    
    // Position at feet level
    const voidY = 125;
    const baseWidth = 70;
    const baseHeight = 20;
    
    // Outer edge (brighter, provides definition)
    const outerW = baseWidth + intensity * 15;
    const outerH = baseHeight + intensity * 5;
    g.ellipse(0, voidY, outerW, outerH);
    g.stroke({ color: this.colors.EMBLEM, width: 1.5, alpha: (0.3 + intensity * 0.3) * pulse });
    
    // Inner void (dark fill)
    g.ellipse(0, voidY, outerW - 3, outerH - 2);
    g.fill({ color: 0x000000, alpha: 0.4 + intensity * 0.2 });
    
    // Core darkness (deepest center)
    g.ellipse(0, voidY, outerW * 0.5, outerH * 0.5);
    g.fill({ color: 0x110008, alpha: 0.6 });
  }

  /**
   * EMBERS - Rising flame particles (not orbs)
   * Simple: each ember has a fixed horizontal offset, rises at own speed
   */
  private drawParticles(phase: PhaseData): void {
    const g = this.particleGraphics;
    g.clear();
    
    const count = phase.particleCount;
    const baseSpeed = phase.particleSpeed;
    
    for (let i = 0; i < count; i++) {
      // Each ember has fixed x offset, cycles vertically
      const xSpread = 120; // How far left/right embers spawn
      const xOffset = ((i / count) - 0.5) * xSpread * 2;
      const xWobble = Math.sin(this.time * 2 + i * 1.7) * 8;
      const x = xOffset + xWobble;
      
      // Y position: cycles from bottom (100) to top (-80), then resets
      // Each ember has different phase offset so they don't all move together
      const cycleSpeed = baseSpeed * (0.8 + (i % 3) * 0.2);
      const cycleOffset = (i * 0.3) % 1;
      const cycle = ((this.time * cycleSpeed * 0.5) + cycleOffset) % 1;
      const y = 100 - cycle * 180; // 100 at bottom, -80 at top
      
      // Size: smaller as they rise (burning out)
      const baseSize = 3 + phase.effectIntensity * 2;
      const size = baseSize * (1 - cycle * 0.5);
      
      // Alpha: fade in at bottom, fade out at top
      const fadeIn = Math.min(cycle * 5, 1);
      const fadeOut = Math.max(1 - (cycle - 0.7) * 3, 0);
      const alpha = fadeIn * fadeOut * (0.6 + phase.effectIntensity * 0.3);
      
      if (alpha > 0.05) {
        // Draw ember as diamond (angular, menacing)
        g.beginPath();
        g.moveTo(x, y - size * 1.5);  // Top point
        g.lineTo(x + size, y);         // Right
        g.lineTo(x, y + size * 0.8);   // Bottom
        g.lineTo(x - size, y);         // Left
        g.closePath();
        g.fill({ color: this.colors.PARTICLE, alpha });
        
        // Glow behind (subtle)
        g.circle(x, y, size * 1.5);
        g.fill({ color: this.colors.EMBLEM, alpha: alpha * 0.3 });
      }
    }
  }

  // ==================== BossInstance Interface ====================

  updateHealth(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
  }

  triggerFlash(duration: number = 60): void {
    triggerFlash(this.effects, duration);
  }

  triggerShield(duration: number = 1500): void {
    triggerShield(this.effects, duration);
  }

  triggerShake(amplitude: number): void {
    triggerShake(this.effects, amplitude, SHAKE_MULTIPLIER, SHAKE_DURATION);
  }

  triggerRecoil(amount: number): void {
    triggerRecoil(this.effects, amount, RECOIL_MULTIPLIER);
  }

  registerWithApp(app: PIXI.Application): void {
    registerTicker(this.ticker, app, (delta) => this.update(delta));
  }

  private update(delta: number): void {
    const dt = delta / 60;
    this.time += dt;
    
    const now = Date.now();
    const hpPercent = this.maxHp > 0 ? (this.hp / this.maxHp) * 100 : 100;
    const phase = getPhase(hpPercent);
    const phaseName = this.getPhaseName(hpPercent);
    
    // Phase change effect - shake on escalation (kids feel the shift!)
    if (phaseName !== this.currentPhase) {
      this.currentPhase = phaseName;
      this.triggerShake(10); // Visual feedback on phase change
    }
    
    updateEffects(this.effects, now, RECOIL_DECAY);
    
    // Position offsets
    let offsetX = 0;
    let offsetY = 0;
    
    // IDLE HOVER - menacing float (slower than Nova, more ominous)
    const hoverSpeed = 0.8 + phase.effectIntensity * 0.3;
    const idleHover = Math.sin(this.time * 1.2 * hoverSpeed) * 4;
    offsetY += idleHover;
    
    // IDLE SWAY - subtle side-to-side
    const idleSway = Math.sin(this.time * 0.6 * hoverSpeed) * 2;
    offsetX += idleSway;
    
    // Shake effect
    if (this.effects.shakeAmplitude > 0) {
      offsetX += (Math.random() - 0.5) * this.effects.shakeAmplitude * 2;
      offsetY += (Math.random() - 0.5) * this.effects.shakeAmplitude * 2;
    }
    
    // Recoil
    offsetY -= this.effects.recoil;
    
    this.container.x = this.baseX + offsetX;
    this.container.y = this.baseY + offsetY;
    
    // Flash via alpha
    this.container.alpha = this.effects.isHit ? 0.6 : 1;
    
    // Scale with phase
    this.container.scale.set(phase.scale);
    
    this.draw();
  }

  destroy(): void {
    unregisterTicker(this.ticker);
    this.graphics.destroy();
    this.glowGraphics.destroy();
    this.particleGraphics.destroy();
    this.shieldGraphics.destroy();
    this.container.destroy();
  }
}

