import { memo, useEffect, useState } from 'react';

interface GameTimerProps {
  startTime: number;
  isActive: boolean;
}

// Memoized timer component - only IT re-renders, not the whole game!
export const GameTimer = memo(function GameTimer({ startTime, isActive }: GameTimerProps) {
  const [timeElapsed, setTimeElapsed] = useState(0);
  
  useEffect(() => {
    if (isActive && startTime > 0) {
      const interval = setInterval(() => {
        setTimeElapsed(Date.now() - startTime);
      }, 100); // Update 10x/sec is plenty for a timer display
      return () => clearInterval(interval);
    } else {
      setTimeElapsed(0);
    }
  }, [isActive, startTime]);
  
  return (
    <div className="text-right mt-1">
      <span className="text-[10px] text-gray-600 font-medium tabular-nums">
        {(timeElapsed / 1000).toFixed(1)}s
      </span>
    </div>
  );
});























































