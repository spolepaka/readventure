import { motion, AnimatePresence } from 'framer-motion';
import { memo } from 'react';

export interface DamageNumber {
  id: number;
  value: number;
  x: number;      // Percentage (0-100) of container width
  y: number;      // Percentage (0-100) of container height
  speedTier: 'fast' | 'medium' | 'normal';
}

interface FloatingCombatTextProps {
  damages: DamageNumber[];
  onComplete?: (id: number) => void;
}

// Speed-based damage colors - Math Raiders style
const DAMAGE_COLORS = {
  fast: '#FFD700',      // Gold for lightning fast
  medium: '#00BFFF',    // Blue for solid hits  
  normal: '#FFFFFF',    // White for normal
};

// Memoized to prevent re-renders when damage array hasn't changed
export const FloatingCombatText = memo(function FloatingCombatText({ damages, onComplete }: FloatingCombatTextProps) {
  return (
    <AnimatePresence>
      {damages.map((damage) => {
        // WoW uses a "fountain" pattern - slight randomization but mostly predictable
        // Numbers alternate left/right with small random variance
        // Use damage.id for stable alternation (not array index which changes)
        const baseDirection = Math.floor(damage.id) % 2 === 0 ? 1 : -1;
        const xDrift = baseDirection * (40 + Math.random() * 20); // 40-60px left or right
        const yHeight = 100 + Math.random() * 20;  // 100-120px up (less variance)
        
        // Detect crit from damage value (scaled for 1.5x damage: 150+ base, ~120+ after grade scaling)
        const isCrit = damage.value >= 120;
        // Crits linger longer for celebration, regular hits clear fast for next answer
        const duration = isCrit ? 2.2 : 1.3;
        // WoW-style: Use tier color always (gold/cyan/white), size differentiates crits
        const color = DAMAGE_COLORS[damage.speedTier];
        
        // Use container queries - size based on damage value
        const containerWidth = damage.value > 40 ? 200 : damage.value > 20 ? 150 : 100;
        
        return (
          <motion.div
            key={damage.id}
            className="damage-container absolute pointer-events-none text-center"
            style={{
              left: `${damage.x}%`,
              top: `${damage.y}%`,
              width: `${containerWidth}px`,
              zIndex: 1000,
              willChange: 'transform',  // Safari: prepare for animation
              transform: 'translateZ(0)',  // Safari: force GPU layer
            }}
          >
            <motion.div
              className="damage-number damage-text"
              style={{
                color,
                fontWeight: isCrit ? 900 : 700,  // Crits are bolder
                textShadow: `
                  2px 2px 0 #000,
                  -2px 2px 0 #000,
                  2px -2px 0 #000,
                  -2px -2px 0 #000
                `,
                fontFamily: 'Rubik, sans-serif',
                willChange: 'transform, opacity',  // Safari: prepare GPU layer
                transform: 'translateZ(0)',        // Safari: force GPU compositing
              }}
              initial={{ 
                opacity: 0,
                scale: 1.5,  // Start bigger for more impact
                x: `calc(-50% + ${xDrift * 0.1}px)`, // Start slightly offset
                y: '-50%',
              }}
              animate={{
                // Clean arc motion - no wobble
                x: `calc(-50% + ${xDrift}px)`,  // Single destination
                y: `calc(-50% - ${yHeight}px)`,  // Single destination
                opacity: [0, 1, 1, 0],  // Fade in, stay visible, fade out
                scale: 1.1,  // Standard scale for all damage
              }}
              transition={{
                duration,
                ease: "easeOut",
                opacity: {
                  times: [0, 0.2, 0.8, 1],  // 20% fade in, 60% visible, 20% fade out
                  duration
                }
              }}
              onAnimationComplete={() => onComplete?.(damage.id)}
            >
              <div className="flex flex-col items-center">
                {/* WoW-style: Crits are HUGE, everything else scaled by damage value */}
                <div className={`font-black ${
                  damage.value >= 120 ? 'text-8xl' :  // CRIT - massive!
                  damage.value >= 70 ? 'text-5xl' :   // Fast normal
                  damage.value >= 45 ? 'text-4xl' :   // Medium
                  damage.value >= 30 ? 'text-3xl' :   // Solid
                  'text-2xl'                          // Slow
                }`}>{damage.value}</div>
                {/* Crit label - bigger and red for maximum impact */}
                {damage.value >= 120 && (
                  <div className="text-5xl font-black mt-2 font-game" style={{ color: '#FF4444' }}>
                    CRIT!
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
});