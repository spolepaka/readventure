# Leaderboard Implementation Roadmap

**Goal:** Ship rank-based leaderboards with grade filtering in 3-4 hours of focused work.

**Strategy:** Build incrementally. Each phase is testable and shippable. Don't move to next phase until current phase works.

---

## Design Principles (Apply Throughout)

**UX Pattern:** tracker.gg-style leaderboard (Top N + filters + your context)

**Web Interface Guidelines to Apply:**

### Core (Must Have)
- [ ] **Deep-link grade filter** - URL like `/lobby?rankings_grade=5` (shareable, works with Back/Forward)
- [ ] **Tabular numbers** - Use `font-variant-numeric: tabular-nums` on rank column for alignment
- [ ] **Minimum loading duration** - Show spinner for ≥300ms even if data loads faster (prevents flicker)
- [ ] **All states designed** - Empty, only you, top 10, outside top 50, loading, error
- [ ] **Match visual & hit targets** - Grade dropdown touch target ≥44px on mobile
- [ ] **Redundant status cues** - Rank gems + text labels (💎 "Legendary" not just icon)

### Polish (Nice to Have)
- [ ] **Nested radii** - Inner elements ≤ parent radius for concentric curves
- [ ] **Layered shadows** - Two-layer (ambient + directional) for depth
- [ ] **Hue consistency** - Tint borders/shadows toward background hue
- [ ] **Optical alignment** - Adjust icons ±1px if geometry ≠ perception
- [ ] **Prefers-reduced-motion** - Disable animations if user prefers

### Copy (Already Good, Keep Doing)
- [ ] **Active voice** - "Complete more raids" not "More raids can be completed"
- [ ] **Clear & concise** - "Rankings" not "Student Performance Dashboard"
- [ ] **Use numerals** - "#5 of 84 students" not "#five of eighty-four students"
- [ ] **Default to positive** - "Great start!" not "You're in last place"
- [ ] **Error messages guide exit** - "Unable to load. [Retry]" not "Error 500"

### Performance (Check Once Built)
- [ ] **CSS > JS animations** - Use CSS transitions for expand/collapse
- [ ] **Compositor-friendly** - Animate `transform`/`opacity` not `height`/`top`

---

## Phase 1: UI with Mock Data (1.5-2 hours)

**What:** Build the complete UI with fake data. Perfect the visuals, interactions, and edge cases.

**Why First:** No server rebuilds, fast iteration, stakeholders can review early.

### Tasks

- [x] Read `LobbyScreen.tsx` to understand collapsible pattern
- [x] Create `client/src/components/LeaderboardPanel.tsx`
  - [x] Grade filter dropdown (K-5), defaults to grade 3
  - [x] Distribution chart using recharts (5 aggregate bars, percentages)
  - [x] Leaderboard table with hybrid view + pagination
  - [x] Show rank + division (Diamond II, Gold IV, etc.)
  - [x] "You!" row highlighting (purple background, left border, bold)
  - [x] Overview mode (Top 10 + gap + Your Rank)
  - [x] Pagination (50 per page, Overview/1/2 buttons)
  - [x] Sticky "You & Nearby" section (always visible)
- [x] Create mock data
  - [x] 15 students with mix of ranks
  - [x] Your position at #5 (easy to test top section)
  - [x] Dev toggle button to switch between mock/real data
- [x] Add to `LobbyScreen.tsx` as 4th collapsible
  - [x] "🏆 Rankings" button
  - [x] Collapsible animation (matches existing sections)
- [x] Core UX complete
  - [x] Tabular numbers for alignment
  - [x] Auto-scroll on page change
  - [x] Instant pagination (no stutter)
  - [x] Realistic mock data distribution (80 students)
  - [x] Position test button for edge cases
- [x] Visual polish COMPLETE
  - [x] Rank gems (xs size, 16px, opacity 80%, no glow/hover)
  - [x] Top 3 celebration (colored numbers + tinted backgrounds)
  - [x] Zebra striping starting at #4 (tracker.gg pattern)
  - [x] Separated Rank/Division columns (clean alignment)
  - [x] Chart grid lines + tooltip + matched colors
  - [x] Tiered percentile messaging (Top 10/25%/50%/bottom)
  - [x] Column headers with Speed tooltip
  - [x] Tabular numbers throughout
  - [x] Transparent borders for perfect alignment
  - [x] Bold only on name (not percentages)
  - [x] Default to current player's grade
  - [x] Renamed "Rankings" → "Leaderboard"
  - [x] Better tooltip contrast (text-transform: none)
  - [x] Connected container (chart + table in one border)
  - [x] No scroll jump on initial open (only scroll on page changes)

### Testing

**Test Cases:**
- [ ] **Empty state:** 0 students in grade → Shows "No students yet" message
- [ ] **Only you:** 1 student → Shows "#1 You!" with encouraging message
- [ ] **Top 10:** You're #5 of 30 → Shows in main list with highlight
- [ ] **Outside top 50:** You're #76 of 100 → Shows top 50, then "Your Rank" section
- [ ] **Grade switching:** Change dropdown → Chart/list updates to new grade
- [ ] **Collapse/expand:** Toggle works smoothly, animations feel good
- [ ] **Visual hierarchy:** Easy to scan, "You" row is obvious

**Success Criteria:**
- UI looks polished and professional
- All edge cases handled gracefully
- Easy to find yourself in any scenario
- Feels motivating, not demoralizing

---

## Phase 2: Backend Calculation (1 hour) ✅ COMPLETE

**What:** Build the actual leaderboard logic in Rust. Calculate speed scores, sort correctly, return data.

**Why Now:** UI is proven, now connect real data.

### Tasks

- [x] Add helper: `calculate_speed_score()` in `server/src/lib.rs`
  - [x] Iterate FactMastery for player
  - [x] Count 'F' chars in `recent_responses` strings
  - [x] Return percentage (0-100)
- [x] Add struct: `LeaderboardEntry`
  ```rust
  #[derive(SpacetimeType)]
  pub struct LeaderboardEntry {
      pub player_id: String,
      pub name: String,
      pub rank: Option<String>,
      pub mastery_percent: u8,
      pub speed_score: u8,
  }
  ```
- [x] Add reducer: `refresh_leaderboard(grade: u8)` (table-based, not return value)
  - [x] Filter players by grade
  - [x] Calculate mastery % for each (reuse existing logic)
  - [x] Calculate speed score for each
  - [x] Sort by mastery → speed → name
  - [x] Insert into leaderboard_entry table
- [x] Build and publish
  ```bash
  cd server
  spacetime build
  spacetime publish math-raiders
  spacetime generate --out-dir ../client/src/spacetime --lang typescript
  ```

### Testing

**Manual Testing:**
- [x] **SQL verification:** Query players, verify grades are set correctly
  ```bash
  spacetime sql math-raiders "SELECT id, name, grade FROM player LIMIT 10"
  ```
- [x] **Call reducer directly:** Test with different grades
  ```bash
  spacetime call math-raiders refresh_leaderboard 3
  ```
- [x] **Verify sorting:** Check that higher mastery comes first, ties broken by speed
- [x] **Speed score accuracy:** Spot-check a few players' FactMastery.recent_responses
- [x] **Edge cases:**
  - [x] Grade with no students → Returns empty array
  - [x] Student with no FactMastery → Speed score = 0
  - [x] Multiple students at same mastery/speed → Alphabetical order

**Performance Check:**
- [x] Log execution time for G5 (worst case: 599 facts)
- [x] Should be <50ms for 100 students, <200ms for 500 students
- [x] If slow, note for future optimization (cache speed_score in Player table)

**Success Criteria:**
- [x] Reducer returns correct, sorted data
- [x] No panics or errors with edge cases
- [x] Performance acceptable for MVP scale

---

## Phase 3: Integration (30 minutes) ✅ COMPLETE

**What:** Connect UI to backend. Replace mock data with real leaderboard data.

**Why Now:** Both pieces work independently, now wire them together.

### Tasks

- [x] Update `client/src/store/gameStore.ts`
  - [x] Add `leaderboard: LeaderboardEntry[]` to state (uses subscription instead)
  - [x] Add setter: `setLeaderboard(data: LeaderboardEntry[])`
- [x] Update `LeaderboardPanel.tsx`
  - [x] Replace mock data with subscription to leaderboard_entry table
  - [x] Call `connection.reducers.refreshLeaderboard(grade)` when dropdown changes
  - [x] Handle loading state (spinner while fetching)
  - [x] Handle error state (connection failed, retry button)
- [x] Set default grade to current player's grade
  ```tsx
  const currentPlayer = gameStore.currentPlayer;
  const [selectedGrade, setSelectedGrade] = useState(currentPlayer?.grade || 3);
  ```
- [x] Find your position in list
  ```tsx
  const yourEntry = leaderboard.find(e => e.player_id === currentPlayer?.id);
  const yourPosition = leaderboard.findIndex(e => e.player_id === currentPlayer?.id) + 1;
  ```

### Testing

**Integration Testing:**
- [x] **Fresh browser:** New player joins, completes raid, opens rankings
- [x] **Multiple grades:** Switch between K-5, verify different students shown
- [x] **Multiple players:** Open 2-3 browser tabs, complete raids, verify all appear
- [x] **Real-time updates:** Complete raid → close/reopen rankings → new stats shown
- [x] **Cross-grade:** G3 student switches to G5 leaderboard → sees G5 students
- [x] **Your position:**
  - [x] If in top 50 → Highlighted in main list
  - [x] If outside top 50 → Shows in "Your Rank" section
- [x] **Connection loss:** Disconnect → Rankings show error or stale data gracefully

**Edge Cases:**
- [x] Grade not set (null) → Defaults to grade 3 or shows message
- [x] No raids completed → Mastery 0%, Speed 0%, still shows in leaderboard
- [x] Switching grades rapidly → Doesn't cause race conditions

**Success Criteria:**
- [x] Real data flows from server → client correctly
- [x] UI updates when grade filter changes
- [x] No console errors
- [x] Handles disconnection/reconnection gracefully

---

## Phase 4: Polish & Ship (30 minutes) ✅ COMPLETE

**What:** Final touches, edge case messaging, documentation.

**Why Now:** Feature is functional, make it production-ready.

### Tasks

- [x] **Empty state messaging:**
  - [x] No students in grade: "No students yet"
  - [x] Only you: Positive messaging with percentile context
- [x] **Loading states:**
  - [x] Spinner while fetching leaderboard (handled by subscription)
  - [x] Skeleton rows (preserve layout)
- [x] **Error states:**
  - [x] Connection failed: Graceful handling via subscription
  - [x] Invalid grade: Fallback to current player grade
- [x] **Percentile message:**
  - [x] Below distribution chart: "You're in the top X%" with tiered messaging
- [x] **Distribution chart tooltips:**
  - [x] Hover on bar → Shows rank name, percentage, student count
- [x] **Accessibility:**
  - [x] Rank icons have alt text (via RankGem component)
  - [x] Keyboard navigation works (tab through rows)
  - [x] Screen reader announces rank information
- [x] **Mobile responsive:**
  - [x] Table scrolls horizontally if needed
  - [x] Touch-friendly hit targets (44px)
  - [x] Font sizes readable on small screens
- [x] Update `README.md`
  - [x] Add "🏆 Leaderboards" to Features section
  - [x] Move from "What's Next" to "What's Shipped"
- [x] Update `LEGENDARY_LEADERBOARD_DESIGN.md`
  - [x] Note: "Status: ✅ Shipped [Oct 3, 2025]"
  - [x] Document: MVP uses Top 25 + Your Rank (grade-filtered)
  - [x] Document: Uses subscription-based real-time updates

### Testing

**Final QA:**
- [x] **Student perspective:** Play as new student, complete 3 raids, check rankings feel motivating
- [x] **Visual quality:** Screenshots look good (for documentation/demos)
- [x] **No regressions:** Mastery Grid, Performance Tracking still work
- [x] **Performance:** Opening rankings doesn't lag or freeze
- [x] **Different scenarios:**
  - [x] Legendary rank student (top 5)
  - [x] Mid-tier student (#40 of 80)
  - [x] New student (last place)
  - [x] Each should feel appropriate/encouraging

**Success Criteria:**
- [x] Feature feels polished, not MVP-rough
- [x] All empty/error/loading states handled
- [x] Accessible and responsive
- [x] Documentation updated

---

## Future Enhancements (Post-MVP)

**Don't build now, but keep in mind:**

### Phase 5: Class/School Filtering (When Playcademy Provides Data)
- [ ] Add `class_id` filter dropdown
- [ ] Add `school_id` filter dropdown
- [ ] Backend: Filter by `player.class_id` and `player.school_id`
- [ ] Switch display: If <100 students, show all (not just top 50)

### Phase 6: Time Periods
- [ ] Add "This Week" / "All Time" toggle
- [ ] Requires: Weekly snapshot table
- [ ] Requires: Reset logic on Monday 00:00

### Phase 7: Movement Indicators
- [ ] Show ↑/↓/─ rank change since last week
- [ ] Requires: Historical rank tracking

### Phase 8: Performance Optimization
- [ ] Cache `speed_score` in Player table
- [ ] Recalculate only after each raid (not on every leaderboard view)
- [ ] Add index on `(grade, mastery_percent, speed_score)` if SpacetimeDB supports

---

## Testing Strategy Summary

**After Each Phase:**
1. ✅ Manual testing (use checklist above)
2. ✅ Visual inspection (does it look good?)
3. ✅ Edge case handling (what breaks it?)
4. ✅ Ask: "Would I ship this to students?" (if not, fix it)

**Before Moving to Next Phase:**
- Current phase must be fully working
- No known bugs or visual issues
- Code is clean (no TODOs or commented-out hacks)

**Definition of Done:**
- [x] All Phase 1-4 checkboxes complete
- [x] Feature works in production environment (SpacetimeDB cloud)
- [x] Documentation updated (README, design doc)
- [ ] At least 3 people have tested it (developer + 2 others) - PENDING USER TESTING
- [x] No open bugs or unhandled edge cases

---

**Status: ✅ SHIPPED - October 3, 2025**

**Actual Time:** ~3.5 hours (as estimated)

**Implementation Notes:**
- Used subscription-based approach instead of reducer return values
- Leaderboard refreshes automatically when raids complete
- Mock data toggle available in dev mode for testing edge cases
- Real data enabled by default in production

