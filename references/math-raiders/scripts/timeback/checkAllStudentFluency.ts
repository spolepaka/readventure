#!/usr/bin/env bun
/**
 * Check AlphaMath fluency scores for all Math Raiders students
 * Compares Math Raiders progress vs AlphaMath baseline
 */

import { join } from 'path';

// Load env vars
const envPath = join(import.meta.dir, '../../client/.env.production');
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

// Load production backup (latest)
const backupPath = '/Users/campbellcao/Desktop/MathRaiders-Backups/production/production_2025-11-09_17-23.json';
const backup = await Bun.file(backupPath).json();

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

async function getAlphaMathEnrollments(token: string, timebackId: string) {
  try {
    // Query their class enrollments (same as fetchGradeFromAlphaMath.ts)
    const url = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users/${timebackId}/classes`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    
    // Filter for AlphaMath Fluency classes
    const alphaMathClasses = data.classes?.filter((cls: any) => 
      cls.title?.includes('AlphaMath Fluency')
    ) || [];
    
    return alphaMathClasses;
  } catch (e) {
    return null;
  }
}

console.log('🔍 Checking AlphaMath Fluency for all students...\n');
console.log('='.repeat(80));

const token = await getToken();
const players = backup.tables.player || [];

console.log(`Found ${players.length} players in Math Raiders\n`);

for (const player of players) {
  console.log(`\n📊 ${player.name} (Grade ${player.grade})`);
  console.log('-'.repeat(80));
  
  if (!player.timebackId) {
    console.log('⚠️  No TimeBack ID - skipping');
    continue;
  }
  
  if (!player.email) {
    console.log('⚠️  No email - skipping');
    continue;
  }
  
  console.log(`📧 ${player.email}`);
  console.log(`🆔 TimeBack: ${player.timebackId}`);
  
  // Math Raiders stats
  const factMastery = (backup.tables.fact_mastery || []).filter((f: any) => f.playerId === player.id);
  const mastered = factMastery.filter((f: any) => f.masteryLevel >= 5).length;
  
  console.log(`\n🎮 Math Raiders Progress:`);
  console.log(`   - Facts mastered: ${mastered}/${factMastery.length}`);
  console.log(`   - Total raids: ${player.totalRaids}`);
  console.log(`   - Accuracy: ${player.totalProblems > 0 ? Math.round(player.totalCorrect / player.totalProblems * 100) : 0}%`);
  console.log(`   - Rank: ${player.rank || 'unranked'}`);
  
  // AlphaMath enrollments
  console.log(`\n📚 Fetching AlphaMath enrollments...`);
  const classes = await getAlphaMathEnrollments(token, player.timebackId);
  
  if (!classes || classes.length === 0) {
    console.log('   ℹ️  Not enrolled in any AlphaMath Fluency classes');
    continue;
  }
  
  console.log(`   ✅ Enrolled in ${classes.length} AlphaMath class(es):`);
  
  classes.forEach((cls: any) => {
    const title = cls.title || 'Unknown class';
    const status = cls.status || 'active';
    const gradeMatch = title.match(/Grade\s+([K0-5])/i);
    const grade = gradeMatch ? gradeMatch[1] : '?';
    
    console.log(`   - ${title} (status: ${status})`);
    console.log(`     Grade level: ${grade}`);
  });
}

console.log('\n');
console.log('='.repeat(80));
console.log('✅ Check complete!');

