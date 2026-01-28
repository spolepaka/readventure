import React from 'react';
import { cn } from '../lib/utils';

type OperationType = 'add' | 'subtract' | 'multiply' | 'divide' | 'all';

interface TrackStarProps {
  operation: OperationType;
  goalBossWins: number;  // 0, 1, 2, or 3+
  goalBossName: string;
  starTier: 'empty' | 'bronze' | 'silver' | 'master';
}

const TRACK_CONFIG = {
  add: { symbol: '+', label: 'Addition', color: '#22c55e' },
  subtract: { symbol: '−', label: 'Subtraction', color: '#f97316' },
  multiply: { symbol: '×', label: 'Multiplication', color: '#3b82f6' },
  divide: { symbol: '÷', label: 'Division', color: '#ef4444' },
  all: { symbol: 'All', label: 'All Facts', color: '#a855f7' }
};

export function TrackStar({ 
  operation, 
  goalBossWins,
  goalBossName,
  starTier,
}: TrackStarProps) {
  const config = TRACK_CONFIG[operation];
  const isMaster = starTier === 'master';
  const stars = Math.min(goalBossWins, 3);
  
  // Build tooltip - optimized for engagement, learning, clarity
  const getTooltip = () => {
    const trackName = config.label; // "Multiplication", "All Facts", etc.
    const masterTitle = operation === 'all' ? 'GRAND MASTER' : 'TRACK MASTER';
    
    if (stars >= 3) {
      // Fortnite K-12 style: punchy, no fluff
      return operation === 'all'
        ? `⭐⭐⭐ ${masterTitle}! All facts. Full speed.`
        : `⭐⭐⭐ ${masterTitle}! ${trackName} conquered.`;
    }
    if (stars === 2) {
      return `⭐⭐ ${trackName}: Beat ${goalBossName} 1 more time! (2/3)`;
    }
    if (stars === 1) {
      return `⭐ ${trackName}: Beat ${goalBossName} 2 more times! (1/3)`;
    }
    return `Beat ${goalBossName} 3× in ${trackName} Mastery Trials`;
  };
  
  return (
    <div 
      className="mastery-cell cursor-help group"
      data-tooltip={getTooltip()}
    >
      <div 
        className={cn(
          "px-2 py-2 rounded-lg transition-all duration-300",
          "border flex flex-col items-center gap-1",
          "hover:scale-105 hover:-translate-y-0.5",
          isMaster && "animate-gentle-shine"
        )}
        style={{
          background: isMaster 
            ? `linear-gradient(135deg, ${config.color}20, ${config.color}40)` 
            : 'rgba(0,0,0,0.4)',
          borderColor: stars > 0 ? config.color : 'rgba(255,255,255,0.15)',
          boxShadow: isMaster 
            ? `0 0 12px ${config.color}60, 0 0 24px ${config.color}30` 
            : 'none',
          minWidth: '52px'
        }}
      >
        {/* Star indicators - stacked vertically */}
        <div className="flex gap-0.5">
          {[1, 2, 3].map(n => (
            <span 
              key={n}
              className="text-xs"
              style={{ 
                color: n <= stars ? '#fbbf24' : 'rgba(255,255,255,0.2)',
                textShadow: n <= stars ? '0 0 4px #fbbf24' : 'none'
              }}
            >
              ★
            </span>
          ))}
        </div>
        
        {/* Operation symbol below - always visible */}
        <span 
          className="text-base font-bold"
          style={{ color: config.color }}
        >
          {config.symbol}
        </span>
      </div>
    </div>
  );
}
