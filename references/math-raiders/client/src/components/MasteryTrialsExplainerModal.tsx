import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BOSS_CONFIG, BOSS_ICONS, BOSS_HP } from '../game/bosses/bossConfig';

interface MasteryTrialsExplainerModalProps {
  isOpen: boolean;
  onClose: () => void;
  grade?: number;
  goalBoss?: number;
}

// Grade → goal boss mapping
const GRADE_GOAL_BOSS: Record<number, number> = {
  0: 4,  // K → Boomer (20 CQPM)
  1: 4,  // G1 → Boomer (20 CQPM)
  2: 6,  // G2 → Titan (30 CQPM)
  3: 6,  // G3 → Titan (30 CQPM)
  4: 7,  // G4 → Captain Nova (35 CQPM)
  5: 8,  // G5 → Void Emperor (40 CQPM)
};

export function MasteryTrialsExplainerModal({
  isOpen,
  onClose,
  grade = 3,
  goalBoss,
}: MasteryTrialsExplainerModalProps) {
  const effectiveGoalBoss = goalBoss ?? GRADE_GOAL_BOSS[grade] ?? 6;
  
  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);
  
  const bosses = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal - same structure as RankExplainerModal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative bg-gray-950/95 rounded-lg p-6 sm:p-8 border border-gray-700/50 
                       max-w-lg w-full shadow-xl"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Title - matches RankExplainerModal */}
            <h2 className="text-xl font-semibold text-white mb-4 text-center font-game">
              Mastery Trials (Grade {grade})
            </h2>
            
            {/* Subtitle - matches RankExplainerModal */}
            <p className="text-xs text-gray-400 mb-6 text-center">
              Defeat increasingly difficult bosses to prove your speed
            </p>

            {/* Boss ladder row - mirrors rank gems row */}
            <div className="flex justify-between mb-12 px-2">
              {bosses.map((id) => {
                const Icon = BOSS_ICONS[id]?.icon as React.ComponentType<{ className?: string }> | undefined;
                const iconColor = BOSS_ICONS[id]?.color || 'text-gray-400';
                const isGoal = id === effectiveGoalBoss;
                const hp = BOSS_HP[id];
                
                return (
                  <div
                    key={id}
                    className="relative text-center"
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg
                      ${isGoal 
                        ? 'bg-amber-900/50 ring-2 ring-amber-500/50' 
                        : 'bg-gray-900/50'
                      }`}
                    >
                      {Icon && <Icon className={`w-5 h-5 ${iconColor}`} />}
                    </div>
                    <p className="text-[10px] mt-1 text-gray-300 truncate w-8">
                      {hp}
                    </p>
                    {/* "Your Goal" indicator - mirrors "You are here" */}
                    {isGoal && (
                      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                        <span className="text-[10px] font-bold text-amber-400 animate-pulse font-game">
                          YOUR GOAL
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Current goal - matches "Current status" section */}
            <div className="bg-gray-900/80 rounded-lg p-4 mb-6">
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-2">Beat This Boss</p>
                <div className="flex items-center justify-center gap-3 mb-3">
                  {(() => {
                    const Icon = BOSS_ICONS[effectiveGoalBoss]?.icon as React.ComponentType<{ className?: string }> | undefined;
                    const iconColor = BOSS_ICONS[effectiveGoalBoss]?.color || 'text-gray-400';
                    return Icon ? <Icon className={`w-8 h-8 ${iconColor}`} /> : null;
                  })()}
                  <p className="text-2xl font-bold font-game">
                    <span className="text-amber-400">
                      {BOSS_CONFIG[effectiveGoalBoss]?.name}
                    </span>
                  </p>
                </div>
                <p className="text-sm text-gray-400">
                  <span className="text-amber-400 font-semibold">{BOSS_HP[effectiveGoalBoss].toLocaleString()} HP</span> to defeat
                </p>
              </div>
            </div>

            {/* Info sections */}
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 flex-shrink-0 rounded bg-gray-900/50 flex items-center justify-center
                                text-amber-400 text-xs mt-0.5">
                  ⭐
                </div>
                <div>
                  <p className="text-white font-medium">Master Your Operation</p>
                  <p className="text-gray-400">
                    Win <span className="text-amber-400">3 times</span> to prove you've got it
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 flex-shrink-0 rounded bg-gray-900/50 flex items-center justify-center
                                text-amber-400 text-xs mt-0.5">
                  ⚡
                </div>
                <div>
                  <p className="text-white font-medium">Beat Your Record</p>
                  <p className="text-gray-400">
                    Replay any boss to beat your best time
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 flex-shrink-0 rounded bg-gray-900/50 flex items-center justify-center
                                text-amber-400 text-xs mt-0.5">
                  ⚔️
                </div>
                <div>
                  <p className="text-white font-medium">Deal Maximum Damage</p>
                  <p className="text-gray-400">
                    Fast and accurate = the harder you hit
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

