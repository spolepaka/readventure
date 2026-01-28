# XP Engagement Analysis & Proposed Fix

## The Problem

Current XP formula rewards **time × accuracy ≥ 80%**, which doesn't measure actual engagement.

A student can:
- Have game open while watching YouTube
- Answer occasionally when attention drifts back
- Get full XP for 150 seconds with only 4 problems answered

## Case Study: De'Marcus Collins (Dec 1-2, 2025)

### Profile
- **80 raids in 2 days** (high volume)
- **95% accuracy** (knows the material)
- **10.1 avg CQPM** (but capable of 32.3)
- **73% full-timer raids** vs 25% peer average

### November vs December
| Metric | November | December | Change |
|--------|----------|----------|--------|
| Avg CQPM | 21.7 | 10.1 | -53% |
| Accuracy | 93% | 95% | +2% |
| Full Timers | 18% | 73% | +4x |

**Key insight:** Accuracy went UP while speed went DOWN. He's not struggling - he's multitasking.

### Behavioral Evidence
| Pattern | Count | Interpretation |
|---------|-------|----------------|
| 1-5 min between raids | 68% | Doing something else |
| Back-to-back (<1 min) | 11% | When focused: 23.8 CQPM |
| Big speed swings (2x) | 37% | Attention comes and goes |

### Anti-Cheat Assessment
| Indicator | Value | Flag |
|-----------|-------|------|
| Accuracy 80-84% (threshold hover) | 1% | ✅ Not gaming threshold |
| Response time variance | 1.1s - 37.5s | ✅ Human pattern |
| Raids <5 problems | 2.5% | ⚠️ Minor AFK |

**Verdict:** Not malicious farming. Natural "second-screen" behavior that the system happens to reward.

## The Core Issue

| What System Measures | What It Should Measure |
|---------------------|------------------------|
| Time × Accuracy ≥ 80% | Time × Accuracy × **Engagement** |

De'Marcus at 95% accuracy isn't gaming the 80% threshold - he's exploiting the lack of volume requirement.

## Solution Options Considered

### Option 1: Fixed Problem Floor
```
XP if Accuracy ≥ 80% AND Problems ≥ 10
```
**Problem:** Unfair to slow learners. 10 problems is easy for a 30 CQPM student, hard for a 10 CQPM student.

### Option 2: Accuracy-Adjusted Floor
```
If Accuracy ≥ 90%: Require 10 problems
If Accuracy < 90%: Require 6 problems
```
**Problem:** Binary cutoffs, edge cases.

### Option 3: Per-Student Adaptive (Recommended)
```
Floor = 30% of student's personal best CQPM
```
**Why it works:**
- Uses BEST, not average (can't sandbag your ceiling)
- Fair to each student's ability
- Struggling students get lower floor automatically

## Implemented Solution

### Formula
```
PersonalBest = Max CQPM from player's raids on this track
FloorCQPM = max(2.0, PersonalBest × 0.15)
RawEngagement = SessionCQPM / FloorCQPM

Engagement:
  - If RawEngagement < 0.30: 0.0 (true AFK gets nothing)
  - Otherwise: min(1.0, RawEngagement)

XP = BaseXP × Engagement (if accuracy >= 80%)
```

### Implementation (server/src/lib.rs)

```rust
/// Get player's best CQPM on a specific track.
/// Returns 10.0 for new players (generous default).
fn get_player_best_cqpm(ctx: &ReducerContext, player_id: &str, track: &Option<String>) -> f32 {
    let snapshots: Vec<_> = ctx.db.performance_snapshot()
        .player_id()
        .filter(player_id)
        .collect::<Vec<_>>()
        .into_iter()
        .filter(|s| s.track == *track && s.session_seconds > 30)
        .collect();
    
    let best = snapshots.iter()
        .map(|s| s.problems_correct as f32 * 60.0 / s.session_seconds as f32)
        .fold(0.0_f32, |a, b| a.max(b));
    
    if best < 1.0 { 10.0 } else { best }
}

/// Calculate engagement multiplier for XP.
/// Floor = max(2.0, 25% of their best CQPM on this track)
/// No cap - scales with ability to prevent sandbagging.
/// Returns 0.0 if below 30% of floor (true AFK), otherwise proportional.
fn calculate_engagement(session_cqpm: f32, player_best_cqpm: f32) -> f32 {
    let floor = f32::max(2.0, player_best_cqpm * 0.25);
    let raw_engagement = session_cqpm / floor;
    
    if raw_engagement < 0.3 {
        0.0  // True AFK gets nothing
    } else {
        f32::min(1.0, raw_engagement)
    }
}
```

### Key Design Decisions

1. **25% floor (no cap)**: Must hit 25% of personal best for full XP; scales with ability to prevent sandbagging
2. **Bare minimum 2.0 CQPM**: Protects new players and slow learners  
3. **30% cutoff for zero XP**: Only true AFK (~38s/problem) gets nothing
4. **Per-track calculation**: ALL track has separate history from single-track
5. **Still requires 80% accuracy**: Engagement is layered on top of accuracy requirement

### Example Impact

**De'Marcus (Best: 31 CQPM → Floor: 7.75 CQPM)**

| Session CQPM | % of Best | Engagement |
|--------------|-----------|------------|
| 31 (peak) | 100% | 100% |
| 20 | 65% | 100% |
| 10 | 32% | 100% |
| 7.75 | 25% | 100% |
| 5 | 16% | 65% |
| 3 | 10% | 39% |

**Struggling Learner (Best: 8 CQPM → Floor: 2.0 CQPM, protected by minimum)**

| Raid Type | Problems | Current XP | New XP |
|-----------|----------|------------|--------|
| Slow | 8 | 100% | **40%** |
| Normal | 15 | 100% | **75%** |
| Good | 22 | 100% | **100%** |

### Why 30%?
- Generous enough for bad days (only need 1/3 of your proven best)
- Still catches obvious AFK (De'Marcus 4-problem raids = 17%)
- Self-calibrating per student

### Edge Cases

| Scenario | Handling |
|----------|----------|
| New player (no history) | Default `bestCQPM = 10`, first raids get full XP |
| Player improves | Best naturally rises, floor rises |
| Player has one lucky fast raid | Bar set higher, but 30% is forgiving |
| Genuine slow learner | Their best is lower, so their floor is lower |

## Why This Is Fair

The system asks: **"Did you perform at 30% of what we know you're capable of?"**

- Fast student (best 40 CQPM) needs 12 CQPM minimum
- Slow student (best 20 CQPM) needs 6 CQPM minimum
- Struggling student (best 15 CQPM) needs 4.5 CQPM minimum

Everyone is held to their own standard, not a universal bar.

## Summary

| Current System | Proposed System |
|---------------|-----------------|
| Rewards time + accuracy | Rewards time + accuracy + engagement |
| Same bar for everyone | Per-student adaptive bar |
| AFK gets 100% XP | AFK gets ~17% XP |
| Slow learner = full XP | Slow learner = full XP (lower bar) |
| Can be passively exploited | Requires active participation |

**One line change in XP calculation. Zero schema changes. Fair to all students.**

