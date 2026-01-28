# Pilot Analysis

One script. One table. You decide what's valid.

## Usage

```bash
# 1. Backup production
./scripts/ops/backup.sh production

# 2. Set TimeBack credentials (optional)
export VITE_TIMEBACK_CLIENT_ID=...
export VITE_TIMEBACK_CLIENT_SECRET=...

# 3. Run
cd pilot
./analyze_pilot.py ~/Desktop/MathRaiders-Backups/production/production_YYYY-MM-DD_HH-MM.sqlite 2025-12-09 2025-12-19
```

## Output

One table with everything:

| Student | G | Days | Total | XP | XP% | Acc | MR Track | MR Peak | Pre Trk | Pre | Post Trk | Post | Gain | Min/+1 | Aligned |
|---------|---|------|-------|----|----|-----|----------|---------|---------|-----|----------|------|------|--------|---------|
| Octavia | 3 | 8 | 149 | 128 | 86% | 89% | track6 | 30.8 | track6 | 11 | track6 | 36 | +25 | 5.1 | ✓ |
| Everett | 3 | 9 | 196 | 45 | 23% | 75% | track6 | 28.1 | track6 | 25 | track6 | 24 | -1 | - | ✓ |

**Legend:**
- ✓ = All tracks aligned (MR = Pre = Post)
- ✗ = Mismatch (practiced different track than tested)
- ~ = Pre/post same track, but MR different
- ? = Incomplete data

## Workflow

1. Run script → copy output
2. Paste to AI: "Help me write a pilot report"
3. You tell AI: "Jimmy is misaligned, exclude. Jace has no post."
4. AI generates report, you review, send
