# Fact Mastery Tracking - Server-Authoritative System

## Overview

Math Raiders tracks automaticity progress using a server-authoritative system. All mastery calculations happen server-side using grade-aware thresholds aligned to Alpha School CQPM standards.

## Data Storage

### AttemptRecord (Raw Observations)
```rust
pub struct AttemptRecord {
    pub time_ms: u32,      // Response time in milliseconds
    pub correct: bool,      // Whether answer was correct
    pub timestamp: Timestamp,  // When this attempt occurred
}
```

### FactMastery Table
```rust
pub struct FactMastery {
    pub player_id: String,
    pub fact_key: String,  // e.g., "7×8" (normalized, commutative ops smaller first)
    
    // Raw observations (10,000 rolling window)
    pub recent_attempts: Vec<AttemptRecord>,
    
    // Aggregates (performance optimization)
    pub total_attempts: u32,
    pub total_correct: u32,
    pub avg_response_ms: u32,
    pub fastest_ms: u32,
    
    // Server-maintained cache (recalculated every answer + grade change)
    pub mastery_level: u8,  // 0-5
}
```

## Mastery Calculation (Server-Side Only)

### Grade-Aware Thresholds
```rust
fn get_fast_threshold_ms(grade: u8) -> u32 {
    match grade {
        0 => 3000,      // K: 20 CQPM (3.0s per problem)
        1..=3 => 2000,  // G1-3: 30 CQPM (2.0s per problem)
        4 => 1700,      // G4: 35 CQPM (1.7s per problem)
        _ => 1500,      // G5+: 40 CQPM (1.5s per problem)
    }
}
```

### Mastery Levels (Last 3 Attempts - Grade Relative)
```rust
fn calculate_mastery_level(fact: &FactMastery, grade: u8) -> u8 {
    let last_3 = &fact.recent_attempts[last 3...];
    let threshold = get_fast_threshold_ms(grade);
    
    let correct_count = last_3.filter(|a| a.correct).count();
    
    // Grade-relative speed tiers
    // L5 requires 2+ fast to reduce false positives from lucky single attempts
    let hit_1x_count = last_3.filter(|a| a.correct && a.time_ms <= threshold).count();
    let hit_2x = last_3.any(|a| a.correct && a.time_ms <= threshold * 2);
    let hit_3x = last_3.any(|a| a.correct && a.time_ms <= threshold * 3);
    
    // Levels based on speed progression
    if hit_1x_count >= 2 { 5 }  // Gold: Mastered (2+ fast in last 3)
    else if hit_2x { 4 }  // Purple: Close (within 2x threshold)
    else if hit_3x { 3 }  // Purple: Developing (within 3x threshold)
    else if correct_count >= 2 { 2 }  // Cyan: Accurate (2+ correct but slow)
    else if correct_count >= 1 { 1 }  // Cyan: Practicing
    else { 0 }  // Gray: All wrong or not attempted
}
```

## Cache Invalidation

**Mastery level is recalculated:**
1. **Every answer** - Uses current player grade
2. **Grade change** - Batch recalculation for all player facts (set_grade reducer)
3. **Always fresh** - SpacetimeDB transactions ensure atomicity

**Client never calculates mastery** - reads `mastery_level` from server via subscriptions.

## Grade Transition Example

**Student at G3:**
- 7×8 last 3 times: [1.6s, 1.7s, 1.9s]
- Threshold: 2.0s (30 CQPM)
- 2+ hits threshold? Yes (1.6s, 1.7s, 1.9s qualify)
- **Mastery level: 5** (mastered)

**Advances to G4:**
- Same times: [1.6s, 1.7s, 1.9s]
- **New threshold: 1.7s** (35 CQPM)
- 2+ hits threshold? Yes (1.6s, 1.7s qualify)
- **Mastery level: 5** (still mastered)
- Server auto-recalculates ✅

## Track Master Certification

**Requirements:**
- 100% of operation facts at mastery level 5
- 8 of last 10 raids above CQPM target (+2 buffer)
- Minimum 10 raids for sample size

**Example (G5 Multiplication):**
- 169 multiplication facts all at Gold
- Last 10 raids: [45, 43, 41, 44, 42, 38, 46, 43, 44, 42 CQPM]
- Target: 40 CQPM, buffer: 42 CQPM
- Qualified: 8 raids above 42 ✓
- **Multiplication Master certified**

## Performance

**10,000 attempt window:**
- Handles years of practice data
- Slice last 3 for mastery: O(1)
- Remove old attempts: O(n) but rare (once per 10K attempts)

**SpacetimeDB subscriptions:**
- Client receives updated mastery_level automatically
- No polling, pure reactive
- React re-renders affected components

## Visual Indicators (Client)

**Colors (determined by server's mastery_level):**
- **Gold (L5):** Mastered ⚡
- **Purple (L3-4):** Strong/Developing 💪
- **Cyan (L1-2):** Learning 📚
- **Gray (L0):** Not attempted

**Track Stars (per-operation):**
- Bronze tier (0-25%): Dim star
- Silver tier (25-50%): Brighter star  
- Gold tier (50-75%): Bright star with shine
- Diamond tier (75-100%): Brilliant star
- Master (100% + 8/10 raids): Gold border, max glow

## Tooltips (Recent Performance)

**Mastery Grid:**
- Shows last 3 attempts accuracy and speed (recency-focused)
- Updates as student improves
- Example: "7 × 8 = 56 • 100% • 1.2s"

**Track Stars:**
- Phase 1: "⭐ 45/169 Multiplication mastered"
- Phase 2: "✓ Multiplication mastered! - 6 of last 10 fast - Stay fast to reach 8!"
- Phase 3: "⚔️ Multiplication Master - Ready for your test! (40+ per minute)"

## Architecture Principles

**Server = Source of Truth:**
- Calculates mastery using student's current grade
- Stores raw attempt data (observations)
- Caches expensive calculations (mastery_level)

**Client = Dumb Displayer:**
- Reads mastery_level from server
- Shows colors, animations, tooltips
- Never calculates game logic

**Classic MMO pattern:** Server computes, client renders.


