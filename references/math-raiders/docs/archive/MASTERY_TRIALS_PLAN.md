# Mastery Trials Implementation Plan

## Overview

Mastery Trials is a tiered boss challenge system where players prove fluency at specific CQPM levels. Unlocks are per-grade, per-track, encouraging mastery of each operation at each difficulty level.

**Key Decision: Mastery Trials is SOLO ONLY.**

Co-op is a separate mode for fun with friends (still earns XP). This clean separation avoids confusion about "fair share" rules and keeps the mental model simple:
- **Mastery Trials** = Prove yourself alone
- **Co-op** = Play with friends for fun

---

## Lobby UI

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│           [ ⚡ QUICK PLAY ]      ← BIG, one-click          │
│             Adaptive • Just right for you                  │
│                                                            │
│      [ 🏆 Mastery Trials ]    [ 👥 Co-op ]                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

| Button | Action | Clicks to Play |
|--------|--------|----------------|
| Quick Play | `startSoloRaid(track, 0)` | **1** |
| Mastery Trials | Opens modal → pick tier | **3** |
| Co-op | Opens modal → create/join | **3+** |

---

## Mastery Trials Modal

Uses your current global track selection. Modal header reflects this:

```
┌─────────────────────────────────────────────────────────────────┐
│              🏆 MASTERY TRIALS — Multiplication                 │
│                                                                 │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │[SLIME] │ │[GOBLIN]│ │[GOLEM] │ │[DRAGON]│ │  🔒    │  ...   │
│  │ Slime  │ │ Goblin │ │ Golem  │ │ Dragon │ │ Demon  │        │
│  │ 🏆1:23 │ │ 🏆1:35 │ │ 🏆1:58 │ │Best:███░│ │        │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
│       ↑                              ↑           ↑              │
│   [SELECTED]                    Attempted    Locked             │
│                                                                 │
│       YOUR GOAL: Titan (Grade 3 benchmark)                      │
│                                                                 │
│                    [ ⚔️ BEGIN TRIAL ]                           │
└─────────────────────────────────────────────────────────────────┘
```

**Card Elements:**
- Boss artwork + name (personality)
- Status: 🏆1:23 (beaten) / Best:[bar] (attempted) / empty+🔒 (locked)

**Progression:** Left-to-right = easier to harder. Locks guide the path.

---

## Boss Definitions

**Formula:** `HP = 150 × CQPM` (validated with pilot data Nov 2025)

| Boss | CQPM | HP | Grade Benchmark |
|------|------|------|-----------------|
| Slime | 5 | 750 | — |
| Goblin | 10 | 1,500 | — |
| Golem | 15 | 2,250 | — |
| Ogre | 20 | 3,000 | K ⭐ |
| Dragon | 25 | 3,750 | — |
| Demon | 30 | 4,500 | G1-3 ⭐ |
| Titan | 35 | 5,250 | G4 ⭐ |
| ??? | 40 | 6,000 | G5 ⭐ |

Boss names naturally imply progression (Slime → Titan).

---

## Unlock System

### Rules
1. **Slime** is always unlocked (first boss)
2. **Beat a boss** → unlocks **next boss**
3. Unlocks are **per-grade, per-track** (independent ladders)

### Victory = Unlock

```
Beat Slime → Unlock Goblin → Beat Goblin → Unlock Golem → ...
```

Solo only. You win, you earn it.

---

## Best Times

- **One best time** per boss (solo only)
- Displayed on boss cards when beaten

---

## Track Master Certification

To earn **Track Master** status (the star on lobby), players must:

1. **Master 100% of facts** for that operation at their grade
2. **Beat their grade's goal boss 3 times** (not just once)

**Why 3×?**
- Filters out lucky wins
- Proves consistent fluency, not peak performance
- Aligns with CCSS intent: automaticity = reliable recall

**UI feedback on goal boss card:**
- `×1/3` → `×2/3` → `⭐ Master`

---

## Failure Feedback: Show How Close

On loss, show boss HP remaining so kids see they almost won.

### Loss Screen Addition

```
         ████████████░░░░░░░░  342 / 2700 HP
         
         "So close! 342 HP left!"
```

**Implementation:** `hp_remaining = BOSS_HP_VALUES[tier] - damage_dealt` (no new fields needed)

---

## Schema Changes

### Add to `PerformanceSnapshot`:

```rust
/// Whether this raid was won
pub victory: bool,

/// Type of raid for filtering
pub raid_type: String,  // "adaptive", "mastery_trial", "coop"
```

### In `end_raid` function:

```rust
ctx.db.performance_snapshot().insert(PerformanceSnapshot {
    // ... existing fields ...
    victory: boss_hp <= 0,
    raid_type: raid_type.clone(),
});
```

**Note:** `damage_dealt` already exists, so "lowest HP remaining" is derivable:
```
hp_remaining = BOSS_HP_VALUES[tier] - damage_dealt
```

---

## Client Logic

### Tier Unlocks (Simplified for Solo Only)

```typescript
const BOSS_HP_VALUES = [0, 750, 1500, 2250, 3000, 3750, 4500, 5250, 6000];

const tierUnlocks = useMemo(() => {
  const unlocks: Record<number, boolean> = { 1: true };
  
  // Only solo Mastery Trial wins count
  const soloWins = performanceHistory.filter(p =>
    p.grade === currentGrade &&
    p.track === currentTrack &&
    p.raidType === 'mastery_trial' &&
    p.victory
  );
  
  for (let tier = 1; tier <= 8; tier++) {
    if (soloWins.some(p => p.bossLevel === tier)) {
      unlocks[tier + 1] = true;
    }
  }
  return unlocks;
}, [performanceHistory, currentGrade, currentTrack]);
```

### Best Times

```typescript
const bestTimes = useMemo(() => {
  const times: Record<number, number> = {};
  
  const wins = performanceHistory.filter(p =>
    p.grade === currentGrade &&
    p.track === currentTrack &&
    p.raidType === 'mastery_trial' &&
    p.victory
  );
  
  for (let tier = 1; tier <= 8; tier++) {
    const winsAtTier = wins.filter(p => p.bossLevel === tier);
    if (winsAtTier.length > 0) {
      times[tier] = Math.min(...winsAtTier.map(w => w.sessionSeconds));
    }
  }
  return times;
}, [performanceHistory, currentGrade, currentTrack]);
```

### Best Attempt (For Unbeaten Tiers)

```typescript
// Returns 0-100 representing % of boss HP dealt (for progress bar)
const bestAttemptPercent = useMemo(() => {
  const percents: Record<number, number | null> = {};
  
  for (let tier = 1; tier <= 8; tier++) {
    // Skip if already beaten
    if (tierUnlocks[tier + 1]) {
      percents[tier] = null;
      continue;
    }
    
    const attempts = performanceHistory.filter(p =>
      p.grade === currentGrade &&
      p.track === currentTrack &&
      p.raidType === 'mastery_trial' &&
      p.bossLevel === tier &&
      !p.victory
    );
    
    if (attempts.length === 0) {
      percents[tier] = null; // Never attempted
    } else {
      const bossMaxHp = BOSS_HP_VALUES[tier];
      const bestDamage = Math.max(...attempts.map(a => a.damageDealt));
      percents[tier] = Math.round((bestDamage / bossMaxHp) * 100);
    }
  }
  return percents;
}, [performanceHistory, currentGrade, currentTrack, tierUnlocks]);
```

---

## Grade Highlighting

Show the player's grade benchmark prominently:

| Grade | Benchmark Boss | Label |
|-------|----------------|-------|
| K | Ogre | "Your Goal: Ogre" |
| 1-3 | Demon | "Your Goal: Demon" |
| 4 | Titan | "Your Goal: Titan" |
| 5 | ??? | "Your Goal: ???" |

```typescript
const GRADE_BENCHMARKS: Record<number, string> = {
  0: 'Ogre',    // K
  1: 'Demon', 2: 'Demon', 3: 'Demon',  // G1-3
  4: 'Titan',   // G4
  5: '???',     // G5
};
```

---

## Co-op Flow (Separate from Mastery Trials)

Co-op is for **fun with friends**, not for unlocking bosses.

1. Click **Co-op** → Modal opens
2. **Create Game**: Pick boss (up to your highest unlocked) → Get room code → Wait for friends
3. **Join Game**: Enter code → Join at host's boss
4. **Rewards**: XP counts toward Timeback, but NO boss unlocks

**Why separate?**
- Clean mental model: "Mastery = prove alone, Co-op = play together"
- No confusion about fair share rules
- No "I didn't get credit" frustration
- Playing with friends IS the reward

---

## Results Screen Additions

### Victory (First Time Beating Boss)
```
🎉 DRAGON DEFEATED! 🎉
Demon unlocked!
```

### Victory (Beat Personal Record)
```
🏆 NEW RECORD! 🏆
1:23 — 24 seconds faster!
```

### Victory (Close to Record, Didn't Beat)
```
1:25 — Just 2 seconds off your best!
```

### Defeat
```
████████████░░░░░░░░  342 / 2700 HP
"So close! 342 HP left!"
```

### Action Buttons (All Outcomes)
```
[ 🔄 PLAY AGAIN ]      ← Same boss (speedrun)
[ 🏆 BACK TO TRIALS ]  ← Return to modal
```

---

## Implementation Checklist (v1 — COMPLETE ✅)

### Server
- [x] Add `victory: Option<bool>` to `PerformanceSnapshot`
- [x] Add `raidType: String` to `PerformanceSnapshot`
- [x] Set both fields in `end_raid` function
- [x] HP formula: `150 × CQPM` (validated with pilot data)

### Client - Core
- [x] Create `MasteryTrialsModal.tsx` component
- [x] Modal header shows current track ("Mastery Trials — Multiplication")
- [x] Implement `tierUnlocks` derivation (solo wins only)
- [x] Implement `bestTimes` derivation
- [x] Implement `bestAttemptPercent` derivation (for progress bars)
- [x] Implement `winCounts` derivation (for 3× Track Master)
- [x] Add grade benchmark highlighting (shimmer + "Beat X 3×")
- [x] Update lobby buttons (Quick Play + Mastery Trials + Co-op)

### Client - Results Screen
- [x] Victory: First-time unlock celebration ("🎉 First Clear!")
- [x] Victory: "NEW RECORD! — Xs faster!" with delta
- [ ] ~~Victory: "Just Xs off your best!" for close misses~~ (v2)
- [ ] ~~Defeat: HP bar showing how close ("342 / 2700 HP")~~ (v2)
- [x] Buttons: Rematch / Back to Lobby

### Client - Boss Cards
- [x] Boss name (artwork pending)
- [x] Beaten: Show best time (🏆1:23)
- [x] Beaten goal boss: Show win count (×1/3, ×2/3, ⭐ Master)
- [x] Attempted: Show progress bar (Best: [███░])
- [x] Locked: Grayed out + 🔒 icon

### Track Master
- [x] 100% facts mastered + 3× goal boss wins = star earned
- [x] TrackMasterModal celebration
- [x] Progress tooltips in TrackStar component

---

## Design Principles

1. **One-click for 80%**: Quick Play = Adaptive, instant
2. **Complexity contained**: Mastery Trials modal houses all boss selection
3. **Optimize for 10th use**: Repeat players get efficient flow
4. **Boss names tell the story**: Slime → Titan implies progression
5. **Solo = proof, Co-op = fun**: Clean mental model, no confusion
6. **Every loss shows progress**: Kids see HP remaining, not just "you lost"

---

## UI Inspiration

- **Brawl Stars**: Clean cards, instant readability
- **Kahoot**: Room codes, host picks settings
- **Prodigy Math**: Educational context, friendly visuals

Avoid Lost Ark aesthetic—too dark/intimidating for K-5.

---

## v2 Polish (Nice-to-Have)

### Results Screen Enhancements
- [ ] Close miss feedback: "Just 2s off your best!"
- [ ] HP bar on defeat: "████████░░ 342 / 3000 HP — So close!"
- [ ] "Play Again" goes directly to same boss (speedrun loop)
- [ ] "Back to Trials" returns to modal

### Audio
- [ ] Sound effect on First Clear / unlock
- [ ] Sound effect on New Record
- [ ] Sound effect on Track Master earned

### Visual
- [ ] Boss artwork/sprites (currently name only)
- [ ] Particle effects on First Clear
- [ ] Screen shake on boss defeat

### Grade Complete (Low Priority)
- [ ] Modal when all 4 tracks mastered at a grade
- [ ] "Grade X Complete!" celebration
- [ ] Prompt to advance grade (for non-Timeback users)

---

## Changelog

- **Nov 2025**: v1 complete
  - HP formula validated: `150 × CQPM`
  - Track Master requires 3× goal boss wins (not 1×)
  - First Clear / New Record celebrations added
  - Win count display on goal boss cards

