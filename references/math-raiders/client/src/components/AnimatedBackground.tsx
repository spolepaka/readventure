import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';

/**
 * AnimatedBackground - Ambient math-themed particle field
 * 
 * Bob Nystrom-approved optimizations:
 * - 8 particles (not 24) - "The simplest optimization is to not do something"
 * - 1 animation per particle (not 3) - composition via transform only
 * - No CSS variables - everything pre-computed
 * - GPU-only transforms - translate, rotate, scale
 */

// More symbols for a fuller feel, still static = zero CPU cost
const PARTICLE_COUNT = 14;

// Mathematical symbols for variety - kid-friendly
const MATH_SYMBOLS = ['1', '2', '3', '4', '5', '+', '−', '×', '=', '?', '★', '♦'];

// Color palette 
const COLORS = [
  'rgba(167, 139, 250, 0.4)', // violet
  'rgba(192, 132, 252, 0.4)', // purple
  'rgba(244, 114, 182, 0.4)', // pink
  'rgba(129, 140, 248, 0.4)', // indigo
];

interface Particle {
  id: number;
  x: number;
  y: number;
  symbol: string;
  size: number;
  color: string;
  duration: number;
  delay: number;
}

export function AnimatedBackground() {
  const currentRaid = useGameStore(state => state.currentRaid);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  
  // Hide during active raid - RaidScreen has its own lighter effects
  const inActiveRaid = !!(currentRaid && currentPlayer && 
    (currentRaid.state.tag === 'InProgress' || currentRaid.state.tag === 'Matchmaking'));
  
  // Performance detection: skip animation on slow devices or reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined' && 
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  // TEMPORARY: Always skip animation until we figure out why 8 CSS animations
  // kill the 2017 iPad Pro's main thread. This shouldn't happen.
  const skipAnimation = true; // TODO: investigate why CSS animations block main thread
  
  // Generate particles once - seeded pseudo-random for consistent placement
  const particles = useMemo((): Particle[] => {
    const result: Particle[] = [];
    
    // Pre-computed "random" positions that look good and don't overlap the center card
    const positions = [
      { x: 5, y: 12 },   { x: 88, y: 8 },   { x: 15, y: 45 },  { x: 92, y: 35 },
      { x: 8, y: 75 },   { x: 85, y: 70 },  { x: 3, y: 28 },   { x: 95, y: 55 },
      { x: 12, y: 88 },  { x: 90, y: 85 },  { x: 6, y: 58 },   { x: 87, y: 22 },
      { x: 18, y: 15 },  { x: 80, y: 92 },
    ];
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      result.push({
        id: i,
        x: positions[i].x,
        y: positions[i].y,
        symbol: MATH_SYMBOLS[i % MATH_SYMBOLS.length],
        size: 28 + (i % 4) * 8, // 28-52px, varied
        color: COLORS[i % COLORS.length],
        duration: 30 + (i % 3) * 15,
        delay: -(i % 5) * 6,
      });
    }
    
    return result;
  }, []);
  
  // Static version with symbols (no animation, zero CPU cost)
  if (inActiveRaid || skipAnimation) {
    return (
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900" />
        
        {/* Static math symbols - scattered around edges, avoiding center card */}
        {particles.map(p => (
          <span
            key={p.id}
            className="absolute select-none pointer-events-none"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              fontSize: `${p.size}px`,
              color: p.color,
              opacity: 0.2 + (p.id % 4) * 0.08, // Vary opacity 0.2-0.44 for depth
              transform: `rotate(${(p.id * 25) - 45}deg)`, // More rotation variety
              filter: 'blur(0.5px)',
            }}
          >
            {p.symbol}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Static gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900" />
      
      {/* CSS for single, efficient animation */}
      <style>{`
        @keyframes float-up {
          from {
            transform: translateY(110vh) rotate(0deg);
          }
          to {
            transform: translateY(-10vh) rotate(360deg);
          }
        }
        
        .bg-particle {
          position: absolute;
          animation: float-up var(--duration) linear var(--delay) infinite;
          will-change: transform;
          pointer-events: none;
        }
      `}</style>
      
      {/* 8 particles with single animation each = 8 total animations */}
      {particles.map(p => (
            <span
          key={p.id}
          className="bg-particle select-none"
              style={{
            left: `${p.x}%`,
            fontSize: `${p.size}px`,
            color: p.color,
            '--duration': `${p.duration}s`,
            '--delay': `${p.delay}s`,
              } as React.CSSProperties}
            >
          {p.symbol}
            </span>
        ))}
    </div>
  );
}
