/// <reference types="bun-types" />
/**
 * Test script to send a Caliper event to TimeBack
 * EXACT 1:1 copy of worker/src/index.ts createCaliperEvent + sendToTimeBack
 * 
 * Usage: bun run scripts/timeback/testCaliperEvent.ts <timebackId> <email> <grade> <xp>
 * Example: bun run scripts/timeback/testCaliperEvent.ts abc-123 campbell@test.com 4 100
 */

import { getTimebackCredentials, TIMEBACK_AUTH_URL } from './utils/timeback';

// EXACT match: worker/src/index.ts line 56
const CALIPER_URL = 'https://caliper.alpha-1edtech.ai/caliper/event';

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

// Simulates EventPayload from worker
interface EventPayload {
  timebackId: string;
  email: string;
  grade: number;
  resourceId: string;
  raidEndTime: string;
  raidDurationMinutes: number;
  xpEarned: number;
  totalQuestions: number;
  correctQuestions: number;
  masteredUnits?: number;
  process?: boolean;
  attempt?: number;
}

// EXACT 1:1 copy of worker/src/index.ts createCaliperEvent (lines 356-422)
function createCaliperEvent(eventData: EventPayload, dbEventId: bigint) {
  const grade = eventData.grade;
  
  const event = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: "ActivityEvent",
    action: "Completed",
    eventTime: eventData.raidEndTime,
    profile: "TimebackProfile",
    
    actor: {
      id: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/users/${eventData.timebackId}`,
      type: "TimebackUser",
      email: eventData.email
    },
    
    object: {
      id: `https://api.alpha-1edtech.ai/ims/activity/context/${crypto.randomUUID()}/${Date.now()}`,
      type: "TimebackActivityContext",
      subject: "FastMath",
      app: {
        name: "Math Raiders"
      },
      activity: {
        name: "Math Raid"
      },
      course: {
        id: `https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/math-raiders-grade-${grade}`,
        name: `Math Raiders Grade ${grade}`
      },
      process: eventData.process ?? true  // Default to true for XP visibility
    },
    
      generated: {
        id: `https://playcademy.org/metrics/raids/${dbEventId}`,
        type: "TimebackActivityMetricsCollection",
        attempt: eventData.attempt ?? 1,
        items: [
          {
            type: "xpEarned",
            value: eventData.xpEarned
          },
          {
            type: "totalQuestions",
            value: eventData.totalQuestions
          },
          {
            type: "correctQuestions",
            value: eventData.correctQuestions
          },
          ...(eventData.masteredUnits !== undefined ? [{
            type: "masteredUnits",
            value: eventData.masteredUnits
          }] : [])
        ]
      }
  };

  // Wrap in Caliper envelope
  return {
    sensor: "https://mathraiders.com",
    sendTime: new Date().toISOString(),
    dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
    data: [event]
  };
}

async function sendTestEvent(timebackId: string, email: string, grade: number, xp: number) {
  console.log(`\n📤 Sending test Caliper event (EXACT worker format):`);
  console.log(`   TimeBack ID: ${timebackId}`);
  console.log(`   Email: ${email}`);
  console.log(`   Grade: ${grade} (course: math-raiders-grade-${grade})`);
  console.log(`   XP: ${xp}`);
  
  const token = await getToken();
  console.log(`\n🔑 Got auth token`);
  
  // Build EventPayload exactly as worker does
  const eventData: EventPayload = {
    timebackId,
    email,
    grade,
    resourceId: `test-resource-${Date.now()}`,
    raidEndTime: new Date().toISOString(),
    raidDurationMinutes: 2.0,
    xpEarned: xp,
    totalQuestions: 50,
    correctQuestions: 45,
    masteredUnits: 10,
    process: true,
    attempt: 1
  };
  
  // Use fake dbEventId
  const dbEventId = BigInt(Date.now());
  
  // Create envelope using EXACT worker function
  const envelope = createCaliperEvent(eventData, dbEventId);
  
  console.log(`\n📨 Sending to ${CALIPER_URL}...`);
  console.log(`\n📋 Payload preview:`);
  console.log(JSON.stringify(envelope, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  
  const response = await fetch(CALIPER_URL, {
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
    console.log(`\n✅ Event sent successfully!`);
    console.log(`\n👉 Now check TimeBack dashboard for ${email} to see if ${xp} XP appeared.`);
    console.log(`   If it DIDN'T appear → enrollment required → Atticus solved`);
    console.log(`   If it DID appear → need different approach`);
  } else {
    console.log(`\n❌ Event failed`);
  }
}

// Parse args
const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Usage: bun run scripts/timeback/testCaliperEvent.ts <timebackId> <email> <grade> <xp>');
  console.log('Example: bun run scripts/timeback/testCaliperEvent.ts abc-123 campbell@test.com 4 100');
  process.exit(1);
}

const [timebackId, email, gradeStr, xpStr] = args;
const grade = parseInt(gradeStr, 10);
const xp = parseInt(xpStr, 10);

sendTestEvent(timebackId, email, grade, xp).catch(console.error);
