---
name: student-raid-analysis
description: Analyze student raid history, boss progress, fact mastery, and session time in Math Raiders. Use when asked to "check on [student]", "what happened with [name]", "analyze raids for [student]", "how is [name] doing", or "backup and look at [student]".
---

# Student Raid Analysis

Workflow for investigating a specific student's Math Raiders progress.

## Quick Start

```bash
# 1. Get fresh backup (if needed)
./scripts/ops/backup.sh production

# 2. Find latest backup
BACKUP=$(ls -t ~/Desktop/MathRaiders-Backups/production/*.sqlite | head -1)

# 3. Open in sqlite3
sqlite3 "$BACKUP"
```

## Find Student

```sql
-- By name (partial match)
SELECT id, name, email, grade, rank, total_problems, total_correct
FROM player WHERE name LIKE '%johnny%';

-- By email
SELECT * FROM player WHERE email LIKE '%johnny%';

-- Store ID for later queries
-- Example: id = 'a1b2c3d4...'
```

## Raid History (performance_snapshot)

```sql
-- Recent raids with times in Austin/CST
SELECT 
    datetime(timestamp/1000000, 'unixepoch', '-6 hours') as time,
    track,
    boss_level,
    CASE victory WHEN 1 THEN '✓' ELSE '✗' END as won,
    problems_correct || '/' || problems_attempted as score,
    session_seconds || 's' as duration,
    ROUND(problems_correct * 60.0 / NULLIF(session_seconds, 0), 1) as cqpm
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE'
ORDER BY timestamp DESC
LIMIT 20;
```

```sql
-- Raids from today only (Austin time)
SELECT datetime(timestamp/1000000, 'unixepoch', '-6 hours') as time,
       track, boss_level, victory, problems_correct, session_seconds
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE'
  AND date(timestamp/1000000, 'unixepoch', '-6 hours') = date('now', '-6 hours')
ORDER BY timestamp DESC;
```

## Boss Progress

```sql
-- Highest boss beaten per track
SELECT track, MAX(boss_level) as highest_boss
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE' AND victory = 1
GROUP BY track;
```

```sql
-- Division track (TRACK5) boss attempts
SELECT 
    datetime(timestamp/1000000, 'unixepoch', '-6 hours') as time,
    boss_level,
    CASE victory WHEN 1 THEN 'WIN' ELSE 'LOSS' END as result,
    problems_correct || '/' || problems_attempted as score
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE' AND track = 'TRACK5'
ORDER BY timestamp DESC;
```

## Fact Mastery

```sql
-- Mastery summary
SELECT 
    mastery_level,
    COUNT(*) as facts
FROM fact_mastery
WHERE player_id = 'PLAYER_ID_HERE'
GROUP BY mastery_level ORDER BY mastery_level;
```

```sql
-- Weak facts (mastery 0-2)
SELECT fact_key, total_attempts, mastery_level
FROM fact_mastery
WHERE player_id = 'PLAYER_ID_HERE' AND mastery_level <= 2
ORDER BY total_attempts DESC LIMIT 20;
```

```sql
-- Division facts specifically
SELECT fact_key, total_attempts, mastery_level
FROM fact_mastery
WHERE player_id = 'PLAYER_ID_HERE' AND fact_key LIKE '%÷%'
ORDER BY mastery_level, total_attempts DESC;
```

## CQPM Analysis

```sql
-- CQPM trend over time
SELECT 
    date(timestamp/1000000, 'unixepoch', '-6 hours') as day,
    ROUND(AVG(problems_correct * 60.0 / NULLIF(session_seconds, 0)), 1) as avg_cqpm,
    SUM(session_seconds) as total_seconds,
    COUNT(*) as raids
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE'
GROUP BY day ORDER BY day DESC LIMIT 14;
```

## Session Time

```sql
-- Total play time
SELECT 
    SUM(session_seconds) / 60 as total_minutes,
    COUNT(*) as total_raids,
    AVG(session_seconds) as avg_raid_seconds
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE';
```

```sql
-- Play time by day
SELECT 
    date(timestamp/1000000, 'unixepoch', '-6 hours') as day,
    SUM(session_seconds) / 60 as minutes,
    COUNT(*) as raids
FROM performance_snapshot
WHERE player_id = 'PLAYER_ID_HERE'
GROUP BY day ORDER BY day DESC;
```

## Track ID Reference

| ID | Operation | Range |
|----|-----------|-------|
| TRACK12 | + | ≤10 |
| TRACK9 | + | 0-9 |
| TRACK6 | + | ≤20 |
| TRACK10 | - | from 20 |
| TRACK8 | - | ≤20 |
| TRACK11 | × | 0-9 |
| TRACK7 | × | 0-12 |
| TRACK5 | ÷ | 0-12 |

## Boss System

### Two Modes

| Mode | `boss_level` | HP | Timeout |
|------|-------------|-----|---------|
| Adaptive (Quick Play) | 0 or 100-108 | Personalized to player CQPM | 2:30 |
| Fixed (Mastery Trial) | 1-8 | Fixed tier from table below | 2:00 |

### Fixed Boss Tiers (Mastery Trial)

| Level | Boss | HP | Target CQPM | Goal Grade |
|-------|------|-----|-------------|------------|
| 1 | Sludge | 1000 | 5 | — |
| 2 | Whisper | 1750 | 10 | — |
| 3 | Bonehead | 2600 | 15 | — |
| 4 | Boomer | 3500 | 20 | K |
| 5 | Frosty | 4200 | 25 | — |
| 6 | Titan | 5000 | 30 | G1-3 |
| 7 | Captain Nova | 5500 | 35 | G4 |
| 8 | Void Emperor | 6000 | 40 | G5+ |

### Decoding `boss_level`

- `0` = Adaptive HP, random visual
- `1-8` = Fixed HP tier (Mastery Trial)
- `100-108` = Adaptive HP + specific visual (100+N = boss N skin)

Example: `boss_level = 107` means adaptive HP but Captain Nova visual.

### Track Master

3× solo wins on goal boss = grade-level fluency. Goal bosses:
- K → Boss 4 (Boomer)
- G1-3 → Boss 6 (Titan)
- G4 → Boss 7 (Captain Nova)
- G5+ → Boss 8 (Void Emperor)

## SQLite Schema

### player
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Hex player ID |
| name | TEXT | Display name |
| grade | INTEGER | School grade |
| rank | TEXT | Current rank |
| total_problems | INTEGER | Lifetime attempts |
| total_correct | INTEGER | Lifetime correct |
| timeback_id | TEXT | TimeBack user ID (nullable) |
| email | TEXT | Email (nullable) |
| last_played | INTEGER | Unix timestamp (seconds) |

### performance_snapshot (raids)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Snapshot ID |
| player_id | TEXT FK | References player.id |
| timestamp | INTEGER | Unix micros (÷1e6 for seconds) |
| track | TEXT | e.g. "TRACK12" (+≤10) |
| problems_attempted | INTEGER | This raid |
| problems_correct | INTEGER | This raid |
| session_seconds | INTEGER | Raid duration |
| boss_level | INTEGER | Boss fought |
| victory | INTEGER | 1=won, 0=lost |
| damage_dealt | INTEGER | Total damage |
| raid_type | TEXT | "solo", "coop", "pvp" |

### fact_mastery
| Column | Type | Notes |
|--------|------|-------|
| player_id | TEXT FK | References player.id |
| fact_key | TEXT | e.g. "3+4", "7×8", "56÷8" |
| total_attempts | INTEGER | Lifetime |
| mastery_level | INTEGER | 0-5 scale |

## One-Liner for Common Check

```bash
# Quick "how's Johnny doing today"
sqlite3 "$(ls -t ~/Desktop/MathRaiders-Backups/production/*.sqlite | head -1)" \
  "SELECT datetime(timestamp/1000000,'unixepoch','-6 hours') as time, track, boss_level, victory, problems_correct, session_seconds FROM performance_snapshot WHERE player_id = (SELECT id FROM player WHERE name LIKE '%johnny%') AND date(timestamp/1000000,'unixepoch','-6 hours') = date('now','-6 hours') ORDER BY timestamp DESC;"
```
