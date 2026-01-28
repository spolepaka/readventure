import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker
} from './bossEffects';

// =============================================================================
// COLORS
// =============================================================================

export const SNOWMAN_COLORS = {
  BODY: 0xF0F8FF,        // Snow white (slightly blue)
  BODY_SHADE: 0xDDEEFF,  // Shadow/shade
  COAL: 0x222222,        // Coal for eyes/buttons
  CARROT: 0xFF6622,      // Carrot nose
  STICK: 0x664422,       // Brown stick arms
  SCARF: 0xDD2222,       // Red scarf
};

export type SnowmanColors = typeof SNOWMAN_COLORS;

// =============================================================================
// PHASE DATA (Nystrom: data-driven, tweak here not in code)
// =============================================================================

type PhaseName = 'CONFIDENT' | 'WORRIED' | 'PANICKING' | 'DESPERATE';

interface PhaseData {
  threshold: number;     // Health % threshold (enter this phase when HP drops below)
  melt: number;          // Body squash factor (0 = normal, 0.3 = very melted)
  armDroop: number;      // How much arms droop in pixels
  hatTilt: number;       // Hat X offset in pixels
  wobbleSpeed: number;   // Wobble animation multiplier
  eyeSize: number;       // Coal eye radius
  face: 'smile' | 'neutral' | 'frown' | 'panic';
  // Juice parameters
  bodyTint: number;      // Body color tint (white → blue → gray)
  blinkRate: number;     // Blinks per second (0 = none)
  eyeDartSpeed: number;  // How fast eyes dart around (0 = calm)
  sweatDrops: number;    // Number of sweat drops to show
  snowflakes: number;    // Snowflake particles active
  noseWiggle: number;    // Carrot nose wiggle amplitude
  scarfWave: number;     // Scarf tail wave amplitude
  breathInterval: number; // Seconds between cold breaths (lower = more frequent)
  windForce: number;     // Horizontal wind push on particles (blizzard effect)
}

// Phases in order from healthy to desperate
// Junior dev: just edit these numbers to tweak the feel!
const PHASES: Record<PhaseName, PhaseData> = {
  CONFIDENT: { threshold: 100, melt: 0,    armDroop: 0,  hatTilt: 0, wobbleSpeed: 1,    eyeSize: 4, face: 'smile',   bodyTint: 0xF0F8FF, blinkRate: 0.3, eyeDartSpeed: 0,   sweatDrops: 0, snowflakes: 10, noseWiggle: 0,   scarfWave: 1,   breathInterval: 3,   windForce: 0  },
  WORRIED:   { threshold: 75,  melt: 0.05, armDroop: 3,  hatTilt: 2, wobbleSpeed: 1.25, eyeSize: 4, face: 'neutral', bodyTint: 0xE8F4FF, blinkRate: 0.5, eyeDartSpeed: 0.5, sweatDrops: 0, snowflakes: 16, noseWiggle: 0.5, scarfWave: 1.5, breathInterval: 2.5, windForce: 5  },
  PANICKING: { threshold: 50,  melt: 0.15, armDroop: 8,  hatTilt: 4, wobbleSpeed: 1.5,  eyeSize: 4, face: 'frown',   bodyTint: 0xDDEEFF, blinkRate: 0.8, eyeDartSpeed: 1.5, sweatDrops: 2, snowflakes: 24, noseWiggle: 1.5, scarfWave: 3,   breathInterval: 1.8, windForce: 15 },
  DESPERATE: { threshold: 25,  melt: 0.3,  armDroop: 15, hatTilt: 6, wobbleSpeed: 2.5,  eyeSize: 5, face: 'panic',   bodyTint: 0xCCDDEE, blinkRate: 1.2, eyeDartSpeed: 3,   sweatDrops: 4, snowflakes: 40, noseWiggle: 3,   scarfWave: 6,   breathInterval: 0.8, windForce: 30 },
};

const MAX_PARTICLES = 80; // Pool size: snow (50) + impact/sparkle bursts (30)

// Order matters: check from lowest threshold up
const PHASE_ORDER: PhaseName[] = ['DESPERATE', 'PANICKING', 'WORRIED', 'CONFIDENT'];

function getPhase(healthPercent: number): PhaseName {
  for (const name of PHASE_ORDER) {
    if (healthPercent < PHASES[name].threshold) return name;
  }
  return 'CONFIDENT';
}

// =============================================================================
// PARTICLE SYSTEM (Nystrom: pool + simple struct, no classes)
// =============================================================================

type ParticleType = 'snow' | 'ice' | 'sparkle' | 'breath';

interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  rotation: number;    // For ice shards
  rotationSpeed: number;
  layer: 'back' | 'front';
}

// =============================================================================
// ANIMATION CONSTANTS
// =============================================================================

const WOBBLE_BASE_SPEED = 0.8;
const WOBBLE_RANGE = 0.02;
const SHAKE_MULTIPLIER = 0.5;
const SHAKE_DURATION = 300;
const RECOIL_MULTIPLIER = 0.5;
const RECOIL_DECAY = 0.88;
const BREATHE_SPEED = 0.5;
const BREATHE_AMOUNT = 0.008;
const BOUNCE_SPEED = 1.8;
const BOUNCE_AMOUNT = 2;
const BLINK_DURATION = 0.12;
const SQUASH_DURATION = 0.15;
const SQUASH_AMOUNT = 0.05;
const ICE_SHARD_COUNT = 10; // Number of ice shards on hit (was 6, now punchier)

// =============================================================================
// SNOWMAN BOSS
// =============================================================================

/**
 * Pure Pixi SnowmanBoss - "Frosty"
 * 
 * 4-phase boss with data-driven visual states.
 * Phases: CONFIDENT → WORRIED → PANICKING → DESPERATE
 */
export class PureSnowmanBoss {
  public container: PIXI.Container;
  
  // State
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: SnowmanColors;
  
  // Phase tracking
  private currentPhase: PhaseName = 'CONFIDENT';
  
  // Animation state
  private lastBlinkTime = 0;
  private isBlinking = false;
  private eyeOffsetX = 0;
  private eyeOffsetY = 0;
  private squashTime = 0;
  private lastBreathTime = 0;
  
  // Particle pool (Nystrom: one pool, tagged by type/layer)
  private particles: Particle[] = [];
  
  // Graphics layers (back to front)
  private shadowGraphics: PIXI.Graphics;        // Ground shadow (very back)
  private meltGraphics: PIXI.Graphics;
  private particleBackGraphics: PIXI.Graphics;  // Snow behind boss
  private armsGraphics: PIXI.Graphics;
  private bodyGraphics: PIXI.Graphics;
  private accessoriesGraphics: PIXI.Graphics;
  private faceGraphics: PIXI.Graphics;
  private sweatGraphics: PIXI.Graphics;
  private particleFrontGraphics: PIXI.Graphics; // Snow + effects in front
  private shieldGraphics: PIXI.Graphics;
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...SNOWMAN_COLORS, ...colorOverrides } as SnowmanColors;
    
    // Create graphics layers (Chromebook perf: minimal layers, simple shapes)
    this.shadowGraphics = new PIXI.Graphics();
    this.meltGraphics = new PIXI.Graphics();
    this.particleBackGraphics = new PIXI.Graphics();
    this.armsGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.accessoriesGraphics = new PIXI.Graphics();
    this.faceGraphics = new PIXI.Graphics();
    this.sweatGraphics = new PIXI.Graphics();
    this.particleFrontGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Add in render order (back to front)
    this.container.addChild(this.shadowGraphics);        // Shadow at very back
    this.container.addChild(this.meltGraphics);
    this.container.addChild(this.particleBackGraphics);  // Snow behind
    this.container.addChild(this.armsGraphics);
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.accessoriesGraphics);
    this.container.addChild(this.faceGraphics);
    this.container.addChild(this.sweatGraphics);
    this.container.addChild(this.particleFrontGraphics); // Snow + effects in front
    this.container.addChild(this.shieldGraphics);
    
    // Initialize particle pool (half back, half front for ambient snow)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push(this.spawnSnowParticle(i < MAX_PARTICLES / 2 ? 'back' : 'front'));
    }
    
    this.draw();
  }
  
  // ===========================================================================
  // PUBLIC API
  // ===========================================================================
  
  public registerWithApp(app: PIXI.Application): void {
    registerTicker(this.ticker, app, (delta) => this.update(delta));
  }
  
  public updateHealth(health: number, maxHealth: number): void {
    this.health = health;
    this.maxHealth = maxHealth;
  }
  
  public triggerFlash(duration = 80): void {
    triggerFlash(this.effects, duration);
    this.squashTime = SQUASH_DURATION;
    // Spawn ice shards on hit
    this.spawnBurst('ice', ICE_SHARD_COUNT);
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
  
  // ===========================================================================
  // GAME LOOP
  // ===========================================================================
  
  private update(delta: number): void {
    if (!this.container.parent) return;
    
    const dt = delta * 0.016;
    this.time += dt;
    const now = Date.now();
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    // Phase transition detection
    const newPhase = getPhase(healthPercent);
    if (newPhase !== this.currentPhase) {
      this.onPhaseChange(this.currentPhase, newPhase);
      this.currentPhase = newPhase;
    }
    
    const phase = PHASES[this.currentPhase];
    
    // Update effects
    updateEffects(this.effects, now, RECOIL_DECAY);
    
    // Blink system
    if (phase.blinkRate > 0) {
      const blinkInterval = 1 / phase.blinkRate;
      if (this.time - this.lastBlinkTime > blinkInterval) {
        this.isBlinking = true;
        this.lastBlinkTime = this.time;
      }
      if (this.isBlinking && this.time - this.lastBlinkTime > BLINK_DURATION) {
        this.isBlinking = false;
      }
    }
    
    // Eye dart
    if (phase.eyeDartSpeed > 0) {
      this.eyeOffsetX = Math.sin(this.time * phase.eyeDartSpeed * 3.7) * 2;
      this.eyeOffsetY = Math.sin(this.time * phase.eyeDartSpeed * 2.3) * 1;
    } else {
      this.eyeOffsetX = 0;
      this.eyeOffsetY = 0;
    }
    
    // Squash decay
    if (this.squashTime > 0) {
      this.squashTime = Math.max(0, this.squashTime - dt);
    }
    
    // Cold breath (periodic puffs)
    if (this.time - this.lastBreathTime > phase.breathInterval) {
      this.spawnBreath(phase);
      this.lastBreathTime = this.time;
    }
    
    // Wobble
    const wobble = Math.sin(this.time * WOBBLE_BASE_SPEED * phase.wobbleSpeed) * WOBBLE_RANGE;
    this.container.rotation = wobble;
    
    // Scale: breathing + squash
    const breathe = 1 + Math.sin(this.time * BREATHE_SPEED) * BREATHE_AMOUNT;
    const squashProgress = this.squashTime / SQUASH_DURATION;
    const squash = Math.sin(squashProgress * Math.PI) * SQUASH_AMOUNT;
    this.container.scale.set(breathe * (1 + squash), breathe * (1 - squash));
    
    // Shake + recoil
    const shakeOffset = this.effects.shakeAmplitude * Math.sin(this.time * 10);
    this.container.pivot.x = -shakeOffset - this.effects.recoil;
    
    // Bounce
    const bounce = Math.abs(Math.sin(this.time * BOUNCE_SPEED)) * BOUNCE_AMOUNT;
    this.container.pivot.y = -bounce;
    
    // Particles
    this.updateParticles(dt, phase.snowflakes, phase.windForce);
    this.drawParticles();
    
    // Draw
    this.draw(phase);
  }
  
  private onPhaseChange(_from: PhaseName, _to: PhaseName): void {
    this.triggerFlash(100);
    this.triggerShake(8);
    
    // Burst of sparkles on phase change
    this.spawnBurst('sparkle', 8);
  }
  
  // ===========================================================================
  // PARTICLE SYSTEM (Complete: snow, ice shards, sparkles)
  // ===========================================================================
  
  /** Spawn ambient snow particle */
  private spawnSnowParticle(layer: 'back' | 'front'): Particle {
    return {
      type: 'snow',
      layer,
      x: (Math.random() - 0.5) * 260,  // Wide horizontal spread for blizzard feel
      y: -100 + Math.random() * 180,   // -100 to +80 (full snowman height)
      vx: (Math.random() - 0.5) * 25,  // Slightly more horizontal drift
      vy: 20 + Math.random() * 25,     // Slower, floatier fall
      size: layer === 'back' ? 1 + Math.random() * 1.5 : 1.5 + Math.random() * 2.5,
      alpha: layer === 'back' ? 0.2 + Math.random() * 0.3 : 0.4 + Math.random() * 0.4,
      life: Math.random() * 2,         // Stagger initial
      maxLife: 4.5 + Math.random() * 1.5, // Linger longer (4.5-6s)
      rotation: 0,
      rotationSpeed: 0,
    };
  }
  
  /** Reset snow particle to top */
  private resetSnowParticle(p: Particle): void {
    p.type = 'snow';
    p.x = (Math.random() - 0.5) * 260;  // Wide horizontal spread
    p.y = -110 + Math.random() * 30;    // Start above snowman (-110 to -80)
    p.vx = (Math.random() - 0.5) * 25;  // Slightly more horizontal drift
    p.vy = 20 + Math.random() * 25;     // Slower, floatier fall
    p.maxLife = 4.5 + Math.random() * 1.5; // Linger longer (4.5-6s)
    p.size = p.layer === 'back' ? 1 + Math.random() * 1.5 : 1.5 + Math.random() * 2.5;
    p.alpha = p.layer === 'back' ? 0.2 + Math.random() * 0.3 : 0.4 + Math.random() * 0.4;
    p.life = p.maxLife;
    p.rotation = 0;
    p.rotationSpeed = 0;
  }
  
  /** Spawn burst of ice shards or sparkles (reuses dead particles) */
  private spawnBurst(type: 'ice' | 'sparkle', count: number): void {
    let spawned = 0;
    for (const p of this.particles) {
      if (p.life <= 0 && spawned < count) {
        p.type = type;
        p.layer = 'front'; // Bursts always in front
        p.x = (Math.random() - 0.5) * 40; // Near center
        p.y = -20 + Math.random() * 40;
        
        if (type === 'ice') {
          // Ice shards fly upward - dramatic burst
          const angle = -Math.PI * 0.85 + Math.random() * Math.PI * 0.7;
          const speed = 120 + Math.random() * 80;
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
          p.size = 5 + Math.random() * 4;   // Bigger shards
          p.alpha = 0.95;                    // Brighter
          p.life = 0.5 + Math.random() * 0.25;
          p.maxLife = p.life;
          p.rotation = angle;
          p.rotationSpeed = (Math.random() - 0.5) * 18;
        } else {
          // Sparkles float up and out
          const angle = Math.random() * Math.PI * 2;
          const speed = 30 + Math.random() * 40;
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed - 30; // Bias upward
          p.size = 2 + Math.random() * 3;
          p.alpha = 1;
          p.life = 0.5 + Math.random() * 0.3;
          p.maxLife = p.life;
          p.rotation = 0;
          p.rotationSpeed = 0;
        }
        spawned++;
      }
    }
  }
  
  /** Spawn cold breath puff near mouth */
  private spawnBreath(phase: PhaseData): void {
    const m = phase.melt;
    const mouthY = -50 + m * 15 + 8; // Near mouth position
    
    // Spawn 4-6 puff particles
    const count = 4 + Math.floor(Math.random() * 3);
    let spawned = 0;
    
    for (const p of this.particles) {
      if (p.life <= 0 && spawned < count) {
        p.type = 'breath';
        p.layer = 'front';
        p.x = 16 + Math.random() * 6;  // In front of mouth/nose
        p.y = mouthY + (Math.random() - 0.5) * 8;
        p.vx = 40 + Math.random() * 25; // More horizontal drift
        p.vy = -3 - Math.random() * 6;   // Less vertical, mostly sideways
        p.size = 4 + Math.random() * 3;  // Bigger starting size
        p.alpha = 0.55;                   // More visible
        p.life = 0.8 + Math.random() * 0.4;
        p.maxLife = p.life;
        p.rotation = 0;
        p.rotationSpeed = 0;
        spawned++;
      }
    }
  }
  
  /** Update all particles */
  private updateParticles(dt: number, snowCount: number, windForce: number): void {
    let aliveBack = 0;
    let aliveFront = 0;
    const halfSnow = Math.floor(snowCount / 2);
    
    for (const p of this.particles) {
      if (p.life > 0) {
        // Physics
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        p.rotation += p.rotationSpeed * dt;
        
        // Snow drifts gently + wind push (blizzard effect)
        if (p.type === 'snow') {
          p.x += Math.sin(this.time * 3 + p.y * 0.1) * 0.5;
          p.x += windForce * dt; // Blizzard wind
        }
        
        // Ice slows down
        if (p.type === 'ice') {
          p.vx *= 0.95;
          p.vy *= 0.95;
        }
        
        // Breath expands and slows
        if (p.type === 'breath') {
          p.size += dt * 4;  // Expand
          p.vx *= 0.97;      // Slow down
          p.vy *= 0.97;
        }
        
        // Count alive snow by layer
        if (p.type === 'snow') {
          if (p.layer === 'back') aliveBack++;
          else aliveFront++;
        }
      } else if (p.type === 'snow' || p.life <= 0) {
        // Respawn dead particles as snow if below quota
        if (p.layer === 'back' && aliveBack < halfSnow) {
          this.resetSnowParticle(p);
          aliveBack++;
        } else if (p.layer === 'front' && aliveFront < halfSnow) {
          this.resetSnowParticle(p);
          aliveFront++;
        }
      }
    }
  }
  
  /** Draw all particles to their respective layers */
  private drawParticles(): void {
    this.particleBackGraphics.clear();
    this.particleFrontGraphics.clear();
    
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      
      const gfx = p.layer === 'back' ? this.particleBackGraphics : this.particleFrontGraphics;
      const fadeAlpha = Math.min(1, p.life / 0.3) * p.alpha;
      
      if (p.type === 'snow') {
        // Simple circle + highlight
        gfx.circle(p.x, p.y, p.size);
        gfx.fill({ color: 0xFFFFFF, alpha: fadeAlpha });
        gfx.circle(p.x - 0.5, p.y - 0.5, p.size * 0.4);
        gfx.fill({ color: 0xCCEEFF, alpha: fadeAlpha * 0.6 });
      } else if (p.type === 'ice') {
        // Diamond/shard shape - bright and visible
        const s = p.size;
        const cos = Math.cos(p.rotation);
        const sin = Math.sin(p.rotation);
        gfx.beginPath();
        gfx.moveTo(p.x + cos * s, p.y + sin * s);
        gfx.lineTo(p.x - sin * s * 0.4, p.y + cos * s * 0.4);
        gfx.lineTo(p.x - cos * s, p.y - sin * s);
        gfx.lineTo(p.x + sin * s * 0.4, p.y - cos * s * 0.4);
        gfx.closePath();
        gfx.fill({ color: 0xFFFFFF, alpha: fadeAlpha });  // Bright white fill
        gfx.stroke({ width: 1, color: 0x99EEFF, alpha: fadeAlpha * 0.5 }); // Subtle ice edge
      } else if (p.type === 'sparkle') {
        // Star/cross sparkle
        const s = p.size;
        gfx.rect(p.x - s, p.y - 1, s * 2, 2);
        gfx.rect(p.x - 1, p.y - s, 2, s * 2);
        gfx.fill({ color: 0xFFFFAA, alpha: fadeAlpha });
      } else if (p.type === 'breath') {
        // Cold breath puff - soft expanding circle
        gfx.circle(p.x, p.y, p.size);
        gfx.fill({ color: 0xDDEEFF, alpha: fadeAlpha * 0.6 });
        // Inner highlight
        gfx.circle(p.x - p.size * 0.2, p.y - p.size * 0.2, p.size * 0.5);
        gfx.fill({ color: 0xFFFFFF, alpha: fadeAlpha * 0.3 });
      }
    }
  }
  
  // ===========================================================================
  // DRAWING
  // ===========================================================================
  
  private draw(phase: PhaseData = PHASES[this.currentPhase]): void {
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    this.drawShadow();
    this.drawMelt(phase, healthPercent);
    this.drawArms(phase);
    this.drawBody(phase);
    this.drawAccessories(phase);
    this.drawFace(phase);
    this.drawSweat(phase);
    
    if (this.effects.showShield) {
      drawShield(this.shieldGraphics, this.time, 75);
    } else {
      this.shieldGraphics.clear();
    }
  }
  
  /** Ground shadow - simple ellipse, grounds the character */
  private drawShadow(): void {
    this.shadowGraphics.clear();
    // Subtle shadow below snowman base
    this.shadowGraphics.ellipse(0, 82, 50, 10);
    this.shadowGraphics.fill({ color: 0x000000, alpha: 0.15 });
  }
  
  private drawMelt(phase: PhaseData, healthPercent: number): void {
    this.meltGraphics.clear();
    if (healthPercent > 50) return;
    
    const meltSize = (1 - healthPercent / 50) * 30 + 20;
    const wobble = Math.sin(this.time * 2) * 3;
    
    this.meltGraphics.ellipse(0, 78, meltSize * 1.5 + wobble, 14);
    this.meltGraphics.fill({ color: 0xAADDFF, alpha: 0.6 });
  }
  
  private drawArms(phase: PhaseData): void {
    this.armsGraphics.clear();
    
    const droop = phase.armDroop;
    const wave = Math.sin(this.time * 2) * 3;
    
    // Left arm + fingers
    this.armsGraphics.moveTo(-30, -10);
    this.armsGraphics.lineTo(-60, -25 + droop + wave);
    this.armsGraphics.stroke({ width: 5, color: this.colors.STICK });
    
    this.armsGraphics.moveTo(-55, -22 + droop + wave);
    this.armsGraphics.lineTo(-65, -35 + droop);
    this.armsGraphics.moveTo(-58, -24 + droop + wave);
    this.armsGraphics.lineTo(-70, -28 + droop);
    this.armsGraphics.stroke({ width: 3, color: this.colors.STICK });
    
    // Right arm + fingers
    this.armsGraphics.moveTo(30, -10);
    this.armsGraphics.lineTo(60, -25 + droop - wave);
    this.armsGraphics.stroke({ width: 5, color: this.colors.STICK });
    
    this.armsGraphics.moveTo(55, -22 + droop - wave);
    this.armsGraphics.lineTo(65, -35 + droop);
    this.armsGraphics.moveTo(58, -24 + droop - wave);
    this.armsGraphics.lineTo(70, -28 + droop);
    this.armsGraphics.stroke({ width: 3, color: this.colors.STICK });
  }
  
  private drawBody(phase: PhaseData): void {
    this.bodyGraphics.clear();
    
    const bodyColor = this.effects.isHit ? 0xFFFFFF : phase.bodyTint;
    const m = phase.melt;
    
    // Bottom ball
    this.bodyGraphics.ellipse(0, 35, 40 + m * 20, 40 - m * 15);
    this.bodyGraphics.fill(bodyColor);
    
    // Middle ball
    const middleY = -10 + m * 10;
    this.bodyGraphics.ellipse(0, middleY, 30 + m * 15, 30 - m * 12);
    this.bodyGraphics.fill(bodyColor);
    
    // Top ball (head)
    const headY = -50 + m * 15;
    this.bodyGraphics.ellipse(0, headY, 22 + m * 10, 22 - m * 8);
    this.bodyGraphics.fill(bodyColor);
    
    // Shading
    this.bodyGraphics.ellipse(-10, 25, 15, 20);
    this.bodyGraphics.fill({ color: this.colors.BODY_SHADE, alpha: 0.3 });
    this.bodyGraphics.ellipse(-8, middleY - 8, 12, 15);
    this.bodyGraphics.fill({ color: this.colors.BODY_SHADE, alpha: 0.3 });
    this.bodyGraphics.ellipse(-6, headY - 6, 8, 10);
    this.bodyGraphics.fill({ color: this.colors.BODY_SHADE, alpha: 0.3 });
  }
  
  private drawAccessories(phase: PhaseData): void {
    this.accessoriesGraphics.clear();
    
    const m = phase.melt;
    const headY = -50 + m * 15;
    const middleY = -10 + m * 10;
    const hatY = headY - 32;
    const hatOffsetX = phase.hatTilt;
    
    // Hat brim
    this.accessoriesGraphics.ellipse(hatOffsetX, hatY + 15, 26, 5);
    this.accessoriesGraphics.fill(0x111111);
    
    // Hat body
    this.accessoriesGraphics.roundRect(-16 + hatOffsetX, hatY - 18, 32, 33, 3);
    this.accessoriesGraphics.fill(0x111111);
    
    // Hat band
    this.accessoriesGraphics.rect(-16 + hatOffsetX, hatY + 5, 32, 5);
    this.accessoriesGraphics.fill(this.colors.SCARF);
    
    // Hat shine
    this.accessoriesGraphics.rect(-12 + hatOffsetX, hatY - 12, 6, 12);
    this.accessoriesGraphics.fill({ color: 0x333333, alpha: 0.5 });
    
    // Coal buttons
    this.accessoriesGraphics.circle(0, middleY - 12, 4);
    this.accessoriesGraphics.circle(0, middleY, 4);
    this.accessoriesGraphics.circle(0, middleY + 12, 4);
    this.accessoriesGraphics.fill(this.colors.COAL);
    
    // Scarf
    const neckY = -30 + m * 12;
    this.accessoriesGraphics.ellipse(0, neckY, 25, 6);
    this.accessoriesGraphics.fill(this.colors.SCARF);
    
    // Scarf tail (wave amplitude increases with panic)
    const scarfWave = Math.sin(this.time * 3) * phase.scarfWave * 3;
    const scarfWave2 = Math.sin(this.time * 4 + 1) * phase.scarfWave * 2;
    this.accessoriesGraphics.beginPath();
    this.accessoriesGraphics.moveTo(20, neckY);
    this.accessoriesGraphics.quadraticCurveTo(35 + scarfWave, neckY + 10, 30 + scarfWave2, neckY + 25);
    this.accessoriesGraphics.lineTo(25 + scarfWave2, neckY + 23);
    this.accessoriesGraphics.quadraticCurveTo(28 + scarfWave * 0.5, neckY + 10, 18, neckY + 3);
    this.accessoriesGraphics.closePath();
    this.accessoriesGraphics.fill(this.colors.SCARF);
  }
  
  private drawFace(phase: PhaseData): void {
    this.faceGraphics.clear();
    
    const m = phase.melt;
    const headY = -50 + m * 15;
    const eyeY = headY - 5;
    const eyeSpacing = 10;
    const mouthY = headY + 8;
    
    // Eyes (with blink + dart)
    const leftEyeX = -eyeSpacing + this.eyeOffsetX;
    const rightEyeX = eyeSpacing + this.eyeOffsetX;
    const eyeYPos = eyeY + this.eyeOffsetY;
    
    if (this.isBlinking) {
      this.faceGraphics.moveTo(leftEyeX - 3, eyeYPos);
      this.faceGraphics.lineTo(leftEyeX + 3, eyeYPos);
      this.faceGraphics.moveTo(rightEyeX - 3, eyeYPos);
      this.faceGraphics.lineTo(rightEyeX + 3, eyeYPos);
      this.faceGraphics.stroke({ width: 2, color: this.colors.COAL });
    } else {
      // Coal eyes
      this.faceGraphics.circle(leftEyeX, eyeYPos, phase.eyeSize);
      this.faceGraphics.circle(rightEyeX, eyeYPos, phase.eyeSize);
      this.faceGraphics.fill(this.colors.COAL);
      
      // Eye shine - tiny white highlight (makes eyes "alive")
      const shineOffset = phase.eyeSize * 0.3;
      this.faceGraphics.circle(leftEyeX - shineOffset, eyeYPos - shineOffset, phase.eyeSize * 0.25);
      this.faceGraphics.circle(rightEyeX - shineOffset, eyeYPos - shineOffset, phase.eyeSize * 0.25);
      this.faceGraphics.fill({ color: 0xFFFFFF, alpha: 0.8 });
    }
    
    // Eyebrows
    this.drawEyebrows(phase.face, eyeY, eyeSpacing);
    
    // Carrot nose (with wiggle in panic phases)
    const noseWiggle = Math.sin(this.time * 8) * phase.noseWiggle;
    this.faceGraphics.beginPath();
    this.faceGraphics.moveTo(noseWiggle, headY - 2);
    this.faceGraphics.lineTo(18 + noseWiggle, headY + 2);
    this.faceGraphics.lineTo(noseWiggle, headY + 6);
    this.faceGraphics.closePath();
    this.faceGraphics.fill(this.colors.CARROT);
    
    // Mouth
    this.drawMouth(phase.face, mouthY);
  }
  
  private drawEyebrows(face: PhaseData['face'], eyeY: number, spacing: number): void {
    if (face === 'smile') return;
    
    if (face === 'neutral') {
      this.faceGraphics.moveTo(-spacing - 4, eyeY - 7);
      this.faceGraphics.lineTo(-spacing + 4, eyeY - 7);
      this.faceGraphics.moveTo(spacing - 4, eyeY - 7);
      this.faceGraphics.lineTo(spacing + 4, eyeY - 7);
      this.faceGraphics.stroke({ width: 2, color: this.colors.COAL });
    } else if (face === 'frown') {
      this.faceGraphics.moveTo(-spacing - 5, eyeY - 8);
      this.faceGraphics.lineTo(-spacing + 5, eyeY - 6);
      this.faceGraphics.moveTo(spacing + 5, eyeY - 8);
      this.faceGraphics.lineTo(spacing - 5, eyeY - 6);
      this.faceGraphics.stroke({ width: 2, color: this.colors.COAL });
    } else if (face === 'panic') {
      this.faceGraphics.moveTo(-spacing - 6, eyeY - 10);
      this.faceGraphics.lineTo(-spacing + 4, eyeY - 5);
      this.faceGraphics.moveTo(spacing + 6, eyeY - 10);
      this.faceGraphics.lineTo(spacing - 4, eyeY - 5);
      this.faceGraphics.stroke({ width: 2.5, color: this.colors.COAL });
    }
  }
  
  private drawMouth(face: PhaseData['face'], mouthY: number): void {
    if (face === 'smile') {
      for (let i = 0; i < 5; i++) {
        const angle = Math.PI * 0.2 + (i / 4) * Math.PI * 0.6;
        this.faceGraphics.circle(Math.cos(angle) * 10, mouthY + Math.sin(angle) * 5, 2);
      }
      this.faceGraphics.fill(this.colors.COAL);
    } else if (face === 'neutral') {
      this.faceGraphics.moveTo(-6, mouthY);
      this.faceGraphics.lineTo(6, mouthY);
      this.faceGraphics.stroke({ width: 3, color: this.colors.COAL });
    } else if (face === 'frown') {
      this.faceGraphics.moveTo(-8, mouthY + 3);
      this.faceGraphics.quadraticCurveTo(0, mouthY - 3, 8, mouthY + 3);
      this.faceGraphics.stroke({ width: 3, color: this.colors.COAL });
    } else if (face === 'panic') {
      this.faceGraphics.ellipse(0, mouthY, 8, 6);
      this.faceGraphics.fill(this.colors.COAL);
    }
  }
  
  private drawSweat(phase: PhaseData): void {
    this.sweatGraphics.clear();
    if (phase.sweatDrops === 0) return;
    
    const m = phase.melt;
    const headY = -50 + m * 15;
    
    const dropPositions = [
      { x: -20, y: headY - 8, delay: 0 },
      { x: 22, y: headY - 5, delay: 0.3 },
      { x: -18, y: headY + 5, delay: 0.6 },
      { x: 20, y: headY + 8, delay: 0.9 },
    ];
    
    for (let i = 0; i < phase.sweatDrops; i++) {
      const pos = dropPositions[i];
      const cycle = (this.time + pos.delay) % 1.5;
      const fallProgress = Math.min(1, cycle / 1.2);
      const dropY = pos.y + fallProgress * 15;
      const alpha = fallProgress < 0.8 ? 1 : 1 - (fallProgress - 0.8) / 0.2;
      
      this.sweatGraphics.beginPath();
      this.sweatGraphics.moveTo(pos.x, dropY - 4);
      this.sweatGraphics.quadraticCurveTo(pos.x + 3, dropY, pos.x, dropY + 3);
      this.sweatGraphics.quadraticCurveTo(pos.x - 3, dropY, pos.x, dropY - 4);
      this.sweatGraphics.closePath();
      this.sweatGraphics.fill({ color: 0x88CCFF, alpha: alpha * 0.8 });
    }
  }
}
