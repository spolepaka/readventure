import { memo, useEffect } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { Skull } from 'lucide-react';

interface BossHealthBarProps {
  currentHp: number;
  maxHp: number;
  isPulsing?: boolean;
  bossName?: string;
}

/**
 * Boss health bar with integrated controls
 * Memoized to prevent unnecessary re-renders
 */
export const BossHealthBar = memo(function BossHealthBar({ 
  currentHp, 
  maxHp, 
  isPulsing = false,
  bossName = "Clank"
}: BossHealthBarProps) {
  const hpPercentage = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
  const mainScale = useMotionValue(hpPercentage / 100); // 0-1 for scaleX (GPU-accelerated)
  const trailingScale = useMotionValue(hpPercentage / 100); // 0-1 for scaleX
  
  // Animate both bars when HP changes (GPU-composited, no layout thrashing)
  useEffect(() => {
    const targetScale = hpPercentage / 100;
    const currentMain = mainScale.get();
    const currentTrail = trailingScale.get();
    
    // Main bar: fast snap
    if (Math.abs(targetScale - currentMain) > 0.001) {
      animate(mainScale, targetScale, {
        duration: 0.1,
        ease: [0.25, 0.1, 0.25, 1]
      });
    }
    
    // Trailing bar: quick satisfaction (you dealt damage, see it land)
    if (targetScale < currentTrail) {
      animate(trailingScale, targetScale, {
        duration: 0.6,
        ease: [0.4, 0, 0.2, 1]
      });
    } else {
      trailingScale.set(targetScale);
    }
  }, [hpPercentage, mainScale, trailingScale]);
  
  // Determine color based on HP percentage
  const getHealthColor = () => {
    if (hpPercentage > 50) return 'linear-gradient(to right, #10b981, #059669)';
    if (hpPercentage > 20) return 'linear-gradient(to right, #f59e0b, #d97706)';
    return 'linear-gradient(to right, #ef4444, #dc2626)';
  };
  
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        {/* Boss name with icon - baseline aligned */}
        <div className="flex items-baseline gap-1.5">
          <Skull className="w-5 h-5 text-red-400 drop-shadow-[0_0_6px_rgba(248,113,113,0.6)] flex-shrink-0 translate-y-0.5" />
        <h3 className="text-xl font-bold boss-name font-game">{bossName}</h3>
        </div>
        <div 
          className={`boss-hp w-64 h-4 ui-progress-track mt-1 relative overflow-hidden rounded-full ${isPulsing ? 'boss-hp-flash' : ''}`}>
          {/* MMO-style segment markers at 25%, 50%, 75% */}
          <div className="absolute inset-0 flex pointer-events-none z-30">
            {[25, 50, 75].map(pos => (
              <div key={pos} className={`absolute top-0 bottom-0 w-px bg-black/60`} style={{ left: `${pos}%` }} />
            ))}
          </div>
          
          {/* Trailing bar (shows previous HP, drains slowly) - GPU accelerated */}
          {hpPercentage < 99.5 && (
            <motion.div
              className="absolute inset-0 h-full bg-white/50 rounded z-[12]"
              style={{ 
                scaleX: trailingScale,
                transformOrigin: 'left',
                willChange: 'transform'
              }}
            />
          )}
          
          {/* Health bar fill (main) - GPU accelerated via scaleX */}
          <motion.div
            className="absolute inset-0 h-full rounded z-[20]"
            style={{ 
              scaleX: mainScale,
              transformOrigin: 'left',
              background: getHealthColor(),
              willChange: 'transform'
            }}
          >
            {/* Subtle shine effect on the health bar */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
          </motion.div>
        </div>
        <div className="text-sm ui-muted mt-1">
          {currentHp} / {maxHp} HP
        </div>
      </div>
    </div>
  );
});

// Display name for debugging
BossHealthBar.displayName = 'BossHealthBar';


