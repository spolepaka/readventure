# Math Raiders K-5 Implementation Phases

Each phase produces a fully functional game. Ship after each phase.

## Phase 0: Current State ✓
**What works:** Multiplication-only for grades 3-5, SRS algorithm, multiplayer raids
**Fact count:** 169 multiplication facts (0-12 × 0-12)
**Players see:** Current game exactly as is

---

## Phase 1: Complete Operations Infrastructure (16 hours)
**Ship date:** End of Day 2
**What changes:** Build entire operations system + enable all 4 operations
**Fact count:** ~775 unique facts defined, all operations active
**Players see:** Mixed operations from ALL ~775 facts (no filtering, tier system removed)

### Sub-phase 1A: Backend Operations (4 hours)
**Test after:** Unit tests pass
```rust
// 1. Extend Operation enum with all 4 operations
// 2. Implement compute() for all operations
// 3. Update normalize_fact() for all operations
// 4. Write comprehensive unit tests
// Test: cargo test operations
```

### Sub-phase 1B: Frontend Operations (3 hours)
**Test after:** UI handles all operation types
```typescript
// 1. Update ProblemDisplay for all operation symbols
// 2. Fix answer validation (negatives, division)
// 3. Test with mock problems locally
// Test: Create manual test problems with all ops
```

### Sub-phase 1C: Fact Generation Script (5 hours)
**Test after:** Script generates valid facts
```python
// 1. Write fact generation script
// 2. Generate ~775 unique facts with grade tags
// 3. Output both Rust and TypeScript files
// Test: Verify fact counts match spec
```

### Sub-phase 1D: Integration (4 hours)
**Test after:** Game works with all 4 operations
```rust
// 1. Import generated facts into server
// 2. Remove tier filtering - serve all facts
// 3. Test all 4 operations working
// Test: Full gameplay with mixed operations
```

### Why this breakdown works:
- Each sub-phase has clear test criteria
- Can catch issues early
- Natural stopping points
- Dependencies are clear

---

## Phase 2: Grade System (8 hours)
**Ship date:** Day 3
**What changes:** Add grades and replace tier system with grade-based filtering
**Fact count:** 42 (K), 66 (G1), 265 (G2), 562 (G3), 313 (G4), 775 (G5)
**Players see:** Grade picker + grade-appropriate facts (not all facts)

### Implementation:
```rust
// 1. Add grade field to Player table
// 2. Migration: map tiers to grades (Spark→3, etc)
// 3. Add grade picker UI (K-5)
// 4. Replace get_tier_facts() with get_grade_facts()
// 5. Remove ALL tier code (Spark/Volt/Thunder/Mega gone!)
```

### Why this second:
- One line change unleashes Phase 1 work
- Immediate value for all grades
- Core game loop complete
- Everything else is polish

---

## Phase 3: Rank System (6 hours)
**Ship date:** Day 4 morning
**What changes:** Replace tiers with Bronze/Silver/Gold/Diamond/Legendary ranks per grade
**Players see:** New rank badges, clearer progression

### Implementation:
```rust
// 1. Calculate ranks from mastery counts (% based)
// 2. Update UI to show rank badges
// 3. Tiers already gone - ranks are the new system
// 4. Add rank up/down notifications
```

### Why this sixth:
- Pure UI/progression change
- Doesn't affect core gameplay
- Can iterate on thresholds
- Motivational enhancement

---

## Phase 4: Metrics & Polish (6 hours)
**Ship date:** Day 4 end
**What changes:** CQPM display, critical hits, XP integration, victory stats
**Players see:** Rich feedback on performance + Timeback XP

### Implementation:
```rust
// 1. Add CQPM to raid end screen
// 2. Implement critical hit system (10%/1%)
// 3. Add XP award webhook to Timeback
// 4. Update victory screen with stats
```

### Why this last:
- All core systems proven
- Pure enhancement layer
- Can tune based on data
- Easy to modify/remove

---

## Rollback Points

Each phase can be rolled back independently:
- **Phase 1**: Revert Operation enum to Multiply-only
- **Phase 2**: Revert to tier-based filtering (restore tier code)
- **Phase 3**: Skip rank display, keep using grade only
- **Phase 4**: Feature flags for each polish item

## Success Metrics Per Phase

1. **Operations**: All tests pass, no crashes
2. **Fact Data**: Fact counts match spec exactly
3. **Grade Infra**: All players have valid grades
4. **All Operations**: >90% problems have correct answers
3. **Ranks**: Clear progression, no confusion
4. **Polish**: Higher engagement, XP flowing

## The Key Principle

**Every phase ships a working game.** No half-built features. No "coming soon" UI. No broken experiences.

If we stop after any phase, we have a better game than we started with.
