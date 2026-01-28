# Rank Progression Implementation Guide

## Overview
This guide details the implementation of rank/division progression tracking and display in MathRaiders' victory screen. Players will see their rank changes and facts mastered after each raid, creating a satisfying feedback loop for learning progress.

## Architecture Overview

### Data Flow
```
Raid Start → Capture Current State → Play Raid → Calculate Gains → Display Progress
```

### Key Components
- **GameStore**: Stores raid start state
- **ResultsScreen**: Displays progression
- **Existing Utilities**: `useMasteryStats`, `calculateDivision`, `getNextMilestone`

## Implementation Phases

### Phase 1: Data Structure Setup

**Objective**: Add tracking fields to GameState

**Changes**:
```typescript
// In client/src/store/gameStore.ts
interface GameState {
  // ... existing fields ...
  raidStartRank: string | null;
  raidStartDivision: string;
  raidStartMastered: number;
}
```

**Testing**:
1. Open React DevTools
2. Start a raid
3. Verify state contains:
   - `raidStartRank: "bronze"`
   - `raidStartDivision: "III"`
   - `raidStartMastered: 45`

---

### Phase 2: Capture Data at Raid Start

**Objective**: Store current progression state when ANY raid begins

**Implementation**:

Add imports to `gameStore.ts`:
```typescript
import { useMasteryStats } from '../hooks/useMasteryStats';
import { calculateDivision } from '../utils/rankDivisions';
```

Update these four methods:

1. **startSoloRaid**:
```typescript
startSoloRaid: () => {
  const { currentPlayer, factMasteries } = get();
  
  // Calculate current mastery stats
  const gradeFacts = ALL_FACTS.filter(f => f.grades.includes(currentPlayer?.grade || 0));
  const masteredCount = factMasteries.filter(fm => 
    fm.masteryLevel >= 5 && 
    gradeFacts.some(gf => generateFactKey(gf) === fm.factKey)
  ).length;
  
  const currentDivision = calculateDivision(
    currentPlayer?.rank,
    masteredCount,
    gradeFacts.length
  );
  
  set({ 
    raidStartRank: currentPlayer?.rank || null,
    raidStartDivision: currentDivision,
    raidStartMastered: masteredCount
  });
  
  connection.reducers.startSoloRaid();
}
```

2. **soloAgain** (same pattern)
3. **createPrivateRoom** (same pattern)
4. **joinPrivateRoom** (same pattern)

**Edge Cases Handled**:
- First-time player (rank = null)
- Grade-filtered fact counting
- Connection failures (data captured before server call)

**Testing Checklist**:
- [ ] Start solo raid → State updated
- [ ] Click "Play Again" → State updated  
- [ ] Create private room → State updated
- [ ] Join room → State updated

---

### Phase 3: Calculate & Display Progression

**Objective**: Show rank/division changes and facts mastered in ResultsScreen

**Implementation**:

Add imports to `ResultsScreen.tsx`:
```typescript
import { useMasteryStats } from '../hooks/useMasteryStats';
import { calculateDivision, getNextMilestone } from '../utils/rankDivisions';
import { RankGem } from './RankGem';
import { ChevronRight } from 'lucide-react';
```

Add state retrieval:
```typescript
// Get stored values
const { raidStartRank, raidStartDivision, raidStartMastered } = useGameStore(
  useShallow(state => ({
    raidStartRank: state.raidStartRank,
    raidStartDivision: state.raidStartDivision,
    raidStartMastered: state.raidStartMastered
  }))
);

// Calculate current values
const masteryStats = useMasteryStats(currentPlayer);
const currentDivision = calculateDivision(
  currentPlayer?.rank,
  masteryStats.mastered,
  masteryStats.total
);

// Detect changes
const rankChanged = currentPlayer?.rank !== raidStartRank;
const divisionChanged = currentDivision !== raidStartDivision;
const factsGained = masteryStats.mastered - raidStartMastered;

// Get next goal
const nextMilestone = getNextMilestone(
  currentPlayer?.rank,
  masteryStats.mastered,
  masteryStats.total
);

// Determine if we show the progression section
const showProgressSection = rankChanged || divisionChanged || factsGained > 0;
```

Add UI after victory header (around line 712):
```tsx
{/* After the Victory message */}
</motion.p>
</div>

{/* Rank/Division/Facts Progression */}
{showProgressSection && (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.6 }}
    className="mb-8"
  >
    {/* Rank or Division Change */}
    {(rankChanged || divisionChanged) && (
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
              <h3 className="text-3xl font-bold text-white mb-6">
                {rankChanged ? '🎉 RANK UP!' : '📈 Division Promotion!'}
              </h3>
              
              {/* Visual progression */}
              <div className="flex items-center justify-center gap-8">
                {/* From */}
                <div className="flex flex-col items-center">
                  <RankGem 
                    rank={raidStartRank as any || 'bronze'} 
                    size="lg" 
                    className="opacity-50" 
                  />
                  <p className="mt-2 text-gray-400">
                    {(raidStartRank || 'bronze').toUpperCase()} {raidStartDivision}
                  </p>
                </div>
                
                {/* Arrow */}
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.8, duration: 0.5 }}
                >
                  <ChevronRight className="w-12 h-12 text-purple-400" />
                </motion.div>
                
                {/* To */}
                <motion.div 
                  className="flex flex-col items-center"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 1, type: "spring", stiffness: 200 }}
                >
                  <RankGem 
                    rank={currentPlayer.rank as any} 
                    size="lg" 
                  />
                  <p className="mt-2 text-white font-bold">
                    {currentPlayer.rank?.toUpperCase()} {currentDivision}
                  </p>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    )}
    
    {/* Facts Mastered */}
    {factsGained > 0 && (
      <motion.div 
        className="mb-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: rankChanged || divisionChanged ? 1.5 : 0.7 }}
      >
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
          <p className="text-center">
            <span className="text-purple-300">✨ You mastered</span>
            <span className="text-2xl font-bold text-purple-400 mx-2">
              {factsGained}
            </span>
            <span className="text-purple-300">
              new {factsGained === 1 ? 'fact' : 'facts'} this raid!
            </span>
          </p>
          
          {/* Context message */}
          {rankChanged && (
            <p className="text-center text-sm text-purple-300/70 mt-2">
              That's what pushed you to {currentPlayer.rank} {currentDivision}!
            </p>
          )}
          {!rankChanged && divisionChanged && (
            <p className="text-center text-sm text-purple-300/70 mt-2">
              Keep going! You're making great progress!
            </p>
          )}
          {!rankChanged && !divisionChanged && nextMilestone && (
            <p className="text-center text-sm text-gray-400 mt-2">
              {nextMilestone.factsNeeded} more until {nextMilestone.milestone}
            </p>
          )}
        </div>
      </motion.div>
    )}
  </motion.div>
)}

{/* Then continue with existing Damage Leaderboard... */}
```

**Testing Scenarios**:

1. **No Progress**:
   - Complete raid without mastering facts
   - Expected: No progression section shown

2. **Facts Only**:
   - Master 2 facts, no rank/division change
   - Expected: Shows "✨ You mastered 2 new facts! 3 more until Silver II"

3. **Division Change**:
   - Progress from Silver III to Silver II
   - Expected: Shows division animation + facts mastered

4. **Rank Change**:
   - Progress from Bronze I to Silver IV
   - Expected: Full celebration animation + facts that caused it

---

## Edge Cases & Considerations

### Handled Edge Cases
- **First Raid**: No previous rank (null → bronze)
- **Race Conditions**: UI uses stored values, not waiting for server updates
- **Grade Changes**: Mastery counting already filtered by grade
- **Failed Raids**: Don't exist in current implementation

### Known Limitations
- `raidAgain` is deprecated but still in UI
- No cleanup on navigation (values persist)
- Performance snapshots may arrive after ResultsScreen renders

### Future Enhancements
1. Track facts mastered per session (which specific facts)
2. Show progress toward specific rank goals
3. Celebration animations for major milestones
4. Progress tracking across multiple sessions

## Dependencies

### Existing Utilities Used
- `useMasteryStats` - Calculates grade-filtered mastery stats
- `calculateDivision` - Determines division within rank
- `getNextMilestone` - Calculates facts needed for next progression
- `RankGem` - Visual component for rank display
- `getRankColorClasses` - Consistent rank theming

### No Server Changes Required
All progression calculation happens client-side using existing data.

## Visual Design

### Layout Hierarchy
1. Victory announcement
2. Rank/Division progression (if applicable)
3. Facts mastered (if > 0)
4. Damage leaderboard
5. Loot chest
6. Other stats

### Animation Timing
- Victory header: 0s
- Rank progression: 0.6s delay
- Arrow animation: 0.8s delay  
- New rank reveal: 1.0s delay
- Facts mastered: 1.5s delay (or 0.7s if no rank change)

### Styling Consistency
- Reuses `RankGem` component from `RankBadge`
- Purple gradient theme for progression
- Dark backgrounds with backdrop blur
- Border highlights matching rank colors

## Rollback Plan

If issues arise, remove the progression section by:
1. Comment out the progression UI block in ResultsScreen
2. Keep data capture (harmless, for future use)
3. No server changes to revert

## Success Metrics

- Players understand their progression immediately
- No confusion about why rank changed
- Increased motivation to master more facts
- Clear path to next milestone






