#!/usr/bin/env bun

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

const YOUR_TIMEBACK_ID = Bun.argv[2];

async function fetchAccessToken() {
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function check() {
  if (!YOUR_TIMEBACK_ID) {
    console.log('Usage: bun run checkStudentAssessments.ts <your-timeback-id>');
    return;
  }

  const token = await fetchAccessToken();
  
  console.log(`Checking assessment results for: ${YOUR_TIMEBACK_ID}\n`);
  
  // Get all assessment results for this user (gradebook endpoint)
  const url = `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${YOUR_TIMEBACK_ID}'&limit=1000&sort=scoreDate&orderBy=desc`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (res.ok) {
    const data = await res.json();
    const results = data.assessmentResults || [];
    
    console.log(`Found ${results.length} assessment results\n`);
    
    // Filter for AMF and Math Raiders results
    const amfResults = results.filter((r: any) => {
      const lineItem = r.lineItem?.sourcedId || r.assessmentLineItem?.sourcedId || '';
      return lineItem.includes('fastmath') || lineItem.includes('alphamath');
    });
    
    const mrResults = results.filter((r: any) => {
      const lineItem = r.lineItem?.sourcedId || r.assessmentLineItem?.sourcedId || '';
      return lineItem.includes('math-raiders') || lineItem.includes('mathraiders');
    });
    
    // Show AMF results by date
    if (amfResults.length > 0) {
      console.log(`AlphaMath Fluency Results (${amfResults.length} total):\n`);
      
      // Sort by date descending
      amfResults.sort((a: any, b: any) => {
        const dateA = new Date(a.scoreDate || a.dateLastModified);
        const dateB = new Date(b.scoreDate || b.dateLastModified);
        return dateB.getTime() - dateA.getTime();
      });
      
      // Show last 20 results
      amfResults.slice(0, 20).forEach((r: any) => {
        const score = r.score || r.scoreValue || 'N/A';
        const date = r.scoreDate || r.dateLastModified || 'N/A';
        const lineItem = r.lineItem?.sourcedId || r.assessmentLineItem?.sourcedId || 'N/A';
        console.log(`  ${date.substring(0, 10)} | Score: ${score} | ${lineItem}`);
      });
      
      if (amfResults.length > 20) {
        console.log(`  ... and ${amfResults.length - 20} more`);
      }
    } else {
      console.log('No AlphaMath Fluency results found');
    }
    
    console.log('');
    
    // Show Math Raiders results
    if (mrResults.length > 0) {
      console.log(`Math Raiders Results (${mrResults.length} total):\n`);
      
      // Sort by date descending
      mrResults.sort((a: any, b: any) => {
        const dateA = new Date(a.scoreDate || a.dateLastModified);
        const dateB = new Date(b.scoreDate || b.dateLastModified);
        return dateB.getTime() - dateA.getTime();
      });
      
      // Show last 10 results
      mrResults.slice(0, 10).forEach((r: any) => {
        const score = r.score || r.scoreValue || 'N/A';
        const date = r.scoreDate || r.dateLastModified || 'N/A';
        const lineItem = r.lineItem?.sourcedId || r.assessmentLineItem?.sourcedId || 'N/A';
        console.log(`  ${date.substring(0, 10)} | XP: ${score} | ${lineItem}`);
      });
      
      if (mrResults.length > 10) {
        console.log(`  ... and ${mrResults.length - 10} more`);
      }
    } else {
      console.log('No Math Raiders results found');
    }
    
  } else {
    console.log(`Failed: ${res.status}`);
    console.log(await res.text());
  }
}

check().catch(console.error);

