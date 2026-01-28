# Math Fact Acquisition App

## Why We're Building This

Students waste 20-30 hours memorizing isolated facts through rote drilling.

DI (Direct Instruction) teaches relationships. 10 strategies cover 100 facts. Students learn patterns, not individual items.

**We can cut time-to-mastery in half.**

Alpha School needs this for 500-1000 students K-5. It's the missing piece between conceptual understanding (synthesis) and fluency building (AlphaMath/Math Raiders).

## Design Pillars (Non-Negotiable)

**1. Faithful to DI Methodology**
- Don't innovate on pedagogy, innovate on execution
- Follow Series Saying and Fact Families scripts closely
- DI error corrections exactly as specified
- 85% mastery threshold (no shortcuts)

**2. Feels Responsive**
- Answer → Feedback in <100ms
- Zero dead time between problems
- No "Continue" buttons
- Continuous flow like rhythm game

**3. Honest Progress**
- Mastery ranks reflect real learning quality
- Progression matches pedagogical sequence
- No arbitrary points/XP
- Achievements = mastery milestones

**4. Calm Focus**
- Zen training facility aesthetic
- Dark phthalo green, tactical, minimal
- Not playful/cartoonish
- Sound supports focus, doesn't distract

## What We're Building

**The Product:**
26-lesson addition acquisition course. Students progress A→Z learning addition facts through DI methodology.

**The Experience:**
- Login → 2-min diagnostic assessment
- Routed to appropriate lesson
- Complete 5-part drill (Series Saying) or 6-part drill (Fact Families)
- Pass quiz (85%+ accuracy) → Earn rank → Unlock next lesson
- 10-minute sessions, 3-4x per week

**The Outcome:**
Student completes all 26 lessons in 4-6 weeks. All basic addition facts learned with 90%+ accuracy. Ready for fluency stage.

## Core Loop

```
Start lesson
  ↓
Follow multi-part drill (TTS guides, student answers)
  ↓
Get immediate corrections when wrong
  ↓
Pass quiz (85%+)
  ↓
Earn mastery rank (Bronze/Silver/Gold)
  ↓
Unlock next lesson
  ↓
"One more lesson"
```

**The hook:** Watching yourself get facts right. Unlocking progression. Building mastery.

**Question:** Is this fun?
**Answer:** For students who want to get better at math - yes. For students forced to do homework - no.

**We're betting on:** Alpha School students value mastery.

## Features (Essential Only)

**1. Lesson Progression (26 lessons)**
- Linear unlock (complete N → unlock N+1)
- Can't skip ahead
- Content from spreadsheet (Sets A-Z)
- Alternating formats: Series Saying (odd) / Fact Families (even)

**2. Series Saying Drill (5 parts + quiz)**
- Part A: Read full statements (facts + answers shown)
- Part B: Read, recall answers  
- Part C: Recite from memory
- Part D: Random order practice
- Quiz: Random drill, 85% to pass

**3. Fact Families Drill (6 parts + quiz)**
- Part A: Structured board (three-number boxes)
- Part B: Generate both statements (5+2=7, 2+5=7)
- Part C: Practice both directions
- Part D: Mixed discrimination
- Part E: Supervised practice
- Quiz: 85% to pass

**4. DI Error Correction**
```
Wrong answer → Pause drill
TTS: "Listen: 5+2 = 7"
Show correct answer
TTS: "What is 5+2?"
Student retypes → Must get right
Brief review → Retry original wrong fact
Continue drill
```

**5. Assessment Mode (2 minutes)**
- 20 random facts from learned content
- Measure accuracy + CQPM
- Run at session start
- Results displayed

**6. Mastery Ranks (Per Lesson)**
- 🥈 **Silver:** 85-89% quiz (earned it)
- 🥇 **Gold:** 90-94% quiz (excellent)
- 👑 **Perfect:** 95-100% quiz (flawless)
- Pass threshold = 85%, rank shows achievement quality
- Below 85% = Must retry (no rank)

**7. Stats Dashboard**
- Lessons completed: X/26
- Overall accuracy: X%
- Rank breakdown (Perfect/Gold/Silver counts)
- Recent activity feed

**8. Audio & Polish (The Game Studio Edge)**
- ElevenLabs voice (pre-generated, natural quality)
- ~1300 audio clips for all lessons + corrections
- Smooth animations (Framer Motion)
- Satisfying feedback (sound + visual)
- Auto-focus input, Enter submits
- Dark phthalo green tactical aesthetic

## What We're NOT Building (Phase 2+)

- ❌ Other operations (subtraction, mult, div)
- ❌ Intervention modes (flashcard, timing)
- ❌ CASE standards integration (per-fact tracking)
- ❌ Leaderboards
- ❌ Math Raiders integration
- ❌ Custom professional voice recording (using ElevenLabs instead)

## Tech Stack

**Frontend:** React + TypeScript, Framer Motion, Tailwind
**Backend:** Convex (TypeScript mutations/queries)
**Runtime:** Bun (package management, dev server, scripts)
**Audio:** ElevenLabs (pre-generated MP3s, ~$8 total cost)
**Auth:** TimeBack SSO
**Hosting:** Vercel (static audio files served from CDN)

**State:** Simple state machine (Home → Assessment → Lesson → Complete → Stats)

**Why Convex:** Solo app, no multiplayer, simpler than SpacetimeDB. Same reactive patterns.

## Build Timeline

**Week 0 (Prep):** Audio generation
- Script all voice lines (~1300 clips)
- Generate via ElevenLabs API
- Organize audio files by lesson/part
- Total cost: ~$8

**Week 1:** Core drill mechanics
- One Series Saying lesson working end-to-end
- Audio playback system
- Error correction flow
- Immediate feedback (visual + audio)

**Week 2:** All 26 lessons
- Data-driven lesson structure
- Fact Families format
- Quiz system (random order, 85% gate)
- Lesson unlock progression

**Week 3:** Assessment & stats
- 2-minute diagnostic
- Stats dashboard
- Home screen with current lesson
- Lesson complete screens

**Week 4:** Polish & pilot
- Sound design
- Animation polish
- Convex deployment
- Test with 5 students, iterate

**Ship after 4 weeks.**

## Success Metrics (Pilot)

**After 4 weeks with 10 students:**
- 70%+ complete 15+ lessons (engagement)
- 88%+ average quiz accuracy (learning)
- Students prefer over worksheets (satisfaction)
- Teachers see fact improvement (outcomes)

**Validates:** Students will complete it + actually learn
**Proves:** Digital DI works without teacher

**If successful → Phase 2 (other operations)**
**If not → Iterate on engagement before expanding**

## Open Questions

1. Gauntlet Step 1 - Need DOK 1-4 brainlift first?
2. Assessment mode - exact 2-min format?
3. Quiz problem ordering - random or specific sequence?
4. ElevenLabs voice selection - which voice profile for K-5 students?

---

**That's the PRD. Clear on what, why, and when. Light on how (you know how).**

**Next:** Confirm with Michael, then build Week 1.
