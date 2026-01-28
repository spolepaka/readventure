import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { PlayerRow, PerformanceSnapshotRow } from '../spacetime';
import type { Infer } from 'spacetimedb';

type Player = Infer<typeof PlayerRow>;
type PerformanceSnapshot = Infer<typeof PerformanceSnapshotRow>;

// Quest targets (in minutes)
export const DAILY_TIME_TARGET = 10;
export const WEEKLY_TIME_TARGET = 50;
export const DAILY_QUEST_REWARD = 400;
export const WEEKLY_QUEST_REWARD = 1500;

// Reset at 8am UTC (midnight PST) - matches server
const RESET_HOUR_UTC = 8;

export interface QuestProgress {
  dailyMinutes: number;
  weeklyMinutes: number;
  dailyComplete: boolean;
  weeklyComplete: boolean;
}

/**
 * Pure function: Calculate quest progress from snapshots.
 * Used by both useQuestProgress hook and captureRaidStartState.
 */
export function calculateQuestProgress(
  player: { id: string } | null,
  performanceHistory: PerformanceSnapshot[]
): QuestProgress {
  if (!player) {
    return { dailyMinutes: 0, weeklyMinutes: 0, dailyComplete: false, weeklyComplete: false };
  }
  
  const now = new Date();
  
  // Today: 8am UTC (midnight PST)
  const todayStart = new Date(now);
  todayStart.setUTCHours(RESET_HOUR_UTC, 0, 0, 0);
  if (todayStart > now) {
    todayStart.setUTCDate(todayStart.getUTCDate() - 1);
  }
  
  // This week: Monday 8am UTC
  const weekStart = new Date(todayStart);
  const dayOfWeek = weekStart.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysToMonday);
  
  let dailySeconds = 0;
  let weeklySeconds = 0;
  
  for (const snapshot of performanceHistory) {
    if (snapshot.playerId !== player.id) continue;
    
    const snapshotTime = snapshot.timestamp.toDate();
    
    if (snapshotTime >= weekStart) weeklySeconds += snapshot.sessionSeconds;
    if (snapshotTime >= todayStart) dailySeconds += snapshot.sessionSeconds;
  }
  
  const dailyMinutes = dailySeconds / 60;
  const weeklyMinutes = weeklySeconds / 60;
  
  return {
    dailyMinutes,
    weeklyMinutes,
    dailyComplete: dailyMinutes >= DAILY_TIME_TARGET,
    weeklyComplete: weeklyMinutes >= WEEKLY_TIME_TARGET,
  };
}

/**
 * Hook wrapper: Memoized quest progress for React components.
 */
export function useQuestProgress(player: Player | null): QuestProgress {
  const performanceHistory = useGameStore(state => state.performanceHistory);
  return useMemo(
    () => calculateQuestProgress(player, performanceHistory),
    [player, performanceHistory]
  );
}

