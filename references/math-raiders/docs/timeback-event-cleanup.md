# TimeBack Event Queue Cleanup

## Context

Math Raiders sends XP events to TimeBack (external API) via a queue table `timeback_event_queue`. A worker polls this table, sends events to TimeBack, and marks them `sent = true` on HTTP 200.

## Problem

The `timeback_event_queue` table grows indefinitely. Events are never deleted—only marked as sent. This creates:

- **Unbounded table growth.** Every raid victory adds a row. At scale, this becomes a performance concern.
- **No dead letter handling.** Failed events (network issues, TimeBack outage) sit forever with `sent = false`. No alerting, no visibility.
- **Audit window mismatch.** Events are kept forever, but PM2 logs (where `[TIMEBACK] ✓` appears) only retain 7 days. After 7 days, you have orphaned rows with no log context.

## Solution

Add cleanup logic to the existing `cleanup_schedule` scheduled reducer. Every 30 seconds:

1. **Delete sent events 7 days after `sent_at`.** Job done, audit window closed. Uses `sent_at` (not `created_at`) so events that retry for days still get full 7-day audit window after success.
2. **Log and delete dead letters older than 7 days.** Events that never sent are errors—log with full payload for Axiom-based replay, then delete. No need to keep in DB; Axiom preserves everything needed for manual retry.

This requires no new tables. We reuse the existing `cleanup_schedule` table and scheduled reducer pattern. The `timeback_event_queue` already has `created_at`, `sent`, and `sent_at` fields.

## Options considered but decided against

- **Immediate deletion on mark_event_sent.** Simpler but loses audit trail. Can't answer "did we send XP for this raid?" after the fact.
- **Separate schedule table for timeback cleanup.** More explicit but adds boilerplate. One cleanup reducer handling multiple domains is fine at this scale.
- **Worker-side deletion.** Worker calls a `delete_event` reducer after sending. Adds latency to the critical path, and worker crashes would leave orphaned rows.
- **24-hour TTL instead of 7 days.** Faster cleanup but misses the debugging window. PM2 logs retain 7 days, so matching that retention makes sense.

## Prior art

- **Existing `cleanup_abandoned_raids` reducer.** Same pattern—scheduled reducer iterates table, applies TTL logic, deletes or logs. (Name kept for SpacetimeDB migration compatibility; now handles both raids and timeback events.)
- **Dead letter queues (SQS, RabbitMQ).** Industry standard for failed messages. We log + delete rather than keep, since Axiom preserves full payload for replay and avoids DB bloat.

## Usage scenarios

**Normal operation**
Event created on raid victory. Worker sends to TimeBack within seconds. `sent = true`, `sent_at` set. After 7 days, cleanup reducer deletes the row. No log—happy path is silent.

**TimeBack outage**
Worker retries fail for 7 days. Event hits `sent = false` + age > 7d. Cleanup reducer logs:
```
[TIMEBACK] ✗ dead_letter event:1234 player:a1b2c3d4 attempts:5 age:7d error:503 payload:{...}
```
Event is deleted after logging. Payload preserved in Axiom for manual replay if needed.

**Debugging "XP didn't sync"**
Support ticket comes in 3 days later. Query `timeback_event_queue` by player_id. If `sent = true`, XP was delivered—check TimeBack's side. If `sent = false`, check `last_error` and worker logs.

## Milestones

### MS1: Core implementation

**Extend existing reducer** ✅ Done

```rust
// Table attribute stays the same (SpacetimeDB doesn't support schedule renames)
#[table(name = cleanup_schedule, scheduled(cleanup_abandoned_raids))]

// Function keeps original name, now handles both raids + timeback events
pub fn cleanup_abandoned_raids(ctx: &ReducerContext, _schedule: CleanupSchedule) {
```

**Add timeback cleanup logic** ✅ Done

```rust
// At end of reducer, before closing brace
let seven_days_micros: i128 = 7 * 24 * 60 * 60 * 1_000_000;
let now_micros = now.to_micros_since_unix_epoch() as i128;

for event in ctx.db.timeback_event_queue().iter() {
    if event.sent {
        // Use sent_at for TTL (fallback to created_at for legacy rows)
        let reference_time = event.sent_at.unwrap_or(event.created_at);
        let age_micros = now_micros - reference_time.to_micros_since_unix_epoch() as i128;
        
        if age_micros > seven_days_micros {
            // Sent successfully, past audit window - delete
            ctx.db.timeback_event_queue().id().delete(&event.id);
        }
    } else {
        // Unsent events: use created_at for age
        let age_micros = now_micros - event.created_at.to_micros_since_unix_epoch() as i128;
        
        if age_micros > seven_days_micros {
            // Dead letter - log with full payload for Axiom replay, then delete
            let player_prefix = &event.player_id[..8.min(event.player_id.len())];
            log::error!(
                "[TIMEBACK] ✗ dead_letter event:{} player:{} attempts:{} age:{}d error:{} payload:{}",
                event.id,
                player_prefix,
                event.attempts,
                age_micros / (24 * 60 * 60 * 1_000_000),
                event.last_error.as_deref().unwrap_or("none"),
                event.payload
            );
            ctx.db.timeback_event_queue().id().delete(&event.id);
        }
    }
}
```

**Log format follows LOGGING.md conventions**
- Tag: `[TIMEBACK]`
- Failure indicator: `✗`
- High-cardinality fields: `event:`, `player:`
- Full payload for manual retry capability

### MS2: Observe and tune

- Verify cleanup runs without errors in staging
- Check dead letter logs appear in module_logs → Axiom
- Confirm table size stays bounded over 2+ weeks
- Adjust TTL if 7 days is too long/short based on actual support ticket patterns
