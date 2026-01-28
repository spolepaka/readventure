import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameSounds } from '@/hooks/useGameSounds';
import { RankGem } from './RankGem';
import { getRankColorClasses } from '../utils/rankDivisions';

interface RankUpModalProps {
  oldRank: string | null;
  newRank: string | null | undefined;
  oldDivision: string;
  newDivision: string;
  onClose: () => void;
}

export function RankUpModal({ 
  oldRank, 
  newRank, 
  oldDivision, 
  newDivision, 
  onClose 
}: RankUpModalProps) {
  const [canDismiss, setCanDismiss] = useState(false);
  const [phase, setPhase] = useState(0);
  const soundPlayedRef = useRef(false);
  const playSound = useGameSounds();
  
  // Rank ordering for comparison
  const rankOrder = ['bronze', 'silver', 'gold', 'diamond', 'legendary'];
  const getRankIndex = (rank: string | null | undefined) => rank ? rankOrder.indexOf(rank) : -1;
  
  // Determine if this is a rank UP, rank DOWN, or just division change
  const rankChanged = oldRank !== newRank;
  const isRankUp = rankChanged && getRankIndex(newRank) > getRankIndex(oldRank);
  const isRankDown = rankChanged && getRankIndex(newRank) < getRankIndex(oldRank);
  
  // Play sound once on mount (only celebratory sound for rank up)
  useEffect(() => {
    if (!soundPlayedRef.current) {
      if (isRankUp) {
        playSound('levelup');
      }
      // No celebratory sound for rank down - just show the info
      soundPlayedRef.current = true;
    }
  }, []);
  
  // Progressive reveal timeline
  useEffect(() => {
    const timer0 = setTimeout(() => setPhase(1), 300);   // Show gems
    const timer1 = setTimeout(() => setPhase(2), 800);   // Show message
    const timer2 = setTimeout(() => setCanDismiss(true), 1500); // Enable dismiss
    
    return () => {
      clearTimeout(timer0);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);
  
  // Keyboard dismiss (Space/Enter)
  useEffect(() => {
    if (!canDismiss) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canDismiss, onClose]);
  
  // Dynamic styling based on new rank
  const rankTheme = {
    bronze: {
      border: 'border-yellow-700',
      glow: 'rgba(113, 63, 18, 0.5)',
      bgOverlay: 'from-yellow-950 via-gray-900 to-black',
      innerGlow: 'bg-yellow-900/10'
    },
    silver: {
      border: 'border-gray-400',
      glow: 'rgba(156, 163, 175, 0.5)',
      bgOverlay: 'from-gray-800 via-gray-900 to-black',
      innerGlow: 'bg-gray-500/10'
    },
    gold: {
      border: 'border-yellow-400',
      glow: 'rgba(250, 204, 21, 0.5)',
      bgOverlay: 'from-yellow-950 via-gray-900 to-black',
      innerGlow: 'bg-yellow-500/10'
    },
    diamond: {
      border: 'border-cyan-400',
      glow: 'rgba(34, 211, 238, 0.5)',
      bgOverlay: 'from-cyan-950 via-gray-900 to-black',
      innerGlow: 'bg-cyan-500/10'
    },
    legendary: {
      border: 'border-purple-400',
      glow: 'rgba(168, 85, 247, 0.5)',
      bgOverlay: 'from-purple-950 via-purple-900 to-black',
      innerGlow: 'bg-purple-500/10'
    }
  }[newRank || 'bronze']!;  // Non-null assertion since we default to bronze
  
  const message = isRankUp ? {
    bronze: "You're on your way! 💪",
    silver: "Getting faster! ⚡",
    gold: "Outstanding work! 🌟",
    diamond: "Elite mastery! 💎",
    legendary: "ABSOLUTE LEGEND! 👑"
  }[newRank || 'bronze'] : isRankDown ? "Keep practicing to rank back up! 💪" : "Division up! 📈";
  
  // Header text based on rank direction
  const headerText = isRankUp ? 'RANK UP!' : isRankDown ? 'RANK UPDATE' : 'DIVISION UP!';
  const headerEmoji = isRankUp ? '🎉' : isRankDown ? '📊' : '⭐';
  
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={canDismiss ? onClose : undefined}
      style={{ cursor: canDismiss ? 'pointer' : 'default' }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/90 animate-fadeIn" />
      
      {/* Modal Card */}
      <div 
        className={`relative overflow-hidden rounded-3xl 
                    p-12 border-4 ${rankTheme.border} shadow-2xl max-w-2xl animate-modalSlam`}
        style={{
          boxShadow: `0 0 30px ${rankTheme.glow}, 0 20px 40px rgba(0, 0, 0, 0.8)`
        }}
      >
        {/* Subtle rank-colored background */}
        <div className={`absolute inset-0 bg-gradient-to-b ${rankTheme.bgOverlay}`} />
        
        {/* Subtle inner glow */}
        <div className={`absolute inset-0 ${rankTheme.innerGlow} blur-3xl opacity-30`} />
        
        {/* Content layer */}
        <div className="relative z-10">
        
        {/* Header */}
        <div className="text-center mb-12 animate-levelUpSlam">
          <div className="flex items-center justify-center gap-4 mb-2">
            <span className={`text-5xl ${isRankUp ? 'animate-bounce' : ''}`}>{headerEmoji}</span>
            <h1 className="text-7xl sm:text-8xl font-black font-game">
              <span className="bg-gradient-to-b from-purple-300 via-purple-400 to-pink-500 bg-clip-text text-transparent drop-shadow-2xl">
                {headerText}
              </span>
            </h1>
            <span className={`text-5xl ${isRankUp ? 'animate-bounce' : ''}`} style={{ animationDelay: '0.1s' }}>{headerEmoji}</span>
          </div>
        </div>
        
        {/* Rank Progression - Visual gem display */}
        <div className={`flex items-start justify-center gap-12 mb-12 ${phase >= 1 ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}>
          {/* Old Rank */}
          <div className="flex flex-col items-center">
            <RankGem 
              rank={oldRank as any || 'bronze'} 
              size="lg" 
              className="opacity-60"
            />
            <p className="mt-6 text-lg font-bold">
              <span className={`${getRankColorClasses(oldRank).text} opacity-70`}>
                {oldRank?.toUpperCase() || 'BRONZE'}
              </span>
              <span className="text-white/70 ml-1">{oldDivision}</span>
            </p>
          </div>
          
          {/* Arrow - centered vertically with gems */}
          <motion.div
            className="flex items-center justify-center"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            style={{ height: '96px', marginTop: '0' }}
          >
            <span className="text-4xl text-purple-400">→</span>
          </motion.div>
          
          {/* New Rank - Bounces in */}
          <motion.div 
            className="flex flex-col items-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.6, type: "spring", stiffness: 200, bounce: 0.4 }}
          >
            <RankGem 
              rank={newRank as any || 'bronze'} 
              size="lg"
            />
            <p className="mt-6 text-lg font-bold">
              <span className={getRankColorClasses(newRank).text}>
                {newRank?.toUpperCase() || 'BRONZE'}
              </span>
              <span className="text-white/90 ml-1">{newDivision}</span>
            </p>
          </motion.div>
        </div>
        
        {/* Message - Phase 4 (show for rank changes, skip for division-only) */}
        {rankChanged && (
          <div className={`${phase >= 2 ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}>
            <p className="text-2xl text-white/90 text-center">
              {message}
            </p>
          </div>
        )}
        
        {/* Continue prompt - flows naturally after message */}
        <div className={`text-center mt-8 transition-opacity duration-300 ${
          canDismiss ? 'opacity-100' : 'opacity-0'
        }`}>
          <p className="text-white/80 text-sm uppercase tracking-wider mb-2">Click anywhere to continue</p>
          <p className="text-white/40 text-xs">or press Space</p>
        </div>
        
        {/* Particles (reuse from LevelUpModalSimple) */}
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          <span className="absolute left-[10%] -bottom-10 text-4xl animate-float-up-once opacity-70">✨</span>
          <span className="absolute left-[30%] -bottom-10 text-4xl animate-float-up-once animation-delay-200 opacity-60">⭐</span>
          <span className="absolute left-[50%] -bottom-10 text-5xl animate-float-up-once animation-delay-400 opacity-80">💫</span>
          <span className="absolute left-[70%] -bottom-10 text-4xl animate-float-up-once animation-delay-600 opacity-70">🌟</span>
          <span className="absolute left-[90%] -bottom-10 text-4xl animate-float-up-once animation-delay-800 opacity-60">✨</span>
        </div>
        
        </div> {/* Close content layer */}
      </div>
    </div>
  );
}

