# Math Raiders

**Turn math fact practice into boss battles.**

Kids need thousands of reps to build math fact automaticity. They find flashcards boring. They avoid practice. Speed suffers.

Math Raiders fixes this: **Answer fast = deal damage. Wrong = miss. Kill the boss = win.**

---

## Pilot Results (Dec 2025)

| Metric | Result |
|--------|--------|
| **Speed Improvement** | +6.5 CQPM average across 8 validated students (target was +3-5) |
| **Breakthrough Performance** | 3/8 broke through all-time personal bests; 5/8 improved |
| **Engagement** | 18 students, 13.3 min/active day avg. Top 5 exceeded 16 min/day. |

> "My kids were all impressed with how easy Fast Math is now that they've been doing Math Raiders." — Jessica, Guide

> "Cancel Fast Math and make it all Math Raiders." — Octavia, Student

> "The kids decided as a group today to stay in and give up half their q-break so they could play extra Math Raiders. It went to a vote." — Jessica, Guide

---

## The Game

**Complete MMO-style progression in ~2 minute raids.** Team up with friends using room codes or practice solo. Watch damage numbers fly as your squad takes down bosses together. Build combos with grade-appropriate fast answers (K: ≤3s, G5: ≤1.5s). Infinite leveling system with titles, daily quests, and track mastery across all four operations: addition, subtraction, multiplication, and division.

### Core Loop (~2 minutes)
1. **Connect** → Automatic Playcademy auth or device-based account
2. **Squad Up** → Join room code or go solo  
3. **Battle** → Solve problems, deal damage
4. **Master** → Track progress on your grid
5. **Raid Again** → One-click restart

---

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) - `curl -fsSL https://bun.sh/install | bash`
- [Rust](https://rustup.rs/) - `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- [SpacetimeDB CLI](https://spacetimedb.com/install) - `curl -sSf https://spacetimedb.com/install.sh | sh`

### First Time Setup

```bash
# 1. Clone the repository
git clone https://github.com/caocampb/math-raiders.git
cd math-raiders

# 2. Terminal 1: Start SpacetimeDB
spacetime start

# 3. Terminal 2: Build and publish the module
cd server
spacetime build
spacetime publish math-raiders
spacetime generate --out-dir ../client/src/spacetime --lang typescript

# 4. Terminal 2: Install and start the client
cd client
bun install
bun run dev

# Open http://localhost:5173 and play!
```

### Troubleshooting

**"spacetime: command not found"** → `curl -sSf https://spacetimedb.com/install.sh | sh`

**"error: failed to run rustc"** → `rustup target add wasm32-unknown-unknown`

**"Connection Failed" in browser** → Make sure `spacetime start` is running

**Need to rebuild server?** → `cd server && spacetime build && spacetime publish math-raiders`

### Quick Play Guide

**Controls:** Type answers (auto-submit when complete), or press Enter.

**Tips:** Answer at grade threshold for max damage • Fast correct answers build combos • Check your mastery grid after each raid

---

## Features

### Mastery Grid
Visual progress tracking for all math facts across operations
- **Gray** → Not attempted
- **Cyan** → Learning accuracy
- **Purple** → Building speed (progressing toward threshold)
- **Gold** → Mastered (2+ fast in last 3 attempts)

### Speed Streak  
Only FAST answers (grade-based threshold) build your streak!
- Visual intensity increases as you go: 5x, 10x, 15x, 20x+
- Boss panic reactions at high streaks
- Combos are for glory, not damage - speed determines power!

### Game Modes

#### Quick Play (Adaptive HP)
- **Solo or Co-op** - Practice alone or squad up with room codes
- **Adaptive HP** - Boss health scales to your skill (~2 min raids)
- **Cosmetic Boss Choice** - Pick any unlocked boss visual
- **Perfect for daily practice** - No stakes, pure improvement

#### Mastery Trials (Fixed HP)
- **8-Boss Ladder** - Progress through increasingly difficult bosses
- **Fixed HP Gates** - Prove you can hit CQPM thresholds
- **Unlock Progression** - Beat a boss solo to unlock the next
- **Track Master Path** - Beat your grade's goal boss 3× to earn the badge

| Boss | HP | CQPM Gate | Grade Goal |
|------|-----|-----------|------------|
| Gloop Jr. (Slime) | 900 | 5 | - |
| Whisper (Ghost) | 1750 | 10 | - |
| Bonehead (Skull) | 2600 | 15 | - |
| Boomer (Bomb) | 3500 | 20 | K |
| Frosty (Snowman) | 4200 | 25 | - |
| Titan (Mech) | 5000 | 30 | G1-3 |
| Captain Nova | 5500 | 35 | G4 |
| Void Emperor | 6000 | 40 | G5 |

#### Multiplayer Features
- **Private Rooms** - Share a 4-letter code with friends (2-10 players)
- **Disconnect/Reconnect** - Robust handling of network interruptions with pause/resume
- **Time Limit** - Raids auto-end at 2:30 for adaptive, 2:00 for fixed boss levels

### Smart Problem Selection
- **Tracks** - Grade-specific problem sets (e.g., "Addition Challenge", "Multiplication Training")
- **Mastery-Based Weighting** - ZPD facts (L2-4) get 70% weight, mastered (L5) get 20%, hard/unknown (L0-1) get 10%
- **Recent Problem Suppression** - Facts in the last 10 problems get 10x reduced weight (spacing effect)
- **Operand Sharing Filter** - Prevents consecutive problems from sharing numbers (e.g., no 7×9 right after 7×8)
- **Time-Based Spacing** - Facts unseen for 3+ days get 2x weight (forgetting curve)

### Juice & Polish
- Damage numbers with speed-based colors
- Boss reactions (sweating at low health!)
- Screen shake on big combos
- Particle effects for correct answers
- Input success ripples

### Player Accounts
- **Playcademy Authentication** - Automatic login for Playcademy users
- **Cross-Device Play** - Your progress follows you everywhere
- **Anonymous Mode** - Device-based accounts for standalone play

### Player Progression

#### Level System (Infinite Progression)
- **AP from raids** - Base AP + performance bonuses
- **Daily Training** - Play 10 minutes for 400 bonus AP
- **Weekly Challenge** - Play 50 minutes for 1500 bonus AP
- **Valorant-style** - Level 60 in ~30 weeks, then infinite prestige
- **Titles** - Rookie → Rising Star → ... → Mythic → Prestige (12 tiers)

#### Rank System
Progress through ranks based on grade-appropriate fact mastery:
- **Bronze** (0-25%) → **Silver** (25-50%) → **Gold** (50-75%) → **Diamond** (75-90%) → **Legendary** (90-100%)
- Each rank has 4 divisions (IV, III, II, I)
- Only grade-appropriate facts count toward mastery percentage

#### Performance Tracking
- **Lifetime Stats** - Total raids, problems answered, accuracy %
- **Per-Fact Mastery** - Up to 10,000 attempt history per fact
- **Track Master Badges** - Beat your grade's goal boss 3× in Mastery Trials
- **Leaderboards** - Grade-filtered rankings by mastery % and speed

---

## Architecture

### Tech Stack
- **[SpacetimeDB](https://spacetimedb.com)** - Real-time multiplayer database
- **[Playcademy SDK](https://playcademy.com)** - Player authentication
- **React + TypeScript** - Type-safe UI
- **PIXI.js** - Hardware-accelerated particle effects
- **Framer Motion** - UI animations and transitions
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **Bun** - Fast builds and worker service

### Key Systems

#### Adaptive Difficulty
- Boss HP scales with player grade and performance
- CQPM tracking for difficulty adjustment
- 3×7 and 7×3 treated as same fact for mastery tracking

#### TimeBack Integration
- Learning analytics sent to TimeBack dashboard
- Performance-gated XP (1 XP per focused minute, capped at 2.5 XP per raid)
- Automatic enrollment for Grades 1-5

---

## Educational Design

### Based on Research
- **Speed Goal**: Grade-based CQPM standards (K: 3s, G1-3: 2s, G4: 1.7s, G5: 1.5s)
- **Spaced Repetition**: Problems adapt to mastery level
- **Immediate Feedback**: See damage instantly
- **Social Learning**: Peer motivation through co-op
- **Quality Over Speed**: Wrong answers deal 0 damage (not harmful to team)

### Damage Calculation
```
Grade-based speed thresholds:
- K: 3s (20 CQPM) | G1-3: 2s (30 CQPM) | G4: 1.7s (35 CQPM) | G5: 1.5s (40 CQPM)

At threshold:     75 damage (Lightning Fast!) - 15% crit = 150
Threshold +1s:    60 damage (Lightning!)
Threshold +2s:    45 damage (Great!)
Threshold +3s:    30 damage (Solid!)
Threshold +5s:    23 damage (Keep going!)
Beyond:           15 damage (Participation)
```

---

## Development

### Daily Workflow

```bash
# Terminal 1: Start SpacetimeDB (if not already running)
spacetime start

# Terminal 2: Start the client dev server
cd client && bun run dev
```

### Making Server Changes

```bash
cd server
spacetime build
spacetime publish math-raiders
spacetime generate --out-dir ../client/src/spacetime --lang typescript
```

**Note:** Schema changes (adding/removing columns) require `spacetime publish math-raiders --delete-data`

### Useful Commands

```bash
# Query data
spacetime sql math-raiders "SELECT * FROM player"

# View logs
spacetime logs math-raiders -f

# Reset database (deletes all data)
spacetime publish math-raiders --delete-data

# Run client against production
cd client && bun run dev:prod
```

### Environment Variables

```env
VITE_SPACETIMEDB_HOST=ws://localhost:3000        # Development
VITE_SPACETIMEDB_HOST=wss://your-server.com      # Production
```

---

## Production Deployment

### Deploy to Playcademy

1. **Backend on AWS EC2** (or similar)
   ```bash
   curl -sSf https://spacetimedb.com/install.sh | sh
   spacetime start --listen-addr 0.0.0.0:3000
   spacetime publish math-raiders -s http://your-server:3000
   ```

2. **Frontend to Playcademy**
   ```bash
   cd client && bun run build
   # Zip dist/ folder → Upload to Playcademy arcade
   ```

### Production Checklist
- [ ] Set production SpacetimeDB URL in `.env.production`
- [ ] Test auth flow with real Playcademy accounts
- [ ] Verify WebSocket connectivity
- [ ] Check performance on target devices
- [ ] Deploy TimeBack worker service

---

## License

MIT - See [LICENSE](LICENSE)

---

## Credits

Built with [SpacetimeDB](https://spacetimedb.com), [Playcademy](https://playcademy.com), [React](https://react.dev), [PIXI.js](https://pixijs.com), and [Alpha School](https://alpha.school).
