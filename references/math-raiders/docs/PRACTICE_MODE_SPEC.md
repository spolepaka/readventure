# Practice Mode Specification

> **Status:** Ready to build
> **Priority:** High — solves L0-L1 acquisition gap

## TL;DR

Practice Mode teaches DI-style derivation strategies to students who have **proven weak** (L0-L1) on specific facts in Raids. It's a 2-5 minute "safety net" before raids, not a full acquisition curriculum.

**Key decisions made:**
- **Real-time, not batched** — XP is Timeback credit (gates fun activities), so server must validate
- **Same architecture as Raids** — 4 reducers, familiar pattern
- **Only proven weak facts** — Never-seen facts excluded; Raids diagnose, Practice remediates
- **No timer** — DI-aligned; acquisition is about accuracy, not speed
- **3 weak + 1 mastered per session** — 3 L0-L1 facts to learn, 1 L3+ discrimination fact to prevent rote
- **Helper + Enemy** — Helper teaches (Model/Lead), enemy minion tests (Test/Firm-up)

**Dependencies:**
- FactMastery table (already exists)
- Mastery levels L0-L1 identification (already exists)

---

## Overview

Practice Mode is a 2-5 minute "safety net" that teaches derived fact strategies to students who have proven weak on specific facts in Raids. It follows Direct Instruction (DI) principles: Model → Lead → Test → Firm-up.

**Philosophy:**
- Raids diagnose and prove mastery (fluency)
- Practice Mode teaches strategies (acquisition)
- "Learn with help, prove without help"
- **Self-sufficient teaching:** Guides provide motivation, not instruction. The app must exhaust every approach (fallback strategies, prerequisite drilling, error diagnosis) before flagging for help.

---

## Learning Science

### Direct Instruction Core Loop

| Step | What Happens | Purpose |
|------|--------------|---------|
| **Model** | Show the derivation strategy | "Here's the trick" |
| **Lead** | Guided sub-questions | "Let's do it together" |
| **Test** | Student solves independently | "Now you try" |
| **Firm-up** | 3 consecutive correct | "Prove you've got it" |

### DI Error Correction (Model → Test → Delayed Test)

Per Engelmann's Direct Instruction methodology (Ch 1), error correction follows a 3-step procedure:

1. **Model** — Show correct response OR ask leading questions so student generates it
2. **Test** — Present same task again with no assistance
3. **Delayed Test** — Return to *beginning* of original task, present entire sequence again

**Implementation:** When a student fails Test, we don't just re-show Model+Lead and immediately retry. We:
1. Correct (Model+Lead)
2. Cycle to other facts (the "delayed" part)
3. Return to the failed fact and re-present the FULL Model→Lead→Test sequence

This prevents short-term echo and strengthens actual retention.

### Timer: None (But Track Response Time)

Practice Mode has no timer. DI is explicit: during learning/acquisition, no time pressure. Students should think through the strategy, not rush.

| Mode | Timer? | Purpose |
|------|--------|---------|
| **Raids** | ✅ Yes | Fluency — speed matters |
| **Practice** | ❌ No | Acquisition — accuracy matters |

**However:** Track response time silently for analytics. DI notes that "students who work problems with relative fluency are more likely to retain strategies over a longer period." We don't pressure students, but we collect data to inform future iterations.

### Thinking Pause (DI Ch 1, p. 6)

> "The duration of the thinking pause is determined by the length of time the lowest-performing student needs to figure out the answer."

After showing a sub-question in Lead or a problem in Test/Firm-up:
- **Delay input activation by 0.5-1s** (input fades in)
- Prevents rushing before student processes the question
- Subtle visual cue that thinking is expected

### Derived Fact Strategies

#### Addition

| Strategy | When | Example |
|----------|------|---------|
| +0 Identity | Adding zero | 7+0 = 7 |
| +1/+2 Count on | Adding small | 7+2 = 9 |
| Doubles | Same numbers | 6+6 = 12 |
| Near doubles | One apart | 6+7 = 6+6+1 = 13 |
| Make 10 | Crosses 10 | 8+5 = 8+2+3 = 13 |
| +10 Place value | Adding ten | 7+10 = 17 |

#### Subtraction

| Strategy | When | Example |
|----------|------|---------|
| -0 Identity | Subtracting zero | 7-0 = 7 |
| -1/-2 Count back | Subtracting small | 7-2 = 5 |
| Think addition | Any subtraction | 13-5 → 5+?=13 → 8 |
| Back through 10 | Crosses 10 | 15-7 = 15-5-2 = 8 |

#### Multiplication

| Table | Strategy | Example |
|-------|----------|---------|
| ×0 | Zero property | 0×7 = 0 |
| ×1 | Identity | 1×7 = 7 |
| ×2 | Doubles | 2×7 = 14 |
| ×3 | Double + one more | 3×7 = 2×7 + 7 = 21 |
| ×4 | Double-double | 4×7 = 2×(2×7) = 28 |
| ×5 | Clock/skip count | 5×7 = 35 |
| ×6 | Fives + one more | 6×7 = 5×7 + 7 = 42 |
| ×7 | Fives + double | 7×6 = 5×6 + 2×6 = 42 |
| ×8 | Tens minus double | 8×7 = 10×7 - 2×7 = 56 |
| ×9 | Tens minus one | 9×7 = 10×7 - 7 = 63 |
| ×10 | Place value | 10×7 = 70 |
| ×11 | Tens + ones | 11×7 = 10×7 + 7 = 77 |
| ×12 | Tens + double | 12×7 = 10×7 + 2×7 = 84 |

#### Division

All division uses **think multiplication**: 56÷7 → "7 times what equals 56?" → 8

---

## Step Details

### Model Step

The minion shows the derivation in a speech bubble. Content varies by strategy:

| Strategy | Model Content |
|----------|---------------|
| Plus one | "6+1? Just say the next number after 6. Seven!" |
| ×12 (tens + double) | "12×7? Here's the trick! 10×7=70, 2×7=14, 70+14=84!" |
| ×9 (tens minus one) | "9×7? Easy! 10×7=70, minus one 7 is 63!" |
| Make 10 (addition) | "8+5? Let's make 10 first! 8+2=10, then +3 more = 13!" |
| Think addition (sub) | "13-5? Start with the big number. Think: 5 plus what equals 13? That's 8!" |
| Basic subtraction | "8-5? Start with the big number, 8. Take away 5. That's 3!" |
| Basic division | "56÷7? Start with the big number, 56. How many 7s? That's 8!" |

The derivation is shown step-by-step with visual highlights. Student taps "Continue" to proceed.

### Fact Families in Model (DI Ch 6, p. 69-71)

DI uses "three-number fact families" to teach relationships:
- Numbers 6, 7, 13 generate: 6+7=13, 7+6=13, 13-6=7, 13-7=6
- Numbers 7, 8, 56 generate: 7×8=56, 8×7=56, 56÷7=8, 56÷8=7

**Consider showing the family when relevant:**
- "8+5=13 means 13-5=8 too!"
- "7×8=56 means 56÷8=7!"

This builds awareness that mastering one fact gives you its inverses. Adds 1 line to Model, low cost.

### Series Showing (DI Ch 6, p. 74)

DI teaches related facts in series (6+2=8, 7+2=9, 8+2=10) to show the counting pattern.

**Consider:** Before testing 7+2, Model could briefly show the series:
- "See the pattern? 6+2=8, 7+2=9, 8+2=10. Each goes up by one!"
- Then test: "Now you try: 7+2?"

This is optional/V2 — adds complexity but builds relational understanding.

### "Big Number First" Rule (DI Ch 6, p. 75)

> "When you subtract, you always start with the big number."

This prevents errors like answering "5" for 3-8 (confusing operand order).

**All subtraction/division Model scripts must include:**
- "Start with the big number, [X]..."
- This is explicit language, not optional flavor

### Lead Step (Sub-Questions)

Lead breaks the strategy into guided sub-questions. Examples:

**For 12×7 (tens + double):**
1. "What's 10×7?" → 70
2. "What's 2×7?" → 14
3. "What's 70+14?" → 84

**For 8+5 (make 10):**
1. "What do we add to 8 to make 10?" → 2
2. "If we used 2, how much is left from 5?" → 3
3. "What's 10+3?" → 13

**For 15-7 (back through 10):**
1. "What's 15-5?" → 10
2. "We subtracted 5, how much more to subtract?" → 2
3. "What's 10-2?" → 8

**For 6+7 (near doubles):**
1. "What's 6+6?" → 12
2. "7 is one more than 6, so add..." → 1
3. "What's 12+1?" → 13

**For 56÷7 (think multiplication):**
1. "Think: 7 times what equals 56?"
2. "What's 7×8?" → 56
3. "So 56÷7 = ?" → 8

**Error handling in Lead:** Wrong answer → show correct answer → retry same sub-question. Max 3 retries per sub-question, then show answer and move on. No penalty, it's guided practice.

### Extended Lead Fallback (DI Ch 6, p. 74)

> "Lower-performing students may find that several days of practice on [scaffolded parts] are needed."

**When `current_fact_attempts` reaches 2 (third try):**
- Trigger Extended Lead before Test
- Show 2-3 related facts in series before re-testing
- Example: If 7+2 keeps failing, show "6+2=8, 7+2=9, 8+2=10" pattern first
- This is automatic escalation, not manual intervention

**If they still fail after Extended Lead → defer fact to next session.**

Uses `current_fact_attempts` field in PracticeSession (no separate counter needed).

### Test Step

Student sees the problem with no hints:
- "12×7 = ?"
- Input box for answer
- No derivation visible
- No timer

### Firm-up Step

Same as Test, but repeated 3 times consecutively:
- Show problem
- Student answers
- If correct: echo full equation ("7 × 8 = 56!"), progress indicator updates (●○○ → ●●○ → ●●●)
- If wrong: reset to ○○○, show "The answer is 84", student types correct answer to confirm, then continue
- Minion HP bar depletes with each correct answer

### Echo Full Equation (DI Ch 6, p. 79)

> "Saying the entire fact statement... helps the student remember the fact."

On correct answer, display the complete equation:
- Student types "56" → show "7 × 8 = 56!" 
- Reinforces the full association, not just the isolated answer
- 1-line UI addition, pedagogically sound

---

## Prerequisites

### Why Prerequisites Matter

Some strategies depend on knowing other facts. For example, ×8 (tens minus double) requires knowing ×10 and ×2. If a student doesn't know 10×7 or 2×7, teaching 8×7 won't work.

### Prerequisite Map

| Strategy | Prerequisites |
|----------|---------------|
| ×3 (double + one) | ×2 facts |
| ×4 (double-double) | ×2 facts |
| ×6 (fives + one) | ×5 facts |
| ×7 (fives + double) | ×5 and ×2 facts |
| ×8 (tens minus double) | ×10 and ×2 facts |
| ×9 (tens minus one) | ×10 facts |
| ×11 (tens + ones) | ×10 facts |
| ×12 (tens + double) | ×10 and ×2 facts |
| Near doubles (add) | Doubles facts |
| Make 10 (add) | Bonds to 10 |
| Think addition (sub) | Corresponding addition fact |

### Queue Sorting by Prerequisites

When building the practice queue:
1. Check if any queued fact's prerequisites are also L0-L1
2. If so, put the prerequisite fact first
3. This ensures students learn foundational facts before dependent ones

### Reactive Safety Net

If during Lead, a student fails a prerequisite sub-question repeatedly:
- Show a quick inline reminder of that prerequisite
- "Remember: 10×7 = 70"
- Then continue with the Lead step

---

## User Flow

### Entry Point (Lobby)

- Practice button shows **shimmer + badge count** if L0-L1 facts exist
- Badge shows number of weak facts (e.g., "(3)")
- If no L0-L1 facts, button appears normal (no shimmer)

### Session Flow

1. Click Practice → transition to Practice screen
2. See "Level up 3 facts! 💪" with session progress: ○ ○ ○
3. For each fact:
   - Model: Minion shows derivation in speech bubble
   - Lead: Answer guided sub-questions
   - Test: Answer the full problem (no hints)
   - Firm-up: Answer 3 times consecutively (minion HP depletes)
   - On completion: progress updates (● ○ ○ → ● ● ○ → ● ● ●)
4. Session complete → "Practice Complete! +X XP" → "Go Raid!" button

**Design philosophy:** Opinionated default (3 facts) with escape hatch (exit anytime). Kids lack metacognition to self-regulate session length. We decide for them, but don't trap them if frustrated.

### Characters: Helper + Enemy

**Two characters for cleaner narrative:**

| Step | Who's On Screen | Role |
|------|-----------------|------|
| Model | Helper character | Shows strategy in speech bubble |
| Lead | Helper character | Asks sub-questions |
| Test | Enemy minion | Student attacks by answering |
| Firm-up | Enemy minion | 3 hits defeat it (●●● = minion KO) |

**Why separate:** Helper teaches you → then you prove it by defeating the enemy. Cleaner narrative than "attack your teacher."

### Minion HP (Visual Progress)

Each fact has an enemy minion with HP bar representing firm-up progress:

| Firm-up Progress | Minion HP |
|------------------|-----------|
| 0/3 | 100% |
| 1/3 | 66% |
| 2/3 | 33% |
| 3/3 | Defeated! 🎉 |

New minion appears for each fact.

---

## Session Design

### Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Facts per session | 3 | Short enough to complete, enough for cycle-back |
| Timer | None | DI-aligned learning environment |
| Exit | Allowed anytime | Escape hatch, not invitation. Completed facts still count. |
| Solo only | Yes | No multiplayer complexity |

**Why opinionated:** Kids don't know when to stop. Unlimited sessions → decision fatigue → worse outcomes. We set the goal (3 facts), show progress (● ○ ○), and let them leave if frustrated. Structure without punishment.

### Error Handling

**DI's 3-step error correction (Model → Test → Delayed Test) applied:**

**During Firm-up:**
- Wrong answer → reset streak to 0/3
- Show "The answer is X" (Model)
- Student types correct answer to confirm (Test)
- Continue with firm-up (no delayed test needed — we're already repeating)
- 5 cumulative errors → bail out, fact stays in queue for next session

**During Test (before firm-up):**
- Wrong answer → show Model + Lead again (correction)
- Cycle to other facts (the "delayed" part)
- When returning: re-present FULL Model→Lead→Test sequence (Delayed Test)
- 3 total Test failures on same fact → bail out

### Cycle-Back (Delayed Test Implementation)

When Test fails, student cycles through other facts before returning:
- Fail Fact A → do Fact B → do Fact C → return to Fact A
- **Critical:** When returning to Fact A, start from Model (not just Test)
- This is DI's "Delayed Test" — re-present the entire task from the beginning
- Prevents short-term echo, strengthens actual retention

---

## Queue Building

### What Enters the Queue

**Only facts that:**
1. Have a FactMastery record (seen in Raids)
2. Are L0-L1 mastery level (proven weak)

**Never-seen facts are excluded.** Raids diagnose first, Practice remediates.

### Sort Order

1. **Prerequisites first** — foundational facts before dependent facts
2. **Operation priority for G4+** — Mult/Div before Add/Sub (see below)
3. **Oldest `last_seen` first** — ensures rotation, no fact is stuck forever
4. **Review rotation rule** — every L0-L1 fact must appear at least once every 3 sessions
5. **Separate confusing strategies** — don't queue similar strategies in same session
6. **Separate inverse facts** — don't queue 8+5 and 13-5 together
7. **Append discrimination fact** — add 1 mastered (L3+) fact at end of queue

### Operation Priority (DI Ch 6, p. 72)

> "For upper-elementary and middle school students who did not master basic addition and subtraction facts by the end of third grade, we recommend presenting multiplication and division facts before returning to addition and subtraction."

**Why:** Older students likely have finger strategies for add/sub (slow but works). They have NO strategy for mult/div (completely stuck). Mult/div is more urgent for grade-level work.

**Queue rule for G4-G5 students:**
- If L0-L1 facts exist in both add/sub AND mult/div, prioritize mult/div
- Add/sub facts wait until mult/div facts are addressed

**Queue rule for K-G3 students:**
- Follow natural prerequisite order (add before sub, mult before div)
- No operation priority override

### Review Rotation Rule (DI Ch 6, p. 77)

> "After more than 30 facts have been introduced, review should be planned so that each fact appears at least once every second or third worksheet."

**Rule:** Every L0-L1 fact must appear in a session at least once every 3 sessions.

If `last_seen` > 3 sessions ago, bump priority regardless of other sorting.

This prevents facts from "falling through the cracks" due to prerequisite or strategy separation rules.

### Mastery Timeline Expectations (DI Ch 6, p. 78)

> "Students generally need anywhere from 3 days to 2 weeks to master a set."

**Set expectations:**
- Facts will stay in L0-L1 for multiple sessions — this is normal
- Don't expect instant mastery
- Consistent daily practice beats occasional long sessions

### Session Cap (Prevent Frustration)

**Context:** Alpha School allocates ~10 min to FastMath. If Practice Mode takes 10 min, students never reach Raids (the fun part).

**Rule:** Max 2 cycle-backs per fact per session.
- If a fact fails Model→Lead→Test twice, mark for next session
- Message: "We'll practice this one again tomorrow!"
- Fact stays L0-L1, appears first in next session's queue

**Worst case with cap:** ~7 minutes (still leaves time for 1 Raid)

**Why this is DI-aligned:** Preventing frustration protects "productive disposition" — students who experience success develop positive self-concepts.

### Strategy Separation (DI Ch 1, p. 3)

> "The more similar two skills are, the more likely students are to confuse them."

Don't queue these pairs in the same session:

| Strategy A | Strategy B | Why Confusing |
|------------|------------|---------------|
| ×6 (fives + one) | ×4 (double-double) | Similar skip count patterns (12, 24, 36) |
| ×9 (tens minus one) | ×8 (tens minus double) | Both "tens minus" strategies |
| ×11 (tens + ones) | ×12 (tens + double) | Both "tens plus" strategies |
| Near doubles (add) | Make 10 (add) | Both addition decomposition |

If both are L0-L1, teach one per session. The other waits for next session.

### Inverse Fact Separation (DI Ch 6, p. 72)

> "Students have more difficulty when a set of addition facts and the inverse subtraction facts are introduced concurrently."

Don't queue inverse facts in the same session:

| Fact A | Inverse Fact B | Why Separate |
|--------|----------------|--------------|
| 8+5 | 13-5 | Same three numbers, different operation |
| 7×8 | 56÷7 | Same three numbers, different operation |

If both are L0-L1, teach addition/multiplication first. Subtraction/division waits for next session.

### Rotation

When a fact is firm-up'd, its `last_seen` timestamp updates. Next session, it moves to the back of the queue. This ensures all weak facts eventually get practiced.

---

## XP System

### Formula

- **XP = elapsed minutes** (server-calculated, rounded)
- **Minimum 1 XP** if session completes
- **Requires ≥1 fact firm-up'd** to earn any XP

| Session | Facts Done | XP |
|---------|------------|-----|
| 3 min | 3 | 3 |
| 5 min | 3 | 5 |
| 5 min | 2 (quit early) | 5 |
| 2 min | 0 (quit early) | 0 |

### Why Server-Authoritative?

Practice XP contributes to **Timeback credits** (gates fun activities). Fake XP = bypassing parental controls. Server must validate all completions.

### XP Granted Immediately

XP is granted on each fact completion (3/3 firm-up), not batched at session end:
- Simpler — no `xp_earned` field needed in session table
- If session is abandoned, partial XP already granted
- Instant feedback (more satisfying)

---

## Architecture

### Pattern: Same as Raids

Practice follows the same 4-reducer pattern as Raids:

| Raids | Practice |
|-------|----------|
| `start_solo_raid` | `start_practice` |
| `request_problem` | `request_practice_fact` |
| `submit_answer` | `submit_practice_answer` |
| `leave_raid` | `leave_practice` |

### Reducer Signatures

```rust
// Creates session, builds queue, returns first fact
start_practice(ctx) -> StartPracticeResult

// Pops next fact from queue, sets as current
request_practice_fact(ctx) -> RequestFactResult

// Validates answer, updates streak, handles cycle-back/defer
// Client tells server whether this is Test or Firm-up phase
submit_practice_answer(ctx, answer: String, is_firmup: bool) -> SubmitResult

// Ends session, grants any remaining XP
leave_practice(ctx) -> LeavePracticeResult
```

### Why `is_firmup` Parameter?

After Firm-up wrong, streak resets to 0. But 0 also means "Test phase." Server can't distinguish from streak alone.

| Phase | If Wrong |
|-------|----------|
| Test (is_firmup=false) | Cycle-back, increment attempts |
| Firm-up (is_firmup=true) | Reset streak to 0, stay in Firm-up |

Client knows the phase. Just tell the server. Cheating doesn't help — still must answer correctly.

### Server Responsibilities

- Pick queue (L0-L1 facts, sorted by prereqs + last_seen)
- Track session state (current fact, firm-up streak)
- Validate answers (different handling based on `is_firmup`)
- Calculate XP from actual elapsed time
- Update `last_seen` on firm-up completion

### Client Responsibilities

- Track current phase (Model/Lead/Test/Firm-up) locally
- Display Model/Lead steps (not validated by server)
- Pass `is_firmup` flag when calling `submit_practice_answer`
- Show helper character for Model/Lead, enemy minion for Test/Firm-up
- Show firm-up progress (●●○)
- Handle transitions between steps
- Call reducers at appropriate moments

### PracticeSession Table

```rust
#[table(name = practice_session)]
pub struct PracticeSession {
    #[primary_key]
    pub player_id: String,              // One session per player (enforced by PK)
    
    pub started_at: Timestamp,          // For XP calculation
    
    pub current_fact: Option<String>,   // e.g., "7x8" — None if between facts
    pub firm_up_streak: u8,             // 0-3, reset on wrong Firm-up answer
    pub current_fact_attempts: u8,      // Extended Lead at 2, defer at 3 if fail
    
    pub queue: Vec<String>,             // Remaining facts to practice
    pub completed: Vec<String>,         // Facts that hit 3/3 firm-up
    pub deferred: Vec<String>,          // Facts that hit cycle-back limit
}
```

**7 fields. Each is necessary. None can be removed.**

| Field | Purpose |
|-------|---------|
| `player_id` | PK — enforces one session per player |
| `started_at` | XP = elapsed time |
| `current_fact` | What they're working on now |
| `firm_up_streak` | Track 0-3 progress in Firm-up |
| `current_fact_attempts` | Trigger Extended Lead (at 2) and defer (at 3) |
| `queue` | Remaining facts |
| `completed` | For session summary |
| `deferred` | For "we'll try tomorrow" message |

**Reuses existing tables:**
- `fact_mastery` — read for queue building, update on completion
- `player` — read grade (for op priority), update XP directly

### Strategy Data

Strategy definitions live **client-side** as hardcoded JSON (`client/src/data/strategies.ts`).
No server table needed — strategies don't change at runtime.

```typescript
interface Strategy {
  factPattern: string;           // e.g., "×12"
  modelText: string;             // Speech bubble template with {n} placeholder
  leadQuestions: LeadQuestion[];
  prereqs: string[];             // e.g., ["×10", "×2"]
}

interface LeadQuestion {
  prompt: string;                // "What's 10×{n}?"
  answerFn: (n: number, prevAnswers: number[]) => number;
}
```

---

## Anti-Cheating

| Attack | Prevention |
|--------|------------|
| Fake completions | Server validates every answer |
| Fake time | Server tracks start timestamp |
| Duplicate XP | Session deleted after completion |
| Idle farming | Must complete ≥1 fact for XP |

---

## Screen States

### Practice Button (Lobby)

| State | Appearance |
|-------|------------|
| Has weak facts | Shimmer ✨ + badge "(3)" |
| No weak facts | Normal button, no shimmer |

### Practice Screen

| State | What's Shown |
|-------|--------------|
| Model | Minion + speech bubble with derivation |
| Lead | Sub-question + input + "Let's try together!" |
| Test | Problem + input + "Now you try!" |
| Firm-up | Problem + input + HP bar + progress dots |
| Correction | Problem + "The answer is X" + input waiting for correct answer |

### Practice Complete Screen

- "Practice Complete! 🎉"
- Facts mastered count (e.g., "You learned 3 facts!")
- XP earned (e.g., "+5 XP")
- "Go Raid!" button (primary action)
- "Practice More" button (if more weak facts exist)

### All Caught Up Screen

If no L0-L1 facts when Practice clicked:
- "You're all caught up! 💪"
- "No facts need practice right now."
- "Go raid to discover more!"
- "Go Raid!" button

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No L0-L1 facts | Server returns empty queue, client shows "All caught up!" |
| Quit mid-session | Completed facts get `last_seen` updated, XP awarded for time |
| Disconnect | Session persists on server, can resume on reconnect |
| All facts bailed | Session ends, no XP (no completions), facts stay in queue |
| Only 1-2 weak facts | Session has fewer than 3 facts, still works |

---

## Implementation Checklist

### Server
- [ ] PracticeSession table
- [ ] 4 reducers (start, request_fact, submit_answer, leave)
- [ ] **`is_firmup` parameter** on submit_answer to distinguish Test vs Firm-up phase
- [ ] Queue building (L0-L1, sorted by prereqs + last_seen)
- [ ] **Strategy separation filter** — don't queue confusing strategy pairs together
- [ ] **Inverse fact separation** — don't queue 8+5 and 13-5 in same session
- [ ] **Operation priority (G4+)** — Mult/Div before Add/Sub for older students
- [ ] Answer validation
- [ ] XP calculation (elapsed time)
- [ ] **Response time tracking** — record silently for analytics (no pressure)
- [ ] **Fluency flag** — if response > 5s, mark as "not fluent" even if correct
- [ ] **Review rotation enforcement** — bump priority if `last_seen` > 3 sessions
- [ ] **Discrimination fact** — append 1 random L3+ fact to queue (skips Model/Lead)
- [ ] **Session cap** — max 2 cycle-backs per fact, then defer to next session
- [ ] `last_seen` update on firm-up

### Client
- [ ] Practice button with shimmer + badge (secondary row, next to Join Room)
- [ ] Weak fact count derivation (`masteryLevel <= 1 && totalAttempts > 0`)
- [ ] PracticeScreen component
- [ ] Model step UI (derivation display)
- [ ] Lead step UI (sub-questions)
- [ ] **Thinking pause** — delay input activation by 0.5-1s after showing question
- [ ] Test/Firm-up step UI (answer input)
- [ ] Correction step UI (after wrong answer — must type correct answer)
- [ ] **Delayed Test flow** — when returning to failed fact, start from Model (not Test)
- [ ] **Error classification** — detect fact/component/strategy errors, show appropriate feedback
- [ ] **"Big number first" language** — all sub/div Model scripts must include it
- [ ] **Extended Lead fallback** — trigger when `current_fact_attempts == 2`, show series
- [ ] **Echo full equation** — on correct, show "7 × 8 = 56!" (reinforces association)
- [ ] Helper character (Model/Lead steps)
- [ ] Enemy minion + HP bar (Test/Firm-up steps)
- [ ] Practice complete screen
- [ ] All caught up screen
- [ ] **Deferred fact message** — "We'll practice this one again tomorrow!" (after 2 cycle-backs)

### Data
- [ ] Strategy definitions per operation
- [ ] Lead sub-questions per strategy
- [ ] Prerequisite map for queue sorting
- [ ] Alternate fallback strategies per fact
- [ ] Error pattern → feedback message map

### V1 Core Features
- [ ] Visual arrays for multiplication (dot grid component)
- [ ] Number line for addition/subtraction
- [ ] Error pattern detection + targeted feedback
- [ ] Alternate strategy fallback system
- [ ] Prerequisite inline verification
- [ ] Strategy celebration messages

### V2+ (iterate with data)
- [ ] Audio/TTS for model steps
- [ ] Minion allies collection + lobby display

---

## Visual Representations (Core)

CRA model (Concrete→Representational→Abstract) requires visual representations for effective math instruction. These are not enhancements—they're pedagogy.

### Dot Arrays (Multiplication/Division)

For multiplication, show the fact as a dot array:
- 7×8 = 7 rows of 8 dots
- Animate the strategy: highlight 10 rows, then remove 2 rows
- Visual learners need spatial representation

For addition, show number line jumps:
- 8+5 = start at 8, jump 2 to 10, jump 3 to 13
- Animate the "make 10" decomposition

| Operation | Visual |
|-----------|--------|
| Multiplication | Dot arrays |
| Division | Array partitioning |
| Addition | Number line jumps |
| Subtraction | Number line hops back |

### Number Lines (Addition/Subtraction)

Already described above in dot arrays section.

---

## Error Diagnosis (Core)

### DI Error Classification (Ch 1, p. 8)

DI identifies 3 error types, each requiring different remediation:

| Error Type | What It Means | Example | Remediation |
|------------|---------------|---------|-------------|
| **Fact error** | Doesn't know a prerequisite fact | Can't answer "10×7=?" in Lead | Drill the prerequisite fact inline |
| **Component-skill error** | Knows facts but messes up a step | Gets 10×7 right but adds wrong | Reteach only that component |
| **Strategy error** | Doesn't know the sequence of steps | Uses addition instead of multiplication | Reteach entire strategy (Model+Lead) |

### Error Pattern Detection

Instead of just "Wrong", detect common error types:

| Error Pattern | Detection | DI Classification | Feedback |
|---------------|-----------|-------------------|----------|
| Added instead of multiplied | 7×8=15 | Strategy error | "Careful! This is multiply (×), not add (+)" |
| Multiplied instead of added | 7+8=56 | Strategy error | "This is add (+), not multiply!" |
| Off by one group | 7×8=49 (7×7) | Fact error | "So close! You got 7×7. We need 7×8." |
| Digit reversal | 7×8=65 | Component-skill | "Check the digits - did you mean 56?" |
| Near miss | 7×8=55 | Component-skill | "Almost! Just one off." |
| Prerequisite wrong in Lead | 10×7=60 | Fact error | Inline teach 10×7 before continuing |

Implementation: Client-side pattern matching on wrong answers, classify by error type, show targeted message before correction.

---

## Future Enhancements (V2+)

### Audio/Spoken Model

Use TTS or recorded audio for Model steps:
- "Here's the trick for 8 times 7..."
- Struggling readers often struggle with math
- More immersive than reading text

Options:
- Browser TTS (free, robotic)
- Pre-recorded per strategy (higher quality, more work)
- AI TTS (ElevenLabs etc - high quality, cost per use)

Recommendation: Start with browser TTS, upgrade later.

---

## Fallback Strategies (Core)

### Alternate Strategy Fallback

If primary strategy fails 3 times, offer alternate:

| Fact | Primary Strategy | Fallback Strategy |
|------|------------------|-------------------|
| 8×7 | Tens minus double (10×7 - 2×7) | Double-double-double (2×2×2×7) |
| 6+7 | Near doubles (6+6+1) | Make 10 (6+4+3) |
| 9×6 | Tens minus one (10×6 - 6) | Double 5s (5×6 + 4×6) |

Speech bubble: "Let's try a different trick!"

---

## Strategy Celebration (Core)

After correct answers, reinforce the METHOD:
- "Nice! You used tens minus one! 🧠"
- "Make 10 works every time! 💪"
- "You're getting good at near doubles!"

This builds metacognition - they remember the trick, not just the answer.

---

## Prerequisite Verification (Core)

Before teaching 8×7 with "tens minus double":
1. Quick check: "What's 10×7?" 
2. If wrong → inline teach 10×7 first
3. Quick check: "What's 2×7?"
4. If wrong → inline teach 2×7 first
5. Now teach 8×7

Don't assume prerequisites - verify and fix inline.

---

## Future: Minion Allies (V2+)

Defeated practice minions join your team:
- Show in lobby as small helper icons
- "You've recruited 12 minions!"
- Maybe they appear in raids as cosmetic helpers

This reframes Practice as **recruiting** (gain something) vs **remediation** (fix something wrong).

---

## Implementation Priority

### V1 (Do it right)

| Enhancement | Effort | Rationale |
|-------------|--------|-----------|
| Visual arrays (dot grids) | Medium | CRA model: Representational step is essential, not polish |
| Number lines (add/sub) | Medium | Same - visual representation aids acquisition |
| Error pattern matching | Medium | Invisible intelligence, feels magical |
| Alternate fallback strategy | Low | Guides can't teach - app must solve it |
| Prerequisite inline checks | Medium | Already specced, essential for DI |
| Celebrate strategy | Trivial | Reinforces method, near-zero cost |

### V2+ (Iterate with data)

| Enhancement | Effort | When to add |
|-------------|--------|-------------|
| Audio/TTS model | Medium | Accessibility, engagement |
| Minion allies | Medium | Engagement boost post-launch |

### Discrimination Examples (DI Ch 1, p. 4)

> "Include not only examples of the currently introduced type but also examples of previously introduced problem types that are similar."

**Each session:** 3 weak facts (L0-L1) + 1 mastered fact (L3+) from same operation.

**Why:** Prevents "rote behavior" — student can't just memorize the session pattern. Forces actual thinking about which strategy applies.

**Example session:**
- 8×9 (weak, ×9 strategy)
- 7×9 (weak, ×9 strategy)
- 6×4 (weak, double-double strategy)
- 7×5 (mastered, discrimination) ← student must recognize this is different

**Queue rule:** After selecting 3 weak facts, append 1 random L3+ fact from the same operation. Discrimination fact skips Model/Lead — goes straight to Test (student already knows it).

### V2: Weighted Repetition (DI Ch 6, p. 77)

DI worksheet pattern:
- Current/new facts: 4x each
- Previous set: 3x each
- Older sets: 2x each

Consider within-session weighting:
- Newest weak fact appears 4x in firm-up
- Older weak facts appear 2-3x
- This is more nuanced than flat "3 correct in a row"

### V2: Input Speed Calibration (DI Ch 6, p. 76)

> "Rate criteria for written work should be based on the speed with which students can write numerals."

DI recommends 2/3 of writing speed as the expected rate.

For Practice Mode:
- Touch-typing speed varies by device (iPad vs keyboard)
- Consider calibration: measure baseline input speed per student
- Adjust fluency expectations accordingly
- This prevents penalizing slow typists vs slow thinkers

**Principle:** Follow the learning science. CRA (Concrete→Representational→Abstract) means visuals are pedagogy, not polish.

---

## Design Principles

1. **Raids diagnose, Practice remediates** — Only practice facts proven weak
2. **Strategy before drill** — Teach the trick, then practice it
3. **No guessing** — Never include facts without Raid data
4. **Short and sweet** — 3 facts, 3-6 minutes, no timer
5. **Server-authoritative** — XP is Timeback credit, can't be faked
6. **Same pattern as Raids** — 4 reducers, familiar architecture
7. **Exit anytime** — Completed facts still count
8. **Mastery via Raids only** — Practice updates `last_seen` timestamp, not mastery level. Students must prove fluency in Raids (timed, no hints) to level up a fact.
9. **Show, don't just tell** — Visual arrays and animations over text explanations
10. **Diagnose errors** — Pattern match mistakes to give targeted feedback
11. **Multiple paths** — If one strategy doesn't click, try another

### DI-Sourced Principles (Ch 1)

12. **Model → Test → Delayed Test** — Error correction includes cycling away then returning to full sequence
13. **Classify errors** — Fact error, component-skill error, or strategy error require different remediation
14. **Separate confusing content** — Don't teach similar strategies in the same session
15. **Preskills before strategy** — Verify prerequisites before teaching dependent facts
16. **Consistent language** — Use exact same wording for the same strategy every time
17. **Thinking pause** — Delay input activation to encourage processing before rushing
