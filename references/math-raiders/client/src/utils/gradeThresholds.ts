/**
 * Grade-based timing thresholds and display helpers
 * Based on Alpha School grade-specific CQPM standards
 */

/**
 * Wins required on the grade goal boss to become a Track Master
 * Used for gating Mastery Trials progression and triggering post-test readiness
 */
export const WINS_FOR_TRACK_MASTER = 3;

export function getFastThresholdMs(grade: number): number {
  if (grade === 0) return 3000;      // K: 20 CQPM
  if (grade >= 1 && grade <= 3) return 2000;  // G1-3: 30 CQPM
  if (grade === 4) return 1700;      // G4: 35 CQPM
  return 1500;                       // G5+: 40 CQPM
}

export function getFastThresholdText(grade: number): string {
  const ms = getFastThresholdMs(grade);
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getGradeCQPMTarget(grade: number): number {
  if (grade === 0) return 20;
  if (grade >= 1 && grade <= 3) return 30;
  if (grade === 4) return 35;
  return 40;
}

export function getGradeLabel(grade: number): string {
  return grade === 0 ? 'K' : `G${grade}`;
}

/**
 * Get the goal boss ID for Track Master certification at a grade
 * Beating this boss proves grade-level fluency
 */
export function getGradeGoalBoss(grade: number): number {
  if (grade === 0) return 4;  // K → Boomer (20 CQPM)
  if (grade >= 1 && grade <= 3) return 6;  // G1-3 → Titan (30 CQPM)
  if (grade === 4) return 7;  // G4 → Captain Nova (35 CQPM)
  return 8;  // G5+ → Void Emperor (40 CQPM)
}

