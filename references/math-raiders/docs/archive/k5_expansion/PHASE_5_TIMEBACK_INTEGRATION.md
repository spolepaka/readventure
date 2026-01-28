# Phase 5: TimeBack Integration Plan

## ✅ STATUS: VALIDATED & WORKING (2025-09-25)

Successfully tested end-to-end XP delivery to production TimeBack API. Player received 6 XP total.

## CRITICAL UPDATE: Use TimeBack Events API Format

**NOT** standard Caliper format! TimeBack requires their custom profile for XP processing:

✅ **Correct Format (TimeBack Events API)**:
- `profile: "TimebackProfile"` 
- `actor.type: "TimebackUser"` with required `email` field
- `object.type: "TimebackActivityContext"` with `subject: "FastMath"`
- `object.app: { name: "Math Raiders" }` - REQUIRED despite docs saying optional
- `generated.type: "TimebackActivityMetricsCollection"`
- `sensor: "https://mathraiders.com"` - Platform filtering

❌ **Wrong Format (Standard Caliper)**: 
- `profile: "https://purl.imsglobal.org/spec/caliper/v1p2"` - Events accepted but NO XP!

## Overview
Integrate Math Raiders with TimeBack's learning analytics platform to track student progress and award XP for math fluency achievements.

## Key Context

### What is TimeBack?
- AI-powered personalized learning platform (2-hour school days!)
- Uses 1EdTech standards (OneRoster, Caliper, QTI)
- Math Raiders would be a learning resource within their ecosystem
- Students see their Math Raiders progress in TimeBack dashboards

### Integration Points
1. **Course Setup** (One-time) - Create Math Raiders as courses in TimeBack
2. **Activity Events** (Runtime) - Send student achievements as they play
3. **Identity Mapping** (Blocker) - Link PlayCademy users to TimeBack users

## Architecture: Transactional Outbox Pattern

```
Game → SpacetimeDB → Worker Bot → TimeBack API
         (outbox)     (relay)      (Caliper)
```

### Why This Pattern?
- **Critical Data**: Student learning credits can't be lost
- **Constraints**: SpacetimeDB can't make HTTP calls (deterministic execution)
- **Reliability**: Must survive crashes, network failures, service outages
- **Existing Infrastructure**: Already have EC2, SpacetimeDB subscriptions

## Completed Items ✅

1. **TimeBack ID Flow**: PlayCademy → Math Raiders → TimeBack working
2. **Caliper Format**: Validated exact format requirements
3. **Authentication**: OAuth2 client credentials working
4. **Production Test**: Successfully sent 6 XP to real user
5. **Schema Updates**: Added `timeback_id` and `email` to Player table
6. **Connect Flow**: Updated to capture TimeBack credentials

## Remaining Work 📋

1. ✅ **Create Event Queue Table**: `timeback_event_queue` with indexes - DONE
2. ✅ **Implement Reducers**: `create_timeback_event` and `mark_event_sent` - DONE  
3. ✅ **Hook to Game Logic**: Integrated into `end_raid` reducer - DONE
4. **Build Worker Service**: Bun-based event processor - IN PROGRESS
5. **Deploy Worker**: Set up EC2 instance with systemd service - TODO

## Phase 5 Implementation Plan

### 5.1: Schema Updates ✅ DONE
```rust
// Add to Player table
pub timeback_id: Option<String>,       // REQUIRED: From PlayCademy user.timebackId
pub email: Option<String>,              // REQUIRED: TimeBack Events API requires actor.email

// New outbox table for TimeBack integration
#[table(name = timeback_event_queue, public)]
pub struct TimebackEventQueue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    
    /// Player who earned the XP
    #[index(btree)]
    pub player_id: String,
    
    /// JSON: {timebackId, email, resourceId, raidEndTime, raidDurationMinutes, xpEarned, process}
    pub payload: String,
    
    /// Created timestamp for FIFO processing
    #[index(btree)]
    pub created_at: Timestamp,
    
    /// Has this been sent successfully?
    #[index(btree)]
    pub sent: bool,
    
    /// Send attempt count (max 5)
    pub attempts: u8,
    
    /// When to retry (NULL = now)
    #[index(btree)]
    pub next_retry_at: Option<Timestamp>,
    
    /// Last error if failed
    pub last_error: Option<String>,
    
    /// When successfully sent
    pub sent_at: Option<Timestamp>,
}
```

### 5.2: Event Creation Logic
When to create events in `end_raid` reducer:
- **Focus Threshold**: CQPM >= 2.0 AND accuracy >= 80%
- **XP Award**: 1 XP per focused minute (rounded up)
- **No XP**: If below focus threshold (not focused learning)

**Example payload structure for timeback_event_queue.payload**:
```json
{
  "timebackId": "abc123",                    // From player.timeback_id
  "email": "student@school.edu",             // From player.email (required by TimeBack)
  "resourceId": "f4283182-aa2c-4ab2-b8ac-cceb4b3f6d6f",  // Component Resource ID
  "raidEndTime": "2024-03-15T14:30:00.000Z", // ISO 8601 timestamp
  "raidDurationMinutes": 2.5,                // Actual duration for XP calculation
  "xpEarned": 3,                             // Math.ceil(2.5) = 3 XP
  "process": true                            // CRITICAL: Required for XP to display!
```

**Converting SpacetimeDB Timestamps**:
```rust
// In your reducer:
let raid_end_iso = ctx.timestamp.to_rfc3339().unwrap();
// Result: "2024-03-15T14:30:00.000000Z" (TimeBack accepts microsecond precision)
```

### 5.3: Worker Service Architecture
- **Technology**: Bun runtime (fast, built-in SQLite if needed)
- **Deployment**: Same EC2 instance as SpacetimeDB
- **Process Manager**: PM2 or systemd
- **TimeBack Auth**: OAuth2 client credentials flow
- **SpacetimeDB Auth**: Worker connects with its own identity/token

Worker responsibilities:
1. Subscribe to `timeback_event_queue WHERE sent = false`
2. Transform to Caliper ActivityEvent format (see Critical Format below)
3. Send to TimeBack API with retry logic
4. Update event status in SpacetimeDB (via reducer call)

**TypeScript Connection Pattern** (from SpacetimeDB SDK docs):
```typescript
import { DbConnection } from 'spacetimedb';
import * as moduleBindings from './module_bindings';

const worker = DbConnection.builder()
  .withUri('ws://localhost:3000')  // or your SpacetimeDB instance
  .withModuleName('math-raiders')
  .withToken(process.env.WORKER_TOKEN)  // Worker identity token
  .onConnect((ctx, identity, token) => {
    console.log('Worker connected:', identity.toHex());
    
    // Subscribe to unsent events
    ctx.subscriptionBuilder()
      .onApplied((subCtx) => {
        console.log('Subscription ready, processing existing events...');
        // Process any existing unsent events
        for (const event of subCtx.db.timebackEventQueue.iter()) {
          if (!event.sent && event.attempts < 5) {
            processEvent(subCtx, event);
          }
        }
      })
      .subscribe('SELECT * FROM timeback_event_queue WHERE sent = false');
    
    // Handle new events as they arrive
    ctx.db.timebackEventQueue.onInsert((eventCtx, event) => {
      if (!event.sent && event.attempts < 5 && !processingEvents.has(event.id)) {
        processEvent(eventCtx, event);
      }
    });
  })
  .onDisconnect((ctx, error) => {
    console.log('Worker disconnected:', error);
    // Implement reconnection logic
    setTimeout(() => reconnect(), 5000);
  })
  .build();

// Call reducer to mark event as sent
function markEventSent(ctx: DbContext<any, any>, eventId: number, error?: string) {
  ctx.reducers.markEventSent(eventId, error || null);
}
```

**Environment Configuration**:
```typescript
// Use staging for development (no auth required)
const TIMEBACK_API_URL = process.env.NODE_ENV === 'production' 
  ? 'https://caliper.alpha-1edtech.com'
  : 'https://caliper-staging.alpha-1edtech.com';

// OAuth credentials (provided by TimeBack)
const TIMEBACK_CLIENT_ID = process.env.TIMEBACK_CLIENT_ID;
const TIMEBACK_CLIENT_SECRET = process.env.TIMEBACK_CLIENT_SECRET;
```

**Important**: Worker must handle reconnection gracefully:
```typescript
// Track in-flight events to prevent reprocessing after reconnect
// CRITICAL: TimeBack has no idempotency keys, so we must prevent duplicates!
const processingEvents = new Set<number>();

// In processEvent function
async function processEvent(ctx: DbContext, event: TimebackEventQueue) {
  if (processingEvents.has(event.id)) {
    return; // Already processing from before reconnect
  }
  
  processingEvents.add(event.id);
  try {
    await sendToTimeBack(ctx, event);
  } finally {
    processingEvents.delete(event.id);
  }
}
```

### CRITICAL: Caliper Event Format Requirements

TimeBack will **REJECT** events missing any required fields. Based on TimeBack client analysis:

**Complete Event Example** (this is what actually gets sent):
```json
{
  "sensor": "https://mathraiders.com",
  "sendTime": "2024-01-24T20:45:00.000Z",
  "dataVersion": "http://purl.imsglobal.org/ctx/caliper/v1p2",
  "data": [{
    "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
    "eventTime": "2024-01-24T20:30:00.000Z",
    "profile": "TimebackProfile",
    "type": "ActivityEvent",
    "actor": {
      "id": "https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/users/abc123",
      "type": "TimebackUser",
      "email": "student@school.edu"
    },
    "action": "Completed",
    "object": {
      "id": "https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/courses/component-resources/f4283182-aa2c-4ab2-b8ac-cceb4b3f6d6f",
      "type": "TimebackActivityContext",
      "subject": "FastMath",
      "app": {
        "name": "Math Raiders"
      },
      "activity": {
        "name": "Math Raid"
      },
      "course": {
        "id": "https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/courses/fe15be0a-9f8d-4251-b000-402c6581617f",
        "name": "Math Raiders K-5"
      },
      "process": false
    },
    "generated": {
      "id": "https://playcademy.org/metrics/raids/12345",
      "type": "TimebackActivityMetricsCollection",
      "items": [{
        "type": "xpEarned",
        "value": 3
      }]
    }
  }]
}
```

```typescript
// Transform SpacetimeDB event to TimeBack format
function createCaliperEvent(dbEvent: TimebackEventQueue): CaliperEvent {
  const eventData = JSON.parse(dbEvent.payload);
  
  // TimeBack Profile event - ALL fields required!
  const event = {
    // Required event-level fields
    id: `urn:uuid:${crypto.randomUUID()}`,            // MUST be UUID as URN
    type: "ActivityEvent",
    action: "Completed",                               // Player completed raid
    eventTime: eventData.raidEndTime,                  // ISO 8601 format
    profile: "TimebackProfile",                        // MUST use TimeBack profile for XP processing
    
    // Required actor fields - MUST include email
    actor: {
      id: `https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/users/${eventData.timebackId}`,
      type: "TimebackUser",
      email: eventData.email                           // REQUIRED by TimeBack
    },
    
    // Required object fields with TimeBack context
    object: {
      id: `https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/courses/component-resources/${eventData.resourceId}`,
      type: "TimebackActivityContext",
      subject: "FastMath",                             // MUST be FastMath for Math Raiders
      app: {
        name: "Math Raiders"                           // REQUIRED despite docs saying third-party only!
      },
      activity: {
        name: "Math Raid"
      },
      course: {
        id: "https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/courses/fe15be0a-9f8d-4251-b000-402c6581617f",
        name: "Math Raiders K-5"
      },
      process: true                                    // REQUIRED for XP to display in dashboard!
    },
    
    // XP data (only metric TimeBack cares about)
    generated: {
      id: `https://playcademy.org/metrics/raids/${dbEvent.id}`,
      type: "TimebackActivityMetricsCollection",
      items: [
        { 
          type: "xpEarned",
          value: eventData.xpEarned  // 0 if below focus threshold
        }
      ]
    }
  };

  // REQUIRED: Wrap in Caliper envelope
  return {
    sensor: "https://mathraiders.com",
    sendTime: new Date().toISOString(),
    dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2", // EXACT value
    data: [event]  // Array even for single event
  };
}

// OAuth Token Management
class TokenManager {
  private token?: string;
  private expiresAt?: Date;
  
  async getToken(): Promise<string> {
    // Return cached token if still valid
    if (this.token && this.expiresAt && new Date() < this.expiresAt) {
      return this.token;
    }
    
    // Get new token using client credentials flow
    const response = await fetch(TIMEBACK_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded', // NOT JSON!
      },
      body: `grant_type=client_credentials&client_id=${TIMEBACK_CLIENT_ID}&client_secret=${TIMEBACK_CLIENT_SECRET}`
    });
    
    if (!response.ok) {
      throw new Error(`OAuth failed: ${response.status}`);
    }
    
    const data = await response.json();
    this.token = data.access_token;
    // Refresh 1 minute before expiration
    this.expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);
    
    return this.token;
  }
}

const tokenManager = new TokenManager();

// Send to TimeBack (startup pragmatic approach)
async function sendToTimeBack(ctx: DbContext, dbEvent: TimebackEventQueue) {
  // Worker should respect retry limit (DB enforces as safety net)
  if (dbEvent.attempts >= 5) {
    console.log(`Skipping event ${dbEvent.id} - max attempts reached`);
    return;
  }
  
  try {
    const envelope = createCaliperEvent(dbEvent);
    const accessToken = await tokenManager.getToken();
    
    const response = await fetch(`${TIMEBACK_API_URL}/caliper/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelope)
    });
    
    if (response.ok) {
      // Success!
      await ctx.reducers.markEventSent(dbEvent.id, null);
    } else if (response.status === 401) {
      // Token expired - refresh and retry immediately (don't count as attempt)
      tokenManager.token = undefined;
      return sendToTimeBack(ctx, dbEvent);
    } else {
      // API error - mark for retry
      const error = `HTTP ${response.status}: ${await response.text()}`;
      await ctx.reducers.markEventSent(dbEvent.id, error);
    }
  } catch (error) {
    // Network/other error - mark for retry
    await ctx.reducers.markEventSent(dbEvent.id, error.message);
  }
}
```

### 5.4: Reducer Implementation

**Important Implementation Notes**:
```rust
// 1. Add serde_json to Cargo.toml (NOT included in SpacetimeDB)
[dependencies]
serde_json = "1.0"

// 2. Convert Identity to String using .to_hex()
let player_id = ctx.sender.to_hex();

// 3. Reducers can return Result for error handling
#[reducer]
pub fn create_learning_event(...) -> Result<(), String> {
    // Return Err triggers rollback
    if player.timeback_id.is_none() {
        return Err("Player has no TimeBack ID".to_string());
    }
    Ok(())
}

// 4. Check for scheduled reducer calls
if ctx.sender == ctx.identity {
    // This is a scheduled reducer call
}

// 5. Scheduled reducer pattern (from SpacetimeDB docs)
// For cleanup of old events (optional for MVP):
#[table(name = cleanup_schedule, scheduled(cleanup_old_events))]
struct CleanupSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

#[reducer(init)]
fn init(ctx: &ReducerContext) -> Result<(), String> {
    // Schedule cleanup to run every hour
    let one_hour = TimeDuration::from_micros(3_600_000_000);
    ctx.db.cleanup_schedule().insert(CleanupSchedule {
        scheduled_id: 0,
        scheduled_at: one_hour.into(),
    });
    Ok(())
}
```

The `create_learning_event` reducer creates events after raids:

**Key Requirements from TimeBack Docs:**
- Actor ID must follow OneRoster URI format
- Events with `type: "xpEarned"` and `value > 0` are required for XP calculation
- Multiple events can be batched in the `data` array
- OAuth scope: `https://purl.imsglobal.org/spec/caliper/v1p1/scope/event.create`

**CRITICAL: `process: true` is REQUIRED for XP visibility!**
- Despite TimeBack docs suggesting `process` only controls Assessment Result creation
- Testing confirmed: `process: false` = event accepted but NO XP in dashboard
- Must use `process: true` for all XP-earning events
- This will create Assessment Results for every raid (acceptable trade-off)

### 5.5: Error Handling Strategy

**Worker Responsibility** (handles error classification):
- **200 OK**: Call `mark_event_sent(id, null)` - success!
- **401 Unauthorized**: Refresh token and retry immediately (don't count as attempt)
- **400-499 Client Error**: Call `mark_event_sent(id, "Client error: 4xx")` - let it retry up to 5x
- **500+ Server Error**: Call `mark_event_sent(id, "Server error: 5xx")` - retry with backoff
- **Network Error**: Call `mark_event_sent(id, "Network error")` - retry with backoff

**Database Safety Net**:
- Exponential backoff automatically applied: 1min, 2min, 4min, 8min, 16min
- After 5 attempts, event is marked as `sent=true` to prevent infinite retries
- Worker should check `attempts < 5` before processing, but DB enforces it

### 5.6: Monitoring & Operations
```sql
-- Key metrics to track
SELECT COUNT(*) FROM timeback_event_queue WHERE sent = false;  -- Queue depth
SELECT COUNT(*) FROM timeback_event_queue WHERE attempts > 3;   -- Struggling events
SELECT AVG(sent_at - created_at) FROM timeback_event_queue;     -- Latency
```

**Note**: SpacetimeDB guarantees atomic transactions - events are created atomically with game state changes (confirmed by docs).

**Performance Note**: Consider composite B-tree index on `(sent, created_at)` for optimal queue queries:
```rust
#[index(btree)]
pub sent: bool,
#[index(btree)]
pub created_at: Timestamp,
// SpacetimeDB will use these efficiently for WHERE sent = false ORDER BY created_at
```

## Implementation Phases

### Phase 5A: Foundation (Can Do Now)
1. ✅ Course setup scripts (already merged from friend's PR)
2. Add schema fields for TimeBack integration
3. Create learning_event table and reducers
4. Build worker service with mock user IDs
5. Test end-to-end with fake TimeBack endpoint

### Phase 5B: Identity Integration
**Now unblocked!** PlayCademy provides TimeBack ID:
```typescript
// In your connect flow
const user = await client.users.me();
const timebackId = user.timebackId; // Available now!
const email = user.email;            // Required for TimeBack Events API

// Pass to SpacetimeDB
ctx.reducers.connect(name, playerId, grade, timebackId, email);
```

### Phase 5C: Production Deployment
1. Deploy worker to EC2 with PM2
2. Configure TimeBack OAuth credentials
3. Update PRODUCTION.md with worker ops
4. Add monitoring alerts
5. Test with real student account

## Key Design Decisions

### Why Transactional Outbox?
- Events created atomically with game state changes
- No distributed transactions needed
- Built-in ordering and exactly-once delivery to worker
- Can query/monitor queue state easily

### Why Not Direct HTTP?
- Can't trust client with student credits
- No retry mechanism
- SpacetimeDB can't make external calls

### Why Not External Queue?
- Already have reliable queue (SpacetimeDB table)
- Adds operational complexity
- Would need distributed transaction

## Success Criteria
- [ ] Zero lost events (critical!)
- [ ] <1 minute average latency
- [ ] Automatic retry on failures
- [ ] Clear monitoring dashboard
- [ ] No manual intervention needed

## Open Questions  
1. ~~**User Mapping**: How will PlayCademy provide TimeBack IDs?~~ ✅ RESOLVED: Available via `user.timebackId`
2. ~~**Actor ID Format**: What's the exact URI format?~~ ✅ RESOLVED: `https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/users/{timebackId}`
3. ~~**XP Requirements**: What fields are required?~~ ✅ RESOLVED: Must have `type: "xpEarned"` with numeric `value > 0`
4. ~~**Batching**: Can we batch events?~~ ✅ RESOLVED: Yes, multiple events in `data` array
5. ~~**Course Structure**: One course per grade or single course?~~ ✅ RESOLVED: Single course for all grades
   - Course ID: `fe15be0a-9f8d-4251-b000-402c6581617f`
   - Component ID: `9f17821f-bd2b-498e-8efa-28a1eb839760` ("Math Raid")
   - Covers grades K-5 (0-5)
6. ~~**OAuth Credentials**: How to get client ID/secret?~~ ✅ RESOLVED: Production credentials provided and tested
7. **Historical Data**: Backfill existing player achievements?
8. **Rate Limits**: What are TimeBack's API limits? (Not documented - using conservative 10 req/sec)

## TimeBack Configuration (Provided)

Math Raiders has been configured in TimeBack with:
- **Course**: `fe15be0a-9f8d-4251-b000-402c6581617f`
- **Component**: `9f17821f-bd2b-498e-8efa-28a1eb839760` ("Math Raid")
- **Component Resource**: `f4283182-aa2c-4ab2-b8ac-cceb4b3f6d6f`
- **Resource**: `c3b6a1b2-cf4b-436f-955c-8f83518d87ee`
- **Target Grades**: K-5 (0-5)
- **Subject**: FastMath
- **Primary App**: math_raiders

## Production Validation Results (2025-09-25)

Successfully tested with real TimeBack user:
- **User**: elpidio.julian@superbuilders.school  
- **TimeBack ID**: 85258b5a-21f3-42c8-b41b-e5e186f9b4bc
- **Events Sent**: 4 test events (2 with process:false, 2 with process:true)
- **XP Awarded**: 12 total (3 per event)
- **Job IDs**: 1647397, 1647425, 1647734 (and one more)

Key findings:
- `object.app` field is REQUIRED (contrary to docs saying "only for third-party apps")
- **`process: true` is REQUIRED for XP to display in dashboard** (critical discovery!)
- Events process immediately (< 1 second)
- XP visible in dashboard after ~1 minute
- Sensor URL matters for platform filtering (`https://mathraiders.com`)
- With `process: false`, events are accepted but XP doesn't show in UI

## Remaining Questions for TimeBack Team

1. **Rate Limits** (ask the team, not in docs):
   - Max events per batch? (we'll start with 100)
   - Max API calls per minute? (we'll start with 10/sec)
   - Any retry backoff requirements? (we'll use exponential)

2. ~~**XP Calculation**:~~ ✅ RESOLVED: 1 XP per focused minute (2 CQPM @ 80% accuracy threshold)
   - XP = raid duration in minutes IF performance meets threshold
   - Threshold: CQPM ≥ 2 AND accuracy ≥ 80%
   - Below threshold: 0 XP (not focused learning)
   - Formula: `xpEarned = meetsFocusThreshold ? Math.ceil(raidDurationMinutes) : 0`
   - Example: 1.5 minute raid = 2 XP (reward partial minutes of focus)

3. ~~**OAuth Credentials**:~~ ✅ RESOLVED: TimeBack provides client keys
   - Use the TimeBack client key/secret they provided
   - Same credentials work for both staging and production (different endpoints)

## Implementation Notes

### Worker Identity Handling
The worker needs a special identity that can call reducers:

**Note**: SpacetimeDB docs don't specify a worker pattern - this is our custom approach using regular client connections with a dedicated identity.

```rust
// Add known worker identity constant
const TIMEBACK_WORKER_IDENTITY: &str = "YOUR_WORKER_IDENTITY_HERE";

#[reducer]
pub fn mark_event_sent(
    ctx: &ReducerContext, 
    event_id: u64,
    error: Option<String>
) {
    // Allow worker OR scheduled reducer to call this
    if ctx.sender != Identity::from_hex(TIMEBACK_WORKER_IDENTITY) 
        && ctx.sender != ctx.identity() {
        log::warn!("Unauthorized attempt to mark event sent");
        return;
    }
    
    // Update event status...
}
```


## Confirmed from TimeBack Client Docs

Based on TimeBack client library analysis:

✅ **External Worker Pattern**: Caliper events can be submitted from any source with proper envelope format  
✅ **Event UUID**: Each event must have unique UUID as URN (we generate this client-side)  
✅ **Minimal XP Format**: Only `xpEarned` required in `generated.items` for XP tracking  
✅ **Error Handling**: API returns structured errors with status/message/errors fields  
✅ **No Server Idempotency**: Client must handle duplicate prevention (our outbox pattern handles this)

**Key Insight**: The lack of server-side implementation details in the client docs means we should implement conservative patterns:
- Generate UUIDs client-side for each event
- Track sent status in our outbox table
- Use exponential backoff for retries
- Start with conservative rate limits (10 req/sec, 100 events/batch)

## What's Missing for Full Implementation

### 1. Complete Reducer Code
Need full implementations of:
- `create_learning_event` reducer (called from `end_raid`)
- `mark_event_sent` reducer (called by worker)
- Integration point in `end_raid` reducer

### 2. Worker Service Structure
```
math-raiders-timeback-worker/
├── package.json
├── src/
│   ├── index.ts          # Main worker loop
│   ├── caliper.ts        # Event transformation
│   ├── timeback-api.ts   # OAuth & API calls
│   └── config.ts         # Environment config
├── .env.example
└── ecosystem.config.js   # PM2 config
```

### 3. Environment Variables
```bash
# .env.example
SPACETIMEDB_URI=ws://localhost:3000
SPACETIMEDB_MODULE=math-raiders
WORKER_TOKEN=<worker-identity-token>
TIMEBACK_CLIENT_ID=<from-timeback>
TIMEBACK_CLIENT_SECRET=<from-timeback>
NODE_ENV=production
```

### 4. Local Testing Strategy
- Use TimeBack staging endpoint (no auth required)
- Create test player with fake TimeBack ID
- Monitor `timeback_event_queue` table
- Check worker logs for processing

### 5. Security Considerations
- Store TimeBack credentials in AWS Secrets Manager
- Rotate worker tokens periodically
- Monitor for suspicious reducer calls
- Rate limit by player to prevent abuse

### 6. Operational Procedures
- **Deployment**: Step-by-step EC2 setup
- **Monitoring**: CloudWatch alarms for queue depth
- **Rollback**: How to pause worker if issues arise
- **Recovery**: Handle partial failures

## Critical Implementation Notes

### 🚨 Timestamp Format (CRITICAL)
TimeBack requires timestamps with **exactly 3 decimal places and Z suffix**:
- ✅ Correct: `"2025-09-25T23:58:42.718Z"`
- ❌ Wrong: `"2025-09-25T23:58:42.718000+00:00"` (6 decimals + timezone)
- ❌ Wrong: `"2025-09-25T23:58:42.71Z"` (2 decimals)

SpacetimeDB's `to_rfc3339()` produces 6 decimals, so manual formatting is required.

### 🚨 process: true is REQUIRED for XP
Despite TimeBack docs saying `process` is for Assessment Results, **XP will NOT display in dashboards without `process: true`**. This was discovered through testing.

### 🚨 Bun Compatibility
Bun doesn't natively support `DecompressionStream` (required by SpacetimeDB SDK). Add this polyfill:
```bash
bun add @ungap/compression-stream
```
```typescript
// At the very top of worker, before any imports
import '@ungap/compression-stream/poly';
```

### 🚨 Sensor URL
The `sensor` field should be your app's domain (e.g., `"https://mathraiders.com"`), not a working URL. It's just a unique identifier.

## References
- TimeBack Caliper API (Production): https://caliper.alpha-1edtech.com/
- TimeBack Caliper API (Staging): https://caliper-staging.alpha-1edtech.com/
- OneRoster API: https://api.alpha-1edtech.com/scalar/
- Transactional Outbox Pattern: https://microservices.io/patterns/data/transactional-outbox.html
