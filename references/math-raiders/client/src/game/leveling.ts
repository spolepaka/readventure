// Account leveling inspired by Valorant's infinite progression system
// Smooth exponential curve with no jarring jumps (each level ~5-7% harder)
// - Levels 1-10: Hook phase (200-470 AP) - Fast early wins
// - Levels 11-30: Habit building (500-1900 AP) - Fall semester
// - Levels 31-50: Commitment phase (2000-5300 AP) - Winter/Spring
// - Levels 51-60: Final milestone (5500-7750 AP) - Year-end achievement
// - Levels 61+: Infinite prestige (5000 AP/level) - Multi-year dedication
// Timeline: Regular (10min/day) hits 60 in ~30 weeks, Dedicated (20min/day) in ~15 weeks

const MAX_LEVEL = Infinity; // Truly infinite

export function apToNext(level: number): number {
  if (!isFinite(level)) return Infinity;
  
  // Smooth exponential curve designed for K-5 multi-year progression
  // Target: Regular player (10min/day) hits 60 in ~30 weeks (April)
  // No jarring jumps - each level ~5-7% harder than previous
  if (level <= 10) {
    // Levels 1-10: Hook phase (700-1600 AP) - 3-8 raids per level
    // Adjusted for pilot: Handles unadapted boss burst (first 5-7 quick raids)
    // After adaptation, natural slowdown from longer raid duration
    return 700 + (level - 1) * 100;
  } else if (level <= 20) {
    // Levels 11-20: Building habits (500-950 AP) - 2-4 raids per level
    return 500 + (level - 11) * 50;
  } else if (level <= 30) {
    // Levels 21-30: Steady climb (1000-1900 AP) - 4-8 raids per level
    return 1000 + (level - 21) * 100;
  } else if (level <= 40) {
    // Levels 31-40: Commitment phase (2000-3350 AP) - 8-13 raids per level
    return 2000 + (level - 31) * 150;
  } else if (level <= 50) {
    // Levels 41-50: Endgame grind (3500-5300 AP) - 13-20 raids per level
    return 3500 + (level - 41) * 200;
  } else if (level <= 60) {
    // Levels 51-60: Final push (5500-7750 AP) - 20-29 raids per level
    return 5500 + (level - 51) * 250;
  } else {
    // Levels 61+: Prestige/Infinite progression (5000 AP per level)
    // Valorant-style: No cap, just recognition for dedication
    // Easier than level 60 (reward for hitting milestone)
    return 5000;
  }
}

export function getLevelFromTotalAp(totalAp: number) {
  let remaining = Math.max(0, Math.floor(totalAp));
  let level = 1;
  // No level cap - loop until we run out of AP
  while (remaining >= apToNext(level)) {
    const need = apToNext(level);
    remaining -= need;
    level++;
  }
  const apForNext = apToNext(level);
  const apIntoLevel = Math.min(remaining, isFinite(apForNext) ? apForNext : 0);
  return { level, apIntoLevel, apForNext };
}

export const MAX_PLAYER_LEVEL = Infinity; // No cap - show actual level

// Level-band titles: progression from student to legend
type TitleBand = { min: number; max: number; name: string; color: string; icon: string };

const TITLE_BANDS: TitleBand[] = [
  { min: 1,  max: 5,  name: 'Rookie',        color: 'text-gray-400',    icon: '🌟' },
  { min: 6,  max: 10, name: 'Rising Star',   color: 'text-green-400',   icon: '⭐' },
  { min: 11, max: 15, name: 'Hotshot',       color: 'text-cyan-400',    icon: '🔥' },
  { min: 16, max: 20, name: 'Ace',           color: 'text-blue-400',    icon: '🎯' },
  { min: 21, max: 25, name: 'Prodigy',       color: 'text-purple-400',  icon: '💫' },
  { min: 26, max: 30, name: 'Master',        color: 'text-indigo-400',  icon: '🏆' },
  { min: 31, max: 35, name: 'Genius',        color: 'text-yellow-400',  icon: '🧠' },
  { min: 36, max: 40, name: 'Champion',      color: 'text-orange-400',  icon: '👑' },
  { min: 41, max: 45, name: 'Superstar',     color: 'text-red-400',     icon: '✨' },
  { min: 46, max: 50, name: 'Hero',          color: 'text-purple-400',  icon: '🦸' },
  { min: 51, max: 55, name: 'Legend',        color: 'text-purple-500',  icon: '💎' },
  { min: 56, max: 60, name: 'Mythic',        color: 'text-amber-400',   icon: '🌠' },
  { min: 61, max: 999, name: 'Mythic',       color: 'text-amber-400',   icon: '🌠' }, // Prestige: Keep highest title
];

export function getTitleForLevel(level: number) {
  const l = Math.max(1, Math.min(level, MAX_LEVEL));
  const band = TITLE_BANDS.find(b => l >= b.min && l <= b.max) || TITLE_BANDS[0];
  
  // Prestige mode: Level 61+ keeps "Mythic" title, level number shows progress
  if (level > 60) {
    return { 
      name: 'Mythic', 
      color: 'text-amber-400', 
      icon: '🌠'
    };
  }
  
  return { name: band.name, color: band.color, icon: band.icon };
}

// Total AP required to REACH a specific level (level 1 => 0 AP)
export function getTotalApForLevel(targetLevel: number): number {
  const capped = Math.max(1, Math.min(targetLevel, MAX_LEVEL));
  let sum = 0;
  for (let lvl = 1; lvl < capped; lvl++) {
    sum += apToNext(lvl);
  }
  return sum;
}

// Next title target from a current level
function getNextTitleTargetLevel(currentLevel: number): { name: string; minLevel: number } | null {
  const l = Math.max(1, Math.min(currentLevel, MAX_LEVEL));
  // Find the band containing current level
  const bandIndex = TITLE_BANDS.findIndex(b => l >= b.min && l <= b.max);
  if (bandIndex < 0) return null;
  const next = TITLE_BANDS[bandIndex + 1];
  if (!next) return null;
  return { name: next.name, minLevel: next.min };
}

// Compute how much AP left until the next title band
export function getNextTitleInfo(totalAp: number): { name: string; minLevel: number; apToGo: number } | null {
  const { level } = getLevelFromTotalAp(totalAp);
  const next = getNextTitleTargetLevel(level);
  if (!next) return null;
  const targetTotal = getTotalApForLevel(next.minLevel);
  return { name: next.name, minLevel: next.minLevel, apToGo: Math.max(0, targetTotal - Math.floor(totalAp)) };
}


