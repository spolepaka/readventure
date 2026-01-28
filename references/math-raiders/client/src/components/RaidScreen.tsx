import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Application, extend } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { Graphics, Container, Text, TextStyle } from 'pixi.js';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { useShallow } from 'zustand/react/shallow';
import { Operation } from '../spacetime';
import type { Infer } from 'spacetimedb';
import { OPERATION_SYMBOLS, type OperationType } from '../constants/operationSymbols';
import { ParticleSystem } from '../game/systems/ParticleSystem';
import { PixiParticleRenderer } from '../game/systems/PixiParticleRenderer';
import { Identity } from 'spacetimedb';
import { useGameSounds } from '@/hooks/useGameSounds';
import { useDamage, getUniqueDamageId } from '../contexts/DamageContext';
import { type DamageNumber } from './FloatingCombatText';
import { type BossInstance, getBossConfig, createBoss } from '../game/bosses/bossConfig';
// useAnimationFrame removed - particle physics now in PixiJS ticker
import { useDamageCalculator } from '../hooks/useDamageCalculator';
import { SquadUIMotivational } from './SquadUIMotivational';
import { BossHealthBar } from './BossHealthBar';
import { BOSS_DIALOGUE, NOVA_DIALOGUE } from '../game/constants/bossDialogue';
import { useBossReaction, REACTION_PRIORITY } from '../hooks/useBossReaction';
import { useGameTimer } from '../hooks/useGameTimer';
import { AnswerInput } from './AnswerInput';
import { RaidTimer } from './RaidTimer';
import { PlayerHealthBar } from './PlayerHealthBar';

// Extend PIXI components for use with @pixi/react
extend({ Graphics, Container, Text });

// Answer feedback timing (ms)
// These control the "wrong answer → retry" flow
const FEEDBACK_MS = 2000;        // How long to show "7 × 8 = 56" (2s encoding time)
const PAUSE_MS = 700;            // Pause before retry - clears iconic memory, forces genuine recall
const TIMER_DELAY_MS = 150;      // Delay before timer starts (problem readable at ~150ms, strict but fair)

// Constants
const DAMAGE_COLORS = {
  FAST: 0xF5C84C,   // Soft gold for fastest hits
  MEDIUM: 0x22D3EE, // Electric cyan for solid hits
  NORMAL: 0xFFFFFF  // White for the rest
};

const COMBO_MILESTONES = {
  STARTER: 3,     // Everyone hits this
  BASIC: 5,       // Most hit this
  FIRE: 10,       // Achievable stretch
  UNSTOPPABLE: 15 // Hard but possible
};



export function RaidScreen() {
  // Data that changes frequently - use useShallow to prevent unnecessary re-renders
  const { currentRaid, currentProblem, raidPlayers, currentPlayer, raidClientStartTime } = useGameStore(
    useShallow(state => ({
      currentRaid: state.currentRaid,
      currentProblem: state.currentProblem,
      raidPlayers: state.raidPlayers,
      currentPlayer: state.currentPlayer,
      raidClientStartTime: state.raidClientStartTime
    }))
  );
  
  // Stable actions - can destructure directly
  // Use selectors to prevent re-renders
  const submitAnswer = useGameStore(state => state.submitAnswer);
  const leaveRaid = useGameStore(state => state.leaveRaid);
  const advanceToNextProblem = useGameStore(state => state.advanceToNextProblem);
  
  const connection = useGameStore(state => 
    state.connectionState.tag === 'connected' ? state.connectionState.conn : null
  );
  const playerId = useGameStore(state => state.playerId);
  
  // Sound hook
  const playSound = useGameSounds();
  
  // Raid music is handled by useBackgroundMusic hook in App.tsx
  
  const [answer, setAnswer] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [showFeedback, setShowFeedback] = useState<{ 
    correct: boolean; 
    speed: number;
    problem?: { left: number; right: number; answer: number; operation: string };
    message?: string;
  } | null>(null);
  
  // Use damage context instead of local state (damage system independent from boss)
  const { spawnDamage } = useDamage();

  // Motion primitives handled by Pure Pixi boss internally (shake/recoil/flash/shield all in Pixi)
  const bossContainerRef = useRef<HTMLDivElement>(null); // DOM ref for CSS animations only (jiggle/flash)
  
  const [combo, setCombo] = useState(0);
  const [showComboFlash, setShowComboFlash] = useState(false);
  const [screenShake, setScreenShake] = useState(0);
  const { bossReaction, showBossReaction, clearBossReaction } = useBossReaction();
  const [hpBarPulse, setHpBarPulse] = useState(false);
  
  // Server-authoritative damage - no client prediction (crits can't be predicted)
  
  // WebGL detection - Pixi v8 requires WebGL (no Canvas fallback)
  const webglSupported = useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return !!gl;
    } catch {
      return false;
    }
  }, []);
  
  // Device capability detection for PixiJS quality settings
  // Measures actual hardware, not device names - future-proof
  const pixiQuality = useMemo(() => {
    const nav = navigator as any;
    
    // Real capability signals (2025 browser APIs)
    const lowMemory = nav.deviceMemory && nav.deviceMemory < 4;  // < 4GB RAM
    const fewCores = navigator.hardwareConcurrency <= 4;         // Weak CPU
    const saveData = nav.connection?.saveData;                    // User opted lite mode
    
    const isLowEnd = lowMemory || fewCores || saveData;
    
    return {
      antialias: !isLowEnd,
      resolution: isLowEnd ? 1 : Math.min(window.devicePixelRatio, 2)
    };
  }, []);
  
  // Boss config derived from server's boss_level (no separate state needed)
  const bossLevel = currentRaid?.bossLevel ?? 0;
  const bossConfig = getBossConfig(bossLevel);
  
  // Nova (visual 7) uses growth mindset dialogue
  // bossLevel 107 = adaptive HP with Nova visual (100 + 7)
  const isNova = bossLevel === 7 || bossLevel === 107;
  const dialogue = isNova ? NOVA_DIALOGUE : BOSS_DIALOGUE;
  
  const [forceShowDots, setForceShowDots] = useState(false);
  const particleSystemRef = useRef<ParticleSystem>(new ParticleSystem());
  const [ripples, setRipples] = useState<{id: number, timestamp: number}[]>([]);
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeDelayRef = useRef<NodeJS.Timeout | null>(null); // Timer start delay for animation
  const hasSubmittedRef = useRef(false); // Track if user has submitted any answer this raid
  const lastRaidIdRef = useRef<bigint | null>(null);
  const [isRetrying, setIsRetrying] = useState(false); // Are they on their second chance for this problem?
  const [isPausing, setIsPausing] = useState(false); // Blank pause between feedback and retry (forces recall)
  const [problemAnimKey, setProblemAnimKey] = useState(0); // Bump to force problem re-animation on retry
  
  // Store answer metrics for when server damage arrives (keyed by problemId)
  // Needed because damageDealt event doesn't include responseTime or combo info
  const pendingAnswerMetricsRef = useRef<Map<string, { responseTime: number; isComboMilestone: boolean }>>(new Map());
  
  // Reset tracking when raid changes
  if (currentRaid?.id !== lastRaidIdRef.current) {
    lastRaidIdRef.current = currentRaid?.id ?? null;
    hasSubmittedRef.current = false;
    setIsRetrying(false);
    setIsPausing(false);
    setProblemAnimKey(0);
  }
  
  // Network lag indicator (show waiting state during slow responses)
  const [isWaiting, setIsWaiting] = useState(false);
  const waitingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track arena height for responsive DPS meter
  const [arenaHeight, setArenaHeight] = useState(280);
  const observerRef = useRef<ResizeObserver | null>(null);
  
  // Cache boss position to avoid layout thrash on every answer
  const bossPosRef = useRef({ x: 50, y: 50 });
  
  const arenaRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    
    if (!node) return;
    
    // Helper: Update cached boss position
    const updateBossPosition = () => {
      if (bossContainerRef.current) {
        const rect = bossContainerRef.current.getBoundingClientRect();
        bossPosRef.current = {
          x: ((rect.left + rect.width / 2) / window.innerWidth) * 100,
          y: ((rect.top + rect.height / 2) / window.innerHeight) * 100
        };
      }
    };
    
    // Calculate initial position (synchronous, before first answer)
    updateBossPosition();
    
    const observer = new ResizeObserver(entries => {
      if (entries.length > 0 && entries[0]) {
        setArenaHeight(entries[0].contentRect.height);
        updateBossPosition(); // Update on resize/zoom
      }
    });
    
    observer.observe(node);
    observerRef.current = observer;
  }, []); // Empty deps: setArenaHeight is stable, observer only needs to be created once per ref change
  
  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);
  
  // Reset waiting state when new problem arrives (server processed answer)
  useEffect(() => {
    if (waitingTimerRef.current) {
      clearTimeout(waitingTimerRef.current);
    }
    setIsWaiting(false);
  }, [currentProblem?.id]);
  
  // Cleanup waiting timer on unmount
  useEffect(() => {
    return () => {
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
      }
    };
  }, []);
  
  // ID counter to ensure unique keys
  const idCounterRef = useRef(0);
  const getUniqueId = () => ++idCounterRef.current;
  
  // Track ALL timeouts to prevent memory leaks
  const timeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set());

  // Use custom hook for speed tier and thresholds (damage calculated server-side)
  const { getSpeedTier, RESPONSE_TIME_LIMITS: LIMITS, getFastThreshold } = useDamageCalculator();
  
  // Override the RESPONSE_TIME_LIMITS constant with hook values
  const RESPONSE_TIME_LIMITS = LIMITS;

  // Memoize boss reaction styles to prevent recreation
  const bossReactionStyles = useMemo(() => ({
    sweat: new TextStyle({
      fontFamily: 'Impact, Arial Black, sans-serif',
      fontSize: 24,
      fontWeight: 'bold',
      fill: '#FFD700',
      stroke: { color: '#000000', width: 2 },
    }),
    laugh: new TextStyle({
      fontFamily: 'Impact, Arial Black, sans-serif',
      fontSize: 24,
      fontWeight: 'bold',
      fill: '#FF6B6B',
      stroke: { color: '#000000', width: 2 },
    })
  }), []);

  // Ref to hold latest showDamageEffect (avoids stale closure in event listener)
  const showDamageEffectRef = useRef<(damage: number, responseTime: number, isComboMilestone?: boolean) => void>(() => {});
  
  // Listen for server-confirmed damage to show damage numbers
  useEffect(() => {
    const handleDamageDealt = (event: CustomEvent<{ damage: number; problemId: bigint }>) => {
      const { damage, problemId } = event.detail;
      console.log('[DAMAGE EVENT] Received damageDealt:', damage);
      if (damage > 0) {
        // Look up the stored metrics for this problem (responseTime, isComboMilestone)
        const problemIdStr = problemId.toString();
        const metrics = pendingAnswerMetricsRef.current.get(problemIdStr);
        
        // Use real metrics if available, fallback to estimates
        const responseTime = metrics?.responseTime ?? 2000;
        const isComboMilestone = metrics?.isComboMilestone ?? false;
        
        // Clean up after use
        if (metrics) {
          pendingAnswerMetricsRef.current.delete(problemIdStr);
        }
        
        showDamageEffectRef.current(damage, responseTime, isComboMilestone);
      }
    };
    
    window.addEventListener('damageDealt', handleDamageDealt as EventListener);
    return () => window.removeEventListener('damageDealt', handleDamageDealt as EventListener);
  }, []);

  // Fallback: if no currentProblem but we're in an active raid, try to load from problems array
  useEffect(() => {
    if (currentRaid && !currentProblem && (currentRaid.state.tag === "InProgress" || currentRaid.state.tag === "Paused")) {
      const ourRaidPlayer = raidPlayers.find(rp => rp.playerId === playerId);
      
      if (ourRaidPlayer?.isActive) {
        // With batch prefetch, first check if we have problems locally
        const state = useGameStore.getState();
        if (state.problems.length > 0) {
          // Find first unanswered problem and set it
          const nextProblem = state.problems.find(p => p.sequence === state.currentProblemSequence + 1);
          if (nextProblem) {
            console.log('[FALLBACK] Loading next problem from local queue');
            state.advanceToNextProblem();
          } else {
            // Try sequence 1 (first problem)
            const firstProblem = state.problems.find(p => p.sequence === 1);
            if (firstProblem && !state.currentProblem) {
              console.log('[FALLBACK] Loading first problem from local queue');
              useGameStore.setState({ currentProblem: firstProblem, currentProblemSequence: 1 });
            }
          }
        }
        // With batch prefetch, if no local problems exist, hydration in gameStore handles it
      }
    }
  }, [currentRaid, currentProblem, raidPlayers, playerId]);

  // Single boss instance (type determined by bossConfig from server's boss_level)
  // Nystrom: Game engine owns game objects, not React state
  const bossRef = useRef<BossInstance | null>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);
  const pixiParticleRendererRef = useRef<PixiParticleRenderer | null>(null);
  
  // Track which boss level we've created (to detect changes mid-raid)
  const createdBossLevelRef = useRef<number | null>(null);

  // Boss creation helper - used by onInit and effect
  const createBossOnStage = useCallback((app: PIXI.Application) => {
    // Clean up old boss if exists
    bossRef.current?.destroy();
    
    const hp = currentRaid?.bossHp || 100;
    const maxHp = currentRaid?.bossMaxHp || 100;
    
    // Create new boss using factory
    bossRef.current = createBoss(bossLevel, 400, hp, maxHp);
    app.stage.addChild(bossRef.current.container);
    bossRef.current.registerWithApp(app);
    createdBossLevelRef.current = bossLevel;
  }, [bossLevel, currentRaid?.bossHp, currentRaid?.bossMaxHp]);

  // Effect: Handle boss level changes AFTER initialization
  // Initialization happens in onInit (where it belongs)
  useEffect(() => {
    const app = pixiAppRef.current;
    if (!app || !bossRef.current) return; // Not initialized yet
    if (createdBossLevelRef.current === bossLevel) return; // No change
    
    // Boss level changed mid-raid - recreate
    createBossOnStage(app);
  }, [bossLevel, createBossOnStage]);

  // HP is server-authoritative (no client prediction)
  const serverHp = currentRaid?.bossHp ?? 100;
  
  useEffect(() => {
    const maxHp = currentRaid?.bossMaxHp || 100;
    bossRef.current?.updateHealth(serverHp, maxHp);
  }, [serverHp, currentRaid?.bossMaxHp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      bossRef.current?.destroy();
      pixiParticleRendererRef.current?.destroy();
    };
  }, []);

  // Particle physics now updated inside PixiParticleRenderer.update() (one loop, not two)

  // Use RAF-based timer for 60fps smooth updates (no React re-renders)
  useGameTimer({
    startTime,
    enabled: !!currentProblem && startTime > 0,
    grade: currentPlayer?.grade ?? 4,
  });

  
  // Particles now rendered via Pure Pixi (no React state updates needed)

  // Start timer when new problem appears (with small delay for animation)
  // The 100ms delay accounts for problem animation - timer starts when kid can read
  useEffect(() => {
    console.log('[TIMER DEBUG] Effect fired, currentProblem?.id:', currentProblem?.id?.toString(), 'sequence:', currentProblem?.sequence);
    if (currentProblem) {
      setAnswer('');
      
      // Cancel any pending delay from previous problem
      if (startTimeDelayRef.current) {
        clearTimeout(startTimeDelayRef.current);
      }
      
      // Reset timer immediately (blocks submission during delay)
      setStartTime(0);
      
      // Start timer after animation delay (imperceptible but fair)
      startTimeDelayRef.current = setTimeout(() => {
        const now = Date.now();
        console.log('[TIMER DEBUG] Setting startTime to', now, 'for problem ID', currentProblem.id.toString(), 'sequence', currentProblem.sequence);
        setStartTime(now);
      }, TIMER_DELAY_MS);
      
      // Timer resets automatically via useGameTimer when startTime changes
      // AnswerInput has autoFocus - no manual focus needed
      // Don't reset combo here - let it persist across problems
    }
    
    // Cleanup on unmount or problem change
    return () => {
      if (startTimeDelayRef.current) {
        clearTimeout(startTimeDelayRef.current);
      }
    };
  }, [currentProblem?.id]); // Only watch problem ID, not feedback state

  // Track previous state for transition detection
  const prevStateRef = useRef<string | null>(null);
  
  // Show boss intro when Countdown → InProgress
  useEffect(() => {
    const currentState = currentRaid?.state.tag;
    const prevState = prevStateRef.current;
    
    // Detect Countdown → InProgress transition
    if (prevState === 'Countdown' && currentState === 'InProgress') {
      // Show boss intro phrase (dialogue already picks Nova vs regular based on bossLevel)
      showBossReaction('laugh', dialogue.RAID_START, REACTION_PRIORITY.TAUNT, 2500);
    }
    
    prevStateRef.current = currentState ?? null;
  }, [currentRaid?.state.tag, dialogue, showBossReaction]);
  
  // Reset combo and feedback when raid ends, destroy boss to stop heavy rendering
  useEffect(() => {
    if (currentRaid && currentRaid.state.tag === "Victory") {
      playSound('victory');
      setCombo(0);
      setShowFeedback(null);
      bossRef.current?.destroy(); // Stop boss animation during transition
      bossRef.current = null;
    } else if (currentRaid && currentRaid.state.tag === "Failed") {
      setCombo(0);
      setShowFeedback(null);
      bossRef.current?.destroy(); // Stop boss animation during transition
      bossRef.current = null;
    }
  }, [currentRaid?.state, playSound]);

  // Damage numbers clean themselves up via onAnimationComplete
  // No need for a cleanup interval!
  
  // Clean up feedback timeout on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);
  
  // Clean up ALL timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clear all tracked timeouts
      timeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      timeoutsRef.current.clear();
      // Clear any active boss reaction
      clearBossReaction();
    };
  }, [clearBossReaction]);
  
  // Helper to create tracked timeouts that auto-cleanup
  const setTrackedTimeout = useCallback((callback: () => void, delay: number) => {
    const timeout = setTimeout(() => {
      callback();
      timeoutsRef.current.delete(timeout);
    }, delay);
    timeoutsRef.current.add(timeout);
    return timeout;
  }, []);

  // Helper: Validate answer
  const validateAnswer = (answer: string): number | null => {
    const parsed = parseInt(answer);
    // Allow negative numbers for subtraction, but keep reasonable bounds
    if (isNaN(parsed) || parsed < -999 || parsed > 999) return null;
    return parsed;
  };

  // Helper: Calculate response metrics
  const calculateResponseMetrics = (startTime: number) => {
    const endTime = Date.now();
    const responseTime = Math.max(0, endTime - startTime);
    
    // Cap at max valid time instead of rejecting
    const cappedResponseTime = Math.min(responseTime, RESPONSE_TIME_LIMITS.MAX_VALID);
    
    return { responseTime: cappedResponseTime, endTime };
  };

  // Helper: Spawn particle burst (backwards compatibility)
  const spawnParticles = (x: number, y: number, count: number, color: number) => {
    particleSystemRef.current.spawn(x, y, count, color);
  };
  
  // Helper: Spawn enhanced particle effects
  const spawnEffect = (effectName: 'celebrate' | 'impact' | 'combo' | 'error' | 'magic', x: number, y: number) => {
    particleSystemRef.current.emit(effectName, x, y);
  };

  // Helper: Show damage effect
  const showDamageEffect = (damage: number, responseTime: number, isComboMilestone: boolean = false) => {
    const speedTier = getSpeedTier(responseTime, currentPlayer?.grade);
    
    // Use cached boss position (updated by ResizeObserver, not on every answer)
      spawnDamage({
        id: getUniqueDamageId(),
        value: damage,
      x: bossPosRef.current.x,
      y: bossPosRef.current.y,
        speedTier
      });
    
    // Trigger boss effects (single ref, all bosses have same interface!)
    // NOTE: Flash is triggered locally in handleSubmit for instant feedback
    if (bossRef.current) {
      // Flash already happened locally - just do recoil/shake here
      
      // Recoil on crits or combo milestones
      if (damage >= 80 || isComboMilestone) {
        const recoilAmount = Math.min(damage / 4, 20);
        bossRef.current.triggerRecoil(recoilAmount);
      }
      
      // Shake on big hits (crits)
      if (damage >= 80) {
        bossRef.current.triggerShake(damage / 15);
      }
    }
    
    // Apply CSS animations to container for the "jiggle" on every hit
    if (bossContainerRef.current) {
      bossContainerRef.current.classList.add('boss-jiggle', 'boss-damage-flash');
      setTrackedTimeout(() => {
        bossContainerRef.current?.classList.remove('boss-jiggle', 'boss-damage-flash');
      }, 300);  // Matches longest animation (jiggle 0.3s)
    }
    
    // Pulse health bar on damage - subtle feedback
    setHpBarPulse(true);
    setTrackedTimeout(() => setHpBarPulse(false), 300);
    
    // Spawn particles based on speed - use enhanced effects!
    const fastThreshold = getFastThreshold(currentPlayer?.grade ?? 4);
    if (responseTime < fastThreshold) {
      spawnEffect('impact', 400, 120); // Lightning fast hit at robot center
    } else {
      // Fallback to simple particles for medium/normal speed
      const particleCount = responseTime < RESPONSE_TIME_LIMITS.MEDIUM ? 12 : 8;
      const particleColor = speedTier === 'fast' ? DAMAGE_COLORS.FAST : 
                           speedTier === 'medium' ? DAMAGE_COLORS.MEDIUM : DAMAGE_COLORS.NORMAL;
      spawnParticles(400, 120, particleCount, particleColor);
    }
  };
  
  // Keep ref updated for event listener
  showDamageEffectRef.current = showDamageEffect;

  const handleSubmit = useCallback((submittedAnswer: string) => {
    if (!currentProblem || !startTime) return;
    
    // Start delayed waiting indicator (only shows if >350ms)
    // Server handles dedup via problem ID validation - we just show waiting state
    waitingTimerRef.current = setTimeout(() => {
      setIsWaiting(true);
    }, 350);
    
    // 1. Validate answer
    const answerToSubmit = submittedAnswer;
    const userAnswer = validateAnswer(answerToSubmit);
    if (userAnswer === null) {
      // Clear waiting timer on validation failure
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = null;
      }
      setShowFeedback({ correct: false, speed: 0, message: 'Enter a number! 🔢' });
      setAnswer('');
      return;
    }
    
    // 2. Calculate timing
    const metrics = calculateResponseMetrics(startTime);
    const { responseTime } = metrics;
    const isCorrect = userAnswer === currentProblem.answer;
    
    // 3. Update combo - NOW REQUIRES SPEED!
    let isComboMilestone = false;
    const fastThreshold = getFastThreshold(currentPlayer?.grade ?? 4);
    if (isCorrect && responseTime < fastThreshold) {
      // Only fast answers build combo
      const newCombo = combo + 1;
      setCombo(newCombo);
      
      // Milestone effects - triggers on all milestones and every 5 after 15
      isComboMilestone = 
        newCombo === COMBO_MILESTONES.STARTER ||
        newCombo === COMBO_MILESTONES.BASIC ||
        newCombo === COMBO_MILESTONES.FIRE ||
        newCombo === COMBO_MILESTONES.UNSTOPPABLE ||
        (newCombo > 15 && newCombo % 5 === 0);
        
      // Flash on EVERY fast answer, not just milestones
      setShowComboFlash(true);
      setTrackedTimeout(() => setShowComboFlash(false), 300);
      
      // Progressive particle effects for every fast answer
      const particleColor = newCombo >= 20 ? 0xA855F7 :  // Purple
                           newCombo >= 15 ? 0xFB923C :  // Orange
                           newCombo >= 11 ? 0xFACC15 :  // Yellow
                           newCombo >= 8 ? 0x22D3EE :   // Cyan
                           newCombo >= 5 ? 0x3B82F6 :   // Blue
                           0x60A5FA;                     // Light blue
      spawnParticles(400, 120, 3 + Math.min(newCombo, 15), particleColor);
      
      if (isComboMilestone) {
        // Much gentler screen shake
        const shakeIntensity = Math.min(3 + newCombo / 10, 8);
        setScreenShake(shakeIntensity);
        setTrackedTimeout(() => setScreenShake(0), 300);
        
        // Boss reacts to combo milestones
        const dialogues = newCombo >= 20 
          ? dialogue.COMBO_HIGH
          : newCombo >= 10 
          ? dialogue.COMBO_MID
          : dialogue.COMBO_LOW;
        showBossReaction('sweat', dialogues, 
          newCombo >= 20 ? REACTION_PRIORITY.COMBO_HIGH : REACTION_PRIORITY.COMBO_LOW,
          2000);
        
        // MEGA combo celebration!
        spawnEffect('combo', 400, 300);
      }
    } else {
      // Lose combo on wrong OR slow answers
      if (combo > 0 && isCorrect) {
        // Boss taunts when you break combo due to slowness (Nova encourages instead)
        showBossReaction('laugh', dialogue.COMBO_BREAK_SLOW, REACTION_PRIORITY.TAUNT, 2000);
      }
      setCombo(0);
    }
    
    // Correct answer - instant feedback (damage number comes from server via damageDealt event)
    if (isCorrect) {
      // Play sound feedback immediately
      playSound('correct');
      
      // Visual feedback - particles and boss effects (damage number waits for server)
      const fastThreshold = getFastThreshold(currentPlayer?.grade ?? 4);
      if (responseTime < fastThreshold) {
        spawnEffect('impact', 400, 120);
      } else {
        spawnParticles(400, 120, 8, 0xFFFFFF);
      }
      
      // Boss flash on hit - INSTANT local feedback (don't wait for server)
      bossRef.current?.triggerFlash(60);
      
      // CSS-based ripple effect (like the green glow)
      const rippleId = getUniqueId();
      setRipples(prev => [...prev, { id: rippleId, timestamp: Date.now() }]);
      setTrackedTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== rippleId));
      }, 800);
    }

    // Boss reactions to wrong answers only (speed reactions happen at combo milestones)
    if (!isCorrect) {
      // Play sound feedback
      playSound('wrong');
      
      // Wrong answer reactions (Nova encourages instead of taunting)
      showBossReaction('laugh', dialogue.WRONG_ANSWER, REACTION_PRIORITY.TAUNT, 1500);
      
      // Wrong answer visual effects (boss owns timing)
      bossRef.current?.triggerShield();
      
      // Blue shield particles that deflect outward
      // Use the particle system instead of manual particles
      spawnParticles(400, 120, 8, 0x00BFFF); // Cyan shield deflection
    }
    
    // 5. Show feedback (capture problem snapshot)
    const encouragements = ['Nice try! 💪', 'Almost! 🎯', 'So close! 🔥', 'Keep going! ⭐'];
    const feedbackState = { 
      correct: isCorrect, 
      speed: responseTime,
      problem: !isCorrect ? {
        left: currentProblem.leftOperand,
        right: currentProblem.rightOperand,
        answer: currentProblem.answer,
        operation: currentProblem.operation.tag // Extract tag from union type
      } : undefined,
      message: !isCorrect ? encouragements[Math.floor(Math.random() * encouragements.length)] : undefined
    };

    setShowFeedback(feedbackState);
    
    // Clear any existing feedback timeout to prevent overlap
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    
    // 6. Reset for next problem
    setAnswer('');
    hasSubmittedRef.current = true; // User has now submitted at least once
    
    // Track session for analysis
    const sessionData = (window as any).sessionData || { attempts: [] };
    const fact = `${currentProblem.leftOperand}×${currentProblem.rightOperand}`;
    sessionData.attempts.push({
      fact,
      correct: isCorrect,
      time: responseTime,
      answer: userAnswer
    });
    (window as any).sessionData = sessionData;
    
    // Compact log for analysis
    // Removed answer logging for privacy
    
    // 7. Store metrics for when server damage arrives (damageDealt event doesn't include these)
    if (isCorrect) {
      pendingAnswerMetricsRef.current.set(currentProblem.id.toString(), {
        responseTime,
        isComboMilestone
      });
    }
    
    // 8. Submit to server - trust SpacetimeDB to handle the rest
    console.log('[SUBMIT] Calling submitAnswer:', { problemId: currentProblem.id.toString(), answer: userAnswer, responseMs: responseTime });
    submitAnswer(currentProblem.id, userAnswer, responseTime);
    
    // 9. Handle advancement based on correctness and retry state
    //
    // Flow:
    //   CORRECT ────────────────────► advance to next problem
    //   WRONG (first) ──► retry same problem
    //   WRONG (retry) ──► give up, advance to next problem
    
    // Helper: clear waiting indicator and stop timer
    const clearWaitingState = () => {
      if (waitingTimerRef.current) {
        clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = null;
      }
      setIsWaiting(false);
      setStartTime(0);
    };
    
    if (isCorrect) {
      // Correct: advance immediately, show brief feedback overlay
      setIsRetrying(false);
      setIsPausing(false);
      advanceToNextProblem();
      feedbackTimeoutRef.current = setTimeout(() => {
        setShowFeedback(null);
      }, FEEDBACK_MS);
      
    } else if (isRetrying) {
      // Wrong on retry: they've had their chance, move on
      // Flow: feedback(2.5s) → pause(1s) → advance + unlock
      setIsRetrying(false);
      setIsPausing(false);
      clearWaitingState();
      
      feedbackTimeoutRef.current = setTimeout(() => {
        // Keep showFeedback (red input) during pause
        setTimeout(() => {
          advanceToNextProblem();
          setShowFeedback(null);  // Clear red when new problem appears
        }, PAUSE_MS);
      }, FEEDBACK_MS);
      
    } else {
      // Wrong first time: show answer, let them retry same problem
      // Flow: feedback(2.5s) → blank pause(1s) → re-animate → timer starts → input unlocks
      setIsRetrying(true);
      clearWaitingState();
      
      feedbackTimeoutRef.current = setTimeout(() => {
        // Clear feedback, start blank pause (forces recall, not copying)
        setShowFeedback(null);
        setIsPausing(true);  // Hide problem during pause
        
        setTimeout(() => {
          // After pause, show problem again
          setIsPausing(false);
          setProblemAnimKey(k => k + 1);  // Re-animate
          
          setTimeout(() => {
            setStartTime(Date.now());     // Fresh timer for retry
          }, TIMER_DELAY_MS);
        }, PAUSE_MS);
      }, FEEDBACK_MS);
      // Note: no advanceToNextProblem() - same problem stays
    }
  }, [currentProblem, startTime, answer, combo, submitAnswer, getSpeedTier, currentPlayer, advanceToNextProblem, isRetrying]);

  // Calculate boss HP percentage (server-authoritative)
  const displayHp = serverHp;
  const hpPercentage = currentRaid ? (displayHp / currentRaid.bossMaxHp) * 100 : 100;
  
  // IDIOMATIC: Get names from raid_player table (we don't subscribe to all players)
  const getPlayerName = (playerId: string) => {
    const raidPlayer = raidPlayers.find(rp => rp.playerId === playerId);
    return raidPlayer ? raidPlayer.playerName : 'Unknown';
  };

  // Get operation symbol
  const getOperationSymbol = (op: Infer<typeof Operation>) => {
    switch (op.tag) {
      case 'Add':
        return '+';
      case 'Subtract':
        return '−';  // Using proper minus sign
      case 'Multiply':
        return '×';
      case 'Divide':
        return '÷';
      default:
        return '×';
    }
  };

  // Boss drawing is now handled by the RobotBoss component



  // Early return if no raid data
  // During Countdown, problem won't exist yet - that's OK, CountdownOverlay covers the screen
  const isCountdown = currentRaid?.state.tag === 'Countdown';
  if (!currentRaid || (!currentProblem && !isCountdown)) {
    return (
      <div className="raid-frame max-w-2xl w-full">
          <div className="text-center p-8">
          <div className="mb-4">
            <div className="text-4xl animate-pulse">⚔️</div>
          </div>
            <p className="text-white/80 text-xl mb-2">Preparing battle calculations...</p>
            <p className="ui-muted text-sm">Get ready!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="raid-container h-full relative overflow-visible">
      {/* Leave Raid - fixed to viewport top-right, matching sound toggle positioning */}
      <button
        onClick={leaveRaid}
        className="fixed top-4 right-4 z-50 px-3 py-2 text-sm bg-red-900/30 hover:bg-red-900/50 text-red-300 rounded-lg transition-all hover:scale-105 border border-red-800/30 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
        aria-label="Leave raid and return to lobby"
      >
        Leave Raid
      </button>
      
      <div className="h-full max-w-4xl mx-auto p-2 flex flex-col gap-2 relative z-10">
        {/* Boss Unit Frame */}
        <div className="flex-shrink-0 w-full">
          <div className="raid-frame px-4 py-2 w-full">
            <div className="flex items-center justify-between">
              {/* Player HP bar - drains with raid time (self-contained, doesn't re-render parent) */}
              <div className="w-44 sm:w-52 lg:w-[300px] flex-shrink">
                <PlayerHealthBar
                  raidClientStartTime={raidClientStartTime}
                  bossLevel={bossLevel}
                  raidState={currentRaid?.state.tag ?? 'Matchmaking'}
                  playerName={currentPlayer?.name ?? 'Player'}
                />
              </div>
              
              {/* Boss health bar - centered */}
              <div className="flex-1 flex items-center justify-center">
                <BossHealthBar
                  currentHp={displayHp}
                  maxHp={currentRaid.bossMaxHp}
                  isPulsing={hpBarPulse}
                  bossName={bossConfig.name}
                />
              </div>
              
              {/* Right side: Streak (centered in space) + Timer (fixed right) */}
              <div className="w-40 sm:w-48 lg:w-[280px] flex-shrink-0 flex items-center">
                {/* Streak - takes available space, centers itself */}
                <div className="flex-1 flex justify-center">
                  <AnimatePresence>
                    {combo > 0 && (
                      <motion.div 
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ 
                          scale: showComboFlash ? 1.05 : 1,
                          opacity: 1
                        }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        className="text-center relative"
                      >
                        {/* Glow - starts at 1 (building), pops at milestones */}
                          <div 
                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-10 rounded-full transform-gpu"
                            style={{
                            background: combo >= 20 
                              ? 'radial-gradient(ellipse, rgba(168,85,247,0.25) 0%, transparent 60%)'
                              : combo >= 15 
                                ? 'radial-gradient(ellipse, rgba(251,146,60,0.2) 0%, transparent 60%)'
                                : combo >= 10
                                ? 'radial-gradient(ellipse, rgba(250,204,21,0.15) 0%, transparent 60%)'
                              : combo >= 5
                              ? 'radial-gradient(ellipse, rgba(34,211,238,0.12) 0%, transparent 60%)'
                              : combo >= 3
                              ? 'radial-gradient(ellipse, rgba(52,211,153,0.1) 0%, transparent 60%)'
                              : 'radial-gradient(ellipse, rgba(148,163,184,0.05) 0%, transparent 60%)'
                            }}
                          />
                        
                        <div className={`relative transition-all duration-200 transform-gpu ${
                          combo >= 20 ? 'text-2xl text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.6)]' :
                          combo >= 15 ? 'text-xl text-orange-400 drop-shadow-[0_0_6px_rgba(251,146,60,0.5)]' :
                          combo >= 10 ? 'text-xl text-yellow-400 drop-shadow-[0_0_5px_rgba(250,204,21,0.4)]' :
                          combo >= 5 ? 'text-lg text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.4)]' :
                          combo >= 3 ? 'text-lg text-emerald-300 drop-shadow-[0_0_3px_rgba(52,211,153,0.3)]' :
                          'text-base text-white/70'
                        }`}>
                          <div className="font-bold tabular-nums leading-none flex items-center justify-center gap-1">
                            {combo >= 20 ? '👑' : combo >= 15 ? '💥' : combo >= 10 ? '⚡' : combo >= 5 ? '🔥' : combo >= 3 ? '✨' : null}
                            {combo}
                          </div>
                          <div className="text-xs uppercase tracking-wide font-medium text-white/50">
                            streak
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* Timer - fixed on right */}
                <RaidTimer 
                  raidClientStartTime={raidClientStartTime}
                  raidState={currentRaid?.state.tag || 'Matchmaking'}
                  bossLevel={currentRaid?.bossLevel}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Boss Battle Arena - with integrated squad display */}
        <div ref={arenaRef} className="relative flex-1 min-h-[260px] [@media(min-height:800px)]:min-h-[280px] max-h-[500px] w-full raid-frame overflow-visible">
          
          {/* Dev: Dots toggle - opposite corner from DPS meter */}
          {import.meta.env.DEV && (
            <button
              onClick={() => setForceShowDots(!forceShowDots)}
              className={`absolute top-2 right-2 z-20 px-3 py-1 text-xs rounded-md transition-all hover:scale-105 border ${
                forceShowDots 
                  ? 'bg-yellow-900/80 text-yellow-300 border-yellow-600/70 shadow-lg' 
                  : 'bg-gray-900/80 text-gray-400 border-gray-700/50 hover:bg-gray-800/80'
              }`}
            >
              {forceShowDots ? '⏳ Dots ON' : '⏳ Dots'}
            </button>
          )}
          
          {/* Touch Number Pad - Bottom-right HUD element (in arena for absolute positioning) */}
          {/* Show only on pure touch devices, not 2-in-1s with keyboards/mice */}
          {('ontouchstart' in window || navigator.maxTouchPoints > 0) && 
           !window.matchMedia('(pointer: fine)').matches && (
            <motion.div 
              className="absolute bottom-4 right-4 z-20"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.5 }}
            >
              <div className="
                grid grid-cols-3 gap-2
                bg-slate-900/90
                backdrop-blur-sm
                border border-slate-700/50
                rounded-xl
                p-3
                shadow-2xl
              ">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0, '⌫'].map((key) => {
                  const handleKeyPress = () => {
                    // Haptic feedback - different for backspace vs digits (Android only)
                    if ('vibrate' in navigator) {
                      navigator.vibrate(key === '⌫' ? 20 : 10);
                    }
                    
                    if (key === '⌫') {
                      setAnswer(prev => prev.slice(0, -1));
                    } else {
                      // Digit: append to answer
                      const newAnswer = answer + key.toString();
                      setAnswer(newAnswer);
                      
                      // Auto-submit when length matches expected (same as keyboard)
                      if (currentProblem && newAnswer.trim() !== '') {
                        const parsed = parseInt(newAnswer, 10);
                        const expectedDigits = currentProblem.answer.toString().length;
                        const inputDigits = newAnswer.length;
                        
                        if (!isNaN(parsed) && inputDigits === expectedDigits) {
                          const problemIdAtSubmit = currentProblem.id;
                          setTimeout(() => {
                            if (currentProblem && currentProblem.id === problemIdAtSubmit) {
                              handleSubmit(newAnswer);
                            }
                          }, 30);
                        }
                      }
                    }
                  };
                  
                  return (
                  <button
                    key={key}
                    onClick={() => handleKeyPress()}
                    style={{
                      textShadow: '0 0 4px rgba(168,85,247,0.3)'
                    }}
                    className={`
                      h-14 w-14
                      ${key === 0 ? 'col-span-2 w-full' : ''}
                      text-2xl font-black
                      bg-slate-800
                      hover:bg-slate-700
                      active:bg-slate-900
                      border border-slate-700/50
                      rounded-lg
                      text-white
                      shadow-lg
                      transition-all duration-100
                      active:scale-90
                      active:brightness-110
                      select-none
                      transform-gpu
                    `}
                  >
                    {key}
                  </button>
                  );
                })}
              </div>
            </motion.div>
          )}
          
          {/* Squad UI - Motivational style for learning */}
          <SquadUIMotivational
            raidPlayers={raidPlayers}
            currentIdentity={connection?.identity?.toHexString()}
            getPlayerName={getPlayerName}
            currentRaid={currentRaid}
            raidClientStartTime={raidClientStartTime}
            arenaHeight={arenaHeight}
          />

          {/* Container for boss arena and damage numbers */}
          <div className="boss-arena relative w-full flex flex-col justify-center items-center" style={{ height: '100%', maxHeight: '500px' }}>
            {/* Pixi canvas - centered */}
            <div ref={bossContainerRef} className="flex-shrink-0 max-w-4xl w-full" style={{ height: 'auto' }}>
              {webglSupported ? (
              <Application 
                  width={800} 
                  height={320}  // Fixed logical size (all positions coded to this)
                  backgroundAlpha={0}  // Transparent - let UI background show through
                  clearBeforeRender={false}
                  antialias={pixiQuality.antialias}
                  resolution={pixiQuality.resolution}
                  className="w-full h-auto block"
                onInit={(app) => {
                  pixiAppRef.current = app;

                  // Belt + suspenders: ensure AccessibilitySystem is disabled at runtime too.
                  // (Pixi v8 can activate accessibility via Tab and installs document-level handlers.)
                  (app.renderer as any)?.accessibility?.setAccessibilityEnabled?.(false);
                  
                  // Particles - create immediately
                  pixiParticleRendererRef.current = new PixiParticleRenderer(particleSystemRef.current);
                  app.stage.addChild(pixiParticleRendererRef.current.getContainer());
                  pixiParticleRendererRef.current.registerWithApp(app);
                  
                  // Boss - create immediately (Nystrom: initialization in initializer)
                  createBossOnStage(app);
                }}
              >
              {/* All bosses now Pure Pixi - initialized in onInit, no React rendering */}
              
              {/* Boss Reaction Text */}
              {bossReaction && (
                <pixiText
                  text={bossReaction.text}
                  x={450}
                  y={85}
                  anchor={0.5}
                  alpha={0.9}
                  style={bossReactionStyles[bossReaction.type]}
                />
              )}



              {/* Particles rendered via Pure Pixi (no React state, 60fps in Pixi ticker) */}


              </Application>
              ) : (
                /* WebGL not available (e.g. Playcademy iframe bug) - animated emoji boss */
                <div className="w-full h-80 flex items-center justify-center">
                  <div className="text-8xl boss-emoji-idle">👹</div>
                </div>
              )}
            </div>
            
          </div>
        </div>

        {/* Problem Display OR Wrong Answer Feedback - Nintendo BIG! */}
        <div className="flex-shrink-0 w-full relative">
          <AnimatePresence mode="popLayout">
            {/* FEEDBACK: replaces problem when wrong */}
            {isPausing && currentProblem ? (
              /* BLANK PAUSE: invisible placeholder preserves layout - MUST match ProblemDisplay exactly */
              <div 
                key="pause"
                className="text-center py-2 [@media(min-height:800px)]:py-4 w-full invisible"
                aria-hidden="true"
              >
                <div className="text-7xl font-black text-white flex items-center justify-center gap-2">
                  <span className="tabular-nums">{currentProblem.leftOperand}</span>
                  <span className="text-6xl mx-2">×</span>
                  <span className="tabular-nums">{currentProblem.rightOperand}</span>
                  <span className="text-6xl ml-2">=</span>
                  <span className="text-6xl ml-3">?</span>
                </div>
              </div>
            ) : showFeedback && !showFeedback.correct && showFeedback.problem ? (
              <motion.div
                key="feedback"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="text-center py-2 [@media(min-height:800px)]:py-4 w-full"
              >
                {/* MUST match ProblemDisplay structure exactly to prevent layout shift */}
                <div className="text-7xl font-black text-white flex items-center justify-center gap-2">
                  {/* Left operand - dimmed */}
                  <span className="text-white/60 drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] tabular-nums">
                      {showFeedback.problem.left}
                    </span>
                  {/* Operator - dimmed */}
                  <span className="text-6xl text-yellow-400/50 drop-shadow-[0_0_20px_rgba(250,204,21,0.2)] mx-2">
                      {OPERATION_SYMBOLS[showFeedback.problem.operation as OperationType]}
                    </span>
                  {/* Right operand - dimmed */}
                  <span className="text-white/60 drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] tabular-nums">
                      {showFeedback.problem.right}
                    </span>
                  {/* Equals sign - dimmed */}
                  <span className="text-6xl text-emerald-400/60 drop-shadow-[0_0_20px_rgba(52,211,153,0.2)] ml-2">
                      =
                    </span>
                  {/* THE ANSWER - hero of the show, replaces the "?" */}
                    <motion.span 
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ 
                        delay: 0.15,
                        type: "spring",
                        stiffness: 500,
                        damping: 12
                      }}
                    className="text-6xl text-emerald-400 drop-shadow-[0_0_25px_rgba(52,211,153,0.8)] ml-3 tabular-nums"
                    >
                      {showFeedback.problem.answer}
                    </motion.span>
                </div>
              </motion.div>
            ) : currentProblem ? (
              /* PROBLEM: Craftsman balance - critical content instant, polish on decoration */
              <div
                key={`problem-${currentProblem.id}-${problemAnimKey}`}
                className="text-center py-2 [@media(min-height:800px)]:py-4 w-full animate-problem-container"
              >
                <div className="text-7xl font-black text-white flex items-center justify-center">
                  <div className="flex items-center gap-3">
                    {/* CRITICAL: operands + operator appear together, no stagger */}
                    <span
                      className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)] tabular-nums animate-problem-operand"
                      style={{ fontVariantNumeric: 'tabular-nums', animationDelay: '0s' }}
                    >
                      {currentProblem.leftOperand}
                    </span>
                    
                    <span 
                      className="text-6xl text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.4)] animate-problem-operator"
                      style={{ animationDelay: '0.02s' }}
                    >
                        {getOperationSymbol(currentProblem.operation)}
                    </span>
                    
                    <span
                      className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)] tabular-nums animate-problem-operand"
                      style={{ fontVariantNumeric: 'tabular-nums', animationDelay: '0.04s' }}
                    >
                      {currentProblem.rightOperand}
                    </span>
                    
                    {/* DECORATIVE: = and ? can have slight stagger for polish */}
                    <span 
                      className="text-6xl text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)] animate-problem-equals"
                      style={{ animationDelay: '0.06s' }}
                    >
                      =
                    </span>
                    
                    <span 
                      className="text-6xl text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)] animate-problem-question"
                      style={{ animationDelay: '0.08s' }}
                    >
                      ?
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Answer Input - Nintendo Style */}
        <form onSubmit={(e) => e.preventDefault()} className="flex-shrink-0 w-full">
          <div className="px-4 pb-4 w-full">
            <div className="flex flex-col items-center gap-1 max-w-xl mx-auto">
              <AnswerInput
                answer={answer}
                onAnswerChange={setAnswer}
                onSubmit={handleSubmit}
                showFeedback={showFeedback}
                currentProblem={currentProblem}
                playerId={playerId}
                firstProblem={!hasSubmittedRef.current}
                ripples={ripples}
                isWaiting={import.meta.env.DEV ? (forceShowDots || isWaiting) : isWaiting}
                disabled={(showFeedback !== null && !showFeedback.correct) || startTime === 0}
              />
              
              {/* Subtle integrated timer */}
              <div className="mt-3 px-2 w-full">
                <div className="relative h-2 bg-gray-800/30 rounded-full overflow-hidden w-full">
                  {/* Timer fill - Updated via RAF direct DOM manipulation */}
                  <div 
                    id="timer-bar"
                    className="h-full timer-bar-fast"
                  />
                </div>
                
                {/* Minimal timer text - Updated via RAF direct DOM manipulation */}
                <div className="text-center mt-1 pb-3.5">
                  <span id="timer-display" className="text-sm text-gray-400 font-bold tabular-nums">
                    0.0s
                  </span>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Squad bar removed from bottom - will be integrated near boss */}
      </div>
    </div>
  );
}