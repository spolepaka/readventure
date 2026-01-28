import * as PIXI from 'pixi.js';

// Particle shape types
export type ParticleShape = 'circle' | 'star' | 'diamond' | 'heart' | 'square';

// Particle interface with additional properties for Disney magic
export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  life: number;
  startLife: number;
  scale: number;
  startScale: number;
  alpha: number;
  rotation: number;
  shape: ParticleShape;
  behaviors: string[];
}

// Behavior functions that modify particles
export const particleBehaviors = {
  gravity: (p: Particle) => {
    p.vy += 0.3;
  },
  
  fade: (p: Particle) => {
    p.life -= 0.02;
    // Extra fade for last 20% of life for smooth ending
    if (p.life < 0.2) {
      p.alpha = p.life * 5;
    }
  },
  
  spin: (p: Particle) => {
    p.rotation += 0.1;
  },
  
  pulse: (p: Particle, time: number) => {
    p.scale = 1 + Math.sin(time * 10) * 0.2;
  },
  
  rainbow: (p: Particle) => {
    // Shift through rainbow based on remaining life
    const hue = (1 - p.life / p.startLife) * 360;
    // Convert HSL to hex (simplified for example)
    p.color = hslToHex(hue, 100, 50);
  },
  
  spiral: (p: Particle, time: number) => {
    const spiralSpeed = 5;
    p.x += Math.cos(time * spiralSpeed + p.id) * 2;
    p.y += p.vy;
  },
  
  explode: (p: Particle) => {
    // Slow down over time for explosion effect
    p.vx *= 0.95;
    p.vy *= 0.95;
  },
  
  float: (p: Particle) => {
    // Gentle floating motion
    p.x += Math.sin(p.id + p.life * 3) * 0.5;
    p.y += p.vy * 0.5;
  },
  
  sparkle: (p: Particle, time: number) => {
    // Disney-style twinkling
    const twinkle = Math.sin(time * 30 + p.id * 10) * 0.5 + 0.5;
    p.scale = p.startScale * (0.5 + twinkle * 0.5);
    p.alpha = 0.7 + twinkle * 0.3;
  },
  
  heartbeat: (p: Particle, time: number) => {
    // Heartbeat-like pulsing
    const pulse = Math.sin(time * 10 + p.id) * 0.3 + 1;
    p.scale = p.startScale * pulse;
  }
};

// Predefined effect configurations
// To add a new effect:
// 1. Add it here with behaviors, colors, shapes, etc.
// 2. Call spawnEffect('yourEffect', x, y) in RaidScreen
// 3. That's it! The system handles the rest
export const particleEffects = {
  celebrate: {
    count: 50,  // More particles!
    behaviors: ['gravity', 'fade', 'spin', 'sparkle'],
    colors: [0xFFD700, 0xFFA500, 0xFFFFFF, 0xFFEB3B, 0xFF69B4],  // Gold-focused palette
    shapes: ['star', 'diamond', 'circle'] as ParticleShape[],
    speed: { min: 3, max: 12 },  // Wider speed range
    scale: { min: 0.5, max: 2.0 },  // Bigger variety
    lifespan: 2.0  // Last longer
  },
  
  impact: {
    count: 35,  // Lightning strike = more particles
    behaviors: ['explode', 'fade', 'sparkle'],  // Added sparkle
    colors: [0xFFFFFF, 0xFFFF00, 0x00FFFF],  // White-yellow-blue lightning
    shapes: ['star', 'circle'] as ParticleShape[],  // Stars for impact!
    speed: { min: 10, max: 20 },  // Faster explosion
    scale: { min: 0.3, max: 1.5 },
    lifespan: 0.8  // Quick and punchy
  },
  
  combo: {
    count: 60,  // BIG celebration
    behaviors: ['spiral', 'fade', 'sparkle', 'rainbow', 'pulse'],  // Added pulse
    colors: [0xFFFFFF], // Will be overridden by rainbow
    shapes: ['star', 'heart', 'diamond'] as ParticleShape[],  // More variety
    speed: { min: 2, max: 10 },
    scale: { min: 0.3, max: 2.5 },  // Some tiny, some huge
    lifespan: 3.0  // Linger for effect
  },
  
  error: {
    count: 10,  // Fewer but more meaningful
    behaviors: ['gravity', 'fade', 'pulse'],  // Added pulse for emphasis
    colors: [0xFF0000, 0xFF6600, 0xFF3300],  // Warmer reds
    shapes: ['square', 'diamond'] as ParticleShape[],
    speed: { min: 1, max: 4 },  // Slower, sadder
    scale: { min: 1.0, max: 1.5 },  // Bigger
    lifespan: 1.2
  },
  
  magic: {
    count: 8,  // Fewer but more magical
    behaviors: ['float', 'fade', 'sparkle', 'rainbow', 'pulse'],
    colors: [0xFFFFFF],
    shapes: ['star', 'circle'] as ParticleShape[],
    speed: { min: 1, max: 3 },
    scale: { min: 0.3, max: 1.0 },
    lifespan: 3.0
  }
};

// Helper function to convert HSL to hex
function hslToHex(h: number, s: number, l: number): number {
  h = h / 360;
  s = s / 100;
  l = l / 100;
  
  let r, g, b;
  
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  return (Math.round(r * 255) << 16) + (Math.round(g * 255) << 8) + Math.round(b * 255);
}

// Main particle system class
export class ParticleSystem {
  private particles: Particle[] = [];
  private time: number = 0;
  private idCounter: number = 0;
  private static readonly MAX_PARTICLES = 60; // Budget for smooth 60fps on Chromebooks
  
  // Create a particle burst with a specific effect
  emit(effectName: keyof typeof particleEffects, x: number, y: number, customOptions?: Partial<typeof particleEffects.celebrate>) {
    const baseEffect = particleEffects[effectName];
    const effect = customOptions ? { ...baseEffect, ...customOptions } : baseEffect;
    
    // Check particle budget - don't spawn if at capacity
    if (this.particles.length >= ParticleSystem.MAX_PARTICLES) {
      if (import.meta.env.DEV) {
        console.log(`[Particles] At budget (${ParticleSystem.MAX_PARTICLES}), skipping ${effectName}`);
      }
      return;
    }
    
    // Spawn only what fits in budget
    const room = ParticleSystem.MAX_PARTICLES - this.particles.length;
    const toSpawn = Math.min(effect.count, room);
    
    for (let i = 0; i < toSpawn; i++) {
      const angle = (Math.PI * 2 * i) / effect.count + (Math.random() - 0.5) * 0.5;
      const speed = effect.speed.min + Math.random() * (effect.speed.max - effect.speed.min);
      const color = effect.colors[Math.floor(Math.random() * effect.colors.length)];
      const shape = effect.shapes[Math.floor(Math.random() * effect.shapes.length)];
      const scale = effect.scale.min + Math.random() * (effect.scale.max - effect.scale.min);
      
      const particle: Particle = {
        id: ++this.idCounter,
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        color,
        life: effect.lifespan,
        startLife: effect.lifespan,
        scale,
        startScale: scale,
        alpha: 1,
        rotation: Math.random() * Math.PI * 2,
        shape,
        behaviors: [...effect.behaviors]
      };
      
      this.particles.push(particle);
    }
  }
  
  // Create simple particles (backwards compatibility)
  spawn(x: number, y: number, count: number, color: number) {
    // Respect particle budget for simple particles too
    const room = ParticleSystem.MAX_PARTICLES - this.particles.length;
    const toSpawn = Math.min(count, room);
    
    for (let i = 0; i < toSpawn; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 3 + Math.random() * 5;
      
      const particle: Particle = {
        id: ++this.idCounter,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        color,
        life: 1,
        startLife: 1,
        scale: 1,
        startScale: 1,
        alpha: 1,
        rotation: 0,
        shape: 'circle',
        behaviors: ['gravity', 'fade']
      };
      
      this.particles.push(particle);
    }
  }
  
  // Update all particles
  // Bob Nystrom: "Don't allocate in the game loop"
  update(deltaTime: number = 0.016) {
    this.time += deltaTime;
    
    // In-place removal using swap-and-pop (no array allocation)
    let i = 0;
    while (i < this.particles.length) {
      const particle = this.particles[i];
      
      // Apply behaviors with for loop (faster than forEach)
      for (let b = 0; b < particle.behaviors.length; b++) {
        const behaviorName = particle.behaviors[b];
        const behavior = particleBehaviors[behaviorName as keyof typeof particleBehaviors];
        if (behavior) {
          behavior(particle, this.time);
        }
      }
      
      // Update position
      particle.x += particle.vx;
      particle.y += particle.vy;
      
      // Remove dead particles with swap-and-pop
      if (particle.life <= 0) {
        // Swap with last element and pop (O(1) removal)
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        // Don't increment i - need to check swapped element
      } else {
        i++;
      }
    }
  }
  
  // Get all active particles
  getParticles(): Particle[] {
    return this.particles;
  }
  
  // Clear all particles
  clear() {
    this.particles = [];
  }
  
  // Draw a shape (used by renderer)
  static drawShape(g: PIXI.Graphics, shape: ParticleShape, x: number, y: number, size: number) {
    switch (shape) {
      case 'star':
        // 5-pointed star
        const spikes = 5;
        const outerRadius = size;
        const innerRadius = size * 0.5;
        let rotation = -Math.PI / 2;
        
        for (let i = 0; i < spikes * 2; i++) {
          const radius = i % 2 === 0 ? outerRadius : innerRadius;
          const angle = rotation + (i * Math.PI) / spikes;
          const px = x + Math.cos(angle) * radius;
          const py = y + Math.sin(angle) * radius;
          
          if (i === 0) {
            g.moveTo(px, py);
          } else {
            g.lineTo(px, py);
          }
        }
        g.closePath();
        break;
        
      case 'diamond':
        g.moveTo(x, y - size);
        g.lineTo(x + size, y);
        g.lineTo(x, y + size);
        g.lineTo(x - size, y);
        g.closePath();
        break;
        
      case 'heart':
        // Simplified heart shape
        g.moveTo(x, y + size * 0.3);
        g.bezierCurveTo(
          x, y - size * 0.3,
          x - size, y - size * 0.3,
          x - size, y
        );
        g.bezierCurveTo(
          x - size, y + size * 0.5,
          x, y + size * 0.8,
          x, y + size
        );
        g.bezierCurveTo(
          x, y + size * 0.8,
          x + size, y + size * 0.5,
          x + size, y
        );
        g.bezierCurveTo(
          x + size, y - size * 0.3,
          x, y - size * 0.3,
          x, y + size * 0.3
        );
        break;
        
      case 'square':
        g.rect(x - size, y - size, size * 2, size * 2);
        break;
        
      case 'circle':
      default:
        g.circle(x, y, size);
        break;
    }
  }
}