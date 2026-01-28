# Progressive Pool Restriction

## Context

Math Raiders uses a 70/20/10 adaptive algorithm to prioritize weak facts over mastered ones. This works well when students have mixed mastery across a track.

## Problem

When a student enters a new track (e.g., G2 Subtraction), they face all 176 facts at once with zero prior mastery. The adaptive algorithm fails because:

- **No variance to exploit.** 70% "weak" pulls from a pool that's 100% weak. There's no easier subset to fall back on.
- **Slow, frustrating practice.** Students like Ren stay at 8 CQPM for 3+ months. Each problem takes 7+ seconds. Low rep volume, high cognitive load.
- **Not DI-aligned.** Direct Instruction requires mastery before progression. We're violating this by exposing all difficulty levels simultaneously.

## Solution

Restrict the fact pool in Quick Play based on track mastery%. Start students on rule-based/pattern facts, expand to pure memorization facts as they demonstrate speed.

- **Quick Play (adaptive boss):** Pool restricted by mastery% using research-backed difficulty tiers
- **Mastery Trials (fixed boss 1-8):** Full pool, proves AMF readiness

This requires no new tables. We derive pool size from existing FactMastery data—the same source of truth that powers the 70/20/10 algorithm.

## Options considered but decided against

- **Split tracks into sub-tracks (TRACK10A, TRACK10B).** More explicit but adds UI complexity. Students shouldn't have to manage their own progression.
- **Time-based unlock.** "After N sessions, expand pool." Doesn't respect actual mastery. Fast learners wait unnecessarily, slow learners get promoted too early.
- **Numerical thresholds (sum ≤ 10, etc.).** Simpler but misses research insights. ×10 facts are easy (pattern) but would be excluded by "factor ≤ 5".

## Prior art

- **Kovaak's/Voltaic:** Benchmark scores gate scenario access. You can't grind Platinum scenarios until you've passed Gold.
- **Cognitive research:** Ashcraft (1992), Siegler (1988), Campbell & Graham (1985) established which facts are easier based on strategy availability vs pure memorization.

## Usage scenarios

**Ren (G2, new to subtraction on TRACK10)**
Today: Sees all 176 subtraction facts. Averages 8 CQPM. Stuck for months.
With restriction: Starts with 50 tier-0 facts (-0, -1, n-n). Builds speed. Hits 10% mastery. Pool expands. Continues progressing.

**Experienced student entering new track**
Diagnostic seeds initial FactMastery. If already fast on tier-0 facts, mastery% starts higher. Pool expands quickly. No unnecessary gating.

**Student attempting Mastery Trial**
Full pool regardless of mastery%. This is the gate to AMF—they need to prove they can handle everything.

## Milestones

### MS1: Core implementation

**Difficulty tier function (research-backed)**

```rust
fn get_difficulty_tier(left: u8, right: u8, op: Operation) -> u8 {
    match op {
        Add => {
            if left == 0 || right == 0 { 0 }        // +0 (identity)
            else if left == 1 || right == 1 { 0 }   // +1 (counting)
            else if left == right { 0 }              // doubles
            else if (left as i8 - right as i8).abs() == 1 { 1 } // near-doubles
            else if left == 2 || right == 2 { 1 }   // +2
            else if left == 10 || right == 10 { 1 } // +10
            else if left == 9 || right == 9 { 2 }   // +9
            else if left + right == 10 { 2 }        // make-10
            else { 3 }
        },
        Subtract => {
            if right == 0 { 0 }                     // -0
            else if right == 1 { 0 }                // -1
            else if left == right { 0 }             // n-n = 0
            else if left - right <= 2 { 1 }         // small difference
            else if right == 2 { 1 }                // -2
            else if left <= 10 { 2 }                // within-10
            else { 3 }
        },
        Multiply => {
            if left == 0 || right == 0 { 0 }        // ×0
            else if left == 1 || right == 1 { 0 }   // ×1
            else if left == 2 || right == 2 { 1 }   // ×2 (doubling)
            else if left == 5 || right == 5 { 1 }   // ×5 (pattern)
            else if left == 10 || right == 10 { 1 } // ×10 (pattern)
            else if left == right { 2 }             // squares
            else if left == 9 || right == 9 { 2 }   // ×9 (finger trick)
            else if left <= 4 && right <= 4 { 2 }   // small
            else { 3 }                              // the killers
        },
        Divide => {
            if right == 1 { 0 }                     // ÷1
            else if left == right { 0 }             // n÷n = 1
            else if right == 2 { 1 }                // ÷2 (halving)
            else if right == 5 { 1 }                // ÷5
            else if right == 10 { 1 }               // ÷10
            else if left <= 25 { 2 }                // small dividend
            else { 3 }
        },
    }
}
```

**Tier distribution by track (verified)**

| Track | Total | T0 | T1 | T2 | T3 |
|-------|-------|-----|-----|-----|-----|
| TRACK12 (Add ≤10) | 36 | 24 | 8 | 2 | 2 |
| TRACK9 (Add 0-9) | 56 | 28 | 13 | 7 | 8 |
| TRACK6 (Add to 20) | 121 | 49 | 29 | 8 | 35 |
| TRACK10 (Sub from 20) | 176 | 50 | 34 | 15 | 77 |
| TRACK8 (Sub to 20) | 176 | 50 | 34 | 15 | 77 |
| TRACK11 (Mult 0-9) | 55 | 19 | 15 | 12 | 9 |
| TRACK7 (Mult 0-12) | 91 | 25 | 30 | 16 | 20 |
| TRACK5 (Div 0-12) | 144 | 23 | 33 | 22 | 66 |

**Mastery thresholds**

| Track Mastery | Allowed Tiers | Ren on TRACK10 |
|---------------|---------------|----------------|
| 0-10% | T0 only | 50 facts |
| 10-25% | T0 + T1 | 84 facts |
| 25-50% | T0 + T1 + T2 | 99 facts |
| 50%+ | All tiers | 176 facts |

**Implementation**
- In `generate_adaptive_problem`, check `is_adaptive_boss(boss_level)`
- If not adaptive (Mastery Trials): skip filtering, use full pool
- Calculate track mastery% from FactMastery
- Filter allowed_facts to only include tiers ≤ max_tier based on mastery%

### MS2: Observe and tune

- Watch students like Ren for CQPM improvement within 4 weeks
- Verify tier distribution feels right (students not stuck between tiers)
- Confirm no regression for already-fluent students
