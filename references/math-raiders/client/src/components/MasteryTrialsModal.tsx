import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Skull, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useGameStore } from '../store/gameStore';
import { getGradeGoalBoss, WINS_FOR_TRACK_MASTER } from '../utils/gradeThresholds';
import { BOSS_CONFIG, BOSS_ICONS, BOSS_HP } from '../game/bosses/bossConfig';
import { MasteryTrialsExplainerModal } from './MasteryTrialsExplainerModal';

// ============================================================================
// TRACK MASTER STARS
// Visual indicator of solo win progress toward Track Master (3× wins on goal boss)
// ============================================================================
function TrackMasterStars({ wins, isComplete }: { wins: number; isComplete: boolean }) {
  return (
    <div className="flex gap-1 mt-0.5">
      {[1, 2, 3].map(n => (
        <span 
          key={n}
          className={cn(
            "text-sm transition-all duration-300",
            isComplete
              ? "text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.9)] scale-125 animate-pulse"
              : n <= wins 
                ? "text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)] scale-110" 
                : "text-gray-600 scale-100"
          )}
        >
          ★
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// HP PROGRESS BAR
// Shows damage progress on an unbeaten boss
// ============================================================================
function HPProgressBar({ hpRemaining, maxHp }: { hpRemaining: number; maxHp: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div 
        className="w-16 h-2 rounded-full overflow-hidden relative"
        style={{ 
          background: 'linear-gradient(to bottom, #dc2626 0%, #991b1b 100%)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)'
        }}
      >
        <div 
          className="h-full rounded-full transition-all duration-300"
          style={{ 
            width: `${(hpRemaining / maxHp) * 100}%`,
            background: 'linear-gradient(to bottom, #4ade80 0%, #22c55e 50%, #16a34a 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)'
          }}
        />
      </div>
      <span className="text-[10px] text-gray-400 tabular-nums">
        <span className="text-green-400">{hpRemaining}</span>
        <span className="text-gray-600">/</span>
        <span className="text-gray-500">{maxHp}</span>
      </span>
    </div>
  );
}

// ============================================================================
// BOSS CARD VISUAL STATE
// Explicit state machine for boss card appearance (Nystrom: "make states explicit")
// ============================================================================
type BossCardState = 
  | 'locked'       // Gray, 40% opacity, can't click
  | 'lockedGoal'   // Amber glow but locked (goal boss before reaching it)
  | 'ready'        // Unlocked, no attempts yet
  | 'attempted'    // Has damage dealt but no win
  | 'beaten'       // 1+ wins (non-goal boss complete)
  | 'inProgress'   // Goal boss with 1-2 solo wins
  | 'trackMaster'; // Goal boss with 3+ solo wins (complete)

function getBossCardState(
  isUnlocked: boolean,
  isGoal: boolean,
  isBeaten: boolean,
  goalWins: number,
  hasAttempt: boolean
): BossCardState {
  if (!isUnlocked) return isGoal ? 'lockedGoal' : 'locked';
  
  if (isGoal) {
    if (goalWins >= 3) return 'trackMaster';
    if (goalWins > 0) return 'inProgress';
    return 'ready';
  }
  
  if (isBeaten) return 'beaten';
  if (hasAttempt) return 'attempted';
  return 'ready';
}

// Border + background classes for each state
// Note: avoid opacity on parent — it cascades to tooltips. Use color alpha instead.
const CARD_STATE_CLASSES: Record<BossCardState, string> = {
  locked:      'border-gray-700/40 bg-gray-900/20 cursor-not-allowed [&>*]:opacity-40',
  lockedGoal:  'border-amber-500/40 bg-gray-900/30 cursor-not-allowed [&>*]:opacity-60',
  ready:       'border-gray-400 bg-gray-900/50',
  attempted:   'border-gray-400 bg-gray-900/50',
  beaten:      'border-green-400 bg-green-950/30',
  inProgress:  'border-amber-500 bg-amber-950/20',
  trackMaster: 'border-green-400 bg-green-950/30',
};

// Boss definitions - derived from bossConfig for single source of truth
const BOSSES = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({
  id,
  name: BOSS_CONFIG[id].name,
  hp: BOSS_HP[id],
}));

interface MasteryTrialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: string;
  trackName: string;
  partyMode: 'solo' | 'coop';
}

export function MasteryTrialsModal({
  isOpen,
  onClose,
  track,
  trackName,
  partyMode,
}: MasteryTrialsModalProps) {
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const performanceHistory = useGameStore(state => state.performanceHistory);
  const startSoloRaid = useGameStore(state => state.startSoloRaid);
  const createPrivateRoom = useGameStore(state => state.createPrivateRoom);
  
  const [selectedBoss, setSelectedBoss] = useState<number | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  
  const grade = currentPlayer?.grade ?? 4;
  const goalBossId = getGradeGoalBoss(grade);
  
  // ============================================================================
  // SOLO vs MULTI LOGIC
  // ============================================================================
  // UNLOCKS:      Always from SOLO wins (prevents carrying in multi)
  // TRACK MASTER: Always from SOLO wins (3× solo wins on goal boss = certification)
  // BEST TIMES:   Mode-specific (solo shows solo records, multi shows multi records)
  // HP PROGRESS:  Mode-specific (shows damage dealt in current mode)
  // ============================================================================
  const { tierUnlocks, bestTimes, bestDamage, winCounts, bossesBeaten, goalBossSoloWins } = useMemo(() => {
    const unlocks: Record<number, boolean> = { 1: true }; // Boss 1 always unlocked
    const times: Record<number, number> = {};
    const damage: Record<number, number> = {};
    const counts: Record<number, number> = {};
    
    // ALL track may have track as 'ALL' or undefined (legacy raids)
    const isAllTrack = track === 'ALL';
    const matchesTrack = (pTrack: string | null | undefined) => 
      isAllTrack ? (pTrack === 'ALL' || !pTrack) : pTrack === track;
    
    // SOLO raids: used for unlocks + Track Master (permanent progression)
    const soloRaids = performanceHistory.filter(p =>
      p.grade === grade &&
      matchesTrack(p.track) &&
      p.raidType === 'solo' &&
      p.bossLevel >= 1 && p.bossLevel <= 8
    );
    
    // MODE raids: used for display (best times, HP bars, win counts shown)
    const modeRaids = performanceHistory.filter(p =>
      p.grade === grade &&
      matchesTrack(p.track) &&
      p.raidType === (partyMode === 'solo' ? 'solo' : 'multi') &&
      p.bossLevel >= 1 && p.bossLevel <= 8
    );
    
    // TRACK MASTER GATE
    // - Pre-goal bosses: 1 win unlocks next (normal progression)
    // - Goal boss: 3× wins required for Track Master → unlocks challenge content
    // - Post-goal bosses: challenge content, normal 1-win progression
    for (let tier = 1; tier <= 8; tier++) {
      const winsOnThisBoss = soloRaids.filter(p => p.bossLevel === tier && p.victory === true).length;
      if (winsOnThisBoss === 0) continue; // No solo wins on this boss
      
      // Bosses you've beaten stay unlocked (legacy-safe)
      unlocks[tier] = true;
      
      if (tier === 8) continue; // No next tier to unlock
      
      const isGoalBoss = tier === goalBossId;
      const winsNeededToUnlockNext = isGoalBoss ? WINS_FOR_TRACK_MASTER : 1;
      
      if (winsOnThisBoss >= winsNeededToUnlockNext) {
        unlocks[tier + 1] = true;
      }
    }
    
    // Calculate best times/damage from current mode
    for (let tier = 1; tier <= 8; tier++) {
      const raidsAtTier = modeRaids.filter(p => p.bossLevel === tier);
      const wins = raidsAtTier.filter(p => p.victory === true);
      
      // Track win count for 3× Track Master progress
      counts[tier] = wins.length;
      
      // Record best time for this mode
      if (wins.length > 0) {
        times[tier] = Math.min(...wins.map(w => w.sessionSeconds));
      }
      
      // For unbeaten tiers, store best damage dealt (raw number for HP bar)
      if (!times[tier]) {
        const losses = raidsAtTier.filter(p => p.victory === false);
        if (losses.length > 0) {
          damage[tier] = Math.max(...losses.map(l => l.damageDealt));
        }
      }
    }
    
    const bossesBeaten = Object.keys(times).length;
    const goalBossSoloWins = soloRaids.filter(p => p.bossLevel === goalBossId && p.victory === true).length;
    
    return { tierUnlocks: unlocks, bestTimes: times, bestDamage: damage, winCounts: counts, bossesBeaten, goalBossSoloWins };
  }, [performanceHistory, grade, track, partyMode]);
  
  // Find next unlocked boss for auto-selection
  const nextUnlockedBoss = useMemo(() => {
    const unlockedBosses = Object.keys(tierUnlocks).map(Number).filter(n => n >= 1);
    const highestUnlocked = unlockedBosses.length > 0 ? Math.max(...unlockedBosses) : 1;
    
    if (partyMode === 'solo') {
      // AUTO-SELECT: First unconquered boss
      // - Normal boss: conquered = 1 win
      // - Goal boss: conquered = 3× wins (Track Master)
      for (let boss = 1; boss <= 8; boss++) {
        if (!tierUnlocks[boss]) continue; // Skip locked bosses
        
        const isGoalBoss = boss === goalBossId;
        const currentWins = winCounts[boss] ?? 0;
        const winsToConquer = isGoalBoss ? WINS_FOR_TRACK_MASTER : 1;
        
        if (currentWins < winsToConquer) {
          return boss; // This is where they should grind
        }
      }
      // All conquered → default to highest unlocked
      return highestUnlocked;
    } else {
      // Multi: default to highest unlocked (challenge with friends at your frontier)
      return highestUnlocked;
    }
  }, [tierUnlocks, winCounts, goalBossId, partyMode]);
  
  // Auto-select next boss when modal opens
  React.useEffect(() => {
    if (isOpen && selectedBoss === null) {
      setSelectedBoss(nextUnlockedBoss);
    }
  }, [isOpen, nextUnlockedBoss, selectedBoss]);
  
  // Reset selection when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedBoss(null);
    }
  }, [isOpen]);
  
  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);
  
  const handleBeginTrial = () => {
    if (selectedBoss && tierUnlocks[selectedBoss]) {
      if (partyMode === 'solo') {
        startSoloRaid(track, selectedBoss);
      } else {
        createPrivateRoom(track, selectedBoss);
      }
      onClose();
    }
  };
  
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const subtitleText = track === 'ALL' ? 'All Facts' : trackName;
  // Reward uses short form to match TrackMasterModal (remove " 0-X" range)
  // Extract just the operation name for cleaner titles ("Addition Master" not "Addition to 20 Master")
  const rewardText = track === 'ALL' ? 'All Facts' : trackName.split(' ')[0];
  
  return (
    <>
    {createPortal(
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
                       max-w-2xl w-full shadow-xl"
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
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-xl font-bold text-white mb-1 font-game">
                  MASTERY TRIALS
                </h2>
                <button
                  onClick={() => setShowExplainer(true)}
                  className="text-gray-400 hover:text-amber-400 transition-colors mb-1"
                  title="How do Mastery Trials work?"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              </div>
              <p className="text-gray-400">{subtitleText}</p>
              
              {/* Progress bar - context-aware label for each stage */}
              {(() => {
                // Nystrom: Pure function deriving label from state
                // Pre-goal: "3/4 Beaten" (climbing to goal)
                // At goal: "Goal: 1/3" (mastery progress)
                // Complete: "✅ Complete!" + challenges if any
                const numChallengeBosses = 8 - goalBossId;
                const masteredLabel = numChallengeBosses > 0
                  ? `✅ Complete! ${numChallengeBosses === 1 ? 'Challenge' : 'Challenges'} unlocked`
                  : '★★★ Mastered!';
                const progressLabel = 
                  bossesBeaten < goalBossId ? `${bossesBeaten}/${goalBossId} Beaten` :
                  goalBossSoloWins >= 3 ? masteredLabel :
                  goalBossSoloWins === 0 ? 'Goal! Beat 3×' :
                  `Goal: ${goalBossSoloWins}/3`;
                
                const barFill = Math.min(bossesBeaten / goalBossId, 1) * 100;
                const isMastered = goalBossSoloWins >= 3;
                
                return (
                  <div className="mt-4 max-w-xs mx-auto">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            isMastered 
                              ? 'bg-gradient-to-r from-green-500 to-emerald-400' 
                              : 'bg-gradient-to-r from-amber-500 to-yellow-400'
                          }`}
                          style={{ width: `${barFill}%` }}
                        />
                      </div>
                      <span className={`text-sm tabular-nums ${isMastered ? 'text-green-400' : 'text-gray-400'}`}>
                        {progressLabel}
                      </span>
                    </div>
                    {/* Assessment ready pill - shown after Track Master (single-op tracks only, no ALL test exists) */}
                    {isMastered && track !== 'ALL' && (
                      <div className="mt-2 flex justify-center">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-b from-green-500/20 to-emerald-600/10 border border-green-400/50 text-green-300 shadow-sm shadow-green-500/20">
                          🚀 AlphaNumbers Test Ready
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Boss Grid - 2x4 */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              {BOSSES.map((boss) => {
                // Derive all state upfront
                const isUnlocked = tierUnlocks[boss.id];
                const isBeaten = !!bestTimes[boss.id];
                const isSelected = selectedBoss === boss.id;
                const isGoal = boss.id === goalBossId;
                const isChallenge = boss.id > goalBossId; // Beyond grade-level = legendary optional content
                const dmgDealt = bestDamage[boss.id];
                const hpRemaining = dmgDealt !== undefined ? Math.max(0, boss.hp - dmgDealt) : undefined;
                const goalWins = isGoal ? goalBossSoloWins : (winCounts[boss.id] ?? 0);
                
                // State machine: one of 7 visual states
                const cardState = getBossCardState(isUnlocked, isGoal, isBeaten, goalWins, hpRemaining !== undefined);
                const isTrackMaster = cardState === 'trackMaster';
                const showGoalGlow = isGoal && !isTrackMaster;
                
                // Track Master gate tooltip: explain why boss after goal is locked
                const winsRemaining = WINS_FOR_TRACK_MASTER - goalBossSoloWins;
                const isLockedByTrackMaster = !isUnlocked && boss.id === goalBossId + 1 && winsRemaining > 0;
                const goalBossName = BOSSES[goalBossId - 1]?.name ?? 'the goal boss';
                const lockTooltip = isLockedByTrackMaster 
                  ? `🔒 Beat ${goalBossName} ${winsRemaining} more time${winsRemaining === 1 ? '' : 's'} to unlock`
                  : undefined;
                
                return (
                  <button
                    key={boss.id}
                    onClick={() => isUnlocked && setSelectedBoss(boss.id)}
                    disabled={!isUnlocked}
                    className={cn(
                      "relative p-3 rounded-lg border-2 transition-all duration-200 ease-out",
                      "flex flex-col items-center justify-center gap-1",
                      "min-h-[100px]",
                      // Selection state (overlay on top of card state)
                      isSelected && "scale-105 z-10 selected-border-glow",
                      // Fade unbeaten when another is selected; beaten bosses stay proud (trophies, replayable)
                      selectedBoss && !isSelected && isUnlocked && !isBeaten && "opacity-50",
                      isUnlocked && !isSelected && "hover:scale-[1.03] hover:border-white/70 hover:shadow-lg hover:shadow-white/5",
                      // Card state (one class per state - easy to trace)
                      !isSelected && !isChallenge && CARD_STATE_CLASSES[cardState],
                      // Challenge bosses: legendary purple/gold treatment (use color alpha, not opacity, to preserve tooltip)
                      isChallenge && !isSelected && (isUnlocked ? "border-purple-500/50 bg-purple-950/20" : "border-purple-500/20 bg-gray-900/20 cursor-not-allowed [&>*]:opacity-50"),
                      isChallenge && isUnlocked && !isSelected && "animate-legendary-shimmer",
                      // Goal shimmer until Track Master achieved
                      showGoalGlow && !isSelected && "animate-pulse-subtle",
                      // Enable tooltip styling for Track Master gate
                      isLockedByTrackMaster && "mastery-cell cursor-help"
                    )}
                    data-tooltip={lockTooltip}
                    style={
                      isSelected ? { boxShadow: 'inset 0 0 20px rgba(255,255,255,0.15), 0 0 30px rgba(255,255,255,0.3)' }
                      : showGoalGlow ? { boxShadow: '0 0 24px rgba(251, 191, 36, 0.25)' }
                      : undefined
                    }
                  >
                    {/* Tier badge (top-left) */}
                    <span className={cn(
                      "absolute top-1.5 left-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold",
                      isUnlocked && isChallenge
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                        : isUnlocked 
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" 
                        : "bg-gray-700/50 text-gray-500 border border-gray-600/50"
                    )}>
                      {boss.id}
                    </span>
                    
                    {/* Checkmark badge (top-right) - only for completed states */}
                    {(cardState === 'beaten' || cardState === 'trackMaster') && (
                      <CheckCircle className="absolute top-1.5 right-1.5 w-4 h-4 text-green-400" />
                    )}
                    
                    {/* Boss icon + name */}
                    <div className="flex items-center gap-1">
                      {React.createElement(BOSS_ICONS[boss.id]?.icon || Skull, {
                        className: cn("w-3.5 h-3.5", isUnlocked ? BOSS_ICONS[boss.id]?.color : "text-gray-600")
                      })}
                      <span className={cn(
                        "font-semibold text-sm font-game",
                        isUnlocked ? "text-white" : "text-gray-500",
                        isChallenge && isUnlocked && "text-purple-200"
                      )}>
                        {boss.name}
                      </span>
                    </div>
                    
                    {/* Status line - render based on card state */}
                    <div className="text-xs flex flex-col items-center gap-0.5">
                      {/* Beaten: show trophy + time */}
                      {isBeaten && (
                        <span className={cardState === 'inProgress' ? "text-amber-400" : "text-green-400"}>
                          🏆 {formatTime(bestTimes[boss.id])}
                        </span>
                      )}
                      
                      {/* Goal boss: always show stars when has progress */}
                      {(cardState === 'inProgress' || cardState === 'trackMaster') && (
                        <TrackMasterStars wins={goalWins} isComplete={isTrackMaster} />
                      )}
                      
                      {/* Attempted: show HP bar */}
                      {cardState === 'attempted' && hpRemaining !== undefined && (
                        <HPProgressBar hpRemaining={hpRemaining} maxHp={boss.hp} />
                      )}
                      
                      {/* Ready: show challenge prompt */}
                      {cardState === 'ready' && (
                        <span className="text-blue-400 text-[10px]">⚔️ Challenge!</span>
                      )}
                      
                      {/* Locked: show lock */}
                      {(cardState === 'locked' || cardState === 'lockedGoal') && (
                        <span className="text-gray-600">🔒</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Goal card - clear visual target for the player */}
            <div className="text-center px-4 py-3 rounded-lg bg-gradient-to-b from-amber-500/15 to-amber-600/5 
                            backdrop-blur-sm border border-amber-400/40 max-w-xs mx-auto mb-6">
              <p className="text-[10px] text-amber-300 uppercase tracking-wider mb-1">Your Goal</p>
              <p className="text-sm font-semibold text-white">
                Defeat <span className="text-amber-400">{BOSSES[goalBossId - 1]?.name}</span> 3× to become
              </p>
              <p className="text-base font-bold mt-1 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(192,132,252,0.6)]">
                {track === 'ALL' ? 'Grand Master' : `${rewardText} Master`}
              </p>
            </div>

            {/* Begin button - dynamic based on party mode */}
            <button
              onClick={handleBeginTrial}
              disabled={!selectedBoss || !tierUnlocks[selectedBoss]}
              className="w-full py-4 rounded-lg font-bold text-lg
                         bg-gradient-to-b from-blue-500 to-blue-600 text-white
                         border-2 border-blue-700
                         hover:from-blue-400 hover:to-blue-500
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              style={{
                boxShadow: '0 4px 0 #1e3a8a, 0 6px 12px rgba(0,0,0,0.3)',
              }}
            >
              <span className="font-game">{partyMode === 'solo' ? '⚔️ BEGIN TRIAL' : '👥 CREATE ROOM'}</span>
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )}
    {/* Explainer modal - also portals to body, stacks via higher z-index */}
    <MasteryTrialsExplainerModal
      isOpen={showExplainer}
      onClose={() => setShowExplainer(false)}
      grade={grade}
      goalBoss={goalBossId}
    />
    </>
  );
}

