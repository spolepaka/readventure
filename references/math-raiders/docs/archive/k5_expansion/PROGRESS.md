# K-5 Expansion Progress Tracker

## Current Status: Phase 1B Complete! 

### ✅ Completed
- [x] Created battle plan documents
- [x] Defined 4-phase implementation strategy
- [x] Clarified architecture (Universal Facts + Lazy Mastery)
- [x] Verified fact counts with Alpha curriculum
- [x] Split Phase 1 into testable sub-phases
- [x] Phase 1A: Backend Operations (All 4 operations working!)
- [x] Phase 1B: Frontend Operations (UI displays all operations!)

### 🚧 In Progress
- [ ] Phase 1C: Fact Generation Script (Starting next!)

### 📋 Upcoming
- [ ] Phase 1D: Integration
- [ ] Phase 2: Grade System
- [ ] Phase 3: Rank System
- [ ] Phase 4: Polish Features
- [ ] Phase 5: TimeBack Integration

---

## MVP Completion Checklist (From Battle Plan)

### Core Features (Must Have for Pilot)
- [ ] Grade 1-5 facts generating correctly (775 total)
- [⏳] All 4 operations working (backend ✅, frontend pending)
- [ ] Grade picker in UI
- [ ] Rank progression visible
- [ ] 10+ consecutive raids without crashes
- [ ] Facts match FastMath exactly

### Production Quality Bar
- [ ] Bug-free > Feature-rich
- [ ] Clear error messages (kid-friendly)
- [ ] Graceful handling of edge cases
- [ ] No broken UI states
- [ ] "Would I let my kid play this?"

### Integration Requirements
- [ ] Timeback XP Integration (1 XP per focused minute at 2+ CQPM)
- [ ] Alpha credentials login working
- [ ] Time and progress tracking to Timeback

---

## Phase → MVP Requirement Mapping

| Phase | MVP Requirements Completed |
|-------|---------------------------|
| **Phase 1A** | • "All 4 operations working" (backend) |
| **Phase 1B** | • "All 4 operations working" (frontend)<br>• "Clear error messages" (validation) |
| **Phase 1C** | • "Grade 1-5 facts generating correctly"<br>• "Facts match FastMath exactly" |
| **Phase 1D** | • All operations live in game<br>• "10+ consecutive raids" testable |
| **Phase 2** | • "Grade picker in UI"<br>• K-5 gameplay enabled |
| **Phase 3** | • "Rank progression visible" |
| **Phase 4** | • Critical hits<br>• Polish for production |
| **Phase 5** | • "Timeback XP Integration"<br>• "Alpha credentials login"<br>• "Time and progress tracking" |

### After All Phases Complete:
✅ Ready for pilot testing  
✅ All MVP requirements met  
✅ Production quality bar achieved  
✅ "Would I let my kid play this?" = YES

---

## Detailed Progress

### Phase 0: Planning ✅
**Duration:** 8+ hours  
**Outcome:** Complete technical specification

**Key Decisions:**
1. Universal fact pool (~775 unique facts)
2. Facts tagged with grades that use them
3. Lazy FactMastery initialization (existing pattern)
4. Grade replaces tier for content selection
5. Ranks based on % of facts mastered

**Documents Created:**
- `K5_EXPANSION_BATTLE_PLAN.md` - High-level vision
- `IMPLEMENTATION_PHASES.md` - Day-by-day execution guide  
- `PHASE_1_BATTLE_PLAN.md` - Deep technical dive

---

### Phase 1A: Backend Operations ✅
**Status:** COMPLETE  
**Est. Duration:** 4 hours
**Actual Duration:** 1 hour

**Tasks:**
- [x] Research current architecture
- [x] Extend Operation enum (Add, Subtract, Divide)
- [x] Implement compute() method for all operations
- [x] Update normalize_fact() for all operations
- [x] Write comprehensive unit tests
- [x] Remove tier filtering - all facts available
- [x] Add logging to verify operations

**Success Criteria:** All operation unit tests pass ✅

---

### Phase 1B: Frontend Operations ✅
**Status:** COMPLETE  
**Est. Duration:** 3 hours
**Actual Duration:** 30 minutes

**Tasks:**
- [x] Update TypeScript operation types (auto-generated)
- [x] Fix ProblemDisplay component
- [x] Handle negative answers
- [x] Fix getOperationSymbol in 2 components
- [x] Build passes with no errors

**Success Criteria:** UI correctly displays all operation types ✅

---

### Phase 1C: Fact Generation Script
**Status:** Not Started  
**Est. Duration:** 5 hours

**Tasks:**
- [ ] Write generation script (Python/Node)
- [ ] Generate Kindergarten facts (42 total)
- [ ] Generate Grade 1 facts (66 total)
- [ ] Generate Grade 2 facts (265 total)
- [ ] Generate Grade 3 facts (562 total)
- [ ] Generate Grade 4 facts (313 total)
- [ ] Generate Grade 5 facts (775 total)
- [ ] Output both Rust and TypeScript files

**Success Criteria:** 
- Fact counts match spec exactly
- No duplicate facts
- Grade tags correct

---

### Phase 1D: Integration
**Status:** Not Started  
**Est. Duration:** 4 hours

**Tasks:**
- [ ] Import generated facts into server
- [ ] Remove tier filtering (serve all facts)
- [ ] Full gameplay test
- [ ] Performance check
- [ ] Document any issues

**Success Criteria:** All 4 operations working, all ~775 facts available

---

### Phase 2: Grade System
**Status:** Not Started  
**Est. Duration:** 8 hours

**Tasks:**
- [ ] Add grade field to Player table
- [ ] Create migration (tier → grade mapping)
- [ ] Build grade picker UI
- [ ] Replace get_tier_facts() with get_grade_facts()
- [ ] DELETE all tier code
- [ ] Test all grades K-5

**Success Criteria:** Full K-5 gameplay working

---

### Phase 3: Rank System  
**Status:** Not Started  
**Est. Duration:** 6 hours

**Tasks:**
- [ ] Calculate ranks from mastery %
- [ ] Create rank badge UI components
- [ ] Add rank progression notifications
- [ ] Remove tier terminology from UI
- [ ] Test rank up/down scenarios

**Success Criteria:** Clear visual progression

---

### Phase 4: Polish Features
**Status:** Not Started  
**Est. Duration:** 6 hours

**Tasks:**
- [ ] Add CQPM display to raid end screen
- [ ] Implement critical hit system (10% chance 2x, 1% chance 3x)
- [ ] Add damage scaling (base 15 + speed bonus + grade×3)
- [ ] Enhance victory screen with mastery gains
- [ ] Final bug fixes and edge cases

**Success Criteria:** Production-ready core gameplay

---

### Phase 5: TimeBack Integration
**Status:** Not Started  
**Est. Duration:** 8-12 hours (plus waiting for identity mapping)

**Tasks:**
- [ ] Phase 5A: Foundation (Can do now)
  - [ ] Add timeback_user_id to Player schema
  - [ ] Create learning_event table
  - [ ] Build worker service with mock IDs
  - [ ] Test with fake TimeBack endpoint
- [ ] Phase 5B: Identity Bridge (Blocked on PlayCademy)
  - [ ] Get TimeBack user mapping from PlayCademy
  - [ ] Update connect flow to store mapping
- [ ] Phase 5C: Production Deployment  
  - [ ] Deploy worker to EC2
  - [ ] Configure OAuth credentials
  - [ ] Monitor event flow
  - [ ] Verify XP in TimeBack dashboard

**Success Criteria:** 
- Student achievements flow to TimeBack
- Zero lost events
- <1 minute average latency

---

## Game Mechanics Checklist (From Battle Plan)

### Damage System
- [ ] Base damage = 15
- [ ] Speed bonus: <3 sec = +10, 3-5 sec = +5, >5 sec = +0
- [ ] Grade scaling: grade × 3
- [ ] Total range: 15 (K, slow) to 43 (G5, fast)

### Critical Hit System
- [ ] 10% chance: CRITICAL HIT! (2x damage)
- [ ] 1% chance: SUPER CRITICAL! (3x damage)
- [ ] Visual feedback: Larger numbers, screen shake

### Rank Thresholds (% of grade's facts mastered)
- [ ] Bronze: 0-25%
- [ ] Silver: 25-50%
- [ ] Gold: 50-75%
- [ ] Diamond: 75-90%
- [ ] Legendary: 90%+ AND 30+ CQPM (G3) or 40+ CQPM (others)

### XP Integration (Phase 5)
- [ ] Award 1 XP per focused minute
- [ ] Only when maintaining 2+ CQPM
- [ ] Send to Timeback API via Caliper events
- [ ] Track fluency, accuracy, and mastery achievements

---

## Notes & Blockers

### Current Blockers
- Phase 5B: Waiting for PlayCademy to provide TimeBack user ID mapping

### Key Learnings
- None yet

### Technical Debt
- Tier system (to be removed in Phase 2)

---

## Quick Stats
- **Total Phases:** 5 (10 sub-phases)
- **Total Estimated Time:** 44-48 hours
- **Time Spent:** 9.5 hours (8 planning + 1 Phase 1A + 0.5 Phase 1B)
- **Progress:** 20% implementation (2/10 sub-phases), 100% planning

---

## 🚀 Launch Readiness Checklist

When ALL of these are checked, you're ready for the 4-week pilot:

### Essential Features
- [ ] All phases (1A through 5) complete
- [ ] MVP Completion Checklist 100% done
- [ ] Production Quality Bar met
- [ ] Game Mechanics implemented
- [ ] TimeBack integration working

### Pre-Launch Testing
- [ ] 10+ consecutive raids without crashes
- [ ] Tested with kids (informal)
- [ ] Teacher workflow verified
- [ ] XP flowing to Timeback

### Go/No-Go Decision
- [ ] Andy approves build
- [ ] 10-20 students identified
- [ ] Pre-test assessment ready
- [ ] 4-week pilot scheduled

**🎯 Target: When this entire document shows checkmarks, Math Raiders is ready for launch!**
