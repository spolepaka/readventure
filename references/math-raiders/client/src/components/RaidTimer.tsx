import { useEffect, memo, useState } from 'react';
import { isAdaptiveBoss } from '@/game/bosses/bossConfig';

interface RaidTimerProps {
  raidClientStartTime: number | null;
  raidState: 'InProgress' | 'Paused' | 'Matchmaking' | 'Victory' | 'Failed' | 'Rematch' | 'Countdown';
  bossLevel?: number;
}

/**
 * Raid timer component - only THIS re-renders every second, not RaidScreen
 * 
 * Pattern: Derive timer value during render, use state only to trigger periodic updates
 * - Timer value calculated from Date.now() - raidClientStartTime (always accurate)
 * - When props change, component re-renders immediately with correct value
 * - Interval triggers periodic updates to recalculate time remaining
 */
export const RaidTimer = memo(function RaidTimer({ raidClientStartTime, raidState, bossLevel = 0 }: RaidTimerProps) {
  // State only used to trigger re-renders every second
  const [, setTick] = useState(0);
  
  // Calculate timeout duration based on boss level (matches server logic)
  const timeoutDuration = isAdaptiveBoss(bossLevel) ? 150 : 120;  // 2:30 for adaptive, 2:00 for fixed bosses
  
  // Derive timer value directly from props during render (single source of truth)
  // This ensures correct value immediately when props change
  const raidTimeRemaining = raidClientStartTime && (raidState === "InProgress" || raidState === "Paused")
    ? Math.max(0, Math.min(timeoutDuration, timeoutDuration - Math.ceil((Date.now() - raidClientStartTime) / 1000)))
    : timeoutDuration;
  
  useEffect(() => {
    if (!raidClientStartTime || (raidState !== "InProgress" && raidState !== "Paused")) {
      return;
    }
    
    // Only update if not paused
    if (raidState === "Paused") {
      return;
    }
    
    // Standard React timer pattern: immediate update + interval
    // Component already renders with correct value when props change
    // This just triggers periodic re-renders to recalculate time remaining
    const update = () => setTick(prev => prev + 1);
    
    // Immediate update (no delay)
    update();
    
    // Then update every second
    const interval = setInterval(update, 1000);
    
    return () => clearInterval(interval);
  }, [raidClientStartTime, raidState]);
  
  // Only render timer for active raids
  if (raidState !== "InProgress" && raidState !== "Paused") {
    return null;
  }
  
  return (
    <div className={`
      flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold tabular-nums text-xl
      bg-gradient-to-br shadow-md border transition-all duration-300
      ${raidTimeRemaining > 60 
        ? 'from-gray-800/80 to-gray-900/80 border-gray-600/50 text-gray-300'
        : raidTimeRemaining > 30
        ? 'from-yellow-900/60 to-orange-900/60 border-yellow-600/70 text-yellow-300'
        : 'from-red-900/80 to-red-950/80 border-red-500 text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]'
      }
      ${raidTimeRemaining <= 30 ? 'animate-pulse' : ''}
    `}>
      <span className="text-base">⏱️</span>
      <span>
        {Math.floor(raidTimeRemaining / 60)}:{(raidTimeRemaining % 60).toString().padStart(2, '0')}
      </span>
    </div>
  );
});
