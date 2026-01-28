import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameSounds } from '@/hooks/useGameSounds';

interface TrackMasterModalProps {
  operation: 'add' | 'subtract' | 'multiply' | 'divide' | 'all';
  bossName?: string;      // e.g., "Boomer" - the boss they mastered
  nextBossName?: string;  // e.g., "Frosty" - the boss they just unlocked
  onClose: () => void;
}

const OPERATION_CONFIG = {
  add: { title: 'MASTERED!', icon: '⚡', color: 'from-green-700 to-emerald-800' },
  subtract: { title: 'MASTERED!', icon: '🔥', color: 'from-orange-700 to-red-800' },
  multiply: { title: 'MASTERED!', icon: '💎', color: 'from-blue-700 to-indigo-800' },
  divide: { title: 'MASTERED!', icon: '👑', color: 'from-purple-700 to-pink-800' },
  all: { title: 'GRAND MASTER!', icon: '✨', color: 'from-gray-900 via-purple-950 to-gray-950' }
};

export function TrackMasterModal({ operation, bossName, nextBossName, onClose }: TrackMasterModalProps) {
  const [canDismiss, setCanDismiss] = useState(false);
  const soundPlayedRef = useRef(false);
  const playSound = useGameSounds();
  const config = OPERATION_CONFIG[operation];
  
  // Play celebration sound
  useEffect(() => {
    if (!soundPlayedRef.current) {
      playSound('levelup');
      soundPlayedRef.current = true;
    }
  }, []);
  
  // Enable dismiss after 2 seconds
  useEffect(() => {
    const timer = setTimeout(() => setCanDismiss(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  
  // Keyboard dismiss
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
  
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={canDismiss ? onClose : undefined}
      style={{ cursor: canDismiss ? 'pointer' : 'default' }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/90 animate-fadeIn" />
      
      {/* Modal */}
      <div className={`relative rounded-3xl p-12 max-w-2xl bg-gradient-to-b ${config.color} animate-modalSlam ${
        operation === 'all' 
          ? 'border border-amber-400/30 shadow-[0_0_80px_rgba(251,191,36,0.15)]' 
          : 'border-2 border-amber-500/60 shadow-2xl'
      }`}>
        
        {/* Content */}
        <div className="relative z-10 text-center">
          {/* Icon */}
          <motion.div
            className="text-8xl mb-6"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
          >
            {config.icon}
          </motion.div>
          
          {/* Title - GRAND MASTER for ALL track, MASTERED! for others */}
          <motion.h1 
            className="text-7xl font-black mb-6 font-game"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <span className="bg-gradient-to-b from-yellow-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent drop-shadow-2xl">
              {config.title}
            </span>
          </motion.h1>
          
          {/* Message - boss-win focused */}
          <motion.p
            className="text-xl text-white/90 mb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            {bossName ? `You beat ${bossName} 3 times!` : 'You proved your mastery 3 times!'}
          </motion.p>
          
          {/* Unlock callout - shows the payoff */}
          {nextBossName && (
            <motion.p
              className="text-2xl text-green-400 font-bold mb-3"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, type: "spring" }}
            >
              🔓 Challenge bosses unlocked!
            </motion.p>
          )}
          
          <motion.p
            className="text-lg text-yellow-300 mb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0 }}
          >
            {operation === 'all' 
              ? 'All operations. Full speed.'
              : "🚀 You're ready for AlphaNumbers!"}
          </motion.p>
          
          {operation === 'all' && (
            <motion.p
              className="text-4xl"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.2, type: "spring" }}
            >
              🏆
            </motion.p>
          )}
        </div>
        
        {/* Continue prompt */}
        <div className={`text-center mt-8 transition-opacity duration-300 ${canDismiss ? 'opacity-100' : 'opacity-0'}`}>
          <p className="text-white/80 text-sm uppercase tracking-wider mb-2">Click anywhere to continue</p>
          <p className="text-white/40 text-xs">or press Space</p>
        </div>
        
        {/* Particles - mastery celebration (more than level up, crown signals mastery) */}
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          <span className="absolute left-[10%] -bottom-8 text-3xl animate-float-up-once opacity-70">⭐</span>
          <span className="absolute left-[25%] -bottom-8 text-3xl animate-float-up-once animation-delay-150 opacity-70">✨</span>
          <span className="absolute left-[50%] -bottom-8 text-4xl animate-float-up-once animation-delay-300 opacity-80">👑</span>
          <span className="absolute left-[75%] -bottom-8 text-3xl animate-float-up-once animation-delay-450 opacity-70">✨</span>
          <span className="absolute left-[90%] -bottom-8 text-3xl animate-float-up-once animation-delay-600 opacity-70">⭐</span>
          <span className="absolute left-[40%] -bottom-8 text-3xl animate-float-up-once animation-delay-200 opacity-60">💫</span>
        </div>
      </div>
    </div>
  );
}
