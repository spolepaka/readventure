// Test if Timeback API accepts decimal XP values
// Run: bun run tests/test-timeback-decimal-xp.ts

const TIMEBACK_AUTH_URL = 'https://alpha-auth-production-idp.auth.us-west-2.amazoncognito.com/oauth2/token';
const TIMEBACK_VALIDATE_URL = 'https://caliper.alpha-1edtech.com/caliper/event/validate';
const CLIENT_ID = process.env.TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = process.env.TIMEBACK_CLIENT_SECRET;

async function getToken() {
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  });
  const data = await response.json();
  return data.access_token;
}

async function testDecimalXP() {
  console.log('🧪 Testing Timeback decimal XP support...\n');
  
  const token = await getToken();
  
  // Test with decimal XP
  const testEvent = {
    sensor: "https://mathraiders.com",
    sendTime: new Date().toISOString(),
    dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
    data: [{
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: "ActivityEvent",
      action: "Completed",
      eventTime: new Date().toISOString(),
      profile: "TimebackProfile",
      actor: {
        id: "https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/users/test-user",
        type: "TimebackUser",
        email: "test@example.com"
      },
      object: {
        id: "https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/component-resources/f4283182-aa2c-4ab2-b8ac-cceb4b3f6d6f",
        type: "TimebackActivityContext",
        subject: "Math",
        app: { name: "Math Raiders" },
        activity: { name: "Math Raid" },
        course: {
          id: "https://api.alpha-1edtech.ai/ims/oneroster/rostering/v1p2/courses/fe15be0a-9f8d-4251-b000-402c6581617f",
          name: "Math Raiders K-5"
        },
        process: true
      },
      generated: {
        id: "https://playcademy.org/metrics/raids/test",
        type: "TimebackActivityMetricsCollection",
        attempt: 1,
        items: [
          { type: "xpEarned", value: 2.39 },  // ← DECIMAL
          { type: "totalQuestions", value: 10 },
          { type: "correctQuestions", value: 9 }
        ]
      }
    }]
  };
  
  const response = await fetch(TIMEBACK_VALIDATE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(testEvent)
  });
  
  const result = await response.json();
  
  console.log('Status:', response.status);
  console.log('Result:', JSON.stringify(result, null, 2));
  
  if (response.ok) {
    console.log('\n✅ SUCCESS: Timeback accepts decimal XP!');
    console.log('You can use: (duration_seconds / 60.0) for precise XP');
  } else {
    console.log('\n❌ FAILED: Timeback rejects decimal XP');
    console.log('Stick with: Math.round(duration_seconds / 60.0)');
  }
}

testDecimalXP().catch(console.error);

