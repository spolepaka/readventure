import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { RankGem } from './RankGem';
import { getFastThresholdText } from '../utils/gradeThresholds';
import { getRankColorClasses } from '../utils/rankDivisions';

interface RankExplainerModalProps {
  isOpen: boolean;
  onClose: () => void;
  rank: string;
  division: string;
  masteredCount: number;
  totalCount: number;
  grade?: number;
}

export function RankExplainerModal({
  isOpen,
  onClose,
  rank,
  division,
  masteredCount,
  totalCount,
  grade = 3
}: RankExplainerModalProps) {
  const percentage = totalCount > 0 ? (masteredCount / totalCount) * 100 : 0;
  const ranks = ['bronze', 'silver', 'gold', 'diamond', 'legendary'] as const;
  
  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);
  
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

            {/* Title */}
            <h2 className="text-xl font-semibold text-white mb-4 text-center font-game">
              Rank Progression (Grade {grade})
            </h2>
            
            {/* Grade scope notice */}
            <p className="text-xs text-gray-400 mb-6 text-center">
              Each grade has its own rank ladder
            </p>

            {/* Rank gems row */}
            <div className="flex justify-between mb-12 px-4">
              {ranks.map((r) => (
                <div
                  key={r}
                  className="relative text-center"
                >
                  <RankGem 
                    rank={r} 
                    size="sm"
                  />
                  <p className="text-xs mt-1 capitalize text-gray-300">
                    {r}
                  </p>
                  {/* "You are here" indicator */}
                  {r === rank && (
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                      <span className="text-[10px] font-bold text-yellow-400 animate-pulse font-game">
                        YOU ARE HERE
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Current status */}
            <div className="bg-gray-900/80 rounded-lg p-4 mb-6">
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-2">Current Rank</p>
                <p className="text-2xl font-bold mb-3 font-game">
                  <span className={getRankColorClasses(rank).text}>
                    {rank.toUpperCase()}
                  </span>
                  {rank !== 'legendary' && (
                    <span className="text-white ml-2">{division}</span>
                  )}
                </p>
                {/* Progress bar */}
                <div className="w-full bg-black/40 rounded-full h-2 mb-2">
                  <div 
                    className="h-full rounded-full transition-all duration-500
                               bg-gradient-to-r from-amber-400 to-orange-500"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400">
                  {masteredCount} of {totalCount} facts mastered
                </p>
              </div>
            </div>

            {/* Info sections */}
            <div className="space-y-4 text-sm">
              {/* Divisions */}
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 flex-shrink-0 rounded bg-gray-900/50 flex items-center justify-center
                                text-gray-400 text-xs font-bold mt-0.5">
                  {rank === 'legendary' ? '👑' : 'IV'}
                </div>
                <div>
                  <p className="text-white font-medium">Divisions</p>
                  <p className="text-gray-400">
                    {rank === 'legendary' 
                      ? 'Legendary is the pinnacle - no divisions!'
                      : 'Each rank has 4 divisions: IV → III → II → I'
                    }
                  </p>
                </div>
              </div>

              {/* How to rank up */}
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 flex-shrink-0 rounded bg-gray-900/50 flex items-center justify-center
                                text-yellow-400 text-xs mt-0.5">
                  ⚡
                </div>
                <div>
                  <p className="text-white font-medium">How to Master Facts</p>
                  <p className="text-gray-400">
                    Answer correctly <span className="text-yellow-400">at grade speed (or faster) 2+ times</span> in your last 3 attempts to master it
                  </p>
                  <p className="text-sm text-cyan-400 mt-1">
                    Your speed goal: <span className="font-semibold">{getFastThresholdText(grade)} or faster</span>
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

// Test wrapper for development
export function RankExplainerModalTest() {
  const [isOpen, setIsOpen] = React.useState(false);
  
  return (
    <div className="p-8">
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
      >
        Test Rank Modal
      </button>
      
      <RankExplainerModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        rank="silver"
        division="II"
        masteredCount={127}
        totalCount={562}
      />
    </div>
  );
}
