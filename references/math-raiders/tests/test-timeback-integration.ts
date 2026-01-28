#!/usr/bin/env bun

/**
 * Test script for TimeBack integration (Bun/TypeScript version)
 * Tests the full flow from event creation to API submission
 */

// Configuration
const TIMEBACK_CLIENT_ID = process.env.TIMEBACK_CLIENT_ID || '';
const TIMEBACK_CLIENT_SECRET = process.env.TIMEBACK_CLIENT_SECRET || '';
const TIMEBACK_AUTH_URL = 'https://alpha-auth-production-idp.auth.us-west-2.amazoncognito.com/oauth2/token';
const TIMEBACK_API_URL = 'https://caliper.alpha-1edtech.com/caliper/event';

// Test data - simulate a SpacetimeDB event
interface EventPayload {
  timebackId: string;
  email: string;
  resourceId: string;
  raidEndTime: string;
  raidDurationMinutes: number;
  xpEarned: number;
  totalQuestions: number;
  correctQuestions: number;
}

const TEST_EVENT: EventPayload = {
  timebackId: process.env.TEST_TIMEBACK_ID || "",  // Test TimeBack ID
  email: process.env.TEST_EMAIL || "",                  // Test email
  resourceId: "f4283182-aa2c-4ab2-b8ac-cceb4b3f6d6f",  // Math Raiders Component Resource ID
  raidEndTime: new Date().toISOString(),
  raidDurationMinutes: 2.5,  // 2.5 minutes = 3 XP (ceiling)
  xpEarned: 3,  // Simulates focused play (CQPM >= 2, accuracy >= 80%)
  totalQuestions: 15,  // Answered 15 problems
  correctQuestions: 13  // Got 13 correct (86.7% accuracy)
};

// Step 1: Get OAuth token
async function getAccessToken(): Promise<string> {
  console.log('🔐 Getting OAuth token...');
  
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&client_id=${TIMEBACK_CLIENT_ID}&client_secret=${TIMEBACK_CLIENT_SECRET}`
  });

  if (!response.ok) {
    throw new Error(`Auth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  console.log('✅ Got token (expires in', data.expires_in, 'seconds)');
  return data.access_token;
}

// Step 2: Transform to Caliper format (matches your worker logic)
function createCaliperEvent(eventData: EventPayload) {
  const event = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    eventTime: eventData.raidEndTime,
    profile: "TimebackProfile",
    type: "ActivityEvent",
    actor: {
      id: `https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/users/${eventData.timebackId}`,
      type: "TimebackUser",
      email: eventData.email
    },
    action: "Completed",
    object: {
      id: `https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/courses/component-resources/${eventData.resourceId}`,
      type: "TimebackActivityContext",
      subject: "FastMath",
      app: {
        name: "Math Raiders"
      },
      activity: {
        name: "Math Raid"
      },
      course: {
        id: "https://api.alpha-1edtech.com/ims/oneroster/rostering/v1p2/courses/fe15be0a-9f8d-4251-b000-402c6581617f",
        name: "Math Raiders K-5"
      },
      process: true
    },
    generated: {
      id: `https://playcademy.org/metrics/raids/test-${Date.now()}`,
      type: "TimebackActivityMetricsCollection",
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
        }
      ]
    }
  };

  return {
    sensor: "https://mathraiders.com",
    sendTime: new Date().toISOString(),
    dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
    data: [event]
  };
}

// Step 3: Send to TimeBack
async function sendToTimeBack(envelope: any, accessToken: string, validateOnly = false) {
  const endpoint = validateOnly ? `${TIMEBACK_API_URL}/validate` : TIMEBACK_API_URL;
  console.log(`📤 Sending to ${validateOnly ? 'validation' : 'production'} endpoint...`);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(envelope, null, 2)
  });

  const responseData = await response.json();
  
  if (!response.ok) {
    console.error('❌ Request failed:', response.status);
    console.error('Response:', responseData);
    throw new Error(`TimeBack rejected event: ${response.status}`);
  }

  console.log('✅ Response:', responseData);
  return responseData;
}

// Test specific SpacetimeDB scenarios
async function testScenarios(accessToken: string) {
  console.log('\n🧪 Testing edge cases...\n');

  // Test 1: No XP (below threshold)
  const noXpEvent = { ...TEST_EVENT, xpEarned: 0 };
  console.log('Test 1: No XP event (CQPM < 2 or accuracy < 80%)');
  const noXpEnvelope = createCaliperEvent(noXpEvent);
  await sendToTimeBack(noXpEnvelope, accessToken, true);

  // Test 2: High XP
  const highXpEvent = { ...TEST_EVENT, xpEarned: 10, raidDurationMinutes: 10.2 };
  console.log('\nTest 2: High XP event (10 minute raid)');
  const highXpEnvelope = createCaliperEvent(highXpEvent);
  await sendToTimeBack(highXpEnvelope, accessToken, true);

  // Test 3: Missing email (should fail)
  console.log('\nTest 3: Missing email (should fail)');
  try {
    const badEvent = { ...TEST_EVENT, email: "" };
    const badEnvelope = createCaliperEvent(badEvent);
    await sendToTimeBack(badEnvelope, accessToken, true);
  } catch (e) {
    console.log('✅ Expected failure:', e.message);
  }
}

// Main test flow
async function runTest() {
  try {
    console.log('🚀 Math Raiders TimeBack Integration Test (Bun)');
    console.log('==============================================');
    console.log('Test Event:', TEST_EVENT);
    console.log('');

    // Get token
    const accessToken = await getAccessToken();
    
    // Create Caliper event
    console.log('\n🔨 Creating Caliper event...');
    const envelope = createCaliperEvent(TEST_EVENT);
    console.log('Event ID:', envelope.data[0].id);
    console.log('Full envelope:', JSON.stringify(envelope, null, 2));
    
    // First validate
    console.log('\n🧪 Step 1: Validate format...');
    await sendToTimeBack(envelope, accessToken, true);
    
    // Test edge cases
    if (process.argv.includes('--test-all')) {
      await testScenarios(accessToken);
    }
    
    // Ask before sending to production
    console.log('\n⚠️  Ready to send to PRODUCTION TimeBack API?');
    console.log('This will create a real event for user:', TEST_EVENT.timebackId);
    console.log('XP to be awarded:', TEST_EVENT.xpEarned);
    
    if (process.argv.includes('--send')) {
      console.log('\n📨 Step 2: Send to production...');
      await sendToTimeBack(envelope, accessToken, false);
      console.log('\n🎉 Success! Event sent to TimeBack.');
      console.log('Note: XP may take time to appear in dashboards.');
    } else {
      console.log('\n⏭️  Skipping production send. Run with --send flag to actually send.');
    }
    
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
console.log('Usage: bun test-timeback-integration.ts [options]');
console.log('  --send      : Actually send to production (default: validate only)');
console.log('  --test-all  : Run additional edge case tests\n');

runTest();
