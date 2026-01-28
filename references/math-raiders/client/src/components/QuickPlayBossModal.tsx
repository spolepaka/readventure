import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Skull } from 'lucide-react';
import { cn } from '../lib/utils';
import { BOSS_CONFIG, BOSS_ICONS } from '../game/bosses/bossConfig';

// Boss visuals for Quick Play (cosmetic only, adaptive HP)
const BOSS_VISUALS = [
  { id: 0, name: 'Clank', description: 'Classic boss' },
  { id: 1, name: BOSS_CONFIG[1].name, description: 'Slimy friend' },
  { id: 2, name: BOSS_CONFIG[2].name, description: 'Spooky ghost' },
  { id: 3, name: BOSS_CONFIG[3].name, description: 'Bone crusher' },
  { id: 4, name: BOSS_CONFIG[4].name, description: 'Explosive!' },
  { id: 5, name: BOSS_CONFIG[5].name, description: 'Chill vibes' },
  { id: 6, name: BOSS_CONFIG[6].name, description: 'Stone giant' },
  { id: 7, name: BOSS_CONFIG[7].name, description: 'Your mentor!' },  // Always free in Quick Play
  { id: 8, name: BOSS_CONFIG[8].name, description: 'Dark power!' },  // Void Emperor - always free in Quick Play
] as const;

interface QuickPlayBossModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBoss: number;
  onSelectBoss: (id: number) => void;
  unlockedBosses: Record<number, boolean>;
}

export function QuickPlayBossModal({
  isOpen,
  onClose,
  selectedBoss,
  onSelectBoss,
  unlockedBosses,
}: QuickPlayBossModalProps) {
  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleSelect = (id: number) => {
    if (unlockedBosses[id]) {
      onSelectBoss(id);
      // Don't close - let user confirm with button
    }
  };

  const handleConfirm = () => {
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative bg-gray-950/95 rounded-xl p-6 border border-blue-500/30 
                       max-w-md w-full shadow-xl shadow-blue-500/10"
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

            {/* Header */}
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-white mb-1 font-game">
                CHOOSE YOUR BOSS
              </h2>
              <p className="text-gray-400 text-sm">Pick a look for Quick Play</p>
            </div>

            {/* Boss Grid - 3x3 */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              {BOSS_VISUALS.map((boss) => {
                const isUnlocked = unlockedBosses[boss.id];
                const isSelected = selectedBoss === boss.id;
                
                return (
                  <button
                    key={boss.id}
                    onClick={() => handleSelect(boss.id)}
                    disabled={!isUnlocked}
                    className={cn(
                      "relative p-2 rounded-lg border-2 transition-all duration-200",
                      "flex flex-col items-center justify-center gap-1",
                      "min-h-[80px]",
                      // Selected state
                      isSelected && "scale-105 z-10 border-blue-400 bg-blue-500/20 shadow-lg shadow-blue-500/30",
                      // Unlocked but not selected
                      isUnlocked && !isSelected && "border-gray-600 bg-gray-900/50 hover:border-blue-400/50 hover:bg-gray-800/50",
                      // Locked
                      !isUnlocked && "border-gray-700/50 bg-gray-900/30 opacity-40 cursor-not-allowed"
                    )}
                  >
                    {/* Lock icon for locked bosses */}
                    {!isUnlocked && (
                      <Lock className="absolute top-1 right-1 w-3 h-3 text-gray-500" />
                    )}
                    
                    {/* Boss icon */}
                    {React.createElement(BOSS_ICONS[boss.id]?.icon || Skull, {
                      className: cn(
                        "w-6 h-6",
                        isUnlocked ? BOSS_ICONS[boss.id]?.color : "text-gray-600"
                      )
                    })}
                    
                    {/* Boss name */}
                    <span className={cn(
                      "font-semibold text-xs text-center leading-tight",
                      isUnlocked ? "text-white" : "text-gray-500"
                    )}>
                      {boss.name}
                    </span>
                    
                    {/* Selected checkmark */}
                    {isSelected && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Hint text */}
            <p className="text-center text-xs text-gray-500 mb-4">
              Beat bosses in Mastery Trials to unlock more looks
            </p>

            {/* Confirm button */}
            <button
              onClick={handleConfirm}
              className="w-full py-3 rounded-lg font-bold text-lg
                         bg-gradient-to-b from-blue-500 to-blue-600 text-white
                         border-2 border-blue-700
                         hover:from-blue-400 hover:to-blue-500
                         transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              style={{
                boxShadow: '0 4px 0 #1e3a8a, 0 6px 12px rgba(0,0,0,0.3)',
              }}
            >
              <span className="font-game">⚡ LET'S GO!</span>
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

