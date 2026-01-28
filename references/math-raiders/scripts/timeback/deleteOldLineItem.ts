#!/usr/bin/env bun
/**
 * FIX: Delete old assessment line items with ComponentResource links
 * 
 * PROBLEM: Pre-Nov-4 line items linked to ComponentResources were marking
 *          courses as "Completed" even when students had incomplete progress
 * 
 * ROOT CAUSE: Worker used to link results to ComponentResource URLs which
 *             triggered TimeBack's course completion logic
 * 
 * SOLUTION: Soft-delete old line items (status → "tobedeleted")
 *           TimeBack ignores these when calculating completion status
 * 
 * USAGE: bun run deleteOldLineItem.ts <line-item-id>
 * 
 * APPLIED: Nov 11, 2024 - TSA pilot
 *   - Grade 2: fc36c3b2-8923-48b6-bfd8-d1af9fcba944 (Renee)
 *   - Grade 3: 2657837d-9f30-451f-b1a7-b303130e8032 (Campbell, Demarcus)
 *   - Grade 4: ddfc4c2d-dcc8-400f-8608-3e7444222c6a (Seth, Peini, Xiaoheng)
 */

import { getTimebackCredentials, TIMEBACK_AUTH_URL, TIMEBACK_API_BASE } from './utils/timeback';

async function getToken() {
  const { clientId, clientSecret } = await getTimebackCredentials();
  const res = await fetch(TIMEBACK_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  return (await res.json()).access_token;
}

const lineItemId = Bun.argv[2];

if (!lineItemId) {
  console.error('❌ Usage: bun run deleteOldLineItem.ts <line-item-id>');
  console.error('\nExample: bun run deleteOldLineItem.ts ddfc4c2d-dcc8-400f-8608-3e7444222c6a');
  process.exit(1);
}

const token = await getToken();

console.log('🗑️  Deleting assessment line item...\n');
console.log(`Line Item ID: ${lineItemId}\n`);

const url = `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentLineItems/${lineItemId}`;

const res = await fetch(url, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${token}` }
});

if (res.status === 204) {
  console.log('✅ Line item deleted successfully (soft delete: status → "tobedeleted")');
  console.log('\nStudents should see course as "Active" instead of "Completed" after refresh!');
} else {
  console.log(`❌ Failed to delete: ${res.status}`);
  console.log(await res.text());
}

