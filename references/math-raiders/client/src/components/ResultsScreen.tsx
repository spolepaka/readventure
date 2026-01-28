import { useEffect, useMemo, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import * as React from 'react';
import { useGameStore } from '../store/gameStore';
import { useShallow } from 'zustand/react/shallow';
import { getBossConfig, BOSS_CONFIG, BOSS_ICONS, BOSS_HP, isAdaptiveBoss, getBossVisual } from '../game/bosses/bossConfig';
import { useUnlockedBosses } from '../hooks/useUnlockedBosses';

import { motion, AnimatePresence } from 'framer-motion';
import { Gift, Sparkles, ChevronRight, ChevronDown } from 'lucide-react';

// localStorage key for leader's boss preference (shared with MatchmakingScreen)
const BOSS_PREF_KEY = 'mathRaidersQuickPlayBoss';
import { RewardParticles } from './RewardParticles';
import { getLevelFromTotalAp, getTitleForLevel } from '../game/leveling';
import { LevelUpModalSimple } from './LevelUpModalSimple';
import { RankUpModal } from './RankUpModal';
import { TrackMasterModal } from './TrackMasterModal';
import { RaidDamageChart } from './RaidDamageChart';
import { useMasteryStats } from '../hooks/useMasteryStats';
import { useQuestProgress, DAILY_QUEST_REWARD, WEEKLY_QUEST_REWARD } from '../hooks/useQuestProgress';
import { useGameSounds } from '../hooks/useGameSounds';
import { useTrackMasterStatus } from '../hooks/useTrackMasterStatus';
import { getTracksForGrade, shouldShowAllButton, ALL_TRACK } from '../data/tracks';
import { calculateDivision, getNextMilestone, getRankColorClasses } from '../utils/rankDivisions';
import { getGradeGoalBoss } from '../utils/gradeThresholds';
import { RankGem } from './RankGem';
// No longer need playerHelpers - names are denormalized in raid_player

// Defeat messages: Learning science (growth mindset, external attribution) + Game engagement (boss-themed, action-oriented)
// Use {boss} placeholder for boss name
const DEFEAT_MESSAGES = {
  // Close loss (>=80% damage dealt) - They almost had it
  close: {
    headers: ["ALMOST!", "SO CLOSE!", "NEARLY THERE!"],
    bodies: [
      "That {boss} got lucky. Rematch?",
      "One more try and you've got this!",
      "You had {boss} on the ropes!",
      "{boss} is sweating. Go again!",
    ]
  },
  // Solid effort (50-79% damage) - Good progress
  solid: {
    headers: ["GOOD FIGHT!", "SOLID EFFORT!", "NICE TRY!"],
    bodies: [
      "Every battle makes you stronger.",
      "Your speed is improving!",
      "Good damage! Keep pushing!",
      "That's how you level up!",
    ]
  },
  // Early loss (<50% damage) - Encourage persistence
  early: {
    headers: ["TOUGH BOSS!", "KEEP GOING!", "DON'T GIVE UP!"],
    bodies: [
      "{boss} takes practice. You'll get there!",
      "Speed comes with practice. Try again!",
      "You're building speed. Keep at it!",
      "The more you practice, the faster you get!",
    ]
  }
};

// Deterministic random picker based on damage dealt (so it doesn't change on re-render)
function pickDefeatMessage(damageDealt: number, maxHp: number, bossName: string): { header: string; body: string } {
  const hpPercent = (damageDealt / maxHp) * 100;
  const tier = hpPercent >= 80 ? 'close' : hpPercent >= 50 ? 'solid' : 'early';
  const messages = DEFEAT_MESSAGES[tier];
  
  // Use damage as seed for deterministic "random" pick
  const headerIndex = damageDealt % messages.headers.length;
  const bodyIndex = Math.floor(damageDealt / 7) % messages.bodies.length;
  
  return {
    header: messages.headers[headerIndex],
    body: messages.bodies[bodyIndex].replace(/{boss}/g, bossName)
  };
}

export function ResultsScreen() {
  // Data that changes - use useShallow
  const { currentRaid, raidPlayers, currentPlayer, raidStartRank, raidStartDivision, raidStartMastered, raidStartAp } = useGameStore(
    useShallow(state => ({
      currentRaid: state.currentRaid,
      raidPlayers: state.raidPlayers,
      currentPlayer: state.currentPlayer,
      raidStartRank: state.raidStartRank,
      raidStartDivision: state.raidStartDivision,
      raidStartMastered: state.raidStartMastered,
      raidStartAp: state.raidStartAp
    }))
  );
  
  // Quest progress from PerformanceSnapshot (time-based)
  const { dailyComplete, weeklyComplete } = useQuestProgress(currentPlayer);
  
  // Stable actions
  // Use selectors to prevent re-renders
  const raidAgain = useGameStore(state => state.raidAgain);
  const soloAgain = useGameStore(state => state.soloAgain);
  const leaveRaid = useGameStore(state => state.leaveRaid);
  const setBossVisual = useGameStore(state => state.setBossVisual);
  const setMasteryBoss = useGameStore(state => state.setMasteryBoss);
  
  // Single values
  const connection = useGameStore(state => 
    state.connectionState.tag === 'connected' ? state.connectionState.conn : null
  );
  const raidStartTrackMasters = useGameStore(state => state.raidStartTrackMasters);
  const raidStartStarTiers = useGameStore(state => state.raidStartStarTiers);
  const raidStartDailyComplete = useGameStore(state => state.raidStartDailyComplete);
  const raidStartWeeklyComplete = useGameStore(state => state.raidStartWeeklyComplete);
  const raidStartBestDamages = useGameStore(state => state.raidStartBestDamages);
  const raidStartBestTimes = useGameStore(state => state.raidStartBestTimes);
  const perfHistory = useGameStore(state => state.performanceHistory);

  const [chestOpened, setChestOpened] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [reward, setReward] = useState<{ tier: string; label: string; tag: string; color: string; hex?: string; value?: string; bonusAP?: number } | null>(null);
  // REMOVED: apCount - never read
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 });
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);
  const [showRankModal, setShowRankModal] = useState(false);
  const [showTrackMasterModal, setShowTrackMasterModal] = useState(false);
  const [newMasterOperation, setNewMasterOperation] = useState<'add' | 'subtract' | 'multiply' | 'divide' | 'all' | null>(null);
  const [newMasterBossName, setNewMasterBossName] = useState<string | null>(null);
  const [newMasterNextBossName, setNewMasterNextBossName] = useState<string | null>(null);
  const [animatedAp, setAnimatedAp] = useState(0);
  const [hasAnimatedBase, setHasAnimatedBase] = useState(false);
  const [showRaidAgainModal, setShowRaidAgainModal] = useState(false);
  const [showBossSelector, setShowBossSelector] = useState(false);
  const [selectedSoloBoss, setSelectedSoloBoss] = useState<number | null>(null);
  const bossSelectorRef = useRef<HTMLDivElement>(null);
  
  // Close boss dropdown on click outside or ESC
  useEffect(() => {
    if (!showBossSelector) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (bossSelectorRef.current && !bossSelectorRef.current.contains(e.target as Node)) {
        setShowBossSelector(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBossSelector(false);
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showBossSelector]);

  // Calculate unlocked bosses (adaptive vs fixed have different rules)
  const isCurrentRaidAdaptive = currentRaid ? isAdaptiveBoss(currentRaid.bossLevel) : true;
  const leaderRaidPlayer = raidPlayers.find(rp => rp.isLeader);
  const unlockedBosses = useUnlockedBosses(isCurrentRaidAdaptive, currentPlayer, leaderRaidPlayer, perfHistory);
  
  // Derive selected visual from raid's boss_level (server is source of truth)
  const selectedBossVisual = currentRaid ? getBossVisual(currentRaid.bossLevel) : 0;
  
  // Dev test harness for rank modal
  const [forceShowRankModal, setForceShowRankModal] = useState(false);
  const rankTestScenarios = [
    { oldRank: 'bronze', newRank: 'silver', oldDivision: 'I', newDivision: 'IV', label: 'Bronze→Silver' },
    { oldRank: 'silver', newRank: 'gold', oldDivision: 'II', newDivision: 'IV', label: 'Silver→Gold' },
    { oldRank: 'gold', newRank: 'diamond', oldDivision: 'I', newDivision: 'IV', label: 'Gold→Diamond' },
    { oldRank: 'diamond', newRank: 'legendary', oldDivision: 'I', newDivision: '', label: 'Diamond→Legendary' },
    { oldRank: 'bronze', newRank: 'bronze', oldDivision: 'IV', newDivision: 'III', label: 'Division Up' },
  ];
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [testRankData, setTestRankData] = useState(rankTestScenarios[0]);
  // REMOVED: hasAnimatedChest - never used
  const previousLevelRef = useRef<number>(1);
  const [levelUpFrom, setLevelUpFrom] = useState<number | null>(null);
  const [levelUpTo, setLevelUpTo] = useState<number | null>(null);
  const apAnimationRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0); // For throttling
  const [animationsPaused, setAnimationsPaused] = useState(false); // Pause all animations when modal shows
  
  // Simple AP tracking
  const [bonusAp, setBonusAp] = useState(0); // Bonus from chest
  
  // Dev: Mock damage chart data
  const [useMockDamageChart, setUseMockDamageChart] = useState(false);
  
  // Cache pre-raid AP to prevent recalculation
  const [initialApValues, setInitialApValues] = useState<{
    preRaidAp: number;
    totalToEarn: number;
    startLevel: number;
    endLevel: number;
  } | null>(null);
  
  const reduceMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Sound hook
  const playSound = useGameSounds();
  const victorySoundPlayedRef = useRef(false);

  // Cache the original victory result before state transitions to Rematch
  // This prevents the bug where Rematch state incorrectly shows victory UI after a defeat
  const cachedVictoryRef = useRef<boolean | null>(null);
  if (cachedVictoryRef.current === null && currentRaid?.state.tag === "Victory") {
    cachedVictoryRef.current = true;
  } else if (cachedVictoryRef.current === null && currentRaid?.state.tag === "Failed") {
    cachedVictoryRef.current = false;
  }
  
  // Use cached result if available (handles Rematch state), otherwise check current state
  const isVictory = cachedVictoryRef.current ?? currentRaid?.state.tag === "Victory";
  
  // Play victory sound once when results screen loads
  useEffect(() => {
    if (isVictory && !victorySoundPlayedRef.current) {
      playSound('victory');
      victorySoundPlayedRef.current = true;
    }
  }, [isVictory, playSound]);
  // Check active players only (someone might have left before results)
  const activePlayers = raidPlayers.filter(p => p.isActive);
  // Solo raids have no room code, multi raids do
  const isSoloRaid = !currentRaid?.roomCode;
  
  // Find current player's stats
  const myStats = currentPlayer ? raidPlayers.find(p => p.playerId === currentPlayer.id) : undefined;
  
  // Calculate HP dealt for loss screen
  const totalDamageDealt = raidPlayers.reduce((sum, rp) => sum + rp.damageDealt, 0);
  const bossMaxHp = currentRaid?.bossMaxHp ?? 1;
  const hpPercent = Math.round((totalDamageDealt / bossMaxHp) * 100);
  
  // Raid duration from server (authoritative)
  const raidDurationSeconds = currentRaid?.durationSeconds || 0;
  
  // === First Clear / New Record derivation (Mastery Trials only) ===
  // 
  // Uses raidStartBestTimes captured BEFORE the raid started.
  // This avoids the SpacetimeDB callback race condition entirely:
  // we compare against stable data captured when perfHistory was guaranteed up-to-date.
  // Mode-specific: solo and multi have separate PB pools (matches modal behavior).
  const bossLevel = currentRaid?.bossLevel ?? 0;
  const isMasteryTrial = bossLevel >= 1 && bossLevel <= 8;  // Fixed HP bosses (solo OR multi)
  const currentTrack = myStats?.track ?? 'ALL';
  const currentRaidType = isSoloRaid ? 'solo' : 'multi';
  
  // Initialize selected boss for solo "Raid Again" picker
  useEffect(() => {
    if (!currentRaid || !isSoloRaid) return;
    const current = currentRaid.bossLevel;
    const isAdaptive = isAdaptiveBoss(current);
    
    if (isAdaptive) {
      // Quick Play: use stored preference or default to current visual
      const saved = localStorage.getItem(BOSS_PREF_KEY);
      const parsed = saved ? Number(saved) : NaN;
      // Validate parsed is a valid boss ID (0-8), fall back to current visual if not
      const isValidBoss = !isNaN(parsed) && parsed >= 0 && parsed <= 8;
      setSelectedSoloBoss(isValidBoss ? parsed : getBossVisual(current));
    } else {
      // Mastery Trials: advance to next boss if just unlocked it, else stay
      const next = current + 1;
      const shouldAdvance = isVictory && next <= 8 && unlockedBosses[next];
      setSelectedSoloBoss(shouldAdvance ? next : current);
    }
  }, [currentRaid?.bossLevel, isSoloRaid, isVictory, unlockedBosses]);
  
  const { isFirstClear, isNewRecord, previousBestTime } = useMemo(() => {
    // If we don't have myStats, we can't reliably derive the track for this run,
    // so avoid showing Mastery PB/First Clear banners in that edge case.
    if (!isMasteryTrial || !isVictory || !currentRaid || !myStats) {
      return { isFirstClear: false, isNewRecord: false, previousBestTime: null };
    }
    
    const myTime = raidDurationSeconds;
    const key = `${currentRaidType}-${bossLevel}-${currentTrack}`;
    const previousBest = raidStartBestTimes[key] ?? null;
    
    // First Clear: no previous best time exists
    const firstClear = previousBest === null;
    
    // New Record: we strictly beat the previous best time (lower is better)
    const newRecord = previousBest !== null && myTime > 0 && myTime < previousBest;
    
    return { 
      isFirstClear: firstClear, 
      isNewRecord: newRecord, 
      previousBestTime: previousBest // For display: "42s → 38s"
    };
  }, [isMasteryTrial, isVictory, currentRaid, myStats, bossLevel, currentTrack, currentRaidType, raidDurationSeconds, raidStartBestTimes]);
  
  // Get next boss info for First Clear message
  // NOTE: Grade goal boss requires 3 wins to unlock the next tier, so a "first clear"
  // on the goal boss should NOT claim the next boss was unlocked.
  const goalBossId = currentPlayer ? getGradeGoalBoss(currentPlayer.grade) : 0;
  const unlocksNextBossOnFirstClear =
    isFirstClear && bossLevel >= 1 && bossLevel < 8 && bossLevel !== goalBossId;
  const nextBossConfig = unlocksNextBossOnFirstClear ? getBossConfig(bossLevel + 1) : null;
  
  // === Quick Play Damage Personal Best ===
  // Track best damage per track for Quick Play wins (adaptive boss = 0 or 100+)
  // 
  // Uses raidStartBestDamages captured BEFORE the raid started.
  // This avoids the SpacetimeDB callback race condition entirely:
  // we compare against stable data captured when perfHistory was guaranteed up-to-date.
  const { isNewDamagePb, previousBestDamage } = useMemo(() => {
    const isQuickPlay = currentRaid && isAdaptiveBoss(currentRaid.bossLevel);
    if (!isQuickPlay || !isVictory || !myStats) {
      return { isNewDamagePb: false, previousBestDamage: 0 };
    }
    
    const myDamage = myStats.damageDealt;
    const previousBest = raidStartBestDamages[currentTrack] ?? 0;
    
    // New PB if we strictly beat the previous best (ties don't count)
    const isNewPb = myDamage > previousBest;
    
    return { isNewDamagePb: isNewPb, previousBestDamage: previousBest };
  }, [currentRaid, isVictory, currentTrack, myStats, raidStartBestDamages]);

  // Get readable operation name for damage PB banner
  const damageRecordLabel = useMemo(() => {
    if (currentTrack === 'ALL') return 'Mixed';
    const trackInfo = getTracksForGrade(currentPlayer?.grade ?? 0).find(t => t.id === currentTrack);
    const opNames: Record<string, string> = { add: 'Addition', subtract: 'Subtraction', multiply: 'Multiplication', divide: 'Division' };
    return trackInfo?.operation ? opNames[trackInfo.operation] : 'Damage';
  }, [currentTrack, currentPlayer?.grade]);

  // Find highlights - safe with empty arrays
  const speedDemon = raidPlayers.length > 0 
    ? raidPlayers.reduce((fastest, p) => 
        p.fastestAnswerMs < fastest.fastestAnswerMs ? p : fastest
      )
    : null;
  
  const damageDealer = raidPlayers.length > 0
    ? raidPlayers.reduce((highest, p) => 
        p.damageDealt > highest.damageDealt ? p : highest
      )
    : null;
  
  const playersWithAnswers = raidPlayers.filter(p => p.problemsAnswered > 0);
  const accuracyAce = playersWithAnswers.length > 0
    ? playersWithAnswers.reduce((best, p) => {
        const accuracy = p.correctAnswers / p.problemsAnswered;
        const bestAccuracy = best.correctAnswers / best.problemsAnswered;
        return accuracy > bestAccuracy ? p : best;
      })
    : null;

  // Calculate progression changes
  const masteryStats = useMasteryStats(currentPlayer);
  const currentDivision = calculateDivision(
    currentPlayer?.rank,
    masteryStats.mastered,
    masteryStats.total
  );
  
  // Track Master detection - include ALL track when 2+ operation tracks
  // Note: Locked tracks check not needed here - LobbyScreen prevents ALL selection,
  // gameStore excludes ALL from pre-raid state, so ALL master detection is impossible
  const operationTracks = getTracksForGrade(currentPlayer?.grade || 4);
  const availableTracks = shouldShowAllButton(currentPlayer?.grade || 4)
    ? [...operationTracks, ALL_TRACK]
    : operationTracks;
  const trackStatuses = useTrackMasterStatus(currentPlayer, availableTracks, perfHistory);
  const currentMasters = trackStatuses.filter(t => t.isMaster).map(t => t.operation);
  
  // Detect changes (raidStartTrackMasters captured before raid in gameStore)
  const rankChanged = currentPlayer?.rank !== raidStartRank;
  const divisionChanged = currentDivision !== raidStartDivision;
  const factsGained = masteryStats.mastered - raidStartMastered;
  const newMasters = currentMasters.filter(op => !raidStartTrackMasters.includes(op));
  
  // Detect star tier-ups (0→1, 1→2, 2→3)
  type OperationType = 'add' | 'subtract' | 'multiply' | 'divide' | 'all';
  const starTierUps = useMemo(() => {
    const tierUps: Array<{ operation: OperationType; oldTier: number; newTier: number }> = [];
    for (const status of trackStatuses) {
      const oldTier = raidStartStarTiers[status.operation] ?? 0;
      const newTier = status.goalBossWins;
      if (newTier > oldTier) {
        tierUps.push({ operation: status.operation, oldTier, newTier: Math.min(newTier, 3) });
      }
    }
    return tierUps;
  }, [trackStatuses, raidStartStarTiers]);
  
  // Get next goal
  const nextMilestone = getNextMilestone(
    currentPlayer?.rank,
    masteryStats.mastered,
    masteryStats.total
  );
  
  // Show progression for any change (excluding first raid where baseline is null)
  const showProgressSection = 
    (rankChanged && raidStartRank !== null) ||  // Rank changed (not first raid)
    divisionChanged ||  // Division changed
    factsGained > 0;  // Facts mastered increased
  
  // Helper to determine if rank improved
  const rankOrder = ['bronze', 'silver', 'gold', 'diamond', 'legendary'];
  const isRankImproved = (oldRank: string | null, newRank: string | null | undefined): boolean => {
    if (!oldRank || !newRank) return false;
    const oldIndex = rankOrder.indexOf(oldRank);
    const newIndex = rankOrder.indexOf(newRank);
    return newIndex > oldIndex;
  };
  
  // Helper to determine if division improved
  const divisionOrder = ['IV', 'III', 'II', 'I'];
  const isDivisionImproved = (oldDiv: string, newDiv: string): boolean => {
    const oldIndex = divisionOrder.indexOf(oldDiv);
    const newIndex = divisionOrder.indexOf(newDiv);
    return newIndex > oldIndex;
  };
  
  // Dev testing state
  const [testScenario, setTestScenario] = useState(0);
  const useTestData = import.meta.env.DEV && testScenario > 0;
  
  // Test scenarios for development
  const testData = useMemo(() => {
    if (!useTestData) return null;
    
    const scenarios = [
      null, // 0 - Use real data
      { // 1 - Rank up
        rankChanged: true,
        divisionChanged: true,
        factsGained: 5,
        raidStartRank: 'bronze',
        raidStartDivision: 'I',
        currentRank: 'silver',
        currentDivision: 'IV'
      },
      { // 2 - Division up
        rankChanged: false,
        divisionChanged: true,
        factsGained: 3,
        raidStartRank: 'silver',
        raidStartDivision: 'III',
        currentRank: 'silver',
        currentDivision: 'II'
      },
      { // 3 - Just facts
        rankChanged: false,
        divisionChanged: false,
        factsGained: 2,
        raidStartRank: 'gold',
        raidStartDivision: 'II',
        currentRank: 'gold',
        currentDivision: 'II'
      },
      { // 4 - Rank down
        rankChanged: true,
        divisionChanged: true,
        factsGained: 0,
        raidStartRank: 'silver',
        raidStartDivision: 'IV',
        currentRank: 'bronze',
        currentDivision: 'I'
      },
      { // 5 - Division down
        rankChanged: false,
        divisionChanged: true,
        factsGained: 0,
        raidStartRank: 'gold',
        raidStartDivision: 'II',
        currentRank: 'gold',
        currentDivision: 'III'
      }
    ];
    
    return scenarios[testScenario];
  }, [testScenario, useTestData]);
  
  // Use test data if in dev mode and test scenario selected
  const displayData = testData || {
    rankChanged,
    divisionChanged,
    factsGained,
    raidStartRank,
    raidStartDivision,
    currentRank: currentPlayer?.rank,
    currentDivision
  };

  // AP calculation: Simple delta (server is source of truth)
  // Server awards: base + multiplayer + quests all in one transaction
  // Client just shows the delta for animation
  const totalApEarned = currentPlayer 
    ? currentPlayer.totalAp - (raidStartAp ?? 0)
    : 0;

  // ANIMATION SEQUENCE:
  // 1. Enter screen → Calculate pre-raid AP → Start at pre-raid value
  // 2. Wait 500ms → Begin AP animation (1.5s)
  // 3. If level up → Show modal when animation hits target level
  // 4. Animation completes → Enable chest
  // 5. Player opens chest → Bonus AP animation (1s) 
  // 6. If level up from bonus → Show modal again
  //
  // STATE DEPENDENCIES:
  // - hasAnimatedBase: Controls chest enable/disable
  // - showLevelUpModal: Prevents duplicate modals
  // - previousLevelRef: Tracks level to detect changes (using ref to avoid stale closures)
  
    // Calculate and cache initial AP values once
  useEffect(() => {
    if (currentPlayer && !initialApValues && raidStartAp !== undefined) {
      // Use captured pre-raid AP (no calculation needed)
      const preRaidAp = raidStartAp;
      const preRaidLevel = getLevelFromTotalAp(preRaidAp).level;
      const finalLevel = getLevelFromTotalAp(currentPlayer.totalAp).level;
      
      setInitialApValues({
        preRaidAp,
        totalToEarn: totalApEarned,  // Simple delta from server
        startLevel: preRaidLevel,
        endLevel: finalLevel
      });
      
      // Initialize animated AP to pre-raid value
      setAnimatedAp(preRaidAp);
      previousLevelRef.current = preRaidLevel;
    }
  }, [currentPlayer, totalApEarned, initialApValues, raidStartAp]);
  
  // Animate AP from pre-raid to post-raid when entering results screen
  useEffect(() => {
    if (currentPlayer && initialApValues && !hasAnimatedBase) {
      // Always cleanup previous animation first
      if (apAnimationRef.current) {
        cancelAnimationFrame(apAnimationRef.current);
        apAnimationRef.current = null;
      }
      
      const { preRaidAp, startLevel, endLevel } = initialApValues;
      const levelsGained = endLevel - startLevel;
      

      
      // Animate to current AP after a short delay
      setTimeout(() => {
        const duration = 1500;
        const startTime = Date.now();
        const startAp = preRaidAp;
        const endAp = currentPlayer.totalAp;
        
        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          
          // Throttle state updates to ~10fps instead of 60fps (100ms intervals)
          const now = Date.now();
          if (now - lastUpdateRef.current > 100) { // ~10fps - MUCH better for React!
            // Ease-out animation
            const easeOutProgress = 1 - Math.pow(1 - progress, 3);
            const newAp = Math.floor(startAp + ((endAp - startAp) * easeOutProgress));
            setAnimatedAp(newAp);
            lastUpdateRef.current = now;
            
          }
          
          if (progress < 1) {
            apAnimationRef.current = requestAnimationFrame(animate);
          } else {
            // Ensure we end at exact value
            setAnimatedAp(endAp);
            setHasAnimatedBase(true);
            apAnimationRef.current = null;
            
            // Show modal AFTER animation completes to prevent lag
            // Priority: Track Master → Rank/Division → Level
            // NEW: Use starTierUps to detect tier 2→3 transitions (boss-win based)
            const newMaster = starTierUps.find(t => t.newTier >= 3 && t.oldTier < 3);
            if (newMaster) {
              // New Track Master earned! (highest priority)
              setAnimationsPaused(true);
              setNewMasterOperation(newMaster.operation);
              // Get boss name from track status
              const masterStatus = trackStatuses.find(s => s.operation === newMaster.operation);
              setNewMasterBossName(masterStatus?.goalBossName ?? null);
              // Get next boss name (the one they just unlocked)
              const goalBossId = getGradeGoalBoss(currentPlayer?.grade ?? 0);
              const nextBossId = goalBossId + 1;
              const nextBossConfig = nextBossId <= 8 ? getBossConfig(nextBossId) : null;
              setNewMasterNextBossName(nextBossConfig?.name ?? null);
              setShowTrackMasterModal(true);
              // Store rank/level data for chaining
              if (rankChanged || divisionChanged) {
                // Will show rank modal after Track Master
              }
              if (levelsGained > 0) {
                setLevelUpFrom(startLevel);
                setLevelUpTo(endLevel);
                previousLevelRef.current = endLevel;
              }
            } else if ((rankChanged || divisionChanged) && raidStartRank !== null && (currentPlayer?.totalRaids || 0) > 1) {
              setAnimationsPaused(true);
              setShowRankModal(true);
              // Store level data for potential display after rank modal
              if (levelsGained > 0) {
                setLevelUpFrom(startLevel);
                setLevelUpTo(endLevel);
                previousLevelRef.current = endLevel;
              }
            } else if (levelsGained > 0) {
              // Only level change, no rank change
              setAnimationsPaused(true);
              setLevelUpFrom(startLevel);
              setLevelUpTo(endLevel);
              setShowLevelUpModal(true);
              previousLevelRef.current = endLevel;
            }
          }
        };
        
        apAnimationRef.current = requestAnimationFrame(animate);
      }, 500); // Small delay before starting animation
      
      return () => {
        if (apAnimationRef.current) {
          cancelAnimationFrame(apAnimationRef.current);
          apAnimationRef.current = null;
        }
      };
    }
  }, [currentPlayer, initialApValues, hasAnimatedBase]);
  
  // Animate bonus AP when chest is opened  
  useEffect(() => {
    if (chestOpened && bonusAp > 0 && currentPlayer) {
      // Always cleanup previous animation first
      if (apAnimationRef.current) {
        cancelAnimationFrame(apAnimationRef.current);
        apAnimationRef.current = null;
      }
      
      const startAp = animatedAp;
      const endAp = currentPlayer.totalAp;
      const startLevel = getLevelFromTotalAp(startAp).level;
      const endLevel = getLevelFromTotalAp(endAp).level;
      const levelsGained = endLevel - startLevel;
      
      // Only show modal if we haven't already shown it for this level
      const shouldShowModal = levelsGained > 0 && previousLevelRef.current < endLevel;
      
      const duration = 1000;
      const startTime = Date.now();
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Throttle state updates to ~10fps (100ms intervals)
        const now = Date.now();
        if (now - lastUpdateRef.current > 100) { // ~10fps - MUCH better for React!
          // Ease-out animation
          const easeOutProgress = 1 - Math.pow(1 - progress, 3);
          const newAp = Math.floor(startAp + ((endAp - startAp) * easeOutProgress));
          setAnimatedAp(newAp);
          lastUpdateRef.current = now;
          
        }
        
        if (progress < 1) {
          apAnimationRef.current = requestAnimationFrame(animate);
        } else {
          // Ensure we end at exact value
          setAnimatedAp(endAp);
          apAnimationRef.current = null;
          
          // Show modal AFTER animation completes
          if (shouldShowModal) {
            // Set states directly for immediate modal display
            setAnimationsPaused(true); // Pause all animations
            setLevelUpFrom(startLevel);
            setLevelUpTo(endLevel);
            setShowLevelUpModal(true);
            previousLevelRef.current = endLevel;
          }
        }
      };
      
      apAnimationRef.current = requestAnimationFrame(animate);
      
      return () => {
        if (apAnimationRef.current) {
          cancelAnimationFrame(apAnimationRef.current);
          apAnimationRef.current = null;
        }
      };
    }
  }, [chestOpened, bonusAp, currentPlayer?.totalAp, animatedAp]);
  
  const currentLevelInfo = getLevelFromTotalAp(animatedAp);
  const serverTotalAp = currentPlayer?.totalAp || 0;
  const targetLevelInfo = getLevelFromTotalAp(serverTotalAp);
  
  // Calculate continuous progress using cached values (prevents jumps)
  const totalProgress = useMemo(() => {
    if (!initialApValues || !currentPlayer) return 0;
    
    const { preRaidAp } = initialApValues;
    const totalRange = currentPlayer.totalAp - preRaidAp;
    
    if (totalRange <= 0) return 0;
    
    const progress = ((animatedAp - preRaidAp) / totalRange) * 100;
    return Math.min(Math.max(progress, 0), 100);
  }, [animatedAp, initialApValues, currentPlayer]);


  // Victory sparkles background effect
  const victorySparkles = useMemo(() => {
    const ENABLE_RESULTS_SPARKLES = false; // Perf: disable animated background sparkles in results
    if (!isVictory || !ENABLE_RESULTS_SPARKLES) return [] as Array<{ x: number; duration: number; delay: number }>;
    return Array.from({ length: 20 }, () => ({
      x: Math.random() * 100,
      duration: 3 + Math.random() * 2,
      delay: Math.random() * 2,
    }));
  }, [isVictory]);



  // IDIOMATIC: Helper to get player name from raid player
  const getPlayerName = (raidPlayer: typeof raidPlayers[0]) => {
    const isYou = currentPlayer && raidPlayer.playerId === currentPlayer.id;
    if (isYou) return "You";
    
    // Use denormalized name directly from raid_player
    return raidPlayer.playerName;
  };

  if (!currentRaid || !currentPlayer) {
    return null;
  }
  
  // Handle edge case - raid players might be cleaned up but we still show results
  if (raidPlayers.length === 0 && (currentRaid.state.tag === "Victory" || currentRaid.state.tag === "Failed")) {
    console.warn("ResultsScreen: No raid players found for completed raid - showing minimal UI");
    // Don't return null - still show the results screen with what we have
  }

  // Highlight card component for cleaner code
  const HighlightCard = ({ 
    icon, 
    title, 
    player, 
    value, 
    color,
    bgColor
  }: {
    icon: string;
    title: string;
    player: typeof raidPlayers[0];
    value: ReactNode;
    color: string;
    bgColor: string;
  }) => (
    <div
      className={`group flex items-center justify-between ${bgColor} rounded-lg p-4 border-2 ${color} transform-gpu transition-all duration-150 ease-out hover:scale-[1.01] hover:shadow-lg`}
      style={{ willChange: 'transform', transform: 'translateZ(0)' }}
      onMouseEnter={undefined}
    >
      <div className="flex items-center space-x-3 select-none">
        <span className="text-2xl">{icon}</span>
        <div>
          <span className="text-white font-medium font-game">{title}</span>
          <span className="text-white/50 ml-2">
            - {currentPlayer && player.playerId === currentPlayer.id ? "You" : getPlayerName(player)}
          </span>
        </div>
      </div>
      <div className={`${color.replace('border-', 'text-')} font-bold text-xl`}>{value}</div>
    </div>
  );

  // Personal stat card for cleaner code
  const StatCard = ({ label, value, subtext, color, delay }: {
    label: string;
    value: string | number;
    subtext: string;
    color: string;
    delay: number;
  }) => (
    <motion.div
      initial={false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, type: "spring" }}
      whileHover={{ scale: 1.05 }}
    >
      <p className="text-gray-400 text-sm ui-sc">{label}</p>
      <motion.p 
        className={`text-2xl font-bold ui-num ${color}`}
        initial={{ y: 20 }}
        animate={{ y: 0 }}
        transition={{ delay: delay + 0.1 }}
      >
        {value}
      </motion.p>
      <p className="text-xs text-gray-500">{subtext}</p>
    </motion.div>
  );



  // Simple hex to rgba converter for glows
  const hexToRgba = (hex: string, alpha: number): string => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result 
      ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`;
  };


  const openChest = async () => {
    setIsOpening(true);
    
    // Wait for shake animation to complete (0.6s - faster for repeat plays)
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Get server's pre-calculated bonus from raidPlayer
    const myRaidPlayer = raidPlayers.find(p => p.playerId === currentPlayer?.id);
    const serverBonus = myRaidPlayer?.pendingChestBonus || 0;
    
    // Map server bonus to display tier
    const getRewardFromBonus = (bonusAP: number) => {
      // Map AP amounts to rarities (must match server values)
      const rarityMap: Record<number, { tier: string; label: string; hex: string }> = {
        25:  { tier: 'common',    label: 'Common',    hex: '#9AA0A6' },
        50:  { tier: 'uncommon',  label: 'Uncommon',  hex: '#1EFF00' },
        75:  { tier: 'rare',      label: 'Rare',      hex: '#0070DD' },
        150: { tier: 'epic',      label: 'Epic',      hex: '#A335EE' },
        300: { tier: 'legendary', label: 'Legendary', hex: '#FF8000' },
      };
      
      const rarity = rarityMap[bonusAP] || rarityMap[25]; // Default to common
      
      // Get performance tag
      const myStats = raidPlayers.find(p => p.playerId === currentPlayer?.id);
      const accuracy = myStats && myStats.problemsAnswered > 0 
        ? Math.round((myStats.correctAnswers * 100) / myStats.problemsAnswered)
        : 0;
      
      const tag = (() => {
        if (isVictory && accuracy === 100) return 'Perfect Play';
        if (isVictory) return 'Victory!';
        if (myStats!.problemsAnswered >= 15) return 'Great Effort';
        return 'Good Try!';
      })();
      
      return {
        tier: rarity.tier,
        label: rarity.label,
        tag,
        color: '', // deprecated
        hex: rarity.hex,
        value: `+${bonusAP} Bonus Level Points!`,
        bonusAP
      };
    };
    
    const loot = getRewardFromBonus(serverBonus);
    
    // Set the display reward
    setReward(loot);
    setBonusAp(loot.bonusAP || 0);
    setChestOpened(true);
    setIsOpening(false);
    
    // Claim the chest bonus from server
    if (connection) {
      try {
        await connection.reducers.openLootChest({});
      } catch (err) {
        console.error('Failed to open loot chest:', err);
      }
    }
  };



  return (
    <div className="page-grid w-full">
      {/* Level Points Progress Bar - Clean, self-explanatory */}
      {currentPlayer && (
        <div className="span-12 mb-6">
          <div className="bg-black/40 rounded-xl p-4 border border-white/20 backdrop-blur-sm">
            {/* AP Bar */}
            <div className="relative h-8 bg-black/50 rounded-full overflow-hidden">
              {/* Background glow */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20" />
              
              {/* Animated AP fill - GPU-accelerated transform instead of width */}
              <div
                className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-blue-500 to-purple-500 transition-transform duration-[1500ms] ease-out will-change-transform origin-left"
                style={{ 
                  transform: `scaleX(${totalProgress / 100})`,
                  animationPlayState: animationsPaused ? 'paused' : 'running' 
                }}
              >
                {/* Shine effect - CSS animation for GPU acceleration */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shine"
                  style={{ animationPlayState: animationsPaused ? 'paused' : 'running' }}
                />
              </div>
              
              {/* AP text overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {totalApEarned > 0 && !chestOpened && (
                    <motion.span 
                      key="base"
                      className="text-lg font-bold text-white drop-shadow-lg"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      transition={{ delay: 0.5 }}
                    >
                      +{totalApEarned} Level Points
                    </motion.span>
                  )}
                  {chestOpened && bonusAp > 0 && (
                    <motion.span 
                      key="bonus"
                      className="text-lg font-bold text-amber-400 drop-shadow-lg"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                    >
                      +{bonusAp} Bonus Level Points
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
            
            {/* AP Breakdown & Timeback XP - Side by side, matching height */}
            <div className="mt-3 flex items-stretch gap-3 justify-center flex-wrap">
              {/* AP Breakdown - only show if there are bonuses worth breaking down */}
                {(() => {
                  // Match server logic: only count players who actually participated
                  const participatingPlayers = raidPlayers.filter(rp => rp.damageDealt > 0 || rp.problemsAnswered > 0);
                  const squadBonus = participatingPlayers.length > 1 ? 25 : 0;
                  // Quest bonuses: only show if JUST completed (transition from incomplete → complete)
                  const dailyJustCompleted = !raidStartDailyComplete && dailyComplete;
                  const weeklyJustCompleted = !raidStartWeeklyComplete && weeklyComplete;
                  const questBonus = (dailyJustCompleted ? DAILY_QUEST_REWARD : 0) + 
                                     (weeklyJustCompleted ? WEEKLY_QUEST_REWARD : 0);
                  const hasBonuses = squadBonus > 0 || questBonus > 0 || bonusAp > 0;
                
                // No bonuses = no breakdown pill (total already shown in progress bar)
                if (!hasBonuses) return null;
                
                const baseAp = (initialApValues?.totalToEarn ?? 0) - squadBonus - questBonus;
                  
                  return (
                  <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-gradient-to-b from-amber-500/15 to-amber-600/5 backdrop-blur-sm border border-amber-400/40">
                      <div className="text-left">
                        <p className="text-[10px] text-amber-300 ui-sc leading-none">Level Points This Raid</p>
                        <p className="text-sm font-extrabold text-white tabular-nums">
                          {(initialApValues?.totalToEarn ?? 0) + bonusAp}
                        </p>
                      </div>
                          <div className="h-4 w-px bg-white/20" />
                          <div className="text-left">
                            <p className="text-[10px] text-white/60 ui-sc leading-none">RAID</p>
                            <p className="text-sm font-bold text-white/90 tabular-nums">{baseAp}</p>
                          </div>
                      {squadBonus > 0 && (
                        <>
                          <div className="h-4 w-px bg-white/20" />
                          <div className="text-left">
                            <p className="text-[10px] text-white/60 ui-sc leading-none">SQUAD</p>
                            <p className="text-sm font-bold text-cyan-400 tabular-nums">+{squadBonus}</p>
                          </div>
                        </>
                      )}
                      {questBonus > 0 && (
                        <>
                          <div className="h-4 w-px bg-white/20" />
                          <div className="text-left">
                            <p className="text-[10px] text-white/60 ui-sc leading-none">QUEST</p>
                            <p className="text-sm font-bold text-purple-400 tabular-nums">+{questBonus}</p>
                          </div>
                        </>
                      )}
                {bonusAp > 0 && (
                  <>
                    <div className="h-4 w-px bg-white/20" />
                    <div className="text-left">
                      <p className="text-[10px] text-white/60 ui-sc leading-none">LOOT</p>
                      <p className="text-sm font-bold text-amber-400 tabular-nums">+{bonusAp}</p>
                    </div>
                  </>
                )}
              </div>
                );
              })()}
              
              {/* Timeback XP earned (if player has Timeback account OR dev mode) - side by side, matching style */}
              {(currentPlayer?.timebackId || import.meta.env.DEV) && currentRaid && (() => {
                // Calculate XP (same logic as server: 1 XP per focused minute)
                const duration_seconds = currentRaid.durationSeconds || 0;
                const myRaidPlayer = raidPlayers.find(rp => rp.playerId === currentPlayer.id);
                const accuracy = myRaidPlayer && myRaidPlayer.problemsAnswered > 0 ?
                  (myRaidPlayer.correctAnswers / myRaidPlayer.problemsAnswered) * 100 : 0;
                const cqpm = myRaidPlayer && duration_seconds > 0 ?
                  (myRaidPlayer.correctAnswers / duration_seconds) * 60 : 0;
                
                // Focus threshold: CQPM >= 2 AND accuracy >= 80%
                const earnedXP = (cqpm >= 2 && accuracy >= 80) ?
                  Math.min(duration_seconds / 60, 2.5).toFixed(1) : '0';
                
                return earnedXP !== '0' ? (
                  <div className="text-left px-3 py-1.5 rounded-lg bg-gradient-to-b from-emerald-500/15 to-emerald-600/5 backdrop-blur-sm border border-emerald-400/40">
                    <p className="text-[10px] text-emerald-300 ui-sc leading-none">TIMEBACK XP</p>
                    <p className="text-sm font-extrabold text-white tabular-nums">+{earnedXP}</p>
                  </div>
                ) : (
                  <div className="text-left px-3 py-1.5 rounded-lg bg-gradient-to-b from-amber-500/15 to-amber-600/5 backdrop-blur-sm border border-amber-400/40">
                    <p className="text-[10px] text-amber-300 ui-sc leading-none">TIMEBACK XP</p>
                    <p className="text-sm font-extrabold text-amber-400/80 tabular-nums">+0</p>
                    <p className="text-[10px] text-amber-200/70">
                      Need <span className="text-white/90">≥80%</span> accuracy <span className="text-amber-400/90">({accuracy.toFixed(0)}%)</span>
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      
      <div className="bg-black/40 rounded-2xl p-8 w-full shadow-2xl border border-white/10 relative overflow-hidden span-12">
      {/* Victory sparkles background effect */}
      {victorySparkles.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {victorySparkles.map((s, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-yellow-400 rounded-full"
              initial={{ x: `${s.x}%`, y: '110%', scale: 0 }}
              animate={{ 
                y: '-10%',
                scale: [0, 1.5, 0],
                opacity: [0, 1, 0]
              }}
              transition={{
                type: "tween",
                duration: s.duration,
                delay: s.delay,
                repeat: Infinity,
                ease: "linear"
              }}
            />
          ))}
        </div>
      )}

      {/* Result Header */}
      <div className="text-center mb-8 relative">
        <motion.div 
          className="text-6xl mb-4"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ 
            scale: 1,  // Spring to final scale
            rotate: 0  // Spring to final rotation
          }}
          transition={{ 
            type: "spring",
            stiffness: 120,  // Lower stiffness = more bounce
            damping: 10,      // Lower damping = more overshoot
            duration: 0.8
          }}
        >
          {isVictory ? '🏆' : (hpPercent >= 80 ? '🔥' : '💪')}
        </motion.div>
        
        {isVictory ? (
          <motion.h2 
            className="h1 mb-2 relative"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <span className="inline-block bg-gradient-to-r from-yellow-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent animate-pulse-subtle font-game">
              VICTORY!
            </span>
          </motion.h2>
        ) : (
          <h2 className="h2 mb-2 font-game">
            <span className={hpPercent >= 80 
              ? "bg-gradient-to-r from-orange-400 via-amber-500 to-orange-400 bg-clip-text text-transparent" 
              : hpPercent >= 50
              ? "bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent"
              : "bg-gradient-to-r from-purple-400 via-fuchsia-400 to-purple-400 bg-clip-text text-transparent"}>
              {pickDefeatMessage(totalDamageDealt, bossMaxHp, getBossConfig(bossLevel).name).header}
            </span>
          </h2>
        )}
        
        {/* First Clear / New Record Banner - Mastery Trials only */}
        {isVictory && isMasteryTrial && (isFirstClear || isNewRecord) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 200, damping: 15 }}
            className="mb-4"
          >
            {isFirstClear ? (
              <div className="inline-block bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border-2 border-amber-400/50 rounded-xl px-6 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🎉</span>
                  <div className="text-left">
                    <p className="text-amber-300 font-black text-lg uppercase tracking-wide font-game">
                      First Clear!
                    </p>
                    {nextBossConfig && (
                      <p className="text-amber-200/80 text-sm">
                        {nextBossConfig.name} unlocked!
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : isNewRecord && previousBestTime !== null ? (
              <div className="inline-block bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-2 border-cyan-400/50 rounded-xl px-6 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">⚡</span>
                  <div className="text-left">
                    <p className="text-cyan-300 font-black text-lg uppercase tracking-wide font-game">
                      New Record!
                    </p>
                    <p className="text-cyan-200/80 text-sm tabular-nums">
                      {previousBestTime}s → {raidDurationSeconds}s
                      <span className="text-green-400 ml-2">
                        (-{previousBestTime - raidDurationSeconds}s)
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </motion.div>
        )}

        {/* Damage PB Banner - Quick Play only */}
        {isNewDamagePb && myStats && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 200, damping: 15 }}
            className="mb-4"
          >
            <div className="inline-block bg-gradient-to-r from-red-500/20 to-orange-500/20 border-2 border-red-400/50 rounded-xl px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🔥</span>
                <div className="text-left">
                  <p className="text-red-300 font-black text-lg uppercase tracking-wide font-game">
                    New Personal Best!
                  </p>
                  <p className="text-red-200/80 text-sm tabular-nums">
                    {previousBestDamage > 0 ? (
                      <>
                        {damageRecordLabel}: {previousBestDamage.toLocaleString()} → {myStats.damageDealt.toLocaleString()}
                        <span className="text-green-400 ml-2">
                          (+{(myStats.damageDealt - previousBestDamage).toLocaleString()})
                        </span>
                      </>
                    ) : (
                      <>{damageRecordLabel}: {myStats.damageDealt.toLocaleString()} damage</>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        
        <motion.div 
          className="text-gray-300"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {isVictory ? (
            <p className="text-lg font-semibold text-white">
              {isSoloRaid 
                ? `You defeated ${getBossConfig(currentRaid?.bossLevel ?? 0).name} solo!` 
                : `${getBossConfig(currentRaid?.bossLevel ?? 0).name} has been defeated!`}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {/* HP Progress message */}
              <p className="text-lg font-semibold text-white">
                {pickDefeatMessage(totalDamageDealt, bossMaxHp, getBossConfig(bossLevel).name).body}
              </p>
              
              {/* Boss HP bar - classic remaining/max format */}
              <div className="w-48">
                <div className="h-3 rounded-full overflow-hidden bg-gray-700">
                  <div 
                    className="h-full transition-all duration-500 rounded-full"
                    style={{ 
                      width: `${((bossMaxHp - totalDamageDealt) / bossMaxHp) * 100}%`,
                      background: 'linear-gradient(to right, #22c55e, #16a34a)'
                    }}
                  />
                </div>
                <span className="text-sm text-gray-400 tabular-nums">
                  {(bossMaxHp - totalDamageDealt).toLocaleString()} / {bossMaxHp.toLocaleString()} HP
                </span>
              </div>
            </div>
          )}
        </motion.div>
        
      </div>

      {/* Rank/Division/Facts Progression */}
      {(showProgressSection || useTestData) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mb-8"
        >
          {/* Dev test button - Hidden for demos, use Cmd+D to toggle */}
          {import.meta.env.DEV && false && (
            <div className="mb-4 text-center">
              <button
                onClick={() => setTestScenario((prev) => (prev + 1) % 6)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm"
              >
                Test Scenario: {testScenario === 0 ? 'Real Data' : `Test ${testScenario}`}
              </button>
            </div>
          )}
          
          {/* Rank or Division Change (skip on first raid) */}
          {(displayData.rankChanged || displayData.divisionChanged) && raidStartRank !== null && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.7, type: "spring", stiffness: 100 }}
              className="mb-6"
            >
              <div className="relative">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-xl" />
                
                <div className="relative bg-black/60 backdrop-blur-sm rounded-2xl p-8 border-2 border-purple-500/30">
                  <motion.div
                    initial={{ y: -20 }}
                    animate={{ y: 0 }}
                    className="text-center"
                  >
                    <h3 className="text-3xl font-bold text-white mb-12 font-game">
                      {displayData.rankChanged 
                        ? (isRankImproved(displayData.raidStartRank, displayData.currentRank) ? '🎉 RANK UP!' : '🔄 Rank Update')
                        : (isDivisionImproved(displayData.raidStartDivision, displayData.currentDivision) ? '⭐ Division Up!' : '🔄 Division Update')}
                    </h3>
                    
                    {/* Visual progression */}
                    <div className="flex items-start justify-center gap-12">
                      {/* From */}
                      <div className="flex flex-col items-center">
                        <RankGem 
                          rank={displayData.raidStartRank as any || 'bronze'} 
                          size="lg" 
                          className={
                            (displayData.rankChanged && !isRankImproved(displayData.raidStartRank, displayData.currentRank)) ||
                            (displayData.divisionChanged && !displayData.rankChanged && !isDivisionImproved(displayData.raidStartDivision, displayData.currentDivision))
                            ? "" : "opacity-50"
                          } 
                        />
                        <p className={`mt-6 ${getRankColorClasses(displayData.raidStartRank).text} ${
                          (displayData.rankChanged && !isRankImproved(displayData.raidStartRank, displayData.currentRank)) ||
                          (displayData.divisionChanged && !displayData.rankChanged && !isDivisionImproved(displayData.raidStartDivision, displayData.currentDivision))
                          ? "font-bold" : "opacity-60"
                        }`}>
                          {(displayData.raidStartRank || 'bronze').toUpperCase()} 
                          <span className="text-white/60 ml-2">{displayData.raidStartDivision}</span>
                        </p>
                      </div>
                      
                      {/* Arrow - positioned to align with badge center */}
                      <motion.div
                        className="flex items-center justify-center"
                        initial={{ x: -10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.8, duration: 0.5 }}
                        style={{ height: '96px', marginTop: '0' }} // 96px matches the lg badge height
                      >
                        <span className="text-4xl text-purple-400">→</span>
                      </motion.div>
                      
                      {/* To */}
                      <motion.div 
                        className="flex flex-col items-center"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 1, type: "spring", stiffness: 200 }}
                      >
                        <RankGem 
                          rank={displayData.currentRank as any || 'bronze'} 
                          size="lg" 
                          className={
                            (displayData.rankChanged && !isRankImproved(displayData.raidStartRank, displayData.currentRank)) ||
                            (displayData.divisionChanged && !displayData.rankChanged && !isDivisionImproved(displayData.raidStartDivision, displayData.currentDivision))
                            ? "opacity-50" : ""
                          }
                        />
                        <p className={`mt-6 ${getRankColorClasses(displayData.currentRank).text} ${
                          (displayData.rankChanged && !isRankImproved(displayData.raidStartRank, displayData.currentRank)) ||
                          (displayData.divisionChanged && !displayData.rankChanged && !isDivisionImproved(displayData.raidStartDivision, displayData.currentDivision))
                          ? "opacity-60" : "font-bold"
                        }`}>
                          {(displayData.currentRank || 'bronze').toUpperCase()} 
                          <span className={`ml-2 ${
                            (displayData.rankChanged && !isRankImproved(displayData.raidStartRank, displayData.currentRank)) ||
                            (displayData.divisionChanged && !displayData.rankChanged && !isDivisionImproved(displayData.raidStartDivision, displayData.currentDivision))
                            ? "text-white/50" : "text-white/70"
                          }`}>{displayData.currentDivision}</span>
                        </p>
                      </motion.div>
                    </div>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          )}
          
          {/* Facts Mastered */}
          {displayData.factsGained > 0 && (
            <motion.div 
              className="mb-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: displayData.rankChanged || displayData.divisionChanged ? 1.5 : 0.7 }}
            >
              <div className="bg-gradient-to-r from-yellow-500/5 via-yellow-400/5 to-yellow-500/5 border border-yellow-500/30 rounded-lg p-4 shadow-[0_0_8px_rgba(250,204,21,0.15)]">
                <p className="text-center">
                  <span className="text-white/90 font-bold">✨ You mastered</span>
                  <span className="text-2xl font-black text-yellow-300 mx-2 drop-shadow-[0_0_4px_rgba(250,204,21,0.3)] font-game">
                    {displayData.factsGained}
                  </span>
                  <span className="text-white/90 font-bold">
                    new {displayData.factsGained === 1 ? 'fact' : 'facts'} this raid!
                  </span>
                </p>
                
                {/* Next goal message */}
                {!displayData.rankChanged && !displayData.divisionChanged && nextMilestone && (
                  <p className="text-center text-sm text-gray-400 mt-2">
                    {nextMilestone.factsNeeded} more {nextMilestone.factsNeeded === 1 ? 'fact' : 'facts'} until{' '}
                    {(() => {
                      const [rankPart, ...divisionParts] = nextMilestone.milestone.split(' ');
                      const division = divisionParts.join(' ');
                      return (
                        <>
                          <span className={getRankColorClasses(rankPart.toLowerCase() as any).text}>
                            {rankPart}
                          </span>
                          {division && <span className="text-white ml-1">{division}</span>}
                        </>
                      );
                    })()}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Damage Leaderboard - Show competitive results (multiplayer only) */}
      {isVictory && raidPlayers.length > 1 && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="mb-8"
          >
            <RaidDamageChart
              raidPlayers={raidPlayers}
              currentPlayerId={currentPlayer?.id}
              raidDurationSeconds={raidDurationSeconds}
              useMockData={useMockDamageChart}
            />
          </motion.div>
        </AnimatePresence>
      )}

      {/* Loot Chest - EVERYONE gets rewards! */}
      <div className="mb-8">
        <div className="bg-gray-900/30 backdrop-blur-md rounded-xl p-8 border border-white/10">
          <div className="text-center mb-6">
            <h3 className="text-2xl font-bold text-white mb-2 font-game">
              {isVictory ? '✨ Open Your Prize! ✨' : '🎁 Open Your Prize 🎁'}
            </h3>
            <p className="text-white/60 text-sm">Tap to open!</p>
          </div>
          <AnimatePresence mode="wait">
          {!chestOpened ? (
            <motion.div
              key="chest"
              className="flex justify-center py-8"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div className="relative inline-block">
                <motion.button
                  onClick={openChest}
                  disabled={!hasAnimatedBase || isOpening}
                  className="relative group"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                {/* Glow effect - only when not opening */}
                {!isOpening && (
                  <motion.div
                    className="absolute inset-0 rounded-full blur-xl pointer-events-none"
                    animate={{
                      scale: [1, 1.3, 1],
                      opacity: [0.7, 1, 0.7],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    style={{
                      background: isVictory 
                        ? 'radial-gradient(circle, rgba(255,215,0,0.6) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(200,200,220,0.4) 0%, transparent 70%)',
                      transform: 'translateZ(0)', // Force GPU layer
                    }}
                  />
                )}
                
                {/* The chest itself */}
                <motion.div
                  className="relative z-10 flex flex-col items-center group"
                  style={{ transform: 'translateZ(0)' }} // GPU acceleration
                  animate={isOpening ? {
                    x: [0, -8, 8, -12, 12, -8, 8, -4, 4, 0],
                    rotate: [0, -3, 3, -5, 5, -3, 3, -1, 1, 0],
                    scale: [1, 1.02, 1, 1.03, 1, 1.02, 1, 1.05, 1.15, 0],
                  } : {
                    y: [0, -5, 0],
                  }}
                  transition={isOpening ? {
                    duration: 0.6,
                    times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1],
                    ease: "easeInOut",
                  } : {
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  {/* Chest emoji - big and prominent - everyone gets a gift! */}
                  <span className="text-8xl mb-2 drop-shadow-2xl relative z-10 transition-transform duration-300 group-hover:scale-110">
                    🎁
                  </span>
                  
                  {/* Sparkles around the chest - stop during opening */}
                  {!isOpening && (
                    <motion.div
                      className="absolute inset-0 pointer-events-none z-20"
                      animate={{
                        rotate: [0, 360],
                      }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                    >
                      <Sparkles size={20} className="absolute top-0 left-1/2 -translate-x-1/2 text-yellow-300 opacity-60" />
                      <Sparkles size={16} className="absolute bottom-0 right-0 text-yellow-300 opacity-40" />
                      <Sparkles size={18} className="absolute top-1/2 left-0 text-yellow-300 opacity-50" />
                    </motion.div>
                  )}
                  {/* Glow effect behind chest */}
                  {!isOpening && (
                    <motion.div
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 transition-transform duration-300 group-hover:scale-125"
                      animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.9, 1.1, 0.9] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <div className="w-40 h-40 bg-yellow-400/30 blur-3xl rounded-full" />
                    </motion.div>
                  )}
                </motion.div>
              </motion.button>
              </motion.div>
            </motion.div>
            ) : (
              <motion.div
                key="reward"
                className="text-center relative flex justify-center py-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                style={{ perspective: '1000px' }}
              >
                <RewardParticles tier={reward?.tier || ''} />
                <motion.div
                  className={`inline-block p-8 rounded-2xl bg-gray-900/95 relative overflow-hidden`}
                  initial={{ scale: 0, opacity: 0, rotateY: -90 }}
                  animate={{ 
                    opacity: 1, 
                    scale: 1,  // Steady state (spring handles overshoot on entry)
                    rotateY: mousePosition.x * 10 - 5,
                    rotateX: -(mousePosition.y * 10 - 5),
                  }}
                  whileHover={{
                    scale: 1.05,
                    transition: { duration: 0.2 }
                  }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = (e.clientX - rect.left) / rect.width;
                    const y = (e.clientY - rect.top) / rect.height;
                    setMousePosition({ x, y });
                  }}
                  onMouseLeave={() => {
                    setMousePosition({ x: 0.5, y: 0.5 });
                  }}
                  transition={{ 
                    type: "spring",
                    damping: 8,       // Lower = more overshoot on entry
                    stiffness: 150,   // Slightly softer for more bounce
                  }}
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: 'translateZ(0)',
                    border: `3px solid ${reward?.hex || '#4B5563'}`,  // Thicker border
                    boxShadow: [
                      `${(mousePosition.x - 0.5) * 20}px ${(mousePosition.y - 0.5) * 20}px 40px rgba(0,0,0,0.3)`,
                      reward?.hex ? (
                        reward.tier === 'legendary' 
                          ? `0 0 30px ${hexToRgba(reward.hex, 0.7)}, 0 0 60px ${hexToRgba(reward.hex, 0.4)}, inset 0 0 30px ${hexToRgba(reward.hex, 0.15)}`
                          : reward.tier === 'epic'
                          ? `0 0 25px ${hexToRgba(reward.hex, 0.5)}, 0 0 40px ${hexToRgba(reward.hex, 0.3)}, inset 0 0 20px ${hexToRgba(reward.hex, 0.1)}`
                          : reward.tier === 'rare'
                          ? `0 0 20px ${hexToRgba(reward.hex, 0.4)}, 0 0 30px ${hexToRgba(reward.hex, 0.2)}, inset 0 0 15px ${hexToRgba(reward.hex, 0.08)}`
                          : reward.tier === 'uncommon'
                          ? `0 0 15px ${hexToRgba(reward.hex, 0.3)}, 0 0 25px ${hexToRgba(reward.hex, 0.15)}`
                          : `0 0 15px rgba(255, 255, 255, 0.15), 0 0 25px rgba(255, 255, 255, 0.08)`
                      ) : `0 0 15px rgba(255, 255, 255, 0.15), 0 0 25px rgba(255, 255, 255, 0.08)`
                    ].join(', '),
                  }}
                >
                  {/* Holographic shine overlay for rare+ cards */}
                  {(reward?.tier === 'legendary' || reward?.tier === 'epic' || reward?.tier === 'rare') && (
                    <div
                      className="absolute inset-0 pointer-events-none opacity-30"
                      style={{
                        background: `radial-gradient(circle at ${mousePosition.x * 100}% ${mousePosition.y * 100}%, 
                          ${reward.hex}88 0%, 
                          transparent 40%)`,
                        mixBlendMode: 'screen',
                      }}
                    />
                  )}
                  
                  {/* Tier-specific icon */}
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", duration: 0.6 }}
                    className="mb-4"
                  >
                    <span className="text-5xl">
                      {reward?.tier === 'legendary' ? '👑' : 
                       reward?.tier === 'epic' ? '💜' :
                       reward?.tier === 'rare' ? '💎' :
                       reward?.tier === 'uncommon' ? '✨' :
                       '⭐'}
                    </span>
                  </motion.div>
                  {/* Tier label - the main focus */}
                  <motion.div 
                    className="mb-4"
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ 
                      y: 0, 
                      opacity: 1,
                      scale: (reward?.tier === 'legendary' || reward?.tier === 'epic') ? [1, 1.03, 1] : 1
                    }}
                    transition={
                      (reward?.tier === 'legendary' || reward?.tier === 'epic') 
                        ? { scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }, default: { delay: 0.1 } }
                        : { delay: 0.1 }
                    }
                  >
                    <span className="text-5xl font-black tracking-tight font-game" style={{ 
                      color: reward?.hex || '#9AA0A6',
                      textShadow: (reward?.tier === 'legendary' || reward?.tier === 'epic') && reward?.hex
                        ? `0 0 20px ${hexToRgba(reward.hex, 0.4)}` 
                        : undefined
                    }}>
                      {reward?.label?.replace(' Treasure', '')}
                    </span>
                  </motion.div>
                  {/* AP amount - show actual awarded bonus */}
                  <motion.div 
                    className="mb-4"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", bounce: 0.3, delay: 0.2 }}
                  >
                    <p className="text-4xl font-black text-white tabular-nums font-game">
                      +{reward?.bonusAP || 0} Level Points
                    </p>
                  </motion.div>
                  
                  {/* Performance context - subtle */}
                  {reward?.tag && (
                    <motion.p 
                      className="text-sm font-medium text-white/60 mb-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 }}
                    >
                      {reward.tag}
                    </motion.p>
                  )}
                  
                  {/* Rarity indicator - celebration not gambling */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="pt-3 border-t border-white/10"
                  >
                    {reward?.tier === 'legendary' && (
                      <p className="text-xs font-semibold text-orange-300 tracking-wide">
                        🎉 JACKPOT! 🎉
                      </p>
                    )}
                    {reward?.tier === 'epic' && (
                      <p className="text-xs font-semibold text-purple-300 tracking-wide">
                        ⚡ AWESOME! ⚡
                      </p>
                    )}
                    {reward?.tier === 'rare' && (
                      <p className="text-xs font-semibold text-blue-300 tracking-wide">
                        ✨ GREAT LOOT! ✨
                      </p>
                    )}
                    {reward?.tier === 'uncommon' && (
                      <p className="text-xs font-semibold text-green-300 tracking-wide">
                        💚 NICE! 💚
                      </p>
                    )}
                    {reward?.tier === 'common' && (
                      <p className="text-xs font-semibold text-gray-400 tracking-wide">
                        ⭐ CLAIMED! ⭐
                      </p>
                    )}
                  </motion.div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Highlights - Only show in multiplayer (comparison to yourself is meaningless) */}
      {raidPlayers.length > 1 && (
      <motion.div 
        className="bg-gray-900/80 rounded-lg p-6 mb-6 relative border border-gray-700/50"
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        style={{ contain: 'layout paint' }}
        layout
      >
        <h3 className="h3 text-white mb-4 relative ui-sc">Raid Highlights</h3>
        <div className="space-y-3 relative">
          {speedDemon && speedDemon.fastestAnswerMs < 100000 && (
            <HighlightCard
              icon="⚡"
              title="Lightning Fast!"
              player={speedDemon}
              value={<span className="ui-num">{(speedDemon.fastestAnswerMs / 1000).toFixed(2)}s</span>}
              color="border-yellow-400/40"
              bgColor="bg-yellow-500/5"
            />
          )}
          
          {damageDealer && (
            <HighlightCard
              icon="💪"
              title="Damage Leader!"
              player={damageDealer}
              value={<span className="ui-num">{damageDealer.damageDealt}</span>}
              color="border-red-400/40"
              bgColor="bg-red-500/5"
            />
          )}
          
          {accuracyAce && (() => {
            const accuracy = Math.round((accuracyAce.correctAnswers / accuracyAce.problemsAnswered) * 100);
            
            // Dynamic title and icon based on accuracy level
            const getAccuracyTitle = () => {
              if (accuracy === 100) return { icon: "🎯", title: "Perfect Score" };
              if (accuracy >= 90) return { icon: "⭐", title: "Super Accurate" };
              if (accuracy >= 80) return { icon: "✨", title: "Great Focus" };
              if (accuracy >= 70) return { icon: "🎪", title: "Good Aim" };
              return { icon: "📚", title: "Best Accuracy" };
            };
            
            const { icon, title } = getAccuracyTitle();
            
            return (
              <HighlightCard
                icon={icon}
                title={title}
                player={accuracyAce}
                value={
                  <span className="ui-num">{accuracy}%</span>
                }
                color="border-green-400/40"
                bgColor="bg-green-500/5"
              />
            );
          })()}
        </div>
      </motion.div>
      )}

      {/* Personal Stats - DPS Focus */}
      {myStats && currentRaid && (
        <div 
          className="bg-gray-900/80 rounded-lg p-6 mb-6 border border-gray-700/50"
          style={{ contain: 'layout paint' }}
        >
          <h3 className="text-2xl font-bold text-white uppercase tracking-wide mb-6">
            Performance
          </h3>
          
          {/* DPS Hero - The King Metric */}
          <div className="pb-8 mb-6 border-b border-gray-700/50 text-center relative">
            <div className="text-sm text-gray-400 uppercase tracking-widest mb-3 font-semibold">
              Damage Per Second
            </div>
            <div className="relative inline-block">
              {/* Glow effect */}
              <div className="absolute inset-0 blur-xl bg-yellow-500/15 scale-110" />
              {/* Number with gradient */}
              <div className="relative text-[120px] font-black leading-none bg-gradient-to-b from-yellow-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent tabular-nums" 
                   style={{ textShadow: '0 4px 8px rgba(251, 191, 36, 0.25)' }}>
                {(raidDurationSeconds > 0 ? myStats.damageDealt / raidDurationSeconds : 0).toFixed(1)}
              </div>
            </div>
          </div>
          
          {/* Stats Table - Simple 2x3 grid */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-8">
            {/* Row 1 */}
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">
                Speed Score
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {(raidDurationSeconds > 0 ? (myStats.correctAnswers / raidDurationSeconds) * 60 : 0).toFixed(1)}
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">
                Accuracy
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {myStats.problemsAnswered > 0 ? Math.round((myStats.correctAnswers / myStats.problemsAnswered) * 100) : 0}%
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">
                Time
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {(() => {
                  const duration = Math.floor(raidDurationSeconds);
                  const mins = Math.floor(duration / 60);
                  const secs = duration % 60;
                  return `${mins}:${secs.toString().padStart(2, '0')}`;
                })()}
              </div>
            </div>
            
            {/* Row 2 */}
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">
                Total Damage
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {myStats.damageDealt.toLocaleString()}
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">
                Correct
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {myStats.correctAnswers}
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">
                Answered
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {myStats.problemsAnswered}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Solo Boss Selector */}
      {isSoloRaid && currentRaid && selectedSoloBoss !== null && (() => {
        // Hoist isAdaptive check once for the entire block (React best practice 7.4)
        const isAdaptive = isAdaptiveBoss(currentRaid.bossLevel);
        const bossIcon = BOSS_ICONS[selectedSoloBoss];
        
        return (
        <div className="mb-4 relative" ref={bossSelectorRef}>
          <div
            onClick={() => setShowBossSelector(!showBossSelector)}
            className="w-full flex items-center justify-between bg-gradient-to-r from-red-900/30 to-orange-900/20 rounded-xl px-4 py-3 border border-red-500/20 cursor-pointer hover:border-red-400/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              {bossIcon && (() => {
                const BossIcon = bossIcon.icon as React.ComponentType<{ className?: string }>;
                return <BossIcon className={`w-4 h-4 ${bossIcon.color}`} />;
              })()}
              <span className="text-white/60 text-sm">Next Boss:</span>
              <span className="text-white font-semibold text-sm">
                {getBossConfig(selectedSoloBoss).name}
              </span>
              <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${showBossSelector ? 'rotate-180' : ''}`} />
            </div>
            {isAdaptive ? (
              <span className="px-2 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 text-xs font-medium">
                Adaptive
              </span>
            ) : (
              <span className="text-red-400 text-sm font-bold tabular-nums">
                {(BOSS_HP[selectedSoloBoss] ?? 0).toLocaleString()} HP
              </span>
            )}
          </div>
          
          {/* Dropdown */}
          {showBossSelector && (() => {
            const bossOptions = isAdaptive
              ? [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(id => unlockedBosses[id])
              : [1, 2, 3, 4, 5, 6, 7, 8].filter(id => unlockedBosses[id]);
            
            return (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-blue-500/30 rounded-xl p-2 z-50 shadow-xl">
                {bossOptions.map(id => {
                  const boss = BOSS_ICONS[id];
                  const BossIcon = boss.icon as React.ComponentType<{ className?: string }>;
                  return (
                    <button
                      key={id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSoloBoss(id);
                        if (isAdaptive) {
                          localStorage.setItem(BOSS_PREF_KEY, String(id));
                        }
                        setShowBossSelector(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        selectedSoloBoss === id ? 'bg-blue-500/20 border border-blue-400/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <BossIcon className={`w-4 h-4 ${boss.color}`} />
                      <span className="text-white">{BOSS_CONFIG[id]?.name}</span>
                      {!isAdaptive && (
                        <span className="text-red-400/70 text-xs ml-auto mr-2">
                          {(BOSS_HP[id] ?? 0).toLocaleString()} HP
                        </span>
                      )}
                      {selectedSoloBoss === id && <span className="text-emerald-400 text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* Action Buttons */}
      <div className="space-y-3">
        <motion.button
          onClick={isSoloRaid 
            ? () => {
              // Encode boss level: adaptive uses 100+visual to preserve adaptive HP with visual choice
              const isAdaptive = currentRaid && isAdaptiveBoss(currentRaid.bossLevel);
              const encodedLevel = selectedSoloBoss != null
                ? (isAdaptive ? 100 + selectedSoloBoss : selectedSoloBoss)
                : undefined;
              soloAgain(encodedLevel);
            }
            : () => {
              raidAgain();  // Transition raid to Rematch state
              setShowRaidAgainModal(true);  // Show modal for this player
            }
          }
          className={`w-full p-4 text-white font-bold rounded-lg shadow-lg relative overflow-hidden ${
            isVictory 
              ? 'bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600' 
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
          }`}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.0 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isVictory && (
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
            />
          )}
          <span className="relative text-lg flex items-center justify-center gap-2">
            {isVictory ? '🏆 Raid Again!' : '⚔️ Raid Again'}
          </span>
        </motion.button>
        
        <motion.button
          onClick={leaveRaid}
          className="w-full p-4 bg-gray-700/50 hover:bg-gray-600/50 text-white font-bold rounded-lg backdrop-blur-sm border border-white/10"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Back to Lobby
        </motion.button>
      </div>
    </div>
    
    {/* Track Master Modal - Priority 0 */}
    {showTrackMasterModal && newMasterOperation && (
      <TrackMasterModal
        operation={newMasterOperation}
        bossName={newMasterBossName ?? undefined}
        nextBossName={newMasterNextBossName ?? undefined}
        onClose={() => {
          setShowTrackMasterModal(false);
          // Chain to rank if changed (skip if first raid)
          if ((rankChanged || divisionChanged) && raidStartRank !== null && (currentPlayer?.totalRaids || 0) > 1) {
            setShowRankModal(true);
          } else if (levelUpFrom !== null && levelUpTo !== null) {
            setShowLevelUpModal(true);
          } else {
            setAnimationsPaused(false);
          }
        }}
      />
    )}
    
    {/* Rank Up Modal - Priority 1 */}
    {(showRankModal || forceShowRankModal) && (
      <RankUpModal
        oldRank={forceShowRankModal ? testRankData.oldRank : raidStartRank}
        newRank={forceShowRankModal ? testRankData.newRank : currentPlayer?.rank}
        oldDivision={forceShowRankModal ? testRankData.oldDivision : raidStartDivision}
        newDivision={forceShowRankModal ? testRankData.newDivision : currentDivision}
        onClose={() => {
          setForceShowRankModal(false);
          setShowRankModal(false);
          // Chain to level modal if it was staged
          if (levelUpFrom !== null && levelUpTo !== null) {
            setShowLevelUpModal(true);
          } else {
            setAnimationsPaused(false);
          }
        }}
      />
    )}
    
    {/* Level Up Modal - Priority 2 */}
    <AnimatePresence>
      {showLevelUpModal && levelUpFrom && levelUpTo && (
        <LevelUpModalSimple
          oldLevel={levelUpFrom}
          newLevel={levelUpTo}
          currentAp={animatedAp}
          onDismiss={() => {
            setShowLevelUpModal(false);
            setAnimationsPaused(false); // Resume animations after modal closes
          }}
        />
      )}
    </AnimatePresence>
    
    {/* Dev Test Buttons - Only in development */}
    {import.meta.env.DEV && (
      <div className="fixed top-4 right-4 z-[10000] flex gap-2">
        <button
          onClick={() => setUseMockDamageChart(!useMockDamageChart)}
          className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
        >
          Chart: {useMockDamageChart ? "Mock (8p)" : "Real"}
        </button>
        <button
          onClick={() => {
            const nextIndex = (scenarioIndex + 1) % rankTestScenarios.length;
            const nextScenario = rankTestScenarios[nextIndex];
            setTestRankData(nextScenario);
            setScenarioIndex(nextIndex);
            setForceShowRankModal(true);
          }}
          className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
        >
          Rank: {testRankData.label}
        </button>
        <button
          onClick={() => {
            setLevelUpFrom(5);
            setLevelUpTo(6);
            setAnimationsPaused(true);
            setShowLevelUpModal(true);
          }}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
        >
          Level: 5→6
        </button>
        <button
          onClick={() => {
            // Show rank first
            setTestRankData(rankTestScenarios[0]); // Bronze→Silver
            setForceShowRankModal(true);
            // Store level for chain
            setLevelUpFrom(5);
            setLevelUpTo(6);
          }}
          className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold shadow-lg transition-colors"
        >
          Both
        </button>
      </div>
    )}
    
    {/* Raid Again Modal */}
    {showRaidAgainModal && !isSoloRaid && currentRaid && (() => {
      // Compute once for the whole modal
      const currentRaidPlayers = raidPlayers.filter(rp => rp.raidId === currentRaid.id && rp.isActive);
      const myPlayer = currentRaidPlayers.find(rp => rp.playerId === currentPlayer?.id);
      const allReady = currentRaidPlayers.every(rp => rp.isReady);
      const leaderName = currentRaidPlayers.find(p => p.isLeader)?.playerName;
      
      return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
            className="bg-gradient-to-b from-indigo-900/40 to-slate-900/60 rounded-2xl p-6 sm:p-8 max-w-md w-full border border-indigo-500/20 shadow-xl shadow-indigo-500/10"
        >
          <h2 className="text-3xl font-bold text-white mb-6 text-center font-game">
            Ready for Another Raid?
          </h2>
          
            {/* Player ready states */}
            <div className="bg-black/20 rounded-xl p-4 mb-5 border border-indigo-500/20">
              <div className="space-y-2">
                {currentRaidPlayers.map((rp) => {
              const isMe = rp.playerId === currentPlayer?.id;
              return (
                <div 
                  key={rp.playerId}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg transition-all ${
                        rp.isReady
                          ? 'bg-emerald-500/10 border-l-4 border-emerald-400'
                          : isMe ? 'bg-white/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                        {rp.isLeader && <span className="text-yellow-400">👑</span>}
                    <span className="text-white font-semibold">{rp.playerName}</span>
                        {isMe && <span className="text-xs text-indigo-400">(You)</span>}
                  </div>
                  <div>
                    {rp.isReady ? (
                          <span className="text-emerald-400 text-lg">✓</span>
                    ) : (
                          <span className="text-gray-400 text-lg">⏳</span>
                    )}
                  </div>
                </div>
              );
            })}
              </div>
          </div>
          
            {/* Boss selector - all players see it, only leader can interact */}
            {currentRaid && (() => {
              // Hoist isAdaptive check once for the entire block (React best practice 7.4)
              const isAdaptive = isAdaptiveBoss(currentRaid.bossLevel);
              const displayBoss = isAdaptive ? selectedBossVisual : currentRaid.bossLevel;
              const bossIcon = BOSS_ICONS[displayBoss];
              
              return (
              <div className="mb-4 relative" ref={bossSelectorRef}>
                <div
                  onClick={() => myPlayer?.isLeader && setShowBossSelector(!showBossSelector)}
                  className={`w-full flex items-center justify-between bg-gradient-to-r from-red-900/30 to-orange-900/20 rounded-xl px-4 py-3 border border-red-500/20 ${
                    myPlayer?.isLeader ? 'cursor-pointer hover:border-red-400/40 transition-colors' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {bossIcon && (() => {
                      const BossIcon = bossIcon.icon as React.ComponentType<{ className?: string }>;
                      return <BossIcon className={`w-4 h-4 ${bossIcon.color}`} />;
                    })()}
                    <span className="text-white/60 text-sm">Next Boss:</span>
                    <span className="text-white font-semibold text-sm">
                      {getBossConfig(isAdaptive ? selectedBossVisual : currentRaid.bossLevel).name}
                    </span>
                    {myPlayer?.isLeader && (
                      <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${showBossSelector ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                  {/* Show HP badge for fixed raids, Adaptive badge for adaptive */}
                  {isAdaptive ? (
                    <span className="px-2 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 text-xs font-medium">
                      Adaptive
                    </span>
                  ) : (
                    <span className="text-red-400 text-sm font-bold tabular-nums">
                      {((BOSS_HP[currentRaid.bossLevel] ?? 0) * currentRaidPlayers.length).toLocaleString()} HP
                    </span>
                  )}
                </div>
                
                {/* Dropdown - leader only */}
                {showBossSelector && myPlayer?.isLeader && (() => {
                  const bossOptions = isAdaptive
                    ? [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(id => unlockedBosses[id])
                    : [1, 2, 3, 4, 5, 6, 7, 8].filter(id => unlockedBosses[id]);
                  const currentSelection = isAdaptive ? selectedBossVisual : currentRaid.bossLevel;
                  
              return (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-blue-500/30 rounded-xl p-2 z-50 shadow-xl">
                      {bossOptions.map(id => {
                        const boss = BOSS_ICONS[id];
                        const BossIcon = boss.icon as React.ComponentType<{ className?: string }>;
                        return (
                          <button
                            key={id}
                            onClick={() => {
                              if (isAdaptive) {
                                setBossVisual(id);
                                localStorage.setItem(BOSS_PREF_KEY, String(id));
                              } else {
                                setMasteryBoss(id);
                              }
                              setShowBossSelector(false);
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                              currentSelection === id ? 'bg-blue-500/20 border border-blue-400/30' : 'hover:bg-white/5'
                            }`}
                          >
                            <BossIcon className={`w-4 h-4 ${boss.color}`} />
                            <span className="text-white">{BOSS_CONFIG[id]?.name}</span>
                            {!isAdaptive && (
                              <span className="text-red-400/70 text-xs ml-auto mr-2">
                                {((BOSS_HP[id] ?? 0) * currentRaidPlayers.length).toLocaleString()} HP
                              </span>
                            )}
                            {currentSelection === id && <span className="text-emerald-400 text-xs">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              );
            })()}
            
            {/* Status message for non-leaders */}
            {!myPlayer?.isLeader && allReady && leaderName && (
                <p className="text-center text-yellow-400 text-sm mb-4 animate-pulse">
                  Waiting for {leaderName} to start...
                </p>
            )}
          
          {/* Action buttons */}
          <div className="space-y-3">
              {/* Non-leader: simple ready toggle */}
              {!myPlayer?.isLeader && (
                    <button
                      onClick={() => connection?.reducers.toggleReady({})}
                  className={`w-full py-4 rounded-xl font-bold text-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] ${
                      myPlayer?.isReady
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400'
                      : 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 hover:bg-indigo-400'
                    }`}
                  >
                  {myPlayer?.isReady ? "READY ✓" : "READY!"}
                  </button>
              )}
                  
              {/* Leader: 3-step flow */}
              {myPlayer?.isLeader && (
                <>
                  {/* Step 1: Ready button (until leader is ready) */}
                  {!myPlayer?.isReady && (
                    <button
                      onClick={() => connection?.reducers.toggleReady({})}
                      className="w-full py-4 rounded-xl font-bold text-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 hover:bg-indigo-400 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                      READY!
                    </button>
                  )}
                  
                  {/* Step 2: After leader ready - waiting for others */}
                  {myPlayer?.isReady && !(allReady && currentRaidPlayers.length >= 2) && (
                    <button
                      onClick={() => connection?.reducers.toggleReady({})}
                      className="w-full py-4 rounded-xl font-bold text-xl bg-emerald-600/50 text-white/90 border border-emerald-500/30 hover:bg-emerald-600/40 transition-all"
                    >
                      READY ✓ <span className="text-white/50 text-sm font-normal ml-2">tap to unready</span>
                    </button>
                  )}
                  
                  {/* Step 3: Everyone ready - START! */}
                  {myPlayer?.isReady && allReady && currentRaidPlayers.length >= 2 && (
                    <div className="space-y-2">
                      <button
                        onClick={() => connection?.reducers.startRematch({})}
                        className="w-full py-4 rounded-xl font-bold text-xl bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-lg shadow-emerald-500/40 hover:from-emerald-400 hover:to-green-300 animate-pulse hover:animate-none hover:scale-[1.02] active:scale-[0.98] transition-all"
                      >
                        ⚔️ START RAID!
                      </button>
                      <button
                        onClick={() => connection?.reducers.toggleReady({})}
                        className="w-full text-white/40 hover:text-white/60 text-sm transition-colors"
                      >
                        wait, not ready
                      </button>
                    </div>
                  )}
                </>
                  )}
                  
                  {/* If alone, offer solo conversion */}
                  {currentRaidPlayers.length === 1 && (
              <button
                onClick={() => {
                  setShowRaidAgainModal(false);
                    soloAgain();
                }}
                  className="w-full py-4 rounded-xl font-bold text-lg bg-yellow-600 hover:bg-yellow-500 text-white shadow-lg shadow-yellow-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                Everyone Left - Start Solo
                    </button>
                  )}
            
              {/* Back button */}
            <button
              onClick={() => setShowRaidAgainModal(false)}
                className="w-full py-3 rounded-xl font-bold bg-gray-700/50 hover:bg-gray-600/50 text-white/80 border border-gray-600/30 transition-all"
            >
              ← Back to Results
            </button>
          </div>
        </motion.div>
      </div>
      );
    })()}
    </div>
  );
} 