# Particle System

A Disney-quality particle system for Math Raiders that makes effects simple to create and beautiful to watch.

## Quick Start

```typescript
// In your component
import { spawnEffect } from '../game/systems/ParticleSystem';

// Spawn predefined effects
spawnEffect('celebrate', x, y);  // Colorful celebration
spawnEffect('impact', x, y);     // Fast hit effect
spawnEffect('combo', x, y);      // Rainbow spiral combo
spawnEffect('error', x, y);      // Red error particles
spawnEffect('magic', x, y);      // Floating sparkles
```

## Adding New Effects

1. Open `ParticleSystem.ts`
2. Add your effect to `particleEffects`:

```typescript
myEffect: {
  count: 25,                              // Number of particles
  behaviors: ['gravity', 'fade', 'spin'], // Mix and match behaviors
  colors: [0xFF0000, 0x00FF00],          // Array of colors to use
  shapes: ['star', 'heart'],             // Shape variety
  speed: { min: 3, max: 8 },             // Speed range
  scale: { min: 0.5, max: 2.0 },         // Size variety
  lifespan: 2.0                          // Seconds before fade
}
```

3. Use it: `spawnEffect('myEffect', x, y)`

## Available Behaviors

- `gravity` - Falls down with physics
- `fade` - Gradually disappears
- `spin` - Rotates continuously
- `pulse` - Size pulses
- `rainbow` - Cycles through colors
- `spiral` - Spirals outward
- `explode` - Slows down over time
- `float` - Gentle floating motion
- `sparkle` - Twinkles

## Philosophy

Disney particles aren't complex - they're MANY simple particles doing simple things TOGETHER:
- 30 circles with variations > 5 complex shapes
- 3 simple behaviors combined > 1 complex algorithm
- Generous quantities > Sophisticated code

## Performance

The system is optimized for 60fps with hundreds of particles:
- Particles are pooled (no GC pressure)
- Simple shapes render fast
- Automatic cleanup of dead particles
- Behaviors are composable functions