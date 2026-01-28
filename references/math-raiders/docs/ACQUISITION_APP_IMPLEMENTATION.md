# Math Fact Acquisition App - Implementation Guide

**Companion to PRD - Builder's craft reference**

This document captures HOW to make the core moments feel incredible. Reference during implementation, iterate based on feel.

---

## The Three Core Moments

Everything serves these three satisfying experiences:

### 1. Pattern Discovery ("Aha!" Moment)

**When it happens:** Part A/B when student recognizes the relationship

**What it should feel like:**
- Lightbulb moment
- "I see it now!"
- Intellectual satisfaction

**How to execute:**
```
Facts appear sequentially (building anticipation):
5 + 2 = 7   [fade in, soft sound]
6 + 2 = 8   [fade in, sound pitch +5%]
7 + 2 = 9   [fade in, sound pitch +10%]
8 + 2 = ?   [fade in, slight glow]

Student types: 10

[CELEBRATION]
✨ PATTERN RECOGNIZED ✨
[Screen pulse (200ms), satisfying chord (3 notes)]
"The numbers count up!"
[Hold 1.5s, then continue]
```

**Timing:**
- Fact appears: 400ms fade in
- Gap between facts: 800ms (anticipation)
- Celebration hold: 1500ms (let them savor it)
- Transition out: 300ms

**Audio:**
- Facts appearing: Soft ascending tones
- Recognition: Resolved chord (major triad)
- Voice: "You found the pattern!"

**Why this works:** Discovery is intrinsically rewarding. Make it VISIBLE and AUDIBLE.

---

### 2. Perfect Recall ("Flow State" Moment)

**When it happens:** Part C/D when student recalls series from memory

**What it should feel like:**
- In the zone
- Effortless rhythm
- Momentum building

**How to execute:**
```
GET READY...
[Beat indicator pulses: ● ○ ○ ○]

5 + 2 = ? 
[Student types: 7]
✓ [Soft tick, next fact appears on beat]
[●● ○ ○]

6 + 2 = ?
[Student types: 8]  
✓ [Tick, pitch +10%, next on beat]
[●●● ○]

7 + 2 = ?
[Student types: 9]
✓ [Tick, pitch +20%, next on beat]
[●●●●]

8 + 2 = ?
[Student types: 10]
✓ [Chord resolves]

🔥 PERFECT RECALL! 4/4
[Facts light up in sequence, satisfying progression]
```

**Timing:**
- Zero dead time (answer → feedback → next = 400ms total)
- Beat interval: 1200ms (comfortable rhythm)
- Feedback shows: 100ms
- Next fact appears: 300ms after feedback

**Audio:**
- Base tick: Soft, clean (not annoying after 20 reps)
- Pitch escalation: +5% per correct in streak
- Perfect series: Chord progression (tension → release)
- Break rhythm: Audio drops, resets

**Visual:**
- Progress dots fill (●●●○ → ●●●●)
- Subtle screen glow builds with streak
- Perfect: All facts highlight in sequence
- **Escalation without distraction**

**Why this works:** Flow state requires rhythm + feedback + no interruptions. Maintain momentum.

---

### 3. Lesson Mastery ("Achievement Unlocked" Moment)

**When it happens:** Quiz complete, 85%+ achieved

**What it should feel like:**
- Earned accomplishment
- Pride
- "I did it"

**How to execute:**
```
[Quiz final answer submitted]

[Brief pause 200ms - anticipation]

QUIZ COMPLETE
━━━━━━━━━━━━━━━
18/20 (90%)

[Rank reveal animation 800ms]
[Medal scales in + rotates]

ACHIEVEMENT
🥇 GOLD

[Facts mastered list appears]
You've mastered:
2+4, 3+4, 4+4, 5+4

[Hold celebration 3s]

[Next lesson card slides in]
Lesson 7 → UNLOCKED

[Two clear CTAs]
[NEXT LESSON]  [RETRY FOR PERFECT]
```

**Timing:**
- Quiz submit → results show: 200ms pause (anticipation)
- Results appear: 400ms fade
- Rank reveal: 800ms (scale + rotate animation)
- Hold celebration: 3000ms (let them feel it)
- Next lesson preview: 500ms slide in
- **Total: 5 seconds from submit to decision point**

**Audio:**
- Quiz complete: Success chime
- Rank reveal: Whoosh + impact sound
- Hold: Ambient success hum (not music, just texture)
- Unlock: Satisfying "click" sound

**Visual:**
- Medal grows from center (scale 0 → 1.2 → 1.0)
- Slight rotation (adds dynamism)
- Facts list fades in sequentially
- Next lesson card has subtle glow (attention magnet)

**Why this works:** Achievement needs ceremony. Too fast = unsatisfying. Too slow = annoying. 5 seconds is the sweet spot.

---

## Technical Execution Details

### Feedback Timing Budget

**The 100ms Rule:**
- User action → visible feedback must be <100ms
- Feels instant to human perception
- >150ms feels laggy

**Implementation:**
```typescript
const handleAnswer = (answer: string) => {
  // Validate
  const correct = checkAnswer(answer);
  
  // IMMEDIATE visual feedback (synchronous)
  setFeedbackState(correct ? 'correct' : 'wrong');
  
  // Audio (non-blocking)
  playSound(correct ? 'tick' : 'wrong');
  
  // Next fact (after brief feedback display)
  setTimeout(() => {
    setCurrentFact(getNextFact());
  }, 300);
};
```

**Target:**
- Keystroke → checkmark appears: 50ms
- Checkmark → next fact: 300ms
- **Total answer cycle: 350ms**

### Audio Escalation Pattern

**For streak building:**
```typescript
const getTickSound = (streakLength: number) => {
  const basePitch = 1.0;
  const pitch = basePitch + (streakLength * 0.05); // 5% per streak
  return { sound: 'tick', pitch: Math.min(pitch, 1.5) }; // Cap at 1.5x
};

// Usage:
playSound('tick', { pitch: getTickSound(currentStreak) });
```

**For perfect series completion:**
```typescript
const playCompletionChord = () => {
  playNote('C', 200); // Root
  setTimeout(() => playNote('E', 200), 100); // Third
  setTimeout(() => playNote('G', 400), 200); // Fifth (resolve)
};
```

**C major = universally pleasant, resolution feeling**

### Animation Curves

**Use easing for polish:**
```typescript
// Framer Motion settings
const fadeIn = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } // Smooth deceleration
};

const celebration = {
  initial: { scale: 0, rotate: -180 },
  animate: { scale: 1, rotate: 0 },
  transition: { type: "spring", stiffness: 200, damping: 15 } // Bouncy reveal
};
```

**Easing functions:**
- Fade in: Ease out (decelerate into position)
- Celebrations: Spring (adds life)
- Errors: Linear (don't make wrong answers bouncy/fun)

---

## DI Script → App Flow Translations

### Series Saying Part A (Modeled Instruction)

**DI Script:**
```
Teacher writes on board:
5 + 2 = 7
6 + 2 = 8
7 + 2 = 9
8 + 2 = 10

Teacher points to each, students read together.
```

**App Translation:**
```
[Auto-playing sequence]

5 + 2 = 7  [Appears, highlights for 2s]
🔊 "Five plus two equals seven"
[Holds 1s]

6 + 2 = 8  [Appears below previous]
🔊 "Six plus two equals eight"
[Previous dims, current highlights]
[Holds 1s]

[Continue for all 4]

[All 4 visible at end]
🔊 "Do you see the pattern?"
[Hold 2s, let them observe]

[CONTINUE]
```

**Key adaptations:**
- Sequential reveal (not all at once)
- Audio narration replaces teacher voice
- Visual highlighting replaces teacher pointing
- Self-paced advance (not teacher-controlled)

### Error Correction Protocol

**DI Script:**
```
Student: 5+2=8 (wrong)

Teacher: 
"Listen: 5 + 2 = 7" [models correct]
"Say it with me: 5 + 2 = 7" [student repeats]
"What is 5 + 2?" [test]
Student: "7"
"That's right. Remember: 5 + 2 = 7" [reinforce]
[Back to drill]
```

**App Translation:**
```
[Student types: 8]

[Pause drill, shift focus]

┌────────────────────────────┐
│  Let's review this one     │
│                            │
│  🔊 Listen: 5 + 2 = 7      │
│  [Auto-plays, shows answer]│
│                            │
│  Now you try.              │
│  What is 5 + 2?            │
│                            │
│  [  7  ] ✓ Correct!        │
│                            │
│  Let's practice a few more │
│  then try 5+2 again...     │
└────────────────────────────┘

[Quick review: 2 previous facts]
[Retry 5+2]
[If correct → back to drill sequence]
```

**Key adaptations:**
- Visual panel focus (not jarring)
- TTS provides all voice
- Forced retry (can't skip)
- Brief review maintains context
- Gentle tone (not punishing)

---

## Sound Design Specifications

### Sound Palette (Minimal)

**Core Sounds (4 total):**
1. **Tick (Correct):** Soft mechanical click, 100ms, mid-high freq
2. **Ding (Streak):** Glass clink with reverb, 150ms, high freq
3. **Chord (Perfect):** C-E-G progression, 600ms total
4. **Thud (Wrong):** Soft bass thump, 80ms, low freq, quiet

**Source:** Freesound.org or Zapsplat
**Format:** MP3, normalized volume
**Implementation:** Preload all on app start

### ElevenLabs Voice Lines

**Structure:**
```
/audio/
  lessons/
    1/
      modeled/
        five-plus-two-equals-seven.mp3
        six-plus-two-equals-eight.mp3
        ...
      corrections/
        listen-five-plus-two-equals-seven.mp3
        what-is-five-plus-two.mp3
        ...
    2/
      ...
```

**Voice settings:**
- Warm, clear teacher voice
- Rate: 0.9x (slightly slower than normal speech)
- Emphasis on numbers (slight pause before/after)

**Batch generation script:**
```typescript
// Generate all 1300 clips
const lessons = LESSON_DATA; // From spreadsheet
for (const lesson of lessons) {
  for (const fact of lesson.facts) {
    await generateVoiceLine(`${fact} equals ${answer}`);
    await generateVoiceLine(`Listen: ${fact} equals ${answer}`);
    // ... corrections, instructions
  }
}
```

---

## Visual Polish Checklist

**Per screen:**
- [ ] Auto-focus input (no clicking required)
- [ ] Enter submits (no button clicks)
- [ ] Feedback <100ms (feels instant)
- [ ] Smooth transitions (300ms, eased)
- [ ] Clear visual hierarchy (eye knows where to look)
- [ ] No dead time (always clear what to do next)

**Micro-interactions:**
- [ ] Input glow on focus
- [ ] Subtle scale on hover (1.05x)
- [ ] Cursor changes appropriately
- [ ] Loading states (if any) have progress indication

**Celebrations:**
- [ ] Don't block interaction (can dismiss early if student wants)
- [ ] Scale appropriately (Perfect > Gold > Silver)
- [ ] Hold long enough to feel (2-3s)
- [ ] Audio/visual sync perfectly

---

## Testing The Feel (Critical)

**Week 1 milestone: One lesson PERFECT**

**Test with yourself:**
1. Complete Lesson 1 ten times
2. Does it get annoying? (sound choice)
3. Does feedback feel crisp? (timing)
4. Do you want to continue? (flow)

**Test with 1-2 students:**
1. Watch them complete Lesson 1
2. Note where they pause/get confused
3. Ask: "Which moment felt best?"
4. Iterate on timing/sounds

**The feel test:**
- If YOU don't want to do lesson 2 after lesson 1, students won't either
- If sounds annoy you after 50 reps, they'll annoy students
- Your gut = the guide

**Don't ship until one lesson feels AMAZING.**

---

## Week 1 Focus: Nail One Lesson

**Lesson 1 (Series Saying: 2+1, 3+1, 4+1, 5+1):**

**Parts to build:**
- Part A: Modeled (auto-playing with TTS)
- Part B: Guided (recall with scaffolds)
- Part C: Memory (from scratch)
- Part D: Random (prove it)
- Quiz: 85% gate

**Success criteria:**
- Completes in 8-10 minutes
- Feels smooth (no jarring moments)
- Error correction feels helpful (not punishing)
- Quiz pass feels earned (celebration is satisfying)
- "One more lesson" impulse exists

**If Week 1 lesson feels perfect → scaling to 26 is just data.**
**If Week 1 lesson feels flat → no amount of content will save it.**

---

## Open Implementation Questions

**To figure out during build:**

1. **Beat indicator style:**
   - Pulsing dot? Progress bar? Visual metronome?
   - Test 2-3 options, pick what feels natural

2. **Error correction tone:**
   - Neutral helper? Encouraging coach? Matter-of-fact?
   - Voice acting choice affects perception

3. **Rank reveal animation:**
   - Scale in? Flip? Slide? Particle burst?
   - Test what feels most "earned"

4. **Lesson complete → next lesson transition:**
   - Immediate option? Forced break? Auto-advance after timer?
   - Balance celebration with momentum

**Don't over-plan. Build, feel, iterate.**

---

## Notes

**This doc is NOT locked in.**
- Reference during Week 1
- Update based on what feels right
- Delete sections that don't matter
- Add new patterns as you discover them

**The PRD is the contract. This doc is your sketchbook.**

Build, test feel, iterate. Trust your craft.

