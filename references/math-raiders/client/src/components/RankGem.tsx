import React from 'react';
import { cn } from '../lib/utils';

interface RankGemProps {
  rank: 'bronze' | 'silver' | 'gold' | 'diamond' | 'legendary';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  animate?: boolean;
}

export function RankGem({ rank, size = 'md', className, animate = true }: RankGemProps) {
  const sizeClasses = {
    xs: 'w-4 h-4',
    sm: 'w-10 h-10',
    md: 'w-16 h-16',
    lg: 'w-24 h-24'
  };

  return (
    <div className={cn("relative inline-block group", className)}>
      {/* Glow layer (disabled for xs - table rows) */}
      {size !== 'xs' && (
        <div 
          className={cn(
            "absolute inset-0 blur-2xl scale-125 transition-all duration-300",
            "opacity-70 group-hover:opacity-100 group-hover:scale-150",
            rank === 'bronze' && "bg-yellow-800",
            rank === 'silver' && "bg-gray-400",
            rank === 'gold' && "bg-amber-400",
            rank === 'diamond' && "bg-cyan-400",
            rank === 'legendary' && "bg-purple-500"
          )}
        />
      )}
      
      {/* Main gem */}
      <div 
        className={cn(
          "relative transform rotate-45 rounded-[10%] overflow-hidden",
          "shadow-lg",
          sizeClasses[size],
          // Base gradient per rank
          rank === 'bronze' && "bg-gradient-to-br from-yellow-800 via-yellow-900 to-amber-950",
          rank === 'silver' && "bg-gradient-to-br from-gray-500 via-gray-300 to-gray-600",
          rank === 'gold' && "bg-gradient-to-br from-amber-400 via-yellow-400 to-amber-600",
          rank === 'diamond' && "bg-gradient-to-br from-cyan-400 via-cyan-300 to-blue-500",
          rank === 'legendary' && "bg-gradient-to-br from-purple-500 via-pink-400 to-purple-600",
          // Hover effects (disabled for xs size - table rows)
          size !== 'xs' && "transition-all duration-300",
          size !== 'xs' && "hover:transform hover:rotate-45 hover:-translate-y-1 hover:scale-105",
          size !== 'xs' && "hover:brightness-110 hover:shadow-lg",
          // Animation - each rank gets a unique effect!
          animate && rank === 'bronze' && "animate-bronze-glow",
          animate && rank === 'silver' && "animate-silver-gleam",
          animate && rank === 'gold' && "animate-gentle-shine",
          animate && rank === 'diamond' && "animate-shimmer",
          animate && rank === 'legendary' && "animate-pulse"
        )}
        style={{
          boxShadow: size === 'xs' 
            ? `
              inset 0 2px 4px rgba(255,255,255,0.4),
              inset 0 -2px 4px rgba(0,0,0,0.4),
              inset 2px 0 2px rgba(255,255,255,0.2),
              inset -2px 0 2px rgba(0,0,0,0.3)
            `
            : `
              inset 0 2px 4px rgba(255,255,255,0.6),
              inset 0 -2px 4px rgba(0,0,0,0.4),
              inset 2px 0 2px rgba(255,255,255,0.3),
              inset -2px 0 2px rgba(0,0,0,0.3)
            `
        }}
      >
        {/* Gloss overlay - reduced for xs size */}
        <div className={cn(
          "absolute inset-0 bg-gradient-to-br via-transparent to-transparent",
          size === 'xs' ? "from-white/15" : "from-white/30"
        )} />
        
        {/* Animated shine sweep - all ranks get their own */}
        <div className={cn(
          "absolute -inset-full bg-gradient-to-r from-transparent to-transparent skew-x-12",
          rank === 'bronze' && "via-yellow-700/30 bronze-shine",
          rank === 'silver' && "via-gray-300/40 silver-shine",
          rank === 'gold' && "via-yellow-300/50 gold-shine",
          rank === 'diamond' && "via-cyan-300/40 diamond-shine",
          rank === 'legendary' && "via-purple-300/60 legendary-rank-shine"
        )} />
      </div>
    </div>
  );
}
