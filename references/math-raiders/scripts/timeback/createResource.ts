#!/usr/bin/env bun

import { fetchAccessToken } from "./timebackAuth";
import { generateUUID } from "./utils/uuid";
import { getTimebackBaseUrl } from "./utils/timeback";

type ResourcePayload = {
  resource: {
    sourcedId?: string;
    status?: string;
    dateLastModified?: string;
    metadata?: Record<string, unknown> | null;
    title: string;
    roles?: string[];
    importance?: string;
    vendorResourceId?: string;
    vendorId?: string | null;
    applicationId?: string | null;
  };
};

function readJsonInput(): ResourcePayload {
  const args = Bun.argv.slice(2);
  const payloadArg = args.find((arg) => arg.startsWith("--payload="));
  if (!payloadArg) {
    throw new Error("Missing required --payload=<json> argument.");
  }

  const json = payloadArg.replace("--payload=", "");
  try {
    return JSON.parse(json) as ResourcePayload;
  } catch (error) {
    throw new Error(`Unable to parse payload JSON: ${error}`);
  }
}

async function createResource(payload: ResourcePayload) {
  if (!payload.resource.sourcedId) {
    payload.resource.sourcedId = generateUUID();
    console.log(`ℹ️ Generated resource sourcedId: ${payload.resource.sourcedId}`);
  }

  if (!payload.resource.status) {
    payload.resource.status = "active";
  }

  if (!payload.resource.dateLastModified) {
    payload.resource.dateLastModified = new Date().toISOString();
  }

  const token = await fetchAccessToken();
  const endpoint = `${getTimebackBaseUrl()}/ims/oneroster/resources/v1p2/resources`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Resource creation failed (${response.status}): ${text}`);
  }

  console.log("✅ Resource created successfully\n");

  try {
    const data = JSON.parse(text);
    console.log(JSON.stringify(data, null, 2));
  } catch {
    console.log(text);
  }
}

async function runCli() {
  try {
    const payload = readJsonInput();
    await createResource(payload);
  } catch (error) {
    console.error("❌ Unable to create resource");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  runCli();
}
