import { memo, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { User } from 'lucide-react';
import { isAdaptiveBoss } from '@/game/bosses/bossConfig';

interface PlayerHealthBarProps {
  raidClientStartTime: number | null;
  bossLevel: number;
  raidState: string;
  playerName: string;
}

/**
 * Player health bar - mirrors boss HP bar style
 * HP drains as raid time passes (time is the attacker)
 * Self-contained: owns its own tick interval to avoid re-rendering parent
 */
export const PlayerHealthBar = memo(function PlayerHealthBar({ 
  raidClientStartTime,
  bossLevel,
  raidState,
  playerName
}: PlayerHealthBarProps) {
  // Tick state - triggers re-renders every second (only THIS component)
  const [tick, setTick] = useState(0);
  const lastTickRef = useRef(0);
  const pulseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);
  
  // Start/stop interval based on raid state
  useEffect(() => {
    if (!raidClientStartTime || (raidState !== "InProgress" && raidState !== "Paused")) {
      lastTickRef.current = 0;
      return;
    }
    
    if (raidState === "Paused") {
      return; // Don't tick during pause
    }
    
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => {
      clearInterval(interval);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, [raidClientStartTime, raidState]);
  
  // Calculate HP from time (derived, not stored)
  const timeoutDuration = isAdaptiveBoss(bossLevel) ? 150 : 120;
  const tickInterval = 10; // Boss attacks every 10 seconds
  const numTicks = timeoutDuration / tickInterval;
  const hpPerTick = 100 / numTicks;
  
  let currentHp = 100;
  if (raidClientStartTime && (raidState === "InProgress" || raidState === "Paused")) {
    const elapsedSeconds = (Date.now() - raidClientStartTime) / 1000;
    const currentTick = Math.floor(elapsedSeconds / tickInterval);
    currentHp = Math.max(0, 100 - (currentTick * hpPerTick));
    
    // Trigger pulse when crossing tick boundary
    if (currentTick > lastTickRef.current && currentTick > 0) {
      lastTickRef.current = currentTick;
      setIsPulsing(true);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = setTimeout(() => setIsPulsing(false), 300);
    }
  }
  // tick is unused but changing it triggers re-render (React pattern for interval-driven updates)
  void tick;
  
  const hpPercentage = Math.max(0, Math.min(100, currentHp));
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
    
    // Trailing bar: slow bleed (time attacking you, feel the loss)
    if (targetScale < currentTrail) {
      animate(trailingScale, targetScale, {
        duration: 1.5,
        ease: [0.4, 0, 0.2, 1]
      });
    } else {
      trailingScale.set(targetScale);
    }
  }, [hpPercentage, mainScale, trailingScale]);
  
  // Fixed green - player HP doesn't stress with color shifts
  // Timer already provides urgency warning (goes red at 30s)
  const HEALTH_COLOR = 'linear-gradient(to right, #10b981, #059669)';
  
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        {/* Player name with icon - baseline aligned */}
        <div className="flex items-baseline gap-1.5">
          <User className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)] flex-shrink-0 translate-y-0.5" />
        <h3 className="text-lg font-bold text-white/90 font-game truncate">{playerName}</h3>
        </div>
        <div 
          className={`player-hp w-48 h-3 ui-progress-track mt-1 relative overflow-hidden rounded-full ${isPulsing ? 'player-hp-flash' : ''}`}>
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
              background: HEALTH_COLOR,
              willChange: 'transform'
            }}
          >
            {/* Subtle shine effect on the health bar */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
          </motion.div>
        </div>
        <div className="text-xs ui-muted mt-0.5">
          {Math.round(currentHp)} / 100 HP
        </div>
      </div>
    </div>
  );
});

// Display name for debugging
PlayerHealthBar.displayName = 'PlayerHealthBar';

