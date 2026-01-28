# Math Raiders Logging Guide

> **TL;DR:** One canonical log per operation. Grep by `[TAG]`. 7 days retention.

---

## Philosophy

We follow **Nystrom + Boris synthesis**:

| Principle | Implementation |
|-----------|----------------|
| **One log per operation** | Each action emits exactly one `[TAG]` log at completion |
| **Tell a story** | Logs read like narrative: `Alice → player:X → raid:Y → XP:Z` |
| **High-cardinality fields** | Include IDs that let you filter: `player:`, `event:`, `raid:` |
| **Log decisions, not steps** | Log "XP skipped: low_accuracy" not "checking accuracy... 65%... threshold is 80%..." |
| **Duration on external calls** | TimeBack API calls include `(Nms)` for performance debugging |

**What we DON'T log:**
- Internal function calls ("entering processRaid...")
- Happy-path verbosity ("step 1 complete, step 2 complete...")
- Redundant context (player name appears once, not in every line)

---

## System Architecture

```
Client (React)
    │
    ▼ POST /verify {jwt}
Worker (Bun) ─────────────────── [VERIFY] [STARTUP] [TOKEN]
    │
    ▼ create_session(player_id, identity)
Server (SpacetimeDB/Rust) ────── [CONNECT] [DISCONNECT] [ROOM] [RAID] [XP] [QUEST] [GRADE]
    │
    ▼ timeback_event_queue insert
Worker polls queue
    │
    ▼ POST to TimeBack API
Worker ───────────────────────── [TIMEBACK]
```

**Key IDs:**
- `player:a1b2c3d4` — First 8 chars of Playcademy user ID
- `ws:x9y8z7w6` — First 8 chars of WebSocket identity  
- `event:1234` — TimeBack queue item ID
- `raid:567` — Raid session ID
- `track=TRACK8` — FastMath track synced at login (smart default for operations)

---

## Log Tags

| Tag | When | Example |
|-----|------|---------|
| `[VERIFY]` | JWT validated | `email=alice@... player_id=a1b2c3d4 grade=3 track=TRACK8` |
| `[CONNECT]` | Player joins | `Alice player:a1b2c3d4 grade:3 (returning)` |
| `[DISCONNECT]` | Player leaves | `Alice player:a1b2c3d4` |
| `[ROOM]` | Room created/joined | `created code:ABCD player:Alice` |
| `[RAID]` | Raid lifecycle | `starting raid:123 players:4 hp:500` |
| `[XP]` | TimeBack XP decision | `Alice earned:2.5 correct:8/10 cqpm:4.2` |
| `[TIMEBACK]` | API call result | `✓ event:1234 user:tb_abc12 xp:2.5 (847ms)` |
| `[QUEST]` | Quest completion | `daily complete player:Alice time:300s` |
| `[GRADE]` | Grade change | `changed player:a1b2c3d4 grade:3→4` |

**Failure indicators:** `✗` for errors, `⚠` for warnings, `skipped` for intentional skips.

---

## Pattern Recognition

### Healthy Flow
```
[VERIFY] email=alice@school.edu player_id=a1b2c3d4 grade=3 track=TRACK8
[CONNECT] Alice player:a1b2c3d4 grade:3 (returning)
[RAID] starting raid:123 players:2 hp:400
[RAID] ended raid:123 result:victory duration:180s
[XP] Alice earned:2.5 correct:8/10 cqpm:4.2
[TIMEBACK] ✓ event:456 user:tb_abc12 xp:2.5 (847ms)
```

### Failure: Token Invalid
```
[VERIFY] ✗ ws:x9y8z7w6 error:token_invalid JWT expired
```
→ User needs to re-login at hub.playcademy.net

### Failure: Identity Changed (THE BUG)
```
[CONNECT] Alice player:a1b2c3d4 grade:3 (returning) ⚠ identity: email=true timeback=false
```
→ Player's email changed on reconnect. Token refresh returned different user data.

### Failure: TimeBack API Error
```
[TIMEBACK] ✗ event:1234 user:tb_abc12 error:401 (234ms)
```
→ Worker credentials expired. Check `TIMEBACK_CLIENT_ID/SECRET`.

### Intentional Skip: Low Accuracy
```
[XP] Alice skipped reason:low_accuracy accuracy:65% cqpm:2.1
```
→ Not a bug. Player below 80% accuracy threshold.

---

## Troubleshooting

> **Note:** Game logic logs (`[XP]`, `[RAID]`, `[CONNECT]`, etc.) live in **module_logs**, not journalctl.
> Use the `MODULE_LOGS` path below, or query Axiom for easier searching.

```bash
# Shorthand for the module logs path
MODULE_LOGS=~/.local/share/spacetime/data/replicas/*/module_logs/*.log
```

### "XP didn't sync to TimeBack"

```bash
# 1. Did server create XP event?
ssh math-raiders "grep 'XP.*StudentName' ~/.local/share/spacetime/data/replicas/*/module_logs/*.log | tail -20"
```

| Result | Meaning | Next Step |
|--------|---------|-----------|
| `[XP] earned:X` | XP was awarded | Check worker delivery below |
| `[XP] skipped reason:X` | Intentional skip | Tell user: accuracy/engagement too low |
| No match | Raid didn't end | Check `[RAID]` logs |

```bash
# 2. Did worker deliver to TimeBack?
ssh math-raiders "pm2 logs timeback-worker --lines 500 | grep 'TIMEBACK'"
```

| Result | Meaning | Next Step |
|--------|---------|-----------|
| `[TIMEBACK] ✓` | Delivered | Check TimeBack dashboard |
| `[TIMEBACK] ✗ error:401` | Auth failed | Refresh worker credentials |
| `[TIMEBACK] ✗ error:500` | TimeBack down | Wait and retry |
| No match | Event stuck in queue | Check worker is running |

---

### "Student can't connect"

```bash
# 1. Did they reach the gateway?
ssh math-raiders "pm2 logs timeback-worker --lines 200 | grep 'VERIFY.*student@email'"
```

| Result | Meaning | Next Step |
|--------|---------|-----------|
| `[VERIFY] ✓` | Token valid | Check server below |
| `[VERIFY] ✗ token_invalid` | Bad/expired token | Re-login at hub |
| No match | Never reached gateway | Client/network issue |

```bash
# 2. Did server accept them?
ssh math-raiders "grep 'CONNECT.*StudentName' ~/.local/share/spacetime/data/replicas/*/module_logs/*.log | tail -10"
```

---

### "Student has wrong identity"

```bash
# Check for identity warnings
ssh math-raiders "grep '⚠ identity' ~/.local/share/spacetime/data/replicas/*/module_logs/*.log"
```

If found: Token refresh returned different user data. This is THE BUG we fixed.

---

## Commands

```bash
# Live tail
ssh math-raiders "pm2 logs timeback-worker"                                    # Worker (TypeScript)
ssh math-raiders "tail -f ~/.local/share/spacetime/data/replicas/*/module_logs/*.log"  # Game logic (Rust)
ssh math-raiders "sudo journalctl -u spacetimedb -f"                           # Server lifecycle only

# Search game logs by player
ssh math-raiders "grep 'Alice' ~/.local/share/spacetime/data/replicas/*/module_logs/*.log | tail -50"
ssh math-raiders "pm2 logs timeback-worker --lines 1000 | grep 'alice@'"

# Find all errors in game logic
ssh math-raiders "grep '✗\|ERROR\|dead_letter' ~/.local/share/spacetime/data/replicas/*/module_logs/*.log"
ssh math-raiders "pm2 logs timeback-worker --lines 2000 | grep '✗'"

# Export for analysis
ssh math-raiders "pm2 logs timeback-worker --lines 10000 --nostream" > worker.log
ssh math-raiders "cat ~/.local/share/spacetime/data/replicas/*/module_logs/*.log" > module.log
```

---

## Retention

| Component | Duration | Size |
|-----------|----------|------|
| Worker (PM2) | 7 days | ~70MB |
| Server (journalctl) | 30 days | ~100MB |
| Axiom | 30 days | 500 GB/month free |

If you need logs from longer ago, you don't have them. Investigate faster next time.

---

## Axiom (Cloud Log Aggregation)

SpacetimeDB server logs are shipped to [Axiom](https://app.axiom.co) for queryable, long-term storage and panic alerts.

### What's in Axiom

| Source | Dataset | Contains |
|--------|---------|----------|
| SpacetimeDB server | `spacetime-logs` | `[CONNECT]`, `[RAID]`, `[XP]`, panics |
| SpacetimeDB module | `spacetime-logs` | Game logic logs (JSON) |

**NOT in Axiom:** Worker logs (`[VERIFY]`, `[TIMEBACK]`, `track=`). These are PM2-only.

### Access

- **Dashboard:** https://app.axiom.co/superbuilder-iycd
- **Dataset:** `spacetime-logs`

### Common Queries

```
# Find panics (for alerts)
_syslog_severity == "error" or message =~ "panic"

# Player activity
message =~ "player_id=a1b2c3d4"

# XP events
message =~ "[XP]"

# Raid completions
message =~ "[RAID]" and message =~ "ended"
```

### Vector Config

Logs are shipped via [Vector](https://vector.dev) running as a systemd service on EC2.

```bash
# Config location
~/.vector/config/vector.yaml

# Service management
sudo systemctl status vector
sudo systemctl restart vector

# Check Vector logs
journalctl -u vector -f
```

**Sources:**
- `/home/ubuntu/spacetime.log` — SpacetimeDB server output
- `~/.local/share/spacetime/data/replicas/*/module_logs/*.log` — Game logic (Rust)

### PM2 Worker Logs

Worker logs (`source: "worker"`) include `[TIMEBACK]` delivery events for debugging XP discrepancy tickets.

**What's logged:**
```
[TIMEBACK] ✓ event:1234 user:a1b2c3d4 xp:2.50 (342ms)  # Success
[TIMEBACK] ✗ event:1234 user:a1b2c3d4 error:503 (1203ms)  # Failure
[VERIFY] ✓ token_valid expires:2026-01-24T12:00:00Z  # OAuth
```

**Query examples:**
```
# Find all TimeBack events for a user
source == "worker" and message =~ "[TIMEBACK]" and message =~ "ben.tier"

# Find failed deliveries
source == "worker" and message =~ "[TIMEBACK] ✗"
```
