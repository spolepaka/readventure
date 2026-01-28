/// <reference types="bun-types" />
/**
 * Backfill XP to TimeBack for a student
 * Based on worker/src/index.ts createCaliperEvent (production code)
 * 
 * Usage: bun run scripts/timeback/backfillXP.ts <timebackId> <email> <grade> <xp> [options]
 * 
 * Options:
 *   --validate    Validate payload without sending (safe test)
 *   --date        ISO timestamp for the event (default: now)
 *   --minutes     Duration in minutes (default: 5)
 * 
 * Examples:
 *   # Test on yourself first (validate only)
 *   bun run scripts/timeback/backfillXP.ts abc-123 you@school.edu 4 1 --validate
 * 
 *   # Actually send 9 XP backdated to Jan 12
 *   bun run scripts/timeback/backfillXP.ts abc-123 student@school.edu 4 9 --date 2026-01-12T17:00:00Z --minutes 9
 */

import { getTimebackCredentials, TIMEBACK_AUTH_URL } from './utils/timeback';

const CALIPER_URL = 'https://caliper.alpha-1edtech.ai/caliper/event';
const CALIPER_VALIDATE_URL = 'https://caliper.alpha-1edtech.ai/caliper/event/validate';

async function getToken(): Promise<string> {
  const { clientId, clientSecret } = await getTimebackCredentials();
  
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
  });
  
  if (!response.ok) throw new Error(`OAuth failed: ${response.status}`);
  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// Simplified payload for backfills - only what's required
interface EventPayload {
  timebackId: string;
  email: string;
  grade: number;
  raidEndTime: string;
  raidDurationMinutes: number;
  xpEarned: number;
}

// Build shared actor (TimebackUser) - matches worker/src/index.ts buildActor
function buildActor(eventData: EventPayload) {
  return {
    id: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/users/${eventData.timebackId}`,
    type: "TimebackUser",
    email: eventData.email
  };
}

// Build shared activity context - matches worker/src/index.ts buildActivityContext
function buildActivityContext(grade: number) {
  return {
    id: `https://api.alpha-1edtech.ai/ims/activity/context/${crypto.randomUUID()}/${Date.now()}`,
    type: "TimebackActivityContext",
    subject: "FastMath",
    app: { name: "Math Raiders" },
    activity: { name: "Math Raid" },
    course: {
      id: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-${grade}`,
      name: `Math Raiders Grade ${grade}`
    },
    process: true
  };
}

// Transform to Caliper format - matches worker/src/index.ts createCaliperEvent
// Returns envelope with BOTH TimebackActivityEvent and TimebackTimeSpentEvent
function createCaliperEvent(eventData: EventPayload, eventId: bigint) {
  const grade = eventData.grade;
  
  // Shared building blocks
  const actor = buildActor(eventData);
  const object = buildActivityContext(grade);
  
  // Event 1: TimebackActivityEvent - XP only (minimal backfill)
  const activityEvent = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: "ActivityEvent",
    action: "Completed",
    eventTime: eventData.raidEndTime,
    profile: "TimebackProfile",
    actor,
    object,
    generated: {
      id: `https://playcademy.org/metrics/backfill/${eventId}/activity`,
      type: "TimebackActivityMetricsCollection",
      attempt: 1,
      items: [
        { type: "xpEarned", value: eventData.xpEarned }
      ]
    }
  };
  
  // Event 2: TimebackTimeSpentEvent - time spent
  const timeSpentEvent = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: "TimeSpentEvent",
    action: "SpentTime",
    eventTime: eventData.raidEndTime,
    profile: "TimebackProfile",
    actor,
    object,
    generated: {
      id: `https://playcademy.org/metrics/backfill/${eventId}/time`,
      type: "TimebackTimeSpentMetricsCollection",
      items: [
        { type: "active", value: Math.round(eventData.raidDurationMinutes * 60) }  // API expects seconds
      ]
    }
  };

  // Wrap both events in single Caliper envelope (one API call)
  return {
    sensor: "https://mathraiders.com",
    sendTime: new Date().toISOString(),
    dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
    data: [activityEvent, timeSpentEvent]
  };
}

async function sendBackfillEvent(
  timebackId: string, 
  email: string, 
  grade: number, 
  xp: number,
  eventDate: string,
  durationMinutes: number,
  validateOnly: boolean
) {
  const mode = validateOnly ? '🧪 VALIDATE ONLY' : '📤 SEND';
  console.log(`\n${mode} - Backfill Caliper event:`);
  console.log(`   TimeBack ID: ${timebackId}`);
  console.log(`   Email: ${email}`);
  console.log(`   Grade: ${grade} (course: math-raiders-grade-${grade})`);
  console.log(`   XP: ${xp}`);
  console.log(`   Date: ${eventDate}`);
  console.log(`   Duration: ${durationMinutes} minutes (${Math.round(durationMinutes * 60)} seconds)`);
  
  const token = await getToken();
  console.log(`\n🔑 Got auth token`);
  
  // Build minimal EventPayload for backfill
  const eventData: EventPayload = {
    timebackId,
    email,
    grade,
    raidEndTime: eventDate,
    raidDurationMinutes: durationMinutes,
    xpEarned: xp
  };
  
  const eventId = BigInt(Date.now());
  const envelope = createCaliperEvent(eventData, eventId);
  
  console.log(`\n📋 Payload preview:`);
  console.log(JSON.stringify(envelope, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  
  const url = validateOnly ? CALIPER_VALIDATE_URL : CALIPER_URL;
  console.log(`\n📨 ${validateOnly ? 'Validating' : 'Sending'} to ${url}...`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(envelope)
  });

  const responseText = await response.text();
  
  console.log(`\n📋 Response: HTTP ${response.status}`);
  if (responseText) {
    try {
      console.log(JSON.stringify(JSON.parse(responseText), null, 2));
    } catch {
      console.log(responseText);
    }
  } else {
    console.log('(empty response body)');
  }
  
  if (response.ok) {
    if (validateOnly) {
      console.log(`\n✅ Payload is valid! Run without --validate to actually send.`);
    } else {
      console.log(`\n✅ Backfill sent successfully!`);
      console.log(`\n👉 Check TimeBack dashboard for ${email} to verify ${xp} XP appeared on ${eventDate.split('T')[0]}.`);
    }
  } else {
    console.log(`\n❌ ${validateOnly ? 'Validation' : 'Backfill'} failed`);
  }
}

// Parse args
const args = process.argv.slice(2);

// Parse flags
let eventDate = new Date().toISOString();
let durationMinutes = 5;  // Default 5 minutes
let validateOnly = false;

const validateIdx = args.indexOf('--validate');
if (validateIdx !== -1) {
  validateOnly = true;
  args.splice(validateIdx, 1);
}

const dateIdx = args.indexOf('--date');
if (dateIdx !== -1 && args[dateIdx + 1]) {
  eventDate = args[dateIdx + 1];
  args.splice(dateIdx, 2);
}

const minutesIdx = args.indexOf('--minutes');
if (minutesIdx !== -1 && args[minutesIdx + 1]) {
  durationMinutes = parseFloat(args[minutesIdx + 1]);
  args.splice(minutesIdx, 2);
}

if (args.length < 4) {
  console.log('Usage: bun run scripts/timeback/backfillXP.ts <timebackId> <email> <grade> <xp> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --validate              Validate only (don\'t actually send)');
  console.log('  --date YYYY-MM-DDTHH:MM:SSZ   Event timestamp (default: now)');
  console.log('  --minutes N             Duration in minutes (default: 5)');
  console.log('');
  console.log('Examples:');
  console.log('  # Validate first (safe - no data sent)');
  console.log('  bun run scripts/timeback/backfillXP.ts abc-123 student@school.edu 4 9 --validate');
  console.log('');
  console.log('  # Actually send');
  console.log('  bun run scripts/timeback/backfillXP.ts abc-123 student@school.edu 4 9');
  console.log('');
  console.log('  # Backdate to Jan 12 with 9 minutes duration');
  console.log('  bun run scripts/timeback/backfillXP.ts abc-123 student@school.edu 4 9 --date 2026-01-12T17:00:00Z --minutes 9');
  process.exit(1);
}

const [timebackId, email, gradeStr, xpStr] = args;
const grade = parseInt(gradeStr, 10);
const xp = parseInt(xpStr, 10);

sendBackfillEvent(timebackId, email, grade, xp, eventDate, durationMinutes, validateOnly).catch(console.error);
