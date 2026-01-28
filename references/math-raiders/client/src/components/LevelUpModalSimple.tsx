import { useEffect, useState, useRef } from 'react';
import { getTitleForLevel } from '../game/leveling';
import { useGameSounds } from '@/hooks/useGameSounds';

interface LevelUpModalProps {
  oldLevel: number;
  newLevel: number;
  currentAp: number;
  onDismiss: () => void;
}

export function LevelUpModalSimple({ oldLevel, newLevel, onDismiss }: LevelUpModalProps) {
  const oldTitle = getTitleForLevel(oldLevel);
  const newTitle = getTitleForLevel(newLevel);
  const isTitleChange = oldTitle.name !== newTitle.name;
  const levelJump = newLevel - oldLevel;
  const [canDismiss, setCanDismiss] = useState(false);
  const [showLevel, setShowLevel] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [displayLevel, setDisplayLevel] = useState(oldLevel);
  const [pulseCount, setPulseCount] = useState(0);
  
  const playSound = useGameSounds();
  const soundPlayedRef = useRef(false);
  
  // Play level up sound when modal opens
  useEffect(() => {
    if (!soundPlayedRef.current) {
      playSound('levelup');
      soundPlayedRef.current = true;
    }
  }, []); // Only play once on mount
  
  useEffect(() => {
    // Progressive reveal timeline - Fortnite style
    const timer0 = setTimeout(() => setShowLevel(true), 400);
    const timer1 = setTimeout(() => setShowRewards(true), 800);
    const timer2 = setTimeout(() => setCanDismiss(true), 2000);
    // NO auto-dismiss - let player click when ready (industry standard)
    
    return () => {
      clearTimeout(timer0);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);
  
  // Counter animation for level number
  useEffect(() => {
    if (!showLevel) return;
    
    if (levelJump === 1) {
      // Single level: quick transition
      setTimeout(() => setDisplayLevel(newLevel), 100);
      setTimeout(() => setPulseCount(1), 150);
    } else {
      // Multi-level: count up with pulses
      const steps = Math.min(levelJump, 5); // Cap at 5 for performance
      const delay = 200; // ms between each number
      
      for (let i = 0; i <= steps; i++) {
        const targetLevel = i === steps ? newLevel : oldLevel + i;
        setTimeout(() => {
          setDisplayLevel(targetLevel);
          setPulseCount(prev => prev + 1);
        }, i * delay);
      }
    }
  }, [showLevel, oldLevel, newLevel, levelJump]);
  
  // Keyboard support - Space or Enter to dismiss
  useEffect(() => {
    if (!canDismiss) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onDismiss();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canDismiss, onDismiss]);
  
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={canDismiss ? onDismiss : undefined}
      style={{ cursor: canDismiss ? 'pointer' : 'default' }}
    >
      {/* Full screen backdrop - darkens the game */}
      <div className="absolute inset-0 bg-black/80 animate-fadeIn" />
      
      {/* Modal card - the actual modal with background */}
      <div className="relative bg-gradient-to-b from-gray-900 to-black rounded-3xl p-12 border-4 border-yellow-400 shadow-2xl max-w-2xl animate-modalSlam"
           style={{
             boxShadow: '0 0 30px rgba(250, 204, 21, 0.5), 0 20px 40px rgba(0, 0, 0, 0.8)'
           }}>
        
        {/* LEVEL UP TEXT - Big impact entrance */}
        <h1 className="text-7xl sm:text-8xl font-black text-center mb-8 animate-levelUpSlam font-game">
          <span className="bg-gradient-to-b from-yellow-300 via-yellow-400 to-orange-500 bg-clip-text text-transparent drop-shadow-2xl">
            LEVEL UP!
          </span>
        </h1>
        
        {/* LEVEL NUMBER - Always rendered, opacity controlled, space reserved */}
        <div className={`text-center mb-6 min-h-[12rem] flex flex-col justify-center ${showLevel ? 'opacity-100 animate-levelSpin' : 'opacity-0'}`}>
          <div className={`text-[10rem] sm:text-[12rem] font-black leading-none transition-transform duration-200 ${pulseCount > 0 ? 'animate-numberPulse' : ''}`}>
            <span className="bg-gradient-to-b from-white via-yellow-100 to-amber-400 bg-clip-text text-transparent drop-shadow-2xl">
              {displayLevel}
            </span>
          </div>
          <p className="text-xl text-gray-400 mt-2">
            {displayLevel === newLevel ? (
              levelJump > 1 ? `+${levelJump} Levels!` : `Level ${oldLevel} → ${newLevel}`
            ) : (
              <span className="text-yellow-400">Counting...</span>
            )}
          </p>
        </div>
        
        {/* REWARDS SECTION - Always rendered, opacity controlled */}
        <div className={`transition-opacity duration-300 ${showRewards ? 'opacity-100 animate-slideUp' : 'opacity-0'}`}>
            {/* Title change celebration */}
            {isTitleChange && (
              <div className="mb-6 bg-gradient-to-r from-purple-900/80 to-indigo-900/80 rounded-2xl p-6 border-2 border-purple-400 animate-glow-border">
                <p className="text-purple-300 text-sm uppercase tracking-wider mb-3 text-center font-game">NEW TITLE UNLOCKED!</p>
                <div className="flex items-center justify-center gap-4">
                  <span className="text-5xl animate-bounce">{newTitle.icon}</span>
                  <h2 className="text-3xl font-bold text-white font-game">{newTitle.name}</h2>
                </div>
              </div>
            )}
            
            {/* Multi-level celebration */}
            {levelJump > 1 && !isTitleChange && (
              <div className="bg-gradient-to-r from-pink-600/50 to-purple-600/50 rounded-full px-8 py-4 text-center animate-glow-border">
                <p className="text-3xl font-bold text-white font-game">
                  🚀 {levelJump} LEVEL JUMP! 🚀
                </p>
              </div>
            )}
        </div>
        
        {/* Continue prompt - flows naturally after rewards */}
        <div className={`text-center mt-8 transition-opacity duration-300 ${
          canDismiss ? 'opacity-100' : 'opacity-0'
        }`}>
          <p className="text-white/80 text-sm uppercase tracking-wider mb-2">Click anywhere to continue</p>
          <p className="text-white/40 text-xs">or press Space</p>
        </div>
        
        {/* Simplified particle effect - 5 particles, run once */}
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          {/* Just 5 particles for visual effect without performance hit */}
          <span className="absolute left-[10%] -bottom-10 text-4xl animate-float-up-once opacity-70">✨</span>
          <span className="absolute left-[30%] -bottom-10 text-4xl animate-float-up-once animation-delay-200 opacity-60">⭐</span>
          <span className="absolute left-[50%] -bottom-10 text-5xl animate-float-up-once animation-delay-400 opacity-80">💫</span>
          <span className="absolute left-[70%] -bottom-10 text-4xl animate-float-up-once animation-delay-600 opacity-70">🌟</span>
          <span className="absolute left-[90%] -bottom-10 text-4xl animate-float-up-once animation-delay-800 opacity-60">✨</span>
          
        </div>
      </div>
    </div>
  );
}