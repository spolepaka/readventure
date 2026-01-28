#!/usr/bin/env bun
/**
 * Batch lookup TimeBack IDs and grades for pilot students
 * Usage: bun run scripts/timeback/batchLookupStudents.ts
 */

import { join } from 'path';

// Load env vars from worker (has TimeBack credentials)
const envPath = join(import.meta.dir, '../../worker/.env');
const envFile = await Bun.file(envPath).text();
envFile.split('\n').forEach(line => {
  const match = line.match(/^(\w+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    process.env[key] = value;
  }
});

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';
const CLIENT_ID = process.env.TIMEBACK_CLIENT_ID || process.env.VITE_TIMEBACK_CLIENT_ID;
const CLIENT_SECRET = process.env.TIMEBACK_CLIENT_SECRET || process.env.VITE_TIMEBACK_CLIENT_SECRET;

// Pilot students
const PILOT_EMAILS = [
  'emma.schipper@alpha.school',
  'geraldine.gurrola@alpha.school',
  'seby.holzhauer@alpha.school',
  'Everett.Mroczkowski@novaacademy.school',
  'Hawk.Henson@novaacademy.school',
  'Analea.Lopez@novaacademy.school',
  'Octavia.gieskes@novaacademy.school',
  'nova.victore@2hourlearning.com',
  'wyatt.victore@2hourlearning.com',
  'landen.goikhman@nextgenacademy.school',
  'jimmy.moore@alpha.school',
  'oslo.singer@alpha.school',
  'ren.sticker@alpha.school',
];

async function getToken() {
  const response = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });
  return (await response.json()).access_token;
}

async function findUserByEmail(token: string, email: string): Promise<{ id: string; name: string } | null> {
  const searchUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`;
  
  const res = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    console.error(`  ❌ API error for ${email}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const users = data.users || [];

  if (users.length === 0) {
    // Try case-insensitive search by listing and filtering
    return null;
  }

  const user = users[0];
  return {
    id: user.sourcedId,
    name: `${user.givenName} ${user.familyName}`,
  };
}

async function getGradeFromEnrollments(token: string, timebackId: string): Promise<number | null> {
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users/${timebackId}/classes`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!res.ok) {
    return null;
  }
  
  const data = await res.json();
  const classes = data.classes || [];
  
  // Look for AlphaMath/AlphaNumbers enrollments
  const alphaMathClasses = classes.filter((cls: any) => 
    cls.title?.includes('AlphaMath') || 
    cls.title?.includes('AlphaNumbers') ||
    cls.title?.includes('Math Fluency')
  );
  
  if (alphaMathClasses.length === 0) {
    // Fallback: try to find grade from any class title
    const anyGrade = classes
      .map((cls: any) => {
        const match = cls.title?.match(/Grade\s+([K0-5])/i);
        if (!match) return null;
        return match[1] === 'K' ? 0 : parseInt(match[1], 10);
      })
      .filter((g: number | null): g is number => g !== null);
    
    return anyGrade.length > 0 ? Math.max(...anyGrade) : null;
  }
  
  // Parse grades from AlphaMath titles
  const grades = alphaMathClasses
    .map((cls: any) => {
      const match = cls.title?.match(/Grade\s+([K0-5])/i);
      if (!match) return null;
      return match[1] === 'K' ? 0 : parseInt(match[1], 10);
    })
    .filter((g: number | null): g is number => g !== null);
  
  return grades.length > 0 ? Math.max(...grades) : null;
}

async function main() {
  console.log('🔍 Batch lookup for pilot students\n');
  console.log('='.repeat(80));
  
  const token = await getToken();
  
  const results: Array<{
    email: string;
    name: string | null;
    timebackId: string | null;
    grade: number | null;
  }> = [];
  
  for (const email of PILOT_EMAILS) {
    process.stdout.write(`\n📧 ${email}... `);
    
    const user = await findUserByEmail(token, email);
    
    if (!user) {
      console.log('❌ NOT FOUND');
      results.push({ email, name: null, timebackId: null, grade: null });
      continue;
    }
    
    const grade = await getGradeFromEnrollments(token, user.id);
    
    console.log(`✅ Found!`);
    console.log(`   Name: ${user.name}`);
    console.log(`   TimeBack ID: ${user.id}`);
    console.log(`   Grade: ${grade !== null ? (grade === 0 ? 'K' : grade.toString()) : 'Unknown'}`);
    
    results.push({
      email,
      name: user.name,
      timebackId: user.id,
      grade,
    });
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 SUMMARY (Copy-paste ready)\n');
  console.log('Email | Name | TimeBack ID | Grade');
  console.log('-'.repeat(80));
  
  for (const r of results) {
    const gradeStr = r.grade !== null ? (r.grade === 0 ? 'K' : r.grade.toString()) : '?';
    console.log(`${r.email} | ${r.name || 'NOT FOUND'} | ${r.timebackId || 'N/A'} | ${gradeStr}`);
  }
  
  // JSON output for easy use
  console.log('\n📦 JSON Output:\n');
  console.log(JSON.stringify(results.filter(r => r.timebackId), null, 2));
  
  // Stats
  const found = results.filter(r => r.timebackId).length;
  const withGrade = results.filter(r => r.grade !== null).length;
  console.log(`\n✅ Found: ${found}/${PILOT_EMAILS.length}`);
  console.log(`📚 With grade: ${withGrade}/${found}`);
}

main().catch(console.error);

