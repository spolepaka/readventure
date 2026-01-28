import * as PIXI from 'pixi.js';
import { Droplet, Ghost, Snowflake, Bomb, Bot, Shield, Skull, Crown, Star } from 'lucide-react';
import { PureRobotBoss, ROBOT_COLORS, type RobotColors } from './PureRobotBoss';
import { PureSlimeBoss, SLIME_COLORS, type SlimeColors } from './PureSlimeBoss';
import { PureGhostBoss, GHOST_COLORS, type GhostColors } from './PureGhostBoss';
import { PureMechTitan, MECH_COLORS, type MechColors } from './PureMechTitan';
import { PureUFOBoss, UFO_COLORS, type UFOColors } from './PureUFOBoss';
import { PureSharkBoss, SHARK_COLORS, type SharkColors } from './PureSharkBoss';
import { PureBombBoss, BOMB_COLORS, type BombColors } from './PureBombBoss';
import { PureSnowmanBoss, SNOWMAN_COLORS, type SnowmanColors } from './PureSnowmanBoss';
import { PureSkullBoss, SKULL_COLORS, type SkullColors } from './PureSkullBoss';
import { PureNovaBoss, NOVA_COLORS, type NovaColors } from './PureNovaBoss';
import { PureVoidEmperorBoss, VOID_EMPEROR_COLORS, type VoidEmperorColors } from './PureVoidEmperorBoss';

// Boss HP values match server - tuned for accurate CQPM gates
// Used in dropdown previews (actual HP = base × player count)
export const BOSS_HP: Record<number, number> = {
  0: 0,     // Adaptive - HP set dynamically
  1: 900,   // 5 CQPM
  2: 1750,  // 10 CQPM
  3: 2600,  // 15 CQPM
  4: 3500,  // 20 CQPM
  5: 4200,  // 25 CQPM
  6: 5000,  // 30 CQPM
  7: 5500,  // 35 CQPM
  8: 6000,  // 40 CQPM
};

// Boss icons for UI (Lucide React icons) - single source of truth
export const BOSS_ICONS: Record<number, { icon: React.ElementType; color: string }> = {
  0: { icon: Bot,       color: 'text-blue-400' },    // Clank (OG Robot) - freebie
  1: { icon: Droplet,   color: 'text-green-400' },   // Gloop Jr. (Slime)
  2: { icon: Ghost,     color: 'text-purple-300' },  // Whisper (Ghost)
  3: { icon: Skull,     color: 'text-gray-200' },    // Bonehead (Skull) - 15 CQPM
  4: { icon: Bomb,      color: 'text-red-500' },     // Boomer (Bomb) - K goal
  5: { icon: Snowflake, color: 'text-cyan-300' },    // Frosty (Snowman)
  6: { icon: Shield,    color: 'text-blue-400' },    // Titan (Mech)
  7: { icon: Star,      color: 'text-yellow-400' },  // Captain Nova - G4 goal, always free in Quick Play
  8: { icon: Skull,     color: 'text-purple-500' },  // Void Emperor - G5 goal, always free in Quick Play
};

/**
 * Boss Configuration - Single Source of Truth
 * 
 * Maps boss_level (from server) to client-side visuals.
 * Adding a new boss: 1) Create class, 2) Add one entry here.
 * 
 * Color variants use explicit color overrides (not hue filters).
 * This is Bob Nystrom approved: explicit > clever, no artifacts.
 * 
 * Boss Level Encoding:
 *   0       = Adaptive HP, Clank visual (legacy)
 *   1-8     = Fixed HP tier, fixed visual (Mastery Trials)
 *   100     = Adaptive HP, Clank visual
 *   101-108 = Adaptive HP, specific visual (101 = boss 1 visual, etc.)
 */

// -------------------- Boss Level Encoding Helpers --------------------
// Centralized here to match server logic. Use these everywhere.

/** Check if boss level uses adaptive HP */
export function isAdaptiveBoss(bossLevel: number): boolean {
  return bossLevel === 0 || bossLevel >= 100;
}

/** Get visual boss ID (0 = Clank, 1-8 = ladder bosses) */
export function getBossVisual(bossLevel: number): number {
  if (bossLevel === 0 || bossLevel === 100) return 0;  // Clank (legacy 0 or encoded 100)
  if (bossLevel > 100) return bossLevel - 100;  // Decode: 101 → 1, etc.
  return bossLevel;  // Fixed tier: visual matches level
}

// -------------------- End Encoding Helpers --------------------

// Base interface all bosses implement (1-for-1 across all bosses)
// Display name comes from BOSS_CONFIG (single source of truth)
export interface BossInstance {
  container: PIXI.Container;
  updateHealth(hp: number, maxHp: number): void;
  triggerFlash(duration?: number): void;
  triggerShield(duration?: number): void;
  triggerShake(amplitude: number): void;
  triggerRecoil(amount: number): void;
  registerWithApp(app: PIXI.Application): void;
  destroy(): void;
}

// Constructor signature for boss classes (with optional color overrides)
type BossConstructor = new (x: number, y: number, hp: number, maxHp: number, colors?: Record<string, number>) => BossInstance;

export interface BossConfig {
  Class: BossConstructor;
  name: string;
  yOffset: number;
  scale?: number;
  colors?: Partial<SlimeColors | GhostColors | RobotColors | MechColors | UFOColors | SharkColors | BombColors | SnowmanColors | SkullColors | NovaColors | VoidEmperorColors>;  // Explicit color overrides
}

/**
 * Boss ladder configuration
 * 
 * Level 0: Adaptive (uses player's recent performance)
 * Levels 1-3: Entry - 5, 10, 15 CQPM
 * Levels 4-5: Mid-tier - 20, 25 CQPM (K goal = boss 4)
 * Levels 6-8: Endgame - 30, 35, 40 CQPM (G2-5 goals)
 * 
 * Color variants are explicit - you see exactly what color each boss is.
 */
export const BOSS_CONFIG: Record<number, BossConfig> = {
  // Adaptive - default robot (gray-blue)
  0: { Class: PureRobotBoss, name: 'Clank', yOffset: 165 },
  
  // Entry tiers (5-15 CQPM)
  1: { Class: PureSlimeBoss, name: 'Gloop Jr.', yOffset: 165 },   // Green slime - 5 CQPM
  2: { Class: PureGhostBoss, name: 'Whisper', yOffset: 145 },     // Pale ghost - 10 CQPM
  3: { Class: PureSkullBoss, name: 'Bonehead', yOffset: 165 },    // Skull - 15 CQPM
  
  // Mid tiers (20-25 CQPM)
  4: { Class: PureBombBoss, name: 'Boomer', yOffset: 165 },       // Bomb - 20 CQPM ⭐ K goal
  5: { Class: PureSnowmanBoss, name: 'Frosty', yOffset: 165 },    // Snowman - 25 CQPM
  
  // Endgame tiers (30-40 CQPM)
  6: { Class: PureMechTitan, name: 'Titan', yOffset: 135 },       // Mech - 30 CQPM ⭐ G2-3 goal
  7: { Class: PureNovaBoss, name: 'Captain Nova', yOffset: 160 }, // Nova - 35 CQPM ⭐ G4 goal (always free in Quick Play)
  8: { Class: PureVoidEmperorBoss, name: 'Void Emperor', yOffset: 130, scale: 0.9 },  // G5 goal ⭐ Ultimate boss (free in Quick Play)
};

// Fallback for invalid levels
const DEFAULT_BOSS: BossConfig = BOSS_CONFIG[0];

/**
 * Get boss config for a given level
 * Handles encoding: 100+ decodes to visual (101 → boss 1)
 * Always returns a valid config (falls back to default)
 */
export function getBossConfig(bossLevel: number): BossConfig {
  const visual = getBossVisual(bossLevel);
  // visual 0 = Clank (the default boss)
  if (visual === 0) return DEFAULT_BOSS;
  return BOSS_CONFIG[visual] ?? DEFAULT_BOSS;
}

/**
 * Create a boss instance for a given level
 * Factory function - handles all the instantiation logic
 * Automatically decodes adaptive boss visuals (101 → boss 1)
 */
export function createBoss(
  bossLevel: number,
  x: number,
  hp: number,
  maxHp: number
): BossInstance {
  const config = getBossConfig(bossLevel);
  const boss = new config.Class(x, config.yOffset, hp, maxHp, config.colors as Record<string, number>);
  
  // Apply scale if specified
  if (config.scale && config.scale !== 1) {
    boss.container.scale.set(config.scale);
  }
  
  return boss;
}

// Re-export color types for reference
export { SLIME_COLORS, GHOST_COLORS, ROBOT_COLORS, MECH_COLORS, UFO_COLORS, SHARK_COLORS, BOMB_COLORS, SNOWMAN_COLORS, SKULL_COLORS, NOVA_COLORS, VOID_EMPEROR_COLORS };
export type { SlimeColors, GhostColors, RobotColors, MechColors, UFOColors, SharkColors, BombColors, SnowmanColors, SkullColors, NovaColors, VoidEmperorColors };

