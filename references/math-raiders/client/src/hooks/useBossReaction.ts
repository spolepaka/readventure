import { useState, useRef, useCallback } from 'react';
import { BossReaction, BossReactionType, createBossReaction } from '../game/constants/bossDialogue';

interface BossReactionState {
  reaction: BossReaction | null;
  timeoutId: NodeJS.Timeout | null;
  priority: number;
}

export function useBossReaction() {
  const [bossReaction, setBossReaction] = useState<BossReaction | null>(null);
  const stateRef = useRef<BossReactionState>({
    reaction: null,
    timeoutId: null,
    priority: 0
  });

  const showBossReaction = useCallback((
    type: BossReactionType,
    dialogues: readonly string[],
    priority: number = 1,
    duration: number = 1500
  ) => {
    // Only show if equal or higher priority
    if (priority < stateRef.current.priority) {
      return;
    }

    // Cancel any existing timeout
    if (stateRef.current.timeoutId) {
      clearTimeout(stateRef.current.timeoutId);
      stateRef.current.timeoutId = null;
    }

    // Create and show new reaction
    const newReaction = createBossReaction(type, dialogues);
    setBossReaction(newReaction);
    stateRef.current.reaction = newReaction;
    stateRef.current.priority = priority;

    // Set new timeout
    stateRef.current.timeoutId = setTimeout(() => {
      setBossReaction(null);
      stateRef.current.reaction = null;
      stateRef.current.priority = 0;
      stateRef.current.timeoutId = null;
    }, duration);
  }, []);

  const clearBossReaction = useCallback(() => {
    if (stateRef.current.timeoutId) {
      clearTimeout(stateRef.current.timeoutId);
    }
    setBossReaction(null);
    stateRef.current = {
      reaction: null,
      timeoutId: null,
      priority: 0
    };
  }, []);

  return {
    bossReaction,
    showBossReaction,
    clearBossReaction
  };
}

// Priority levels for different reaction types
export const REACTION_PRIORITY = {
  RAGE: 4,        // Boss entering rage mode
  COMBO_HIGH: 3,  // 20+ combo reactions
  SPEED: 2,       // Fast/slow answer reactions  
  COMBO_LOW: 2,   // 5-10 combo reactions
  TAUNT: 1,       // General taunts
} as const;







