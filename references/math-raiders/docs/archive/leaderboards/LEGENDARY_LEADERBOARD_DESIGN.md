# Legendary Leaderboard - Design & Implementation

**Status: ✅ SHIPPED - October 3, 2025**

## North Star

**Mastery completion is the goal.** Everything - levels, ranks, quests, leaderboards - exists to drive students toward 100% automaticity of math facts for their grade.

## Why Leaderboards Matter

### The Aspiration Gap

Without leaderboards, students have:
✅ Personal progress (mastery grid, chart)
✅ Absolute goals (rank up, level up)
✅ Cooperative play (multiplayer raids)
❌ **Social comparison** (the #1 motivator for ages 7-11)

Research shows K-5 students are driven by **peer comparison** more than personal improvement or abstract goals. "Am I better than Tommy?" matters more than "Did I improve by 5%?"

## Design: Rank-Based Leaderboard (Not Level-Based)

### Why Rank > Level

**Problem with Level Leaderboards:**
```
Top Students:
1. Emma (G5) - Level 32
2. You (G3) - Level 25
3. Tommy (K) - Level 18
```

Issues:
- G5 has 599 facts, K has ~70 facts
- Level measures time played, not mastery
- Unfair across grades
- Discourages younger students

**Solution: Rank Leaderboards:**
```
Top Students (Grade 3):
1. 💎 Emma - Diamond I (98% mastered)
2. 💎 You - Diamond II (94% mastered)
3. 🥇 Marcus - Gold I (72% mastered)
```

**Why it works:**
- ✅ Grade-normalized (Diamond in any grade ≈ 75% mastery)
- ✅ Fair comparison (K Diamond ≈ G5 Diamond, different facts)
- ✅ Measures skill (not just time played)
- ✅ Multi-grade classrooms can compete fairly
- ✅ Serves north star (rank UP = complete MORE mastery)

### Rank System Recap

```
Bronze:    0-24% mastered
Silver:    25-49% mastered
Gold:      50-74% mastered
Diamond:   75-89% mastered
Legendary: 90-100% mastered
```

Each rank has divisions (IV → III → II → I) showing progress within tier.

## Inspiration: Rank-Based Competition

Inspired by Valorant/League leaderboards, but adapted for educational context:
- Everyone sees their rank and position
- Rank gems provide visual hierarchy (legendary players stand out)
- Sorted by mastery % (serves north star)
- Secondary sort by speed (automaticity depth)

## Sorting Algorithm

### Primary Sort: Mastery Percentage

Students are ranked by how close to 100% completion they are. This directly serves the north star.

### Secondary Sort: Speed Score

**Speed score = % of recent responses that are Fast (≤2.5s)**

Calculation:
```typescript
// For each player:
totalResponses = SUM(fact.recent_responses.length) across all facts
fastResponses = COUNT('F' characters) across all recent_responses
speedScore = (fastResponses / totalResponses) × 100
```

**Uses existing data:**
- FactMastery.recent_responses string (last 10 per fact)
- 'F' = Fast, 'M' = Medium, 'S' = Slow, 'W' = Wrong
- No schema changes needed

**Why speed score matters:**
- Mastery is binary (100% = done)
- Speed shows automaticity DEPTH
- Prevents leaderboard stagnation
- Always dynamic (based on recent 10 × facts ≈ 500-5000 recent answers)
- Serves automaticity goal (not just accuracy, but instant recall)

### Tertiary Sort: Total AP (Tiebreaker)

At 100% mastery with identical speed scores, total AP (lifetime dedication) decides ranking. Edge case only.

### Final Sort: Alphabetical

If perfectly tied (extremely rare), sort alphabetically for deterministic, fair results.

### Complete Sorting Logic

```rust
legendary_players.sort_by(|a, b| {
    // 1. Mastery percentage (primary)
    match b.mastery_percent.cmp(&a.mastery_percent) {
        Equal => {
            // 2. Speed score (secondary - automaticity depth)
            match b.speed_score.cmp(&a.speed_score) {
                Equal => {
                    // 3. Total AP (dedication)
                    match b.total_ap.cmp(&a.total_ap) {
                        Equal => {
                            // 4. Alphabetical (stable)
                            a.name.cmp(&b.name)
                        },
                        other => other
                    }
                },
                other => other
            }
        },
        other => other
    }
});
```

## Display Design (tracker.gg Inspired)

### Top: Rank Distribution Chart

```
Grade 3 Rank Distribution (45 students)
┌────────────────────────────────────────┐
│ 20 ██████████ Bronze                   │
│ 12 ██████░░░░ Silver                   │
│  8 ████░░░░░░ Gold                     │
│  4 ██░░░░░░░░ Diamond                  │
│  1 █░░░░░░░░░ Legendary ← You're here! │
└────────────────────────────────────────┘
```

**Implementation:** recharts BarChart (already installed)

**Purpose:**
- Shows where everyone is (context)
- "You're in top 2%!" (achievement)
- Not intimidating (just data visualization)

### Bottom: Leaderboard Table

```
╔══════════════════════════════════════════════════╗
║ Legendary Tier (90%+ Mastery)                    ║
╠═════╦══════════╦═══════════╦════════════════════╣
║  #  ║ Student  ║ Mastery   ║ Speed              ║
╠═════╬══════════╬═══════════╬════════════════════╣
║  1  ║ Emma     ║ 98% ⭐⭐⭐ ║ 85% ⚡⚡          ║
║  2  ║ You!     ║ 94% ⭐⭐   ║ 82% ⚡⚡  ← YOU   ║
║  3  ║ Marcus   ║ 91% ⭐⭐   ║ 76% ⚡           ║
╠═════╩══════════╩═══════════╩════════════════════╣
║ Diamond & Below                                   ║
╠═════╦══════════╦═══════════╦════════════════════╣
║  4  ║ Sophie   ║ 89% ⭐⭐   ║ 74% ⚡           ║
║  5  ║ Jake     ║ 85% ⭐⭐   ║ 71% ⚡           ║
║ ... ║ ...      ║ ...       ║ ...              ║
║ 22  ║ Liam     ║ 48% ⭐    ║ 58%              ║
╚═════╩══════════╩═══════════╩════════════════════╝
```

**Visual elements:**
- Stars for mastery milestones (⭐ per 33%)
- Lightning for speed tiers (⚡ per 33%)
- Clear separation: Legendary section highlighted
- Your row gets background highlight
- Simplified from tracker.gg (4 columns max)

**Decision: Show everyone or top 10 + you?**
- Given TimeBack precedent: **Show everyone**
- Make it feel less harsh with visual design (no red for bottom, just fewer stars)

## Technical Implementation

### Phase 1: UI with Mock Data (2-3 hours)

```tsx
// client/src/components/LeaderboardPanel.tsx

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { RankGem } from './RankGem';

const mockDistribution = [
  { rank: 'Bronze', count: 20, fill: '#CD7F32' },
  { rank: 'Silver', count: 12, fill: '#C0C0C0' },
  { rank: 'Gold', count: 8, fill: '#FFD700' },
  { rank: 'Diamond', count: 4, fill: '#00CED1' },
  { rank: 'Legendary', count: 1, fill: '#A855F7' },
];

const mockPlayers = [
  { id: '1', name: 'Emma', rank: 'legendary', mastery: 98, speed: 85, isYou: false },
  { id: '2', name: 'You!', rank: 'legendary', mastery: 94, speed: 82, isYou: true },
  // ...
];

export function LeaderboardPanel() {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white">Grade 3 Rankings</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Distribution chart */}
        <div className="mb-8">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={mockDistribution}>
              {/* Configure like MasteryProgressChart */}
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Leaderboard table */}
        <div className="space-y-1">
          {mockPlayers.map((player, i) => (
            <LeaderboardRow 
              key={player.id}
              position={i + 1}
              player={player}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

### Phase 2: Backend (30 min - 1 hour)

```rust
// server/src/lib.rs

#[derive(SpacetimeType)]
pub struct LeaderboardEntry {
    pub player_id: String,
    pub name: String,
    pub rank: Option<String>,
    pub mastery_percent: u8,
    pub speed_score: u8,
}

#[reducer]
pub fn get_leaderboard(ctx: &ReducerContext, grade: u8) -> Vec<LeaderboardEntry> {
    // 1. Filter players by grade
    let mut players: Vec<_> = ctx.db.player()
        .iter()
        .filter(|p| p.grade == grade)
        .collect();
    
    // 2. Calculate speed score for each
    let mut entries: Vec<LeaderboardEntry> = players.iter()
        .map(|p| {
            let (mastered, total) = get_player_mastery_stats(ctx, p);
            let mastery_percent = if total > 0 { 
                ((mastered * 100) / total).min(100) as u8 
            } else { 0 };
            
            let speed_score = calculate_speed_score(ctx, &p.id);
            
            LeaderboardEntry {
                player_id: p.id.clone(),
                name: p.name.clone(),
                rank: p.rank.clone(),
                mastery_percent,
                speed_score,
            }
        })
        .collect();
    
    // 3. Sort by our algorithm
    entries.sort_by(|a, b| {
        match b.mastery_percent.cmp(&a.mastery_percent) {
            Equal => match b.speed_score.cmp(&a.speed_score) {
                Equal => a.name.cmp(&b.name),
                other => other
            },
            other => other
        }
    });
    
    entries
}

fn calculate_speed_score(ctx: &ReducerContext, player_id: &String) -> u8 {
    let mut total = 0u32;
    let mut fast = 0u32;
    
    for fact in ctx.db.fact_mastery().player_id().filter(player_id) {
        for c in fact.recent_responses.chars() {
            total += 1;
            if c == 'F' { fast += 1; }
        }
    }
    
    if total == 0 { return 0; }
    ((fast * 100) / total).min(100) as u8
}
```

### Phase 3: Integration (15 min)

```tsx
// client/src/store/gameStore.ts
export interface GameState {
    // ... existing ...
    leaderboard: LeaderboardEntry[];
}

// Subscribe to leaderboard in onConnect
conn.db.subscribe([
    // ... existing subscriptions ...
    `SELECT * FROM leaderboard WHERE grade = ${grade}` // If cached
]);

// Or call reducer on-demand
const refreshLeaderboard = () => {
    connection.reducers.getLeaderboard(currentPlayer.grade);
};
```

## Data Architecture Decisions

### Distribution Chart Data

**Option A: Calculate Client-Side (Simpler)**
```tsx
// Count ranks from leaderboard data
const distribution = useMemo(() => {
  const counts = { bronze: 0, silver: 0, gold: 0, diamond: 0, legendary: 0 };
  leaderboardData.forEach(p => counts[p.rank]++);
  return Object.entries(counts).map(([rank, count]) => ({ rank, count }));
}, [leaderboardData]);
```

**Option B: Server Provides (Efficient)**
```rust
// Return distribution with leaderboard
pub struct LeaderboardResponse {
    pub entries: Vec<LeaderboardEntry>,
    pub distribution: Vec<RankDistribution>,
}
```

**Recommendation:** Client-side (Option A) - simpler, one less API surface.

### Caching Strategy

**Don't cache leaderboard in a table.** Calculate on-demand because:
- Changes frequently (after every raid)
- Small dataset (max 100-200 students per grade)
- Calculation is fast (~5ms for G5)
- Reduces complexity (no cache invalidation)

**Cache player-level metrics:**
- ✅ Mastery % (already calculated)
- ✅ Speed score (calculate after each raid, store in Player table)

### Filtering & Scoping

**Phase 1 (MVP):**
- Filter by grade only
- Show all students in that grade
- No school/class filtering yet

**Phase 2 (When Playcademy Provides Data):**
```tsx
Filters:
- Grade (K-5)
- School (from Playcademy)
- Class (from Playcademy)
- Time period (This Week / All Time)
```

**Adult/Troll Protection:**
Defer to Playcademy platform (they must solve this for all games).

## UX Patterns (tracker.gg Inspired)

### What We're Stealing

1. **Rank distribution chart** - Shows population context
2. **Clean data table** - 4 columns max
3. **Visual hierarchy** - Legendary section separated
4. **Your position highlighted** - Easy to find yourself

### What We're NOT Stealing

❌ Location/flags (privacy)
❌ Social badges (moderation nightmare)
❌ Profile pictures (COPPA)
❌ "Last 24h" (too granular for K-5)

### Columns

```
Place | Name | Rank | Mastery | Speed
```

**That's it.** 5 columns, simple, focused, serves the goal.

**Visual indicators:**
- Rank gem (💎 Legendary, 🥇 Diamond, etc.) - provides visual hierarchy
- Clean percentages (no decorative icons needed)
- Zebra striping (alternating row backgrounds) for scanability
- Strong background highlight for "You!" row
- ⓘ tooltip on Speed column header: "% of recent answers that were Fast (≤2.5s). Based on last 10 attempts per fact."

**Implementation:**
```tsx
<div className={`
  ${index % 2 === 0 ? 'bg-gray-800/30' : 'bg-transparent'}
  ${player.isYou ? 'bg-purple-500/20 border-l-4 border-purple-400' : ''}
  px-4 py-3 hover:bg-white/5 transition-colors
`}>
```

**Why no tier separation:** Rank column already shows who's legendary (purple gem). No need for visual dividers or section headers.

**Why no stars/lightning:** Percentages are clear and self-explanatory. Rank gem provides all the visual hierarchy needed.

## Educational Considerations

### Growth Mindset Alignment

**Potential concerns:**
- Rankings can create fixed mindset ("I'm just #22")
- Comparison can cause anxiety
- Bottom students feel discouraged

**Mitigations:**
1. **Mastery-based metric** - everyone can reach 100%, it's not curved
2. **Visual stars** - even #22 can have ⭐⭐ (shows accomplishment)
3. **Legendary separation** - bottom students don't see "last place", just "not legendary yet"
4. **Distribution context** - "#22 of 45" less harsh than raw ranking
5. **Weekly resets** (future) - fresh starts

### Parent/Teacher Messaging

**"This isn't a grade, it's a game leaderboard."**
- Opt-in competitive mode
- Measures practice effort, not aptitude
- Everyone working toward same 100% goal
- Like showing high scores in arcade games

## Empty States

### No Students Yet
```
📊 Grade 3 Rankings

No students yet! Complete your first raid to appear on the leaderboard.
```

### First Student
```
#   Name     Rank          Mastery  Speed
──────────────────────────────────────────
1   You!     🥉 Bronze     12%      45%

Great start! Keep raiding to climb the ranks.
```

### Populated Leaderboard
```
#   Name     Rank          Mastery  Speed
──────────────────────────────────────────
1   Emma     💎 Legendary  98%      85%
2   Marcus   🥇 Diamond    89%      78%
3   You!     🥇 Diamond    85%      74%  ← Highlighted
...
```

## Technical Notes

### Performance

**G5 worst case:**
- 599 facts × 10 responses = 5,990 chars per student
- 50 legendary students = ~300K char comparisons
- Modern CPU: <5ms total
- Acceptable for leaderboard view (not real-time)

**Optimization if needed:**
Cache speed_score in Player table, recalculate after each raid.

### Backend Query

```rust
// Simple, no complex joins needed
pub fn get_leaderboard(ctx: &ReducerContext, grade: u8) -> Vec<LeaderboardEntry> {
    // Already have all data in Player + FactMastery tables
    // Filter, map, sort - straightforward
}
```

### Frontend Integration

**MVP: Add as 4th collapsible section in LobbyScreen**

```tsx
// Matches existing pattern (MasteryGrid, PerformanceTracking)
const [showLeaderboard, setShowLeaderboard] = useState(false);

// Toggle button
<button onClick={() => setShowLeaderboard(!showLeaderboard)}>
  🏆 Rankings
  <ChevronRight className={showLeaderboard ? 'rotate-90' : ''} />
</button>

// Collapsible section
<AnimatePresence>
  {showLeaderboard && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
    >
      <LeaderboardPanel />
    </motion.div>
  )}
</AnimatePresence>
```

**Placement in lobby:**
1. Player Card (always visible)
2. Action Buttons (always visible)
3. ▶ Mastery Grid (collapsible)
4. ▶ Performance Tracking (collapsible)
5. **▶ Rankings (collapsible)** ← NEW

**Why collapsible for MVP:**
- Easy to add (matches existing pattern)
- Doesn't clutter lobby by default
- Can iterate placement later (tab, always-visible, mini-version, etc.)
- Component is 90% of work, placement is 5 minutes to change

## Development Workflow

### Step 1: UI First (Recommended)

1. Create `LeaderboardPanel.tsx` with mock data
2. Build distribution chart
3. Build leaderboard table
4. Add animations, styling
5. Test responsive behavior
6. Get the UX perfect

**Benefits:**
- Fast iteration (no Rust rebuilds)
- Easy to test edge cases
- Can show to stakeholders early

### Step 2: Backend

1. Add `calculate_speed_score` helper
2. Add `get_leaderboard` reducer
3. Test with real data
4. Verify performance

### Step 3: Integration

1. Subscribe to leaderboard or call on-demand
2. Replace mock data with real data
3. Handle loading/error states
4. Ship

**Estimated time:**
- UI: 2-3 hours
- Backend: 1 hour
- Integration: 30 min
- **Total: Half day of work**

## Success Metrics

### Engagement
- % of students who view leaderboard
- Time spent on leaderboard screen
- Daily return rate after viewing

### Motivation
- Correlation between leaderboard rank and raid frequency
- Mastery completion rate before/after leaderboard
- Student feedback ("I want to reach legendary")

### Safety
- Teacher/parent complaints (should be zero)
- Student anxiety reports (monitor closely)
- Opt-out requests (allow if requested)

## Future Enhancements

### Not MVP, But Nice-to-Have:

1. **Movement indicators** (↑12, ↓3, ─)
   - Requires storing previous week's ranks
   - Shows momentum

2. **Multiple tabs** ("Your Grade" / "All Grades" / "Friends")
   - Requires friend system
   - More filtering options

3. **Time periods** ("This Week" / "All Time")
   - Requires snapshot history
   - Weekly resets for fresh competition

4. **Hall of 100% Masters**
   - Separate celebration for completers
   - Timestamp-based (first to complete = honor)

5. **Class/School filtering**
   - When Playcademy provides grouping data
   - More relevant comparison

## Conclusion

Legendary leaderboard serves mastery completion by:
1. Making 90%+ achievement visible and aspirational
2. Creating friendly competition among high achievers
3. Showing that 100% is the ultimate goal
4. Providing grade-normalized, fair comparison
5. Using existing data (no new tracking needed)

This is the final piece of the motivational puzzle. Ship it.

---

**Last Updated:** 2025-10-01
**Status:** Design complete, ready for implementation
**Next Step:** Build UI with mock data

