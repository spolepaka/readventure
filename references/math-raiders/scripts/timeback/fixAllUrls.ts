#!/usr/bin/env bun
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

const token = await getToken();

const TARGET_URL = 'https://hub.playcademy.net/play/math-raiders';

console.log(`🔧 Fixing ALL URL fields in Math Raiders resources to: ${TARGET_URL}\n`);

for (let grade = 1; grade <= 5; grade++) {
  const crId = `math-raiders-grade-${grade}-component-resource`;
  
  const getUrl = `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/courses/component-resources/${crId}`;
  const getRes = await fetch(getUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!getRes.ok) continue;
  
  const crData = await getRes.json();
  const cr = crData.componentResource;
  const resourceId = cr.resource.sourcedId;
  
  // GET resource
  const resourceUrl = `${TIMEBACK_API_BASE}/ims/oneroster/resources/v1p2/resources/${resourceId}`;
  const resourceRes = await fetch(resourceUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!resourceRes.ok) continue;
  
  const resourceData = await resourceRes.json();
  const resource = resourceData.resource;
  
  // Update ALL URL fields
  const updatedResource = {
    ...resource,
    metadata: {
      ...resource.metadata,
      external_url: TARGET_URL,
      url: TARGET_URL,
      launchUrl: TARGET_URL
    },
    dateLastModified: new Date().toISOString()
  };
  
  const putRes = await fetch(resourceUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ resource: updatedResource })
  });
  
  if (putRes.ok) {
    console.log(`✅ Grade ${grade}: All URL fields updated to ${TARGET_URL}`);
  } else {
    console.error(`❌ Grade ${grade}: Failed`);
  }
}

console.log('\n✅ Done! Refresh your browser to see the change.');
