# Math Raiders: K-5 Expansion Battle Plan

## Mission
Ship Math Raiders with full K-5 math fluency support to Andy - the first implementation of proven learning science in a game kids actually want to play.

**Strategic Decision**: We align to Alpha's cumulative testing approach (all operations mixed) rather than Rocket Math's sequential mastery. This maximizes test score improvements even though sequential learning has pedagogical benefits.

## Pilot Plan
- 10-20 students, 4 weeks
- Pre-test with Alpha Math Fluency assessment (measures retrieval speed + accuracy)
- 20 minutes/day gameplay (minimum 15 sessions)
- Post-test with same assessment
- Success criteria: 70%+ show CQPM improvement (proving automaticity gains)

### MVP Completion Checklist
- [ ] Grade 1-5 facts generating correctly (775 total)
- [ ] All 4 operations working
- [ ] Grade picker in UI
- [ ] Rank progression visible
- [ ] 10+ consecutive raids without crashes
- [ ] Facts match FastMath exactly

### Production Quality Bar
- Bug-free > Feature-rich
- Clear error messages (kid-friendly)
- Graceful handling of edge cases
- No broken UI states
- "Would I let my kid play this?"

## Content & Progression

### Grade-to-Problem Mapping (Alpha Test Alignment)
- **Kindergarten**: Add/sub within 5 (42 facts)
- **Grade 1**: Addition within 10 only (66 facts) 
- **Grade 2**: Addition (100 facts) + Subtraction (165 facts) = 265 total
- **Grade 3**: Add (231) + Sub (231) + Multiply (100) = 562 total facts
- **Grade 4**: Multiply (169) + Divide (144) only = 313 total facts
- **Grade 5**: All four operations = 775 facts total (231 add + 231 sub + 169 mult + 144 div)

### Grade Level Selection
- Students select any grade (K-5) from UI picker
- Each grade maintains separate rank progression
- Can switch grades freely, progress persists per grade
- All grades award XP (accepting farming risk for simplicity)
- Grade picker sets available operations and number ranges, problem generator uses grade-specific configuration to select appropriate problems.

### Performance Ranking System
- Replace content-based leagues with performance ranks (Bronze/Silver/Gold/Diamond/Legendary)
- Bronze through Diamond based on fact mastery count only
- Legendary requires BOTH mastery (90%+ facts) AND speed (40+ CQPM)
- Ranks can decrease if facts are forgotten (deranking allowed)
- Rank updates calculated post-raid
- Problem selection NOT gated by rank - algorithm serves based on learning needs

### Rank Progression (Fact-Based)
#### Grade 3 Example (562 total facts: add + sub + mult)
- **Bronze**: 0-140 facts mastered (25%)
- **Silver**: 141-281 facts mastered (50%) 
- **Gold**: 282-421 facts mastered (75%)
- **Diamond**: 422-505 facts mastered (90%)
- **Legendary**: 506+ facts mastered AND 30+ CQPM

Each grade follows similar percentage-based progression.

### Expected Outcomes
- All students improve, but rank shows rate of improvement
- Higher rank = mastered more facts = larger CQPM gains
- Pilot will quantify: Bronze = +X CQPM, Silver = +Y CQPM, Gold = +Z CQPM

## Learning System

**3 Principles That Drive CQPM Gains:**
1. **Retrieval Practice**: Type answer from memory (no hints/choices)
2. **Spaced Repetition**: Our existing algorithm works for all operations
3. **Speed Pressure**: Timer forces automaticity (not just accuracy)

The game IS the assessment - every answer measures retrieval speed.


## Game Mechanics

### Damage Scaling
Base Damage = 15 (base) + speed_bonus + (grade × 3)
- Speed bonus: <3 sec = +10, 3-5 sec = +5, >5 sec = +0
- Total damage ranges from 15 (K, slow) to 43 (G5, fast)

**Critical Hit System (Variable Reward)**
- 10% chance: CRITICAL HIT! (2x damage)
- 1% chance: SUPER CRITICAL! (3x damage)
- Visual feedback: Larger damage numbers, screen shake, special effect
- Keeps core progression deterministic while adding excitement

## Integration

### Timeback XP Integration
Award 1 XP per focused minute when student maintains 2+ CQPM.

### Teacher Workflow
- Students login with existing Alpha credentials
- Game automatically tracks time and progress
- Data appears in Timeback alongside other activities
- No new systems for teachers to learn

## Technical Implementation

**Core Architecture: Universal Facts + Lazy Mastery**
- Single fact pool (~775 unique facts) shared by all players
- Each fact tagged with grades that use it
- FactMastery records created on-demand when fact attempted
- Problem selection combines grade filtering + SRS weights
- No changes to existing database schema needed

**Total Time: ~36 hours (4-5 days)**

### Build Order (Ship after each phase)
1. **Complete Operations Layer** (16 hours)
   - **1A Backend** (4hr): Enum + compute() + normalize_fact() + tests
   - **1B Frontend** (3hr): UI symbols + answer validation
   - **1C Fact Script** (5hr): Generate ~775 facts with grade tags
   - **1D Integration** (4hr): Import facts, remove tier filtering, enable all operations
   - Ship: All 4 operations working (no filtering, all ~775 facts available)!

2. **Grade System** (8 hours)
   - Add grade field to Player table
   - Migration: map tiers to grades (Spark→3, Volt→4, etc)
   - DELETE all tier code (Spark/Volt/Thunder/Mega gone!)
   - Add grade picker UI (K-5)
   - Switch to grade-based fact selection
   - Ship: Full K-5 experience unlocked!

3. **Metrics & Ranks** (8 hours)
   - Calculate ranks from mastery counts
   - Add CQPM calculation and display
   - Bronze through Legendary badges
   - Ship: Clear progression visibility

4. **Polish & Integration** (4 hours)
   - Critical hit system (10%/1%)
   - XP webhook to Timeback
   - Victory screen enhancements
   - Ship: Production ready


## Reference Data

### Fact Counts by Grade (Alpha Test Alignment)
- **Kindergarten**: 42 facts (add/sub within 5)
- **Grade 1**: 66 facts (addition within 10 only)
- **Grade 2**: 265 facts total (100 add + 165 sub)
- **Grade 3**: 562 facts total (231 add + 231 sub + 100 mult)
- **Grade 4**: 313 facts total (169 mult + 144 div)
- **Grade 5**: 775 facts total (231 add + 231 sub + 169 mult + 144 div)

**Note**: Total unique facts across all grades: ~775 (many facts appear in multiple grades)
