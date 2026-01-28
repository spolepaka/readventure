import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface Particle {
  id: number;
  dx: number;
  dy: number;
  size: number;
  rotate: number;
  color: string;
  delay: number;
  duration: number;
}

export function RewardParticles({ tier }: { tier: string }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    // Fortnite-style: more particles, bigger burst
    const counts = tier === 'legendary' ? 20 : tier === 'epic' ? 14 : tier === 'rare' ? 10 : tier === 'uncommon' ? 5 : 0;
    if (counts === 0) return;
    const color = tier === 'legendary' ? '#F59E0B' : tier === 'epic' ? '#A335EE' : tier === 'rare' ? '#60A5FA' : '#34D399';

    const gen: Particle[] = Array.from({ length: counts }, (_, i) => ({
      id: i,
      dx: (Math.random() * 200 - 100),  // Wider spread
      dy: (Math.random() * 200 - 100),
      size: 14 + Math.random() * 10,     // Slightly larger
      rotate: Math.random() * 360,
      color,
      delay: i * 0.015,                  // Faster stagger
      duration: 0.6 + Math.random() * 0.4,
    }));
    setParticles(gen);
  }, [tier]);

  if (tier !== 'uncommon' && tier !== 'rare' && tier !== 'epic' && tier !== 'legendary') return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute w-4 h-4"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            x: p.dx,
            y: p.dy,
            scale: [0, 1.5, 0],
            opacity: [0, 1, 0],
          }}
          transition={{ 
            duration: p.duration, 
            ease: 'easeOut', 
            delay: p.delay,
          }}
        >
          <div 
            className="w-full h-full"
            style={{
              backgroundColor: p.color,
              clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
              transform: `rotate(${p.rotate}deg)`,
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}