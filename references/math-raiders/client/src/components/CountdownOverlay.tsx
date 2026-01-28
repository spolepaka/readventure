import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';

/**
 * 3-2-1-RAID! countdown overlay before raid starts
 * Uses server timestamp for multiplayer sync
 * CSS-only animations (no Framer overhead)
 */
export function CountdownOverlay() {
  const currentRaid = useGameStore(s => s.currentRaid);
  const [count, setCount] = useState(3);
  const lastCountRef = useRef(3);
  
  // Update count based on server timestamp
  useEffect(() => {
    if (!currentRaid?.countdownStartedAt || currentRaid.state.tag !== 'Countdown') return;
    
    // Convert BigInt microseconds to milliseconds
    const countdownStartMs = Number(currentRaid.countdownStartedAt.microsSinceUnixEpoch / 1000n);
    
    const tick = () => {
      const elapsed = Math.max(0, (Date.now() - countdownStartMs) / 1000);
      const newCount = Math.max(0, 3 - Math.floor(elapsed));
      
      if (newCount !== lastCountRef.current) {
        lastCountRef.current = newCount;
        setCount(newCount);
      }
    };
    
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [currentRaid?.countdownStartedAt, currentRaid?.state.tag]);
  
  // Only show during Countdown state
  if (currentRaid?.state.tag !== 'Countdown') return null;
  
  const isGo = count === 0;
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80">
      {/* Subtle radial glow */}
      <div 
        className="absolute inset-0 pointer-events-none transition-all duration-300"
        style={{
          background: isGo 
            ? 'radial-gradient(circle, rgba(251,191,36,0.2) 0%, transparent 50%)'
            : 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 50%)'
        }}
      />
      
      {/* Number/GO - CSS animation only */}
      <div 
        key={count}
        className="animate-pop"
      >
        {isGo ? (
          <span className="font-game text-[10rem] leading-none font-black 
                         bg-gradient-to-b from-amber-300 via-amber-400 to-orange-500 
                         bg-clip-text text-transparent
                         drop-shadow-[0_0_40px_rgba(251,191,36,0.6)]">
            RAID!
          </span>
        ) : (
          <span className="font-game text-[16rem] leading-none font-black 
                         text-white drop-shadow-[0_0_25px_rgba(255,255,255,0.3)]">
            {count}
          </span>
        )}
      </div>
      
      <style>{`
        @keyframes pop {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-pop {
          animation: pop 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

