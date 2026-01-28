import * as PIXI from 'pixi.js';
import {
  EffectState, createEffectState,
  TickerState, createTickerState,
  triggerFlash, triggerShield, triggerShake, triggerRecoil,
  updateEffects, drawShield, registerTicker, unregisterTicker
} from './bossEffects';

// =============================================================================
// COLORS (Nystrom: data at top, easy to tweak)
// =============================================================================

export const NOVA_COLORS = {
  // Suit: Saturated heroic blue (brighter = more "superhero")
  HELMET: 0x2255CC,       // Bright blue helmet
  HELMET_LIGHT: 0x4488EE, // Vivid blue highlights (fists, belt)
  VISOR: 0xAADDFF,        // Bright reflective visor
  VISOR_SHINE: 0xFFFFFF,  // Visor glint
  BODY: 0x2244AA,         // Rich navy suit
  BODY_LIGHT: 0x3366CC,   // Suit highlights
  // Cape & Emblem: Warm gold (contrast with cool blue)
  CAPE: 0xFFCC00,         // Gold cape
  CAPE_DARK: 0xDD9900,    // Cape shadow (richer)
  EMBLEM: 0xFFDD44,       // Star emblem
  EMBLEM_GLOW: 0xFFFFAA,  // Emblem glow
  STARS: 0xFFDD44,        // Orbiting stars
};

export type NovaColors = typeof NOVA_COLORS;

// =============================================================================
// PHASE SYSTEM (Nova's reaction as mentor being tested by student)
// WATCHING → NOTICING → IMPRESSED → AMAZED
// The "fight" is a test. Damage = student proving themselves. Nova gets impressed.
// =============================================================================

type PhaseName = 'WATCHING' | 'NOTICING' | 'IMPRESSED' | 'AMAZED';

interface PhaseData {
  threshold: number;      // Enter this phase when HP% drops below this
  // Visual additions (cumulative - each phase adds more)
  showArmRings: boolean;  // Energy rings around forearms
  showCapeGlow: boolean;  // Cape edges emit light
  showVisorFlicker: boolean; // Subtle visor awareness (NOTICING beat)
  showVisorGlow: boolean; // Full visor scan effect
  showCorona: boolean;    // Sun-like energy corona behind
  showEmanating: boolean; // Star particles emanating outward
  // Intensity scaling
  intensity: number;      // Overall visual intensity (1.0 - 2.0)
  scale: number;          // Container scale (1.0 - 1.15) - POWER UP!
  // Colors (shift warmer as phases progress)
  glowColor: number;      // Aura, sparkles, emblem, arm rings
  capeGlowColor: number;  // Cape edge glow
  coronaColor: number;    // Background corona
}

const PHASES: Record<PhaseName, PhaseData> = {
  WATCHING: {
    threshold: 100,
    showArmRings: false,
    showCapeGlow: false,
    showVisorFlicker: false,
    showVisorGlow: false,
    showCorona: false,
    showEmanating: false,
    intensity: 1.0,
    scale: 1.0,
    // Golden yellow - "Let's see what you've got"
    glowColor: 0xFFDD44,
    capeGlowColor: 0xFFDD44,
    coronaColor: 0xFFCC00,
  },
  NOTICING: {
    threshold: 80,
    showArmRings: true,   // + ARM RINGS ("Not bad...")
    showCapeGlow: false,
    showVisorFlicker: true, // + VISOR FLICKER ("I see you" - designer beat!)
    showVisorGlow: false,
    showCorona: false,
    showEmanating: false,
    intensity: 1.3,
    scale: 1.05,
    // Orange - starting to pay attention
    glowColor: 0xFFAA00,
    capeGlowColor: 0xFFBB22,
    coronaColor: 0xFFAA00,
  },
  IMPRESSED: {
    threshold: 50,
    showArmRings: true,
    showCapeGlow: true,   // + CAPE GLOW ("You're really doing it!")
    showVisorFlicker: false, // Replaced by full scan
    showVisorGlow: true,  // + VISOR SCAN (locked in, watching closely)
    showCorona: false,
    showEmanating: false,
    intensity: 1.6,
    scale: 1.1,
    // Hot orange - genuinely impressed
    glowColor: 0xFF7700,
    capeGlowColor: 0xFF8822,
    coronaColor: 0xFF6600,
  },
  AMAZED: {
    threshold: 25,
    showArmRings: true,
    showCapeGlow: true,
    showVisorFlicker: false,
    showVisorGlow: true,
    showCorona: true,     // + SUN CORONA ("Incredible!")
    showEmanating: true,  // + EMANATING (pure amazement)
    intensity: 2.0,
    scale: 1.2,           // BIGGER! Kids need to SEE the power-up
    // BRILLIANT WHITE - supernova climax (NOT gold - clear arc end!)
    glowColor: 0xFFFFEE,
    capeGlowColor: 0xFFFFDD,
    coronaColor: 0xFFFFAA,
  },
};

const PHASE_ORDER: PhaseName[] = ['AMAZED', 'IMPRESSED', 'NOTICING', 'WATCHING'];

function getPhase(healthPercent: number): PhaseName {
  for (const name of PHASE_ORDER) {
    if (healthPercent < PHASES[name].threshold) return name;
  }
  return 'WATCHING';
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SHAKE_MULTIPLIER = 0.5;
const SHAKE_DURATION = 300;
const RECOIL_MULTIPLIER = 0.6;
const RECOIL_DECAY = 0.88;

// =============================================================================
// CAPTAIN NOVA BOSS
// =============================================================================

/**
 * Pure Pixi NovaBoss - "Captain Nova"
 * 
 * Growth mindset mentor boss. The "fight" is a test - as you prove yourself,
 * Nova gets more impressed (WATCHING → NOTICING → IMPRESSED → AMAZED).
 * 
 * Mastery Trials tier 7 (35 CQPM) and Quick Play (adaptive HP, bossLevel 107).
 */
export class PureNovaBoss {
  public container: PIXI.Container;
  
  // State
  private effects: EffectState = createEffectState();
  private ticker: TickerState = createTickerState();
  private time = 0;
  private health: number;
  private maxHealth: number;
  private colors: NovaColors;
  private currentPhase: PhaseName = 'WATCHING';
  
  // Graphics (back to front render order)
  private coronaGraphics: PIXI.Graphics;         // Sun corona (AMAZED only)
  private auraGraphics: PIXI.Graphics;           // Energy aura
  private emanatingGraphics: PIXI.Graphics;      // Emanating particles (AMAZED only)
  private orbitingStarsGraphics: PIXI.Graphics;  // Cosmic stars
  private capeGraphics: PIXI.Graphics;
  private capeGlowGraphics: PIXI.Graphics;       // Cape edge glow (IMPRESSED+)
  private bodyGraphics: PIXI.Graphics;
  private armRingsGraphics: PIXI.Graphics;       // Energy rings on arms (NOTICING+)
  private helmetGraphics: PIXI.Graphics;
  private visorFlickerGraphics: PIXI.Graphics;   // Visor flicker (NOTICING - designer beat!)
  private visorGlowGraphics: PIXI.Graphics;      // Visor scan (IMPRESSED+)
  private emblemGraphics: PIXI.Graphics;
  private shieldGraphics: PIXI.Graphics;
  
  // Base position for shake/recoil effects
  private baseX: number;
  private baseY: number;
  
  // Dynamic fist positions (updated by drawBody for arm rings to follow)
  private leftFistPos = { x: -46, y: -36 };
  private rightFistPos = { x: 46, y: -36 };
  
  constructor(x: number, y: number, health: number = 100, maxHealth: number = 100, colorOverrides?: Record<string, number>) {
    this.container = new PIXI.Container();
    this.baseX = x;
    this.baseY = y;
    this.container.x = x;
    this.container.y = y;
    this.container.interactiveChildren = false;
    
    this.health = health;
    this.maxHealth = maxHealth;
    this.colors = { ...NOVA_COLORS, ...colorOverrides } as NovaColors;
    
    // Create graphics layers (order = render order)
    this.coronaGraphics = new PIXI.Graphics();
    this.auraGraphics = new PIXI.Graphics();
    this.emanatingGraphics = new PIXI.Graphics();
    this.orbitingStarsGraphics = new PIXI.Graphics();
    this.capeGraphics = new PIXI.Graphics();
    this.capeGlowGraphics = new PIXI.Graphics();
    this.bodyGraphics = new PIXI.Graphics();
    this.armRingsGraphics = new PIXI.Graphics();
    this.helmetGraphics = new PIXI.Graphics();
    this.visorFlickerGraphics = new PIXI.Graphics();
    this.visorGlowGraphics = new PIXI.Graphics();
    this.emblemGraphics = new PIXI.Graphics();
    this.shieldGraphics = new PIXI.Graphics();
    
    // Add to container (back to front)
    this.container.addChild(this.coronaGraphics);    // Sun corona (very back)
    this.container.addChild(this.auraGraphics);
    this.container.addChild(this.emanatingGraphics); // Emanating stars
    this.container.addChild(this.capeGraphics);
    this.container.addChild(this.capeGlowGraphics);  // Cape glow on top of cape
    this.container.addChild(this.bodyGraphics);
    this.container.addChild(this.armRingsGraphics);  // Arm rings on top of body
    this.container.addChild(this.helmetGraphics);
    this.container.addChild(this.visorFlickerGraphics); // Visor flicker (NOTICING beat)
    this.container.addChild(this.visorGlowGraphics); // Visor glow on top of helmet
    this.container.addChild(this.emblemGraphics);
    this.container.addChild(this.orbitingStarsGraphics); // Stars in front
    this.container.addChild(this.shieldGraphics);
    
    this.draw();
  }
  
  // ============================================================
  // PUBLIC API (BossInstance interface)
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
    // Star burst on hit (like Frosty's ice shards)
    this.burstTimer = 0.25;
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
    this.container.destroy({ children: true });
  }
  
  // ============================================================
  // UPDATE LOOP
  // ============================================================
  
  private update(delta: number): void {
    const dt = delta / 60; // Normalize to seconds
    this.time += dt;
    
    const now = Date.now();
    const healthPercent = (this.health / this.maxHealth) * 100;
    
    // Phase detection (escalation as HP drops)
    const newPhase = getPhase(healthPercent);
    if (newPhase !== this.currentPhase) {
      this.onPhaseChange(this.currentPhase, newPhase);
      this.currentPhase = newPhase;
    }
    
    const phase = PHASES[this.currentPhase];
    
    // Burst timer (decrement here, not in draw)
    if (this.burstTimer > 0) {
      this.burstTimer -= dt;
    }
    
    updateEffects(this.effects, now, RECOIL_DECAY);
    
    // Apply shake + recoil to position
    let offsetX = 0;
    let offsetY = 0;
    
    // IDLE BOUNCE - faster in intense phases
    const bounceSpeed = 1 + (phase.intensity - 1) * 0.3;
    const idleBounce = Math.sin(this.time * 1.5 * bounceSpeed) * 3;
    offsetY += idleBounce;
    
    // IDLE SWAY - subtle side-to-side (ready stance)
    const idleSway = Math.sin(this.time * 0.8 * bounceSpeed) * 1.5;
    offsetX += idleSway;
    
    if (this.effects.shakeAmplitude > 0) {
      offsetX += (Math.random() - 0.5) * this.effects.shakeAmplitude * 2;
      offsetY += (Math.random() - 0.5) * this.effects.shakeAmplitude * 2;
    }
    
    offsetY -= this.effects.recoil;
    
    this.container.x = this.baseX + offsetX;
    this.container.y = this.baseY + offsetY;
    
    // Scale changes with phase (POWER UP!)
    this.container.scale.set(phase.scale);
    
    // Redraw (for animations) - pass phase data
    this.draw(phase);
  }
  
  private onPhaseChange(_oldPhase: PhaseName, _newPhase: PhaseName): void {
    // Visual feedback on phase transition - make kids FEEL it
    this.triggerShake(12);
    
    // BURST of stars on phase change! (longer = more "whoa!")
    this.burstTimer = 0.75;
  }
  
  // Burst particles state
  private burstTimer = 0;
  
  // ============================================================
  // DRAWING - Nystrom: Get base geometry RIGHT first
  // 
  // Coordinate system (relative to container origin):
  //   Y = 0 is the "anchor point" (center of character)
  //   Negative Y = up (head)
  //   Positive Y = down (body, cape)
  //
  // Character proportions (total height ~140px):
  //   Head:  -70 to -20 (50px)
  //   Body:  -20 to +50 (70px)  
  //   Cape:  -10 to +70 (80px, behind body)
  // ============================================================
  
  private draw(phase: PhaseData = PHASES[this.currentPhase]): void {
    // Phase-specific additions (cumulative visual crescendo)
    this.drawCorona(phase);         // AMAZED: Sun corona
    this.drawAura(phase);           // Energy aura
    this.drawEmanating(phase);      // AMAZED: Emanating particles
    this.drawOrbitingStars(phase);  // Cosmic stars
    this.drawCape(phase);           // Cape behind body
    this.drawCapeGlow(phase);       // IMPRESSED+: Cape edge glow
    this.drawBody(phase);           // Main body (pose changes per phase!)
    this.drawArmRings(phase);       // NOTICING+: Energy rings on forearms
    this.drawHelmet();              // Head
    this.drawVisorFlicker(phase);   // NOTICING: Visor awareness (designer beat!)
    this.drawVisorGlow(phase);      // IMPRESSED+: Visor scan effect
    this.drawEmblem(phase);         // Nova emblem on chest
    this.drawShieldEffect();        // Shield (front)
  }
  
  private drawCorona(phase: PhaseData): void {
    const g = this.coronaGraphics;
    g.clear();
    
    if (!phase.showCorona) return;
    
    // AMAZED ONLY: SUPERNOVA corona (bigger = more scream-worthy)
    const pulse = 0.5 + Math.sin(this.time * 2) * 0.2; // Faster pulse in climax
    
    // Outer corona (BIGGER for impact)
    g.ellipse(0, 10, 160, 180);
    g.fill({ color: phase.coronaColor, alpha: pulse * 0.15 });
    
    // Inner corona (still visible but doesn't wash out sparkles)
    g.ellipse(0, 10, 100, 120);
    g.fill({ color: phase.glowColor, alpha: pulse * 0.2 });
  }
  
  private drawAura(phase: PhaseData): void {
    const g = this.auraGraphics;
    g.clear();

    // Subtle aura (don't compete with sparkles)
    const pulse = 0.2 + Math.sin(this.time * 2) * 0.1;
    const size = 65 + (phase.intensity - 1) * 15;

    g.ellipse(0, 20, size, size * 1.3);
    g.fill({ color: phase.glowColor, alpha: pulse * phase.intensity * 0.1 });
  }
  
  private drawVisorFlicker(phase: PhaseData): void {
    const g = this.visorFlickerGraphics;
    g.clear();
    
    if (!phase.showVisorFlicker) return;
    
    // NOTICING ONLY: Subtle visor awareness (designer beat - "I see you")
    // Quick flicker effect, not the full scan
    const flicker = Math.sin(this.time * 6);
    if (flicker < 0.3) return; // Only show part of the time
    
    const alpha = (flicker - 0.3) * 0.8;
    const color = 0x00FFFF; // Cyan awareness
    
    // Brief visor highlight
    g.ellipse(0, -44, 18, 14);
    g.fill({ color, alpha: alpha * 0.15 });
    
    // Edge glow
    g.setStrokeStyle({ width: 2, color, alpha: alpha * 0.5 });
    g.ellipse(0, -44, 20, 16);
    g.stroke();
  }

  // Pre-computed angles for emanating particles (avoid cos/sin per particle)
  private static readonly EMANATE_ANGLES = (() => {
    const angles: { cos: number; sin: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      angles.push({ cos: Math.cos(a), sin: Math.sin(a) });
    }
    return angles;
  })();
  
  private drawEmanating(phase: PhaseData): void {
    const g = this.emanatingGraphics;
    g.clear();
    
    if (!phase.showEmanating && this.burstTimer <= 0) return;

    const color = 0xFFDD44; // Bright gold
    const count = this.burstTimer > 0 ? 12 : 8;
    const speed = this.burstTimer > 0 ? 1.5 : 0.5;
    const t = this.time;
    
    for (let i = 0; i < count; i++) {
      const cycle = (t * speed + i * 0.08) % 1;
      if (cycle > 0.9) continue;
      
      const { cos, sin } = PureNovaBoss.EMANATE_ANGLES[i];
      const dist = 40 + cycle * 100;
      const x = cos * dist;
      const y = sin * dist * 0.6 + 20;
      const alpha = (1 - cycle) * 0.8;
      
      // 4-pointed star (fancier than diamond)
      const s = 4 * (1 - cycle * 0.5);
      const inner = s * 0.3;
      g.moveTo(x, y - s);
      g.lineTo(x + inner, y - inner);
      g.lineTo(x + s, y);
      g.lineTo(x + inner, y + inner);
      g.lineTo(x, y + s);
      g.lineTo(x - inner, y + inner);
      g.lineTo(x - s, y);
      g.lineTo(x - inner, y - inner);
      g.closePath();
      g.fill({ color, alpha });
    }
  }
  
  // Pre-computed sparkle data (Nystrom: compute once, not every frame)
  private static readonly SPARKLES = [
    // Close to Nova (always visible - first 6)
    { x: -35, y: -50, size: 4, phase: 0, speed: 2.8 },
    { x: 38, y: -45, size: 3, phase: 1.2, speed: 3.2 },
    { x: 0, y: -65, size: 5, phase: 2.5, speed: 2.5 },
    { x: -48, y: 10, size: 4, phase: 0.8, speed: 3.0 },
    { x: 52, y: 15, size: 3, phase: 2.0, speed: 2.6 },
    { x: -30, y: 45, size: 4, phase: 1.8, speed: 2.9 },
    // Mid-range aura (NOTICING+ - next 5)
    { x: -90, y: -75, size: 5, phase: 0.4, speed: 2.7 },
    { x: 95, y: -65, size: 4, phase: 1.6, speed: 3.1 },
    { x: -100, y: 30, size: 4, phase: 2.2, speed: 2.8 },
    { x: 105, y: 35, size: 5, phase: 0.9, speed: 3.0 },
    { x: 45, y: 75, size: 4, phase: 1.4, speed: 2.6 },
    // Outer aura (IMPRESSED+ - next 5)
    { x: 0, y: -115, size: 6, phase: 2.8, speed: 2.4 },
    { x: -125, y: -20, size: 5, phase: 0.6, speed: 3.3 },
    { x: 130, y: -15, size: 4, phase: 1.9, speed: 2.9 },
    { x: -110, y: 85, size: 4, phase: 2.4, speed: 3.2 },
    { x: 115, y: 90, size: 5, phase: 0.2, speed: 2.7 },
  ];
  
  private drawOrbitingStars(phase: PhaseData): void {
    const g = this.orbitingStarsGraphics;
    g.clear();
    
    // Sparkles scale: WATCHING=6, NOTICING=9, IMPRESSED=12, AMAZED=16
    const count = Math.floor(6 + (phase.intensity - 1) * 10);
    const color = 0xFFDD44; // Always gold - pops against red in AMAZED
    const t = this.time;
    
    for (let i = 0; i < count; i++) {
      const spark = PureNovaBoss.SPARKLES[i];
      
      // Simplified drift
      const drift = Math.sin(t * 0.5 + spark.phase) * 5;
      const x = spark.x + drift;
      const y = spark.y + drift * 0.6;
      
      // Twinkle
      const twinkle = Math.sin(t * spark.speed + spark.phase);
      if (twinkle < 0.1) continue;
      
      const alpha = twinkle;
      const s = spark.size * (0.7 + alpha * 0.3);
      const inner = s * 0.25;
      
      // Glow at peak brightness (makes sparkles pop!)
      if (alpha > 0.7) {
        g.circle(x, y, s + 2);
        g.fill({ color, alpha: (alpha - 0.7) * 0.5 });
      }
      
      // 4-pointed star
      g.moveTo(x, y - s);
      g.lineTo(x + inner, y - inner);
      g.lineTo(x + s, y);
      g.lineTo(x + inner, y + inner);
      g.lineTo(x, y + s);
      g.lineTo(x - inner, y + inner);
      g.lineTo(x - s, y);
      g.lineTo(x - inner, y - inner);
      g.closePath();
      g.fill({ color, alpha: 0.5 + alpha * 0.5 });
    }
  }

  private drawCape(phase: PhaseData): void {
    const g = this.capeGraphics;
    g.clear();

    const intensity = phase.intensity;
    // Phase-specific cape behavior
    // WATCHING: calm, gentle sway | AMAZED: dramatic, fast billowing
    const flutter = 1 + (intensity - 1) * 1.5;  // 1x → 2.5x (was 1.5x max)
    const speed = 1 + (intensity - 1) * 0.8;    // Faster waves in later phases
    const spread = (intensity - 1) * 8;         // Cape spreads wider in later phases

    // Multi-frequency waves (speed scales with phase)
    const wave1 = Math.sin(this.time * 2 * speed) * 6 * flutter;
    const wave2 = Math.sin(this.time * 3.5 * speed + 1) * 4 * flutter;
    const wave = wave1 + wave2;

    // Cape bottom ripple (more dramatic in later phases)
    const bottomWave = Math.sin(this.time * 2.5 * speed + 0.5) * 10 * flutter;

    // Cape flows from shoulders (spreads wider in later phases)
    g.moveTo(-28, -12);
    g.quadraticCurveTo(-35 - spread + wave * 0.3, 10, -42 - spread + wave, 30);
    g.quadraticCurveTo(-48 - spread + wave, 60, -55 - spread * 1.5 + bottomWave, 90);
    g.lineTo(55 + spread * 1.5 - bottomWave, 90);
    g.quadraticCurveTo(48 + spread - wave, 60, 42 + spread - wave, 30);
    g.quadraticCurveTo(35 + spread - wave * 0.3, 10, 28, -12);
    g.closePath();
    g.fill({ color: this.colors.CAPE });

    // Inner fold (also affected by phase)
    const innerWave = Math.sin(this.time * 2.2 * speed + 0.3) * 5 * flutter;
    g.moveTo(-20, 0);
    g.quadraticCurveTo(-28 - spread * 0.5 + innerWave, 20, -35 - spread * 0.5 + innerWave, 45);
    g.quadraticCurveTo(-40 - spread * 0.5 + innerWave, 65, -45 - spread + bottomWave * 0.7, 80);
    g.lineTo(45 + spread - bottomWave * 0.7, 80);
    g.quadraticCurveTo(40 + spread * 0.5 - innerWave, 65, 35 + spread * 0.5 - innerWave, 45);
    g.quadraticCurveTo(28 + spread * 0.5 - innerWave, 20, 20, 0);
    g.closePath();
    g.fill({ color: this.colors.CAPE_DARK, alpha: 0.25 });
  }
  
  private drawCapeGlow(phase: PhaseData): void {
    const g = this.capeGlowGraphics;
    g.clear();

    if (!phase.showCapeGlow) return;

    // IMPRESSED+: Cape edges emit light (matches cape movement)
    const intensity = phase.intensity;
    const flutter = 1 + (intensity - 1) * 1.5;
    const speed = 1 + (intensity - 1) * 0.8;
    const spread = (intensity - 1) * 8;
    const pulse = 0.4 + Math.sin(this.time * 3 * speed) * 0.25;
    const color = phase.capeGlowColor;

    const wave1 = Math.sin(this.time * 2 * speed) * 6 * flutter;
    const wave2 = Math.sin(this.time * 3.5 * speed + 1) * 4 * flutter;
    const wave = wave1 + wave2;
    const bottomWave = Math.sin(this.time * 2.5 * speed + 0.5) * 10 * flutter;

    // Draw glowing outline along cape edges (brighter in later phases)
    g.setStrokeStyle({ width: 4 + intensity, color, alpha: pulse * 0.7 });

    // Left edge
    g.moveTo(-28, -12);
    g.quadraticCurveTo(-35 - spread + wave * 0.3, 10, -42 - spread + wave, 30);
    g.quadraticCurveTo(-48 - spread + wave, 60, -55 - spread * 1.5 + bottomWave, 90);
    g.stroke();

    // Right edge
    g.moveTo(28, -12);
    g.quadraticCurveTo(35 + spread - wave * 0.3, 10, 42 + spread - wave, 30);
    g.quadraticCurveTo(48 + spread - wave, 60, 55 + spread * 1.5 - bottomWave, 90);
    g.stroke();

    // Bottom edge glow
    g.moveTo(-55 - spread * 1.5 + bottomWave, 90);
    g.lineTo(55 + spread * 1.5 - bottomWave, 90);
    g.stroke();
  }
  
  private drawArms(g: PIXI.Graphics, tint: number, phaseName: PhaseName): void {
    // 4 completely different arm poses
    switch (phaseName) {
      case 'WATCHING':
        // Relaxed stance - arms at sides, "let's see what you've got"
        // Left arm
        g.moveTo(-30, -8);
        g.lineTo(-38, 5);
        g.quadraticCurveTo(-42, 20, -40, 35);
        g.lineTo(-32, 35);
        g.quadraticCurveTo(-34, 18, -28, 0);
        g.closePath();
        g.fill({ color: tint });
        g.circle(-36, 42, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.leftFistPos = { x: -36, y: 42 };
        
        // Right arm
        g.moveTo(30, -8);
        g.lineTo(38, 5);
        g.quadraticCurveTo(42, 20, 40, 35);
        g.lineTo(32, 35);
        g.quadraticCurveTo(34, 18, 28, 0);
        g.closePath();
        g.fill({ color: tint });
        g.circle(36, 42, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.rightFistPos = { x: 36, y: 42 };
        break;
        
      case 'NOTICING':
        // Starting to notice - arms spread wide, "not bad..."
        // Left arm
        g.moveTo(-30, -8);
        g.lineTo(-50, -5);
        g.quadraticCurveTo(-65, 0, -70, -10);
        g.lineTo(-65, -18);
        g.quadraticCurveTo(-55, -12, -35, -12);
        g.closePath();
        g.fill({ color: tint });
        g.circle(-75, -12, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.leftFistPos = { x: -75, y: -12 };
        
        // Right arm
        g.moveTo(30, -8);
        g.lineTo(50, -5);
        g.quadraticCurveTo(65, 0, 70, -10);
        g.lineTo(65, -18);
        g.quadraticCurveTo(55, -12, 35, -12);
        g.closePath();
        g.fill({ color: tint });
        g.circle(75, -12, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.rightFistPos = { x: 75, y: -12 };
        break;
        
      case 'IMPRESSED':
        // Impressed stance - fists up, "you're really doing it!"
        // Left arm
        g.moveTo(-30, -8);
        g.lineTo(-48, 0);
        g.quadraticCurveTo(-60, 5, -58, -15);
        g.lineTo(-52, -35);
        g.lineTo(-45, -32);
        g.lineTo(-48, -12);
        g.quadraticCurveTo(-45, 2, -30, -2);
        g.closePath();
        g.fill({ color: tint });
        g.circle(-50, -42, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.leftFistPos = { x: -50, y: -42 };
        
        // Right arm
        g.moveTo(30, -8);
        g.lineTo(48, 0);
        g.quadraticCurveTo(60, 5, 58, -15);
        g.lineTo(52, -35);
        g.lineTo(45, -32);
        g.lineTo(48, -12);
        g.quadraticCurveTo(45, 2, 30, -2);
        g.closePath();
        g.fill({ color: tint });
        g.circle(50, -42, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.rightFistPos = { x: 50, y: -42 };
        break;
        
      case 'AMAZED':
        // Amazed - arms raised high, "I can't believe it!"
        // Left arm
        g.moveTo(-30, -8);
        g.lineTo(-42, -15);
        g.quadraticCurveTo(-55, -25, -55, -45);
        g.lineTo(-48, -50);
        g.lineTo(-42, -40);
        g.quadraticCurveTo(-40, -22, -28, -12);
        g.closePath();
        g.fill({ color: tint });
        g.circle(-52, -58, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.leftFistPos = { x: -52, y: -58 };
        
        // Right arm
        g.moveTo(30, -8);
        g.lineTo(42, -15);
        g.quadraticCurveTo(55, -25, 55, -45);
        g.lineTo(48, -50);
        g.lineTo(42, -40);
        g.quadraticCurveTo(40, -22, 28, -12);
        g.closePath();
        g.fill({ color: tint });
        g.circle(52, -58, 10);
        g.fill({ color: this.colors.HELMET_LIGHT });
        this.rightFistPos = { x: 52, y: -58 };
        break;
    }
  }
  
  private drawArmRings(phase: PhaseData): void {
    const g = this.armRingsGraphics;
    g.clear();
    
    if (!phase.showArmRings) return;
    
    // Energy rings around forearms (color shifts with phase!)
    const pulse = 0.5 + Math.sin(this.time * 4) * 0.3;
    const pulse2 = 0.5 + Math.sin(this.time * 4 + Math.PI) * 0.3;
    const color = phase.glowColor;
    
    const lx = this.leftFistPos.x;
    const ly = this.leftFistPos.y;
    const rx = this.rightFistPos.x;
    const ry = this.rightFistPos.y;
    
    // Energy orbs ABOVE fists (like holding power)
    // Outer ring (further up)
    g.setStrokeStyle({ width: 2, color, alpha: pulse * 0.8 });
    g.ellipse(lx, ly - 18, 14, 6);
    g.stroke();
    g.ellipse(rx, ry - 18, 14, 6);
    g.stroke();
    
    // Inner ring (closer to fist)
    g.setStrokeStyle({ width: 2, color, alpha: pulse2 * 0.6 });
    g.ellipse(lx, ly - 10, 12, 5);
    g.stroke();
    g.ellipse(rx, ry - 10, 12, 5);
    g.stroke();
    
    // Power orb glow above fists
    g.circle(lx, ly - 14, 16);
    g.fill({ color, alpha: pulse * 0.2 });
    g.circle(rx, ry - 14, 16);
    g.fill({ color, alpha: pulse * 0.2 });
  }
  
  private drawBody(phase: PhaseData = PHASES[this.currentPhase]): void {
    const g = this.bodyGraphics;
    g.clear();
    
    const tint = this.effects.isHit ? 0xFFFFFF : this.colors.BODY;
    
    // === ARMS - 4 DISTINCT POSES ===
    this.drawArms(g, tint, this.currentPhase);
    
    // === TORSO ===
    g.roundRect(-28, -20, 56, 55, 8);
    g.fill({ color: tint });
    
    // Belt/waist
    g.roundRect(-30, 30, 60, 10, 3);
    g.fill({ color: this.colors.HELMET_LIGHT });
    
    // Belt buckle (star-shaped hint)
    g.circle(0, 35, 6);
    g.fill({ color: this.colors.EMBLEM, alpha: 0.6 });
    
    // === LEGS ===
    g.roundRect(-22, 38, 16, 32, 5);  // Left leg
    g.roundRect(6, 38, 16, 32, 5);    // Right leg
    g.fill({ color: tint });
    
    // Boots (darker, sturdy)
    g.roundRect(-24, 65, 20, 14, 5);  // Left boot
    g.roundRect(4, 65, 20, 14, 5);    // Right boot
    g.fill({ color: this.colors.HELMET });
    
    // Boot soles
    g.roundRect(-25, 76, 22, 4, 2);
    g.roundRect(3, 76, 22, 4, 2);
    g.fill({ color: 0x111122 });
    
    // === SHOULDER PADS ===
    g.roundRect(-42, -16, 18, 20, 6);
    g.roundRect(24, -16, 18, 20, 6);
    g.fill({ color: tint });
    
    // Shoulder highlights
    g.roundRect(-40, -13, 14, 5, 2);
    g.roundRect(26, -13, 14, 5, 2);
    g.fill({ color: this.colors.BODY_LIGHT, alpha: 0.5 });
  }
  
  private drawHelmet(): void {
    const g = this.helmetGraphics;
    g.clear();
    
    const tint = this.effects.isHit ? 0xFFFFFF : this.colors.HELMET;
    
    // Main helmet dome
    g.ellipse(0, -42, 30, 28);
    g.fill({ color: tint });
    
    // Helmet collar that overlaps body
    g.roundRect(-22, -20, 44, 8, 3);
    g.fill({ color: this.colors.HELMET_LIGHT });
    
    // Visor (reflective, no face visible - mysterious mentor)
    g.ellipse(0, -44, 20, 16);
    g.fill({ color: this.colors.VISOR });
    
    // Visor gradient effect (darker at bottom = reflection of space)
    g.ellipse(0, -38, 18, 10);
    g.fill({ color: 0x446688, alpha: 0.4 });
    
    // Visor shine (top-left reflection)
    g.ellipse(-7, -52, 8, 5);
    g.fill({ color: this.colors.VISOR_SHINE, alpha: 0.6 });
    
    // Secondary smaller shine
    g.ellipse(-10, -48, 3, 2);
    g.fill({ color: this.colors.VISOR_SHINE, alpha: 0.8 });
  }
  
  private drawVisorGlow(phase: PhaseData): void {
    const g = this.visorGlowGraphics;
    g.clear();

    if (!phase.showVisorGlow) return;

    const CYAN = 0x00FFFF;
    const WHITE = 0xFFFFFF;
    
    // Single clean scan line (meta: Iron Man, Terminator)
    const scanY = -44 + Math.sin(this.time * 2.5) * 10;
    const flicker = 0.9 + Math.sin(this.time * 8) * 0.1;
    
    // Glow behind scan line
    g.roundRect(-15, scanY - 3, 30, 6, 3);
    g.fill({ color: CYAN, alpha: 0.25 * phase.intensity * flicker });
    
    // === ALL CYAN STROKES (batched) ===
    g.setStrokeStyle({ width: 2.5, color: CYAN, alpha: 0.85 * flicker });
    
    // Scan line
    g.moveTo(-14, scanY);
    g.lineTo(14, scanY);
    
    // Corner brackets
    g.moveTo(-15, -55); g.lineTo(-15, -52);
    g.moveTo(-15, -55); g.lineTo(-11, -55);
    g.moveTo(15, -55); g.lineTo(15, -52);
    g.moveTo(15, -55); g.lineTo(11, -55);
    g.moveTo(-15, -33); g.lineTo(-15, -36);
    g.moveTo(-15, -33); g.lineTo(-11, -33);
    g.moveTo(15, -33); g.lineTo(15, -36);
    g.moveTo(15, -33); g.lineTo(11, -33);
    
    // Visor rim
    g.ellipse(0, -44, 20, 16);
    
    g.stroke();
    
    // White hot center of scan line
    g.setStrokeStyle({ width: 1.5, color: WHITE, alpha: 0.95 * flicker });
    g.moveTo(-12, scanY);
    g.lineTo(12, scanY);
    g.stroke();
  }
  
  private drawEmblem(phase: PhaseData): void {
    const g = this.emblemGraphics;
    g.clear();
    
    const cx = 0;
    const cy = 10;
    
    // Pulse (single sin call)
    const pulse = 0.4 + Math.sin(this.time * 2.5) * 0.2 * phase.intensity;
    const pulseSize = 1 + pulse * 0.15;
    
    const longR = 10 * pulseSize;
    const shortR = 3 * pulseSize;
    const width = 2.5 * pulseSize;
    
    // Glow
    g.circle(cx, cy, longR + 4);
    g.fill({ color: phase.glowColor, alpha: pulse * 0.35 * phase.intensity });
    
    // 4-pointed nova starburst (curved tapered points - more elegant)
    g.moveTo(cx, cy - longR);
    g.quadraticCurveTo(cx + width, cy - shortR, cx + shortR, cy - shortR);
    g.quadraticCurveTo(cx + shortR, cy - width, cx + longR, cy);
    g.quadraticCurveTo(cx + shortR, cy + width, cx + shortR, cy + shortR);
    g.quadraticCurveTo(cx + width, cy + shortR, cx, cy + longR);
    g.quadraticCurveTo(cx - width, cy + shortR, cx - shortR, cy + shortR);
    g.quadraticCurveTo(cx - shortR, cy + width, cx - longR, cy);
    g.quadraticCurveTo(cx - shortR, cy - width, cx - shortR, cy - shortR);
    g.quadraticCurveTo(cx - width, cy - shortR, cx, cy - longR);
    g.closePath();
    g.fill({ color: this.colors.EMBLEM });
  }
  
  private drawShieldEffect(): void {
    const g = this.shieldGraphics;
    
    if (this.effects.showShield) {
      drawShield(g, this.time, 70, 6, 0x00BFFF);
    } else {
      g.clear();
    }
  }
}

