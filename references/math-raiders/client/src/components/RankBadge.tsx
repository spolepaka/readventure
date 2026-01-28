import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { getRankColorClasses, getNextMilestone } from '../utils/rankDivisions';
import { RankGem } from './RankGem';
import { RankExplainerModal } from './RankExplainerModal';

interface RankBadgeProps {
  rank: string | null | undefined;
  division: string;
  masteredCount: number;
  totalCount: number;
  grade?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function RankBadge({ 
  rank, 
  division, 
  masteredCount, 
  totalCount,
  grade = 3,
  className,
  size = 'md'
}: RankBadgeProps) {
  const [showRankModal, setShowRankModal] = useState(false);
  const [hasSeenExplainer, setHasSeenExplainer] = useState(() => {
    return localStorage.getItem('rank-explainer-seen') === 'true';
  });
  
  const handleOpenModal = () => {
    setShowRankModal(true);
    if (!hasSeenExplainer) {
      localStorage.setItem('rank-explainer-seen', 'true');
      setHasSeenExplainer(true);
    }
  };
  
  if (!rank) return null;
  
  const percentage = totalCount > 0 ? (masteredCount / totalCount) * 100 : 0;
  const colors = getRankColorClasses(rank);
  const nextMilestone = getNextMilestone(rank, masteredCount, totalCount);
  
  const sizeClasses = {
    sm: {
      container: 'p-4',
      icon: 'text-3xl',
      title: 'text-lg',
      stats: 'text-xs',
      bar: 'h-2'
    },
    md: {
      container: 'p-6',
      icon: 'text-5xl',
      title: 'text-2xl',
      stats: 'text-sm',
      bar: 'h-3'
    },
    lg: {
      container: 'p-8',
      icon: 'text-7xl',
      title: 'text-3xl',
      stats: 'text-base',
      bar: 'h-4'
    }
  };
  
  const sizes = sizeClasses[size];
  
  return (
    <>
      <div
        className={cn(
          'rank-badge rounded-xl text-center transition-all duration-300 relative group',
          'border-2',
          colors.bg,
          colors.border,
          colors.glow,
          'shadow-lg hover:shadow-xl',
          sizes.container,
          className
        )}
      >
      {/* Help button - always visible with subtle pulse hint for first-time users */}
      <button 
        onClick={handleOpenModal}
        className={cn(
          "absolute top-2 right-2 w-7 h-7 rounded-full",
          "bg-white/10 hover:bg-white/20",
          "flex items-center justify-center",
          "transition-all duration-200",
          "cursor-pointer hover:scale-110",
          !hasSeenExplainer && "animate-pulse"  // Pulse until they view it once
        )}
        aria-label="Learn about ranks"
      >
        <span className="text-white/70 hover:text-white text-sm font-semibold transition-colors">?</span>
      </button>

      {/* Rank Gem */}
      <div className={cn('flex items-center justify-center mb-6', sizes.icon)}>
        <RankGem 
          rank={rank as 'bronze' | 'silver' | 'gold' | 'diamond' | 'legendary'} 
          size={size}
        />
      </div>
      
      {/* Rank Title */}
      <h2 className={cn(
        'font-bold mb-3 font-game',
        colors.text,
        sizes.title
      )}>
        {rank.toUpperCase()}
        {division && <span className="text-white/70 ml-2">{division}</span>}
      </h2>
      
      {/* Progress Bar Container */}
      <div className="w-full max-w-[200px] mx-auto mb-3">
        <div className={cn(
          'w-full bg-black/40 rounded-full overflow-hidden',
          sizes.bar
        )}>
          <div 
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              'bg-gradient-to-r',
              rank === 'bronze' && 'from-yellow-800 to-yellow-700',
              rank === 'silver' && 'from-gray-600 to-gray-400',
              rank === 'gold' && 'from-yellow-600 to-yellow-400',
              rank === 'diamond' && 'from-cyan-500 to-cyan-300',
              rank === 'legendary' && 'from-purple-500 to-purple-300 animate-pulse'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      
      {/* Stats */}
      <p className={cn('text-gray-400', sizes.stats)}>
        {masteredCount}/{totalCount} facts mastered
        <span 
          className="inline-block ml-1 text-gray-500 cursor-help relative info-icon"
          data-tooltip="Unique facts only (3 + 4 = 4 + 3 counts as one)"
        >
          ⓘ
        </span>
      </p>
      
      {/* Next Milestone */}
      {nextMilestone && (
        <p className={cn('text-gray-500 mt-1', sizes.stats)}>
          {nextMilestone.factsNeeded} facts until {nextMilestone.milestone}
        </p>
      )}

    </div>
    
      {/* Rank Explainer Modal */}
      <RankExplainerModal
        isOpen={showRankModal}
        onClose={() => setShowRankModal(false)}
        rank={rank}
        division={division}
        masteredCount={masteredCount}
        totalCount={totalCount}
        grade={grade}
      />
    </>
  );
}














