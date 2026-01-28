import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { getLevelFromTotalAp, MAX_PLAYER_LEVEL, getTitleForLevel, getNextTitleInfo } from '../game/leveling';
import { cn } from '../lib/utils';
// Removed LevelUpModal - level ups are celebrated in ResultsScreen only
import RoomModal from './RoomModal';
import { MasteryTrialsModal } from './MasteryTrialsModal';
import { MasteryProgressChart } from './MasteryProgressChart';
import { LeaderboardPanel } from './LeaderboardPanel';
// GradeToggle moved inline to player profile header
// TrackSelector component exists but not used here (inline JSX instead)
import { RankBadge } from './RankBadge';
import { RankGem } from './RankGem';
import { MasteryGrid } from './MasteryGrid';
import { useMasteryStats } from '../hooks/useMasteryStats';
import { useTodayXP } from '../hooks/useTodayXP';
import { useQuestProgress, DAILY_TIME_TARGET, WEEKLY_TIME_TARGET, DAILY_QUEST_REWARD, WEEKLY_QUEST_REWARD } from '../hooks/useQuestProgress';
import { calculateDivision } from '../utils/rankDivisions';
import { generateFactKey } from '../utils/factKeys';
import { ALL_FACTS } from '../data/mathFacts';
import { OPERATION_SYMBOLS } from '../constants/operationSymbols';
import { getLevelColor } from '../utils/levelColors';
import { getTracksForGrade, shouldShowTrackSelector, shouldShowAllButton, getTrackForGrade, ALL_TRACK } from '../data/tracks';
import { getLockedTracks, getTimebackTrack } from '../utils/resolveStudentGrade';
import { getFastThresholdText } from '../utils/gradeThresholds';
import { TrackStar } from './TrackStar';
import { useTrackMasterStatus } from '../hooks/useTrackMasterStatus';
import { GradientLogo } from './GradientLogo';
import { Settings } from 'lucide-react';
import { BOSS_CONFIG, BOSS_ICONS, isAdaptiveBoss } from '../game/bosses/bossConfig';
import { QuickPlayBossModal } from './QuickPlayBossModal';

// localStorage key for Quick Play boss preference (shared with MatchmakingScreen)
const BOSS_PREF_KEY = 'mathRaidersQuickPlayBoss';

// Type definitions
type MathOperation = 'add' | 'subtract' | 'multiply' | 'divide';

// Constants
// Leveling curve moved to game/leveling.ts (WoW-like 1–60)
// Quest constants moved to useQuestProgress.ts


const MAX_REASONABLE_TIME_MS = 1000000; // 1000 seconds

// Helper: Convert milliseconds to display format
const formatResponseTime = (ms: number): string => {
  if (ms <= 0 || ms >= MAX_REASONABLE_TIME_MS) return '—';
  return (ms / 1000).toFixed(2);
};


export function LobbyScreen() {
  // Data that might change
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const connection = useGameStore(state => 
    state.connectionState.tag === 'connected' ? state.connectionState.conn : null
  );
  
  // Quest progress derived from PerformanceSnapshot (single source of truth)
  const { dailyMinutes, weeklyMinutes, dailyComplete, weeklyComplete } = useQuestProgress(currentPlayer);
  
  // Streak still comes from JSON (server tracks calendar days)
  const questProgress = currentPlayer?.quests ? JSON.parse(currentPlayer.quests) : {};
  const dailyStreak = questProgress.daily_streak || 0;
  
  // Dev: Test streak display
  const [testStreak, setTestStreak] = useState<number | null>(null);
  const displayStreak = import.meta.env.DEV && testStreak !== null ? testStreak : dailyStreak;
  
  // Dev: Test XP display
  const [testXP, setTestXP] = useState<number | null>(null);
  
  // Dev: Test ETA states (0-5: not enough data, stalled, normal, close, very close, legendary)
  const [testEtaState, setTestEtaState] = useState<number | null>(null);
  
  
  // Lock grade toggle ONLY for TimeBack users (they sync from AlphaMath enrollment)
  // Non-TimeBack users can freely adjust grade (it's just a difficulty setting)
  // Treat empty string as no TimeBack (admin may have cleared it for testing)
  const [gradeIsLocked, setGradeIsLocked] = useState(true);
  
  // Update lock state when player loads (fixes race condition where TimeBack students see unlocked briefly)
  useEffect(() => {
    if (currentPlayer) {
      const hasTimeBack = !!(currentPlayer.timebackId && currentPlayer.timebackId !== '');
      setGradeIsLocked(hasTimeBack);
    }
  }, [currentPlayer?.timebackId]);
  
  // Dev: Local grade override for instant UI updates
  const [devGradeOverride, setDevGradeOverride] = useState<number | null>(null);
  const effectiveGrade = import.meta.env.DEV && devGradeOverride !== null 
    ? devGradeOverride 
    : (currentPlayer?.grade ?? 3);
  
  // Get raw data from store - just read, don't compute in selectors
  const factMasteries = useGameStore(state => state.factMasteries);
  const performanceHistory = useGameStore(state => state.performanceHistory);
  
  // Pro tip rotation state
  const [tipIndex, setTipIndex] = useState(0);
  const proTips = [
    // CORE MECHANICS
    "Answer fast for BIG damage! Speed = power!",
    "Streaks grow when you're FAST and CORRECT - both matter!",
    "Wrong answers break your streak - accuracy counts!",
    
    // MASTERY GRID
    "Gold facts = mastered! Hit grade speed 2+ times in last 3 tries.",
    "Gray → Cyan → Purple → Gold: Watch facts level up as you improve!",
    "Cyan = learning accuracy! Purple = building speed! Gold = mastered!",
    
    // PROGRESSION
    "Master more facts to rank up: Bronze → Silver → Gold → Diamond → Legendary!",
    "Your rank shows mastery %. Legendary = 90%+ facts mastered!",
    "Level up for new titles: Rookie → Rising Star → Hotshot → Ace → Prodigy!",
    "No level cap - keep leveling forever! Show your dedication.",
    
    // QUESTS & REWARDS
    "Daily Training: Play 10 minutes = 400 bonus Level Points!",
    "Weekly Challenge: Play 50 minutes = 1500 bonus Level Points!",
    "Come back every day to build your streak! Don't break the chain.",
    
    // MULTIPLAYER
    "Play with friends! Share your room code for squad raids!",
    "Check the leaderboard - compete with others in your grade!",
    
    // ADVANCED
    "Facts you struggle with appear more - the game adapts to you!",
    "Track selection: Focus on one operation or practice ALL!",
    "Boss HP matches your skill - raiders face fair challenges!",
    "Fast answers get 15% crit chance - watch for HUGE damage numbers!"
  ];
  
  // Rotate tips every 8 seconds (more time to read)
  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % proTips.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [proTips.length]);
  
  // Compute all derived values with useMemo to prevent infinite loops
  const masteredFactsCount = useMemo(() => {
    const mastered = factMasteries.filter(m => m.masteryLevel >= 5);
    const factKeys = mastered.map(m => m.factKey);
    
    // Count unique facts only
    const uniqueFacts = [...new Set(factKeys)];
    
    return uniqueFacts.length;  // Return unique count instead
  }, [factMasteries]);
  
  // Removed tier/league system - using rank/division instead
  
  // Mastery stats for current grade
  const masteryStats = useMasteryStats(currentPlayer);
  
  // Today's XP progress
  const { xp: rawTodayXP, raids: todayRaids } = useTodayXP(currentPlayer);
  const todayXP = import.meta.env.DEV && testXP !== null ? testXP : rawTodayXP;
  
  // Calculate division within current rank
  const division = useMemo(() => {
    return calculateDivision(currentPlayer?.rank, masteryStats.mastered, masteryStats.total);
  }, [currentPlayer?.rank, masteryStats.mastered, masteryStats.total]);
  
  // Stable actions - use selectors to prevent re-renders
  const startSoloRaid = useGameStore(state => state.startSoloRaid);
  const createPrivateRoom = useGameStore(state => state.createPrivateRoom);
  
  // Room modal state (join only - room creation goes through MasteryTrialsModal)
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  
  // Party mode toggle (solo vs multiplayer) - persisted to localStorage
  const [partyMode, setPartyMode] = useState<'solo' | 'coop'>(() => {
    const stored = localStorage.getItem('partyMode');
    return stored === 'coop' ? 'coop' : 'solo';
  });
  
  // Persist party mode changes
  const handlePartyModeChange = (mode: 'solo' | 'coop') => {
    setPartyMode(mode);
    localStorage.setItem('partyMode', mode);
  };
  
  // Mastery Trials modal state
  const [masteryTrialsOpen, setMasteryTrialsOpen] = useState(false);
  
  // Quick Play boss selector state
  const [showBossModal, setShowBossModal] = useState(false);
  const [quickPlayBoss, setQuickPlayBoss] = useState<number>(() => {
    const saved = localStorage.getItem(BOSS_PREF_KEY);
    if (saved !== null) {
      const visual = parseInt(saved, 10);
      if (!isNaN(visual) && visual >= 0 && visual <= 8) return visual;
    }
    return 0; // Default: Clank
  });
  const [hasSeenBossPicker, setHasSeenBossPicker] = useState(() => {
    return localStorage.getItem('boss-picker-seen') === 'true';
  });
  
  // Unlocked bosses for Quick Play (from solo Mastery Trial wins)
  const unlockedBosses = useMemo(() => {
    // Always available: Clank, Gloop Jr, Captain Nova, Void Emperor
    const unlocks: Record<number, boolean> = { 0: true, 1: true, 7: true, 8: true };
    const grade = currentPlayer?.grade ?? 0;
    
    const soloRaids = performanceHistory.filter(p =>
      p.grade === grade &&
      p.raidType === 'solo' &&
      p.bossLevel >= 1 && p.bossLevel <= 8
    );
    
    for (let tier = 1; tier <= 8; tier++) {
      const hasWin = soloRaids.some(p => p.bossLevel === tier && p.victory === true);
      if (hasWin) unlocks[tier] = true;
    }
    
    return unlocks;
  }, [performanceHistory, currentPlayer?.grade]);
  
  // Mastery grid state
  const [showMasteryGrid, setShowMasteryGrid] = useState(false);
  
  // Mastery Progress state  
  const [showMasteryProgress, setShowMasteryProgress] = useState(false);
  
  // Combat Stats state
  const [showCombatStats, setShowCombatStats] = useState(false);
  
  // Rankings state
  const [showRankings, setShowRankings] = useState(false);
  const [showGradePicker, setShowGradePicker] = useState(false);
  
  // Track selection state with localStorage persistence (per-grade)
  const [selectedTrack, setSelectedTrack] = useState<string>(() => {
    if (currentPlayer?.id) {
      return getTrackForGrade(currentPlayer.id, currentPlayer.grade);
    }
    return 'ALL';
  });
  
  // Track locking: tracks the student has passed and shouldn't play (prevent XP farming)
  // Empty array = new student, graduated, or unassigned → unlock all
  // Memoized since lockedTracks only changes at login (component remounts after login)
  const lockedTracks = useMemo(() => getLockedTracks(), []);
  const timebackLatestTrack = useMemo(() => getTimebackTrack(), []);

  // Auto-switch to latest unlocked track if player is on a locked track or ALL
  useEffect(() => {
    if (lockedTracks.length > 0 && (selectedTrack === 'ALL' || lockedTracks.includes(selectedTrack))) {
      const validTracks = getTracksForGrade(currentPlayer?.grade ?? 3);
      const firstUnlocked = validTracks.find(t => !lockedTracks.includes(t.id));
      const latestUnlocked = timebackLatestTrack && !lockedTracks.includes(timebackLatestTrack)
        ? validTracks.find(t => t.id === timebackLatestTrack)
        : undefined;
      const nextTrack = latestUnlocked?.id ?? firstUnlocked?.id;
      if (nextTrack) setSelectedTrack(nextTrack);
    }
  }, [lockedTracks, selectedTrack, timebackLatestTrack, currentPlayer?.grade]);
  
  // Determine available operations based on grade
  const availableOperations = useMemo(() => {
    const ops = new Set<string>();
    ALL_FACTS
      .filter(f => f.grades.includes(currentPlayer?.grade ?? 3))
      .forEach(f => {
        // Convert tag to lowercase for our state
        const opName = f.operation.tag.toLowerCase() as MathOperation;
        ops.add(opName);
      });
    const result = Array.from(ops).sort() as MathOperation[];
    return result;
  }, [currentPlayer?.grade]);

  // Operation selection state with smart defaults (per-grade)
  const [selectedOperation, setSelectedOperation] = useState<MathOperation>(() => {
    const playerId = currentPlayer?.id;
    const grade = currentPlayer?.grade ?? 3;
    if (playerId) {
      const stored = localStorage.getItem(`mastery-op-${playerId}-grade${grade}`) as MathOperation;
      // Trust localStorage for initial state - availableOperations will validate on next render
      if (stored) return stored;
    }
    
    // Smart defaults based on grade
    if (grade === 0) return 'add';      // Kindergarten
    if (grade <= 2) return 'add';       // Grades 1-2
    if (grade === 3) return 'multiply';  // Grade 3
    if (grade === 4) return 'divide';    // Grade 4
    return 'multiply';                   // Grade 5+
  });

  // Operation change handler - saves to localStorage (per-grade, uses ref for latest grade)
  const handleOperationChange = useCallback((newOp: MathOperation, isManual = false) => {
    setSelectedOperation(newOp);
    if (currentPlayer?.id) {
      const key = `mastery-op-${currentPlayer.id}-grade${currentGradeRef.current}`;
      localStorage.setItem(key, newOp);
      if (isManual) {
        localStorage.setItem(`${key}-manual`, 'true');
      }
    }
  }, [currentPlayer?.id]);
  
  // Use ref to track current grade (always up-to-date, no stale closures)
  const currentGradeRef = useRef(currentPlayer?.grade ?? 3);
  
  // Sync grade ref from DB when it changes and reload track selection
  useEffect(() => {
    if (currentPlayer?.grade !== undefined) {
      const gradeChanged = currentGradeRef.current !== currentPlayer.grade;
      currentGradeRef.current = currentPlayer.grade;
      
      if (gradeChanged) {
        console.log('[GRADE] DB updated to:', currentPlayer.grade);
      }
      
      // Reload track selection for new grade
      if (currentPlayer?.id && gradeChanged) {
        setSelectedTrack(getTrackForGrade(currentPlayer.id, currentPlayer.grade));
      }
    }
  }, [currentPlayer?.grade, currentPlayer?.id]);
  
  // Track change handler - reads grade from ref (always current)
  const handleTrackChange = useCallback((newTrack: string) => {
    setSelectedTrack(newTrack);
    // Read ref.current at call time (always latest grade)
    if (currentPlayer?.id) {
      const key = `track-${currentPlayer.id}-grade${currentGradeRef.current}`;
      localStorage.setItem(key, newTrack);
    }
  }, [currentPlayer?.id]);
  
  // Clear manual selection flags on mount (new session)
  useEffect(() => {
    if (currentPlayer?.id) {
      // Clear manual flags for all grades (fresh start each session)
      for (let g = 0; g <= 5; g++) {
        localStorage.removeItem(`mastery-op-${currentPlayer.id}-grade${g}-manual`);
      }
    }
  }, []); // Only on mount
  
  // Handle when selected operation becomes unavailable (e.g., Grade 4 has no add/subtract)
  useEffect(() => {
    if (availableOperations.length > 0 && !availableOperations.includes(selectedOperation)) {
      // Current operation not available for this grade
      const grade = currentPlayer?.grade ?? 3;
      let defaultOp: MathOperation = 'add';
      
      // Use grade-specific defaults
      if (grade === 0) defaultOp = 'add';
      else if (grade <= 2) defaultOp = 'add';
      else if (grade === 3) defaultOp = 'multiply';
      else if (grade === 4) defaultOp = 'divide';
      else defaultOp = 'multiply';
      
      // Fall back to first available if default not available
      const newOp = availableOperations.includes(defaultOp) ? defaultOp : availableOperations[0];
      handleOperationChange(newOp);
    }
  }, [availableOperations, selectedOperation, currentPlayer?.grade, handleOperationChange]);

  if (!currentPlayer) return null;

  // Calculate player level using curve (1–60)
  const { level: playerLevel, apIntoLevel: currentLevelAp, apForNext } = getLevelFromTotalAp(currentPlayer.totalAp);
  const levelProgress = apForNext === Infinity ? 100 : (currentLevelAp / apForNext) * 100;
  const nextTitle = getNextTitleInfo(currentPlayer.totalAp);
  const showNextTitleInline = false; // keep header clean
  const showNextTitleBelow = !!(nextTitle && (nextTitle.minLevel - playerLevel <= 1));

  // AP bar shine effect when level/AP increases (subtle feedback)
  const [barShine, setBarShine] = useState(false);
  const lastLevelRef = useRef<number>(playerLevel);
  useEffect(() => {
    if (playerLevel > lastLevelRef.current) {
      // Just trigger the bar shine - level up was already celebrated in ResultsScreen
      setBarShine(true);
      const t = setTimeout(() => setBarShine(false), 1000);
      return () => clearTimeout(t);
    }
    lastLevelRef.current = playerLevel;
  }, [playerLevel]);

  // Pulse AP bar when AP increases
  const lastApRef = useRef<number>(currentPlayer.totalAp);
  const [apPulsing, setXpPulsing] = useState(false);
  useEffect(() => {
    const last = lastApRef.current;
    if (currentPlayer.totalAp > last) {
      setXpPulsing(true);
      // reset after 600ms
      const t = setTimeout(() => {
        setXpPulsing(false);
      }, 600);
      return () => clearTimeout(t);
    }
    lastApRef.current = currentPlayer.totalAp;
  }, [currentPlayer.totalAp]);

  // Calculate accuracy percentage
  const accuracy = currentPlayer.totalCorrect > 0 
    ? Math.round((currentPlayer.totalCorrect / currentPlayer.totalProblems) * 100)
    : 0;

  // Format response times
  const avgResponseTime = formatResponseTime(currentPlayer.avgResponseMs);
  const bestResponseTime = formatResponseTime(currentPlayer.bestResponseMs);

  const title = getTitleForLevel(playerLevel);

  // Calculate track master status
  const availableTracks = getTracksForGrade(currentPlayer.grade);
  // Include ALL track when 2+ operation tracks exist AND player has graduated (no locked tracks)
  // Must be congruent with track selector visibility (line ~892)
  const tracksWithAll = shouldShowAllButton(currentPlayer.grade) && lockedTracks.length === 0
    ? [ALL_TRACK, ...availableTracks]
    : availableTracks;
  const perfHistory = useGameStore(state => state.performanceHistory);
const trackStatuses = useTrackMasterStatus(currentPlayer, tracksWithAll, perfHistory);

  // Best damage per track (Quick Play wins only)
  const damageRecords = useMemo(() => {
    if (!currentPlayer) return [];
    const dominated: Record<string, number> = {};
    for (const s of perfHistory) {
      if (s.playerId !== currentPlayer.id) continue;
      if (s.grade !== currentPlayer.grade) continue;
      if (!isAdaptiveBoss(s.bossLevel)) continue;
      if (!s.victory) continue;
      const track = s.track ?? 'ALL';
      dominated[track] = Math.max(dominated[track] ?? 0, s.damageDealt);
    }
    // Return as array with track names, sorted by track order
    return tracksWithAll
      .filter(t => dominated[t.id] !== undefined)
      .map(t => ({ id: t.id, name: t.name, damage: dominated[t.id] }));
  }, [perfHistory, currentPlayer, tracksWithAll]);

  // Dev: Override mastery for testing star progression
  const [devMasteryOverride, setDevMasteryOverride] = useState<number | null>(null);
  const displayTrackStatuses = import.meta.env.DEV && devMasteryOverride !== null
    ? trackStatuses.map(s => ({ ...s, masteryPercent: devMasteryOverride }))
    : trackStatuses;

  return (
    <div className="page-grid w-full">
      {/* Dev Test Buttons */}
      {import.meta.env.DEV && (
        <div className="fixed top-4 left-4 z-40 flex gap-2">
          <button
            onClick={() => setTestStreak((prev) => (prev === null ? 1 : (prev + 1) % 31))}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
          >
            Streak: {testStreak === null ? 'Real' : testStreak}
          </button>
          <button
            onClick={() => {
              const levels = [null, 0, 10, 25, 50, 75, 90, 100];
              const current = devMasteryOverride;
              const currentIndex = levels.indexOf(current);
              const nextIndex = (currentIndex + 1) % levels.length;
              setDevMasteryOverride(levels[nextIndex]);
            }}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
          >
            Stars: {devMasteryOverride === null ? 'Real' : `${devMasteryOverride}%`}
          </button>
          <button
            onClick={() => setTestEtaState((prev) => (prev === null ? 0 : (prev + 1) % 6))}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
          >
            {(() => {
              if (testEtaState === null) return 'ETA: Real';
              const labels = ['No Data', 'Stalled', 'Normal', 'Close', 'V.Close', 'Complete'] as const;
              return `ETA: ${labels[testEtaState] ?? 'Unknown'}`;
            })()}
          </button>
          <button
            onClick={() => setGradeIsLocked(!gradeIsLocked)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
          >
            Grade: {gradeIsLocked ? '🔒' : '🔓'}
          </button>
        </div>
      )}
      
      <div className="bg-gray-950/70 backdrop-blur-md rounded-xl p-8 mb-8 span-12 border border-white/10">
      {/* Commented out: bg-gray-950 */}
      {/* Character Sheet Header - Stacked Layout with Streak */}
      <div className="relative">
        
        {/* Streak Pill - Top Right of Card */}
        {displayStreak > 0 && (
          <div className="absolute top-0 right-0">
            <div 
              className="inline-flex items-center pl-4 pr-3 py-2
                         bg-gradient-to-r from-orange-600/30 to-red-600/20
                         border-2 border-orange-400/60 rounded-full
                         backdrop-blur-sm shadow-lg
                         hover:scale-105 transition-transform cursor-default
                         info-icon"
              data-tooltip={
                displayStreak === 1 ? "First day! 🎉" :
                displayStreak === 7 ? "1 WEEK! 🏆 Don't lose it!" :
                displayStreak === 14 ? "2 WEEKS! 🔥 Keep going!" :
                displayStreak === 30 ? "1 MONTH! 👑 Legendary!" :
                displayStreak === 100 ? "100 DAYS! 💎 Elite!" :
                displayStreak >= 30 ? `🔥 ${displayStreak} days! Don't break it!` :
                displayStreak >= 7 ? `🔥 ${displayStreak}-day streak!` :
                `🔥 ${displayStreak} days!`
              }
              style={{ minWidth: '72px' }}
            >
              <span className="text-xl leading-none flex-shrink-0">🔥</span>
              <span className="text-xl font-black text-white tabular-nums leading-none pl-1">
                {displayStreak}
              </span>
            </div>
          </div>
        )}
        
      <div className="text-center">
        {/* Logo - Centered */}
        <div className="flex justify-center mb-4">
          <GradientLogo size="md" />
        </div>
        
        {/* Name + Grade Circle */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <h2 className="text-3xl text-white font-game">
            {currentPlayer.name}
          </h2>
          
          {/* Grade Circle - Clickable for non-Timeback */}
          <div className="relative">
            <button
              onClick={() => !gradeIsLocked && setShowGradePicker(!showGradePicker)}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-200",
                "ring-2 ring-offset-0 border-0 shadow-lg",
                "[text-shadow:_0_1px_2px_rgb(0_0_0_/_40%)]",
                "relative overflow-hidden",
                "before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                // Grade-specific colors
                effectiveGrade === 0 && "bg-gray-500/30 ring-gray-500 text-white",
                effectiveGrade === 1 && "bg-green-500/30 ring-green-500 text-white",
                effectiveGrade === 2 && "bg-blue-500/30 ring-blue-500 text-white",
                effectiveGrade === 3 && "bg-purple-500/30 ring-purple-500 text-white",
                effectiveGrade === 4 && "bg-orange-500/30 ring-orange-500 text-white",
                effectiveGrade === 5 && "bg-red-500/30 ring-red-500 text-white",
                // Clickable vs locked
                !gradeIsLocked && "cursor-pointer hover:scale-110 hover:ring-[3px]",
                gradeIsLocked && "cursor-default opacity-80"
              )}
              title={gradeIsLocked ? "Grade synced from AlphaMath" : "Change grade"}
            >
              <span className="relative z-10">{effectiveGrade === 0 ? 'K' : `G${effectiveGrade}`}</span>
            </button>
            
            {/* Grade Picker Dropdown */}
            {showGradePicker && !gradeIsLocked && (
              <>
                {/* Backdrop to close */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowGradePicker(false)}
                />
                {/* Dropdown */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-gray-900/95 backdrop-blur-sm rounded-xl p-2 border border-gray-700 shadow-xl flex gap-1.5">
                  {[
                    { value: 0, label: 'K', color: 'gray' },
                    { value: 1, label: '1', color: 'green' },
                    { value: 2, label: '2', color: 'blue' },
                    { value: 3, label: '3', color: 'purple' },
                    { value: 4, label: '4', color: 'orange' },
                    { value: 5, label: '5', color: 'red' },
                  ].map((grade) => (
                    <button
                      key={grade.value}
                      onClick={() => {
                        if (connection && currentPlayer) {
                          console.log('[GRADE] Changing to:', grade.value);
                          setDevGradeOverride(grade.value);
                          const key = `track-${currentPlayer.id}-grade${grade.value}`;
                          const savedTrack = localStorage.getItem(key) || 'ALL';
                          setSelectedTrack(savedTrack);
                          connection.reducers.setGrade({ grade: grade.value, playerId: undefined });
                        }
                        setShowGradePicker(false);
                      }}
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-200",
                        "hover:scale-110",
                        effectiveGrade === grade.value && "ring-2 ring-white",
                        grade.color === 'gray' && "bg-gray-500/50 text-white hover:bg-gray-500/70",
                        grade.color === 'green' && "bg-green-500/50 text-white hover:bg-green-500/70",
                        grade.color === 'blue' && "bg-blue-500/50 text-white hover:bg-blue-500/70",
                        grade.color === 'purple' && "bg-purple-500/50 text-white hover:bg-purple-500/70",
                        grade.color === 'orange' && "bg-orange-500/50 text-white hover:bg-orange-500/70",
                        grade.color === 'red' && "bg-red-500/50 text-white hover:bg-red-500/70",
                      )}
                    >
                      {grade.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Title · Level + Progress - all on one line */}
        <div className="max-w-xl mx-auto mb-4">
          <div className="flex items-center justify-center gap-3">
            {/* Title */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-lg">{title.icon}</span>
              <span className="text-sm text-white font-game">{title.name}</span>
            </div>
            
            <span className="text-gray-600">·</span>
            
            {/* Level */}
            <span className="font-medium whitespace-nowrap shrink-0">
              <span className="text-sm text-gray-400">Level</span>
              <span className={`text-lg font-bold ${getLevelColor(playerLevel)} ml-1`}>{playerLevel}</span>
              {playerLevel >= MAX_PLAYER_LEVEL && <span className="text-purple-400 text-xs ml-0.5">(MAX)</span>}
            </span>
            
            {/* Progress bar */}
            <div className="w-32 relative h-2 bg-gray-800 rounded-full overflow-hidden border border-purple-500/20 shrink-0">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-purple-400 transition-all duration-500"
                style={{ width: `${levelProgress}%` }}
              />
              {barShine && (
                <>
                  <style>{`
                    @keyframes sparkle-sweep { from { transform: translateX(-30%); } to { transform: translateX(130%); } }
                  `}</style>
                  <div className="absolute inset-0 pointer-events-none">
                    <div
                      className="h-full w-1/3 opacity-70 mix-blend-screen"
                      style={{
                        background: 'linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 100%)',
                        filter: 'blur(1px)',
                        animation: 'sparkle-sweep 900ms cubic-bezier(0.16, 1, 0.3, 1) both',
                      }}
                    />
                  </div>
                </>
              )}
            </div>
            
            {/* XP numbers */}
            <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
              {currentLevelAp}/{apForNext === Infinity ? '—' : apForNext}
            </span>
          </div>
          
          {/* Next title info */}
          {showNextTitleBelow && nextTitle && (
            <div className="mt-2 text-[10px] text-white/40 text-center">
              {nextTitle.apToGo.toLocaleString()} Level Points until {nextTitle.name}
            </div>
          )}
          
          {/* Lightweight AP toast */}
          <div className="relative h-0">
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-6 text-gray-400 text-xs font-semibold pointer-events-none select-none opacity-0 data-[show=true]:opacity-100 transition-opacity duration-500"
                 data-show={apPulsing ? true : undefined}>
              Level Points gained!
            </div>
          </div>
        </div>
        
        {/* Daily XP Progress - TimeBack users only */}
        {(currentPlayer?.timebackId || import.meta.env.DEV) && (() => {
          // Progressive tiers: intensity increases with XP
          const isComplete = todayXP >= 10;
          const tier = todayXP >= 20 ? 'legend' : todayXP >= 15 ? 'extra' : todayXP >= 10 ? 'complete' : 'progress';
          
          const tierStyles = {
            progress: {
              border: 'border-yellow-500/30',
              label: 'text-yellow-400',
              bar: 'from-yellow-600 to-yellow-400',
              glow: '',
            },
            complete: {
              border: 'border-green-500/40',
              label: 'text-green-400',
              bar: 'from-green-600 to-green-400',
              glow: 'shadow-[0_0_10px_rgba(34,197,94,0.3)]',
            },
            extra: {
              border: 'border-green-400/50',
              label: 'text-green-300',
              bar: 'from-green-500 to-green-300',
              glow: 'shadow-[0_0_15px_rgba(34,197,94,0.4)]',
            },
            legend: {
              border: 'border-emerald-400/60',
              label: 'text-emerald-300',
              bar: 'from-emerald-500 to-emerald-300',
              glow: 'shadow-[0_0_20px_rgba(52,211,153,0.5)] animate-pulse',
            },
          };
          
          const style = tierStyles[tier];
          
          return (
            <div className="max-w-lg mx-auto mb-4">
              <div className={cn("bg-gray-900/60 rounded-lg px-4 py-3 border transition-all duration-300", style.border, style.glow)}>
                <div className="flex justify-between items-center mb-2 text-xs">
                  <span className={style.label}>Today's FastMath XP</span>
                  <span className={isComplete ? style.label : 'text-gray-300'}>
                    {isComplete ? `✓ ${todayXP.toFixed(1)} XP` : `${todayXP.toFixed(1)} / 10.0`}
                  </span>
                </div>
                <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full bg-gradient-to-r transition-all duration-500", style.bar)}
                    style={{ width: `${Math.min((todayXP / 10) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      </div> {/* Close relative wrapper */}

      {/* Content Column - Consistent Width */}
      <div className="max-w-4xl mx-auto">
      
      {/* Play Mode Selection - Diamond Layout */}
      <div className="mt-6 mb-8 flex flex-col items-center gap-4">
        {/* Solo/Multiplayer Toggle - Polished pill with glow */}
        <div className="inline-flex bg-gray-800/90 rounded-full p-1.5 border border-gray-600/50 shadow-lg">
          <button
            onClick={() => handlePartyModeChange('solo')}
            className={cn(
              "px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 min-w-[100px]",
              partyMode === 'solo'
                ? "bg-white text-gray-900 shadow-md"
                : "text-gray-400 hover:text-white hover:bg-gray-700/50"
            )}
          >
            ⚔️ Solo
          </button>
          <button
            onClick={() => handlePartyModeChange('coop')}
            className={cn(
              "px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 min-w-[100px]",
              partyMode === 'coop'
                ? "bg-white text-gray-900 shadow-md"
                : "text-gray-400 hover:text-white hover:bg-gray-700/50"
            )}
          >
            👥 Multiplayer
          </button>
        </div>
        
        {/* Mode Cards */}
        <div className="flex flex-col gap-3 items-center">
          {/* Top Row - Quick Play & Boss Ladder */}
          <div className="flex gap-3 justify-center">
            {/* Quick Play Card - Dynamic text based on Solo/Multiplayer */}
            <div className="relative">
            <button
              onClick={() => {
                  // Use saved preference if unlocked, else fall back to 0
                  const effectiveBoss = unlockedBosses[quickPlayBoss] ? quickPlayBoss : 0;
                  const bossLevel = effectiveBoss === 0 ? 0 : 100 + effectiveBoss;
                if (partyMode === 'solo') {
                    startSoloRaid(selectedTrack, bossLevel);
                } else {
                    createPrivateRoom(selectedTrack, bossLevel);
                }
              }}
              disabled={!!(currentPlayer?.inRaidId && currentPlayer.inRaidId !== 0n)}
              className="relative overflow-hidden group rounded-xl transition-all transform hover:-translate-y-1 hover:scale-[1.02] hover:shadow-[0_6px_0_#1d4ed8,0_10px_30px_rgba(59,130,246,0.5)] active:translate-y-0 active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              style={{
                width: '150px',
                height: '200px',
                background: 'linear-gradient(to bottom, #4d9fff 0%, #2563eb 100%)',
                border: '2px solid #1d4ed8',
                boxShadow: '0 6px 0 #1e40af, 0 10px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.15)',
              }}
            >
              {/* Boss selector button - prominent for new users, subtle after */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBossModal(true);
                  if (!hasSeenBossPicker) {
                    localStorage.setItem('boss-picker-seen', 'true');
                    setHasSeenBossPicker(true);
                  }
                }}
                className={cn(
                  "absolute top-2 right-2 p-1.5 rounded-full cursor-pointer z-10 transition-all",
                  hasSeenBossPicker
                    ? "bg-white/20 hover:bg-white/40"  // After: subtle like before
                    : "bg-white/90 hover:bg-white shadow-md animate-pulse hover:scale-110"  // New: prominent
                )}
                title="Choose boss"
              >
                <Settings className={cn(
                  "w-4 h-4",
                  hasSeenBossPicker ? "text-gray-900" : "text-gray-700"
                )} />
              </div>
              
              <div className="relative h-full flex flex-col items-center p-4 pt-8 text-center">
                <span className="text-4xl mb-3">⚡</span>
                <h3 className="text-lg text-gray-900 uppercase tracking-wide leading-tight font-game">
                  Quick<br />Play
                </h3>
                <p className="text-gray-900 text-xs mt-auto pb-2 min-h-[32px] flex items-end justify-center">
                  {partyMode === 'solo' ? 'Adapts to you' : 'Play with friends'}
                </p>
              </div>
            </button>
            </div>
            
            {/* Boss Ladder Card - Fortnite-style neon yellow with glow */}
            <button
              onClick={() => setMasteryTrialsOpen(true)}
              className="relative overflow-hidden group rounded-xl transition-all transform hover:-translate-y-1 hover:scale-[1.02] hover:shadow-[0_6px_0_#8a8200,0_10px_30px_rgba(232,224,32,0.6)] active:translate-y-0 active:scale-100"
              style={{
                width: '150px',
                height: '200px',
                background: 'linear-gradient(to bottom, #E8E020 0%, #D0C818 100%)',
                border: '2px solid #A8A010',
                boxShadow: '0 6px 0 #8a8200, 0 10px 20px rgba(0,0,0,0.4), 0 0 20px rgba(232,224,32,0.3), inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 0 rgba(0,0,0,0.1)',
              }}
            >
              {/* Shine animation overlay - brighter, faster */}
              <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                <div className="absolute -inset-full bg-gradient-to-r from-transparent via-white/40 to-transparent -skew-x-12 animate-[shine_3s_ease-in-out_infinite]" />
              </div>
              <div className="relative h-full flex flex-col items-center p-4 pt-8 text-center">
                <span className="text-4xl mb-3">🏆</span>
                <h3 className="text-lg text-gray-900 uppercase tracking-wide leading-tight font-game">
                  Mastery<br />Trials
                </h3>
                <p className="text-gray-900 text-xs mt-auto pb-2 min-h-[32px] flex items-end justify-center">
                  {partyMode === 'solo' ? 'Prove your speed' : 'Team challenge'}
                </p>
              </div>
            </button>
          </div>
          
          {/* Bottom Row - Join Room (full width, half height, flat secondary) */}
          <button
            onClick={() => setRoomModalOpen(true)}
            className="bg-gray-800/80 text-gray-300 border border-gray-700/50 rounded-lg transition-all hover:bg-gray-700/80 hover:text-white hover:border-blue-500/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] active:bg-gray-800"
            style={{
              width: '312px',
              height: '52px',
            }}
          >
            <div className="h-full flex items-center justify-center">
              <span className="text-sm font-semibold uppercase tracking-wide">Join Room</span>
            </div>
          </button>
        </div>
      </div>
      
      {/* Track Selection Card */}
      {shouldShowTrackSelector(effectiveGrade) && (
        <div className="mb-8">
          <div className="bg-gray-900/60 rounded-lg border border-gray-800/50 overflow-hidden">
            <div key={effectiveGrade}>
              <div className="px-4 py-3 flex flex-col items-center gap-2">
                <span className="text-gray-400 text-xs uppercase tracking-wider font-semibold">
                  Focus Area
                </span>
                
                {/* Segmented Control */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {/* All option - only show if 2+ tracks AND graduated (nothing locked) */}
                  {shouldShowAllButton(effectiveGrade) && lockedTracks.length === 0 && (
                    <button
                      onClick={() => handleTrackChange('ALL')}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap relative overflow-hidden",
                        selectedTrack === 'ALL'
                          ? "bg-purple-500/30 text-white ring-2 ring-purple-500 shadow-lg border-0 before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent"
                          : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 border border-gray-700"
                      )}
                    >
                      <span className="mr-1 relative z-10">✨</span>
                      <span className="relative z-10">All Facts</span>
                    </button>
                  )}
                  
                  {/* Track options with operation-specific colors */}
                  {getTracksForGrade(effectiveGrade).map(track => {
                    const isSelected = selectedTrack === track.id;
                    // Track locking: lock tracks the student has already passed
                    const isLocked = lockedTracks.includes(track.id);
                    // Operation-specific colors
                    const colorClass = track.operation === 'add' ? 'green' :
                                      track.operation === 'subtract' ? 'orange' :
                                      track.operation === 'multiply' ? 'blue' :
                                      track.operation === 'divide' ? 'red' : 'purple';
                    
                    return (
                      <button
                        key={track.id}
                        onClick={() => !isLocked && handleTrackChange(track.id)}
                        disabled={isLocked}
                        title={isLocked ? 'Locked - Complete your current track first' : undefined}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap relative",
                          // Locked state: greyed out
                          isLocked && "opacity-40 cursor-not-allowed text-gray-500 border border-gray-700/50",
                          // Selected state (only when not locked)
                          !isLocked && isSelected && colorClass === 'green' && "bg-green-500/30 text-white ring-2 ring-green-500 shadow-lg border-0",
                          !isLocked && isSelected && colorClass === 'orange' && "bg-orange-500/30 text-white ring-2 ring-orange-500 shadow-lg border-0",
                          !isLocked && isSelected && colorClass === 'blue' && "bg-blue-500/30 text-white ring-2 ring-blue-500 shadow-lg border-0",
                          !isLocked && isSelected && colorClass === 'red' && "bg-red-500/30 text-white ring-2 ring-red-500 shadow-lg border-0",
                          !isLocked && !isSelected && "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 border border-gray-700"
                        )}
                      >
                        {!isLocked && isSelected && (
                          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                        )}
                        <span className="mr-1.5 relative z-10">{isLocked ? '🔒' : track.icon}</span>
                        <span className="relative z-10">{track.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rank Progress - THE KEY METRIC */}
      {currentPlayer && (
        <div className="mt-8 mb-8 relative">
          {/* Track Master Stars - Top Left Inside Badge */}
          {trackStatuses.length > 0 && (
            <div className="absolute top-3 left-3 flex gap-1 z-10">
              {displayTrackStatuses.map(status => (
                <TrackStar
                  key={status.trackId}
                  operation={status.operation}
                  goalBossWins={status.goalBossWins}
                  goalBossName={status.goalBossName}
                  starTier={status.starTier}
                />
              ))}
            </div>
          )}
          
          <RankBadge
            rank={currentPlayer.rank || 'bronze'} // Default to bronze if null
            division={division}
            masteredCount={masteryStats.mastered}
            totalCount={masteryStats.total}
            grade={currentPlayer.grade}
            size="md"
            className="w-full"
          />
        </div>
      )}

      {/* Performance Tracking Section */}
      {currentPlayer && (
        <div className="mt-8 mb-8">
          {/* Section Header */}
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Your Progress
          </h3>
          
          {/* All toggles and their content */}
          <div className="space-y-2">
            {/* Mastery Grid Toggle */}
            <button
              onClick={() => setShowMasteryGrid(!showMasteryGrid)}
              className="w-full text-xs px-8 py-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 
                         text-blue-400 transition-all flex items-center justify-center gap-1"
            >
              <motion.span
                animate={{ rotate: showMasteryGrid ? 90 : 0 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="inline-block text-[10px]"
              >
                ▶
              </motion.span>
              View Mastery Grid
            </button>
            
            {/* Collapsible Mastery Grid Container - RIGHT AFTER ITS BUTTON */}
            <motion.div
              initial={false}
              animate={{ 
                height: showMasteryGrid ? "auto" : 0,
                opacity: showMasteryGrid ? 1 : 0
              }}
              transition={{ 
                type: "spring", 
                stiffness: 200, 
                damping: 25 
              }}
              className="overflow-visible"
            >
              {showMasteryGrid && (
                <div className="mt-3 p-4 bg-gray-800/50 rounded-lg overflow-visible relative">
                  {/* Operation selector buttons */}
                  <div className="flex gap-2 mb-4 justify-center">
                  {availableOperations.map(op => {
                    const isSelected = selectedOperation === op;
                    // Operation-specific colors
                    const colorClass = op === 'add' ? 'green' :
                                      op === 'subtract' ? 'orange' :
                                      op === 'multiply' ? 'blue' :
                                      op === 'divide' ? 'red' : 'purple';
                    
                    return (
                      <button
                        key={op}
                        onClick={() => handleOperationChange(op, true)}
                        aria-label={`Show ${op} facts`}
                        aria-pressed={isSelected}
                        className={cn(
                          "w-11 h-11 rounded-full text-xl font-bold transition-all relative overflow-hidden flex items-center justify-center",
                          isSelected && colorClass === 'green' && "bg-green-500/30 text-white ring-2 ring-green-500 shadow-lg border-0 before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                          isSelected && colorClass === 'orange' && "bg-orange-500/30 text-white ring-2 ring-orange-500 shadow-lg border-0 before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                          isSelected && colorClass === 'blue' && "bg-blue-500/30 text-white ring-2 ring-blue-500 shadow-lg border-0 before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                          isSelected && colorClass === 'red' && "bg-red-500/30 text-white ring-2 ring-red-500 shadow-lg border-0 before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/10 before:to-transparent",
                          !isSelected && "bg-gray-700/50 text-gray-400 hover:bg-gray-600/50 border border-gray-600"
                        )}
                      >
                        <span className="relative z-10">
                          {OPERATION_SYMBOLS[op.charAt(0).toUpperCase() + op.slice(1) as keyof typeof OPERATION_SYMBOLS]}
                        </span>
                      </button>
                    );
                  })}
                </div>
                
                {/* Mastery Grid - with padding for tooltips */}
                <div className="pt-8 pb-8">
                  <MasteryGrid 
                    operation={selectedOperation}
                    factMasteries={factMasteries}
                    grade={currentPlayer.grade}
                  />
                </div>
              
              {/* Color Legend */}
              <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs">
                <div className="flex items-center gap-2 mastery-cell cursor-help" 
                     data-tooltip="Keep practicing this fact!">
                  <div className="w-4 h-4 bg-gray-600 rounded"></div>
                  <span className="text-gray-400">Practice</span>
                </div>
                <div className="flex items-center gap-2 mastery-cell cursor-help" 
                     data-tooltip="1+ correct in last 3 attempts">
                  <div className="w-4 h-4 bg-cyan-500 rounded"></div>
                  <span className="text-gray-400">Learning</span>
                </div>
                <div className="flex items-center gap-2 mastery-cell cursor-help" 
                     data-tooltip={`Developing speed - answered within 3x threshold in last 3 attempts`}>
                  <div className="w-4 h-4 bg-purple-500 rounded"></div>
                  <span className="text-gray-400">Developing</span>
                </div>
                <div className="flex items-center gap-2 mastery-cell cursor-help" 
                     data-tooltip={`Hit grade speed (≤${getFastThresholdText(currentPlayer?.grade ?? 3)}) 2+ times in last 3 = MASTERED! ⚡`}>
                  <div className="w-4 h-4 bg-gradient-to-br from-amber-400 to-orange-500 rounded"></div>
                  <span className="text-gray-400">Mastered</span>
                </div>
              </div>
            </div>
            )}
          </motion.div>
            
            {/* Mastery Progress Toggle */}
            <button
              onClick={() => setShowMasteryProgress(!showMasteryProgress)}
              className="w-full text-xs px-8 py-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 
                         text-blue-400 transition-all flex items-center justify-center gap-1"
            >
              <motion.span
                animate={{ rotate: showMasteryProgress ? 90 : 0 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="inline-block text-[10px]"
              >
                ▶
              </motion.span>
              View Mastery Progress
            </button>
            
            {/* Collapsible Mastery Progress Chart Container */}
            <motion.div
              initial={false}
              animate={{ 
                height: showMasteryProgress ? "auto" : 0,
                opacity: showMasteryProgress ? 1 : 0
              }}
              transition={{ 
                type: "spring", 
                stiffness: 300, 
                damping: 30
              }}
              className="overflow-visible"
            >
              {showMasteryProgress && (
                <div className="mt-3 p-4 bg-gray-800/50 rounded-lg">
                  <MasteryProgressChart testEtaState={testEtaState} />
                </div>
              )}
            </motion.div>
            
            {/* Combat Stats Toggle */}
            <button
              onClick={() => setShowCombatStats(!showCombatStats)}
              className="w-full text-xs px-8 py-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 
                         text-blue-400 transition-all flex items-center justify-center gap-1"
            >
              <motion.span
                animate={{ rotate: showCombatStats ? 90 : 0 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="inline-block text-[10px]"
              >
                ▶
              </motion.span>
              View All-Time Stats
            </button>
            
            {/* Collapsible Combat Stats Container */}
            <motion.div
              initial={false}
              animate={{ 
                height: showCombatStats ? "auto" : 0,
                opacity: showCombatStats ? 1 : 0
              }}
              transition={{ 
                type: "spring", 
                stiffness: 300, 
                damping: 30
              }}
              className="overflow-visible"
            >
              {showCombatStats && (
                <div className="mt-3 p-4 bg-gray-800/50 rounded-lg">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">All-Time Stats</h4>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-cyan-400 tabular-nums">{currentPlayer.totalRaids}</p>
                      <p className="text-[10px] text-gray-500 tracking-wider mt-1">Raids</p>
                    </div>
                    
                    <div className="text-center">
                      <p className="text-2xl font-bold text-blue-400 tabular-nums">{currentPlayer.totalProblems}</p>
                      <p className="text-[10px] text-gray-500 tracking-wider mt-1">Problems</p>
                    </div>
                    
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-400 tabular-nums">{accuracy}%</p>
                      <p className="text-[10px] text-gray-500 tracking-wider mt-1">Accuracy</p>
                    </div>
                    
                    <div className="text-center">
                      <p className="text-2xl font-bold text-yellow-400 tabular-nums">
                        {avgResponseTime}
                        {avgResponseTime !== '—' && <span className="text-lg text-gray-500">s</span>}
                      </p>
                      <p className="text-[10px] text-gray-500 tracking-wider mt-1">Avg Speed</p>
                    </div>
                  </div>

                  {/* Damage Records - Quick Play PBs per track */}
                  {damageRecords.length > 0 && (
                    <>
                      <div className="border-t border-gray-700/50 my-4" />
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Damage Records</h4>
                      <div className="flex flex-wrap justify-center gap-4">
                        {damageRecords.map(({ id, name, damage }) => (
                          <div key={id} className="text-center min-w-[80px]">
                            <p className="text-2xl font-bold text-red-400 tabular-nums">{damage.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-500 tracking-wider mt-1">{name}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </motion.div>
            {/* Rankings Toggle */}
            <button
              onClick={() => setShowRankings(!showRankings)}
              className="w-full text-xs px-8 py-1.5 rounded bg-blue-500/20 hover:bg-blue-500/30 
                         text-blue-400 transition-all flex items-center justify-center gap-1"
            >
              <motion.span
                animate={{ rotate: showRankings ? 90 : 0 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="inline-block text-[10px]"
              >
                ▶
              </motion.span>
              View Leaderboard
            </button>
            
            {/* Collapsible Leaderboard Container - conditional render to avoid re-renders when closed */}
            <AnimatePresence>
              {showRankings && (
            <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
              transition={{ 
                type: "spring", 
                stiffness: 300, 
                damping: 30
              }}
              className="overflow-hidden"
            >
              <LeaderboardPanel />
            </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    
      {/* Quest Log */}
      <div className="mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Quests</span>
            </div>
            {dailyComplete && weeklyComplete && (
              <span className="text-xs text-green-500 font-semibold uppercase font-game">All Complete!</span>
            )}
          </div>
        
          {/* Daily Training */}
          <div className="bg-gray-800 rounded p-2 mb-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-base">{dailyComplete ? '✅' : '🎯'}</span>
                <span className="text-xs font-semibold text-white font-game">Daily Training</span>
              </div>
              <span className={`text-xs font-semibold ${dailyComplete ? 'text-green-500' : 'text-gray-400'}`}>
                +{DAILY_QUEST_REWARD} Level Points
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-yellow-300 transition-all duration-500"
                     style={{ width: `${Math.min((dailyMinutes / DAILY_TIME_TARGET) * 100, 100)}%` }} />
              </div>
              <span className="text-[10px] text-gray-500 font-mono">
                {Math.floor(dailyMinutes)}/{DAILY_TIME_TARGET} min
              </span>
            </div>
          </div>

          {/* Weekly Challenge */}
          <div className="bg-gray-800 rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-base">{weeklyComplete ? '🏆' : '🔥'}</span>
                <span className="text-xs font-semibold text-white font-game">Weekly Challenge</span>
              </div>
              <span className={`text-xs font-semibold ${weeklyComplete ? 'text-green-500' : 'text-gray-400'}`}>
                +{WEEKLY_QUEST_REWARD} Level Points
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-yellow-300 transition-all duration-500"
                     style={{ width: `${Math.min((weeklyMinutes / WEEKLY_TIME_TARGET) * 100, 100)}%` }} />
              </div>
              <span className="text-[10px] text-gray-500 font-mono">
                {Math.floor(weeklyMinutes)}/{WEEKLY_TIME_TARGET} min
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Pro Tips */}
      <div className="mt-6 bg-gradient-to-r from-gray-900 to-gray-800 border border-gray-700 p-4 rounded-lg shadow-lg">
        <div className="flex items-start gap-3">
          <span className="text-yellow-400 text-2xl">💡</span>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-yellow-400 font-bold text-xs uppercase tracking-wider">Pro Tip</p>
              {/* Progress dots */}
              <div className="flex gap-1">
                {proTips.map((_, index) => (
                  <div
                    key={index}
                    className={`w-1 h-1 rounded-full transition-all duration-300 ${
                      index === tipIndex ? 'bg-yellow-400 w-3' : 'bg-gray-600'
                    }`}
                  />
                ))}
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.p
                key={tipIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4 }}
                className="text-gray-300 font-medium leading-relaxed"
              >
                {proTips[tipIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>
      </div> {/* End Content Column */}
      
      {/* Room Modal */}
      <RoomModal 
        isOpen={roomModalOpen}
        onClose={() => setRoomModalOpen(false)}
        selectedTrack={selectedTrack}
      />
      
      {/* Mastery Trials Modal */}
      <MasteryTrialsModal
        isOpen={masteryTrialsOpen}
        onClose={() => setMasteryTrialsOpen(false)}
        track={selectedTrack}
        trackName={selectedTrack === 'ALL' ? 'All' : 
          getTracksForGrade(effectiveGrade).find(t => t.id === selectedTrack)?.name ?? selectedTrack}
        partyMode={partyMode}
      />

      {/* Quick Play Boss Selector Modal */}
      <QuickPlayBossModal
        isOpen={showBossModal}
        onClose={() => setShowBossModal(false)}
        selectedBoss={quickPlayBoss}
        onSelectBoss={(id) => {
          setQuickPlayBoss(id);
          localStorage.setItem(BOSS_PREF_KEY, String(id));
        }}
        unlockedBosses={unlockedBosses}
      />
    </div>
    </div>
  );
}