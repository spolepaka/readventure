#!/usr/bin/env bun

import { fetchAccessToken } from "./timebackAuth";
import { generateUUID } from "./utils/uuid";

type OrgPayload = {
  org: {
    sourcedId?: string;
    name: string;
    type: "school" | "district" | string;
    status?: "active" | "inactive";
    dateLastModified?: string;
    identifier?: string;
    parent?: { sourcedId: string } | null;
    metadata?: Record<string, unknown>;
  };
};

function readJsonInput(): OrgPayload {
  const args = Bun.argv.slice(2);
  const payloadArg = args.find((arg) => arg.startsWith("--payload="));
  if (!payloadArg) {
    throw new Error("Missing required --payload=<json> argument.");
  }

  const json = payloadArg.replace("--payload=", "");
  try {
    return JSON.parse(json) as OrgPayload;
  } catch (error) {
    throw new Error(`Unable to parse payload JSON: ${error}`);
  }
}

function readBaseUrl(): string {
  const baseUrl = Bun.env.TIMEBACK_BASE_URL ?? "https://api.alpha-1edtech.com";
  return baseUrl.replace(/\/$/, "");
}

async function createOrg(payload: OrgPayload) {
  if (!payload.org.sourcedId) {
    payload.org.sourcedId = generateUUID();
    console.log(`ℹ️ Generated org sourcedId: ${payload.org.sourcedId}`);
  }

  const token = await fetchAccessToken();
  const baseUrl = readBaseUrl();
  const endpoint = `${baseUrl}/ims/oneroster/rostering/v1p2/orgs`;

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
    throw new Error(`Org creation failed (${response.status}): ${text}`);
  }

  try {
    const data = JSON.parse(text);
    console.log("✅ Org created successfully\n");
    console.log(JSON.stringify(data, null, 2));
  } catch {
    console.log("✅ Org created successfully (non-JSON response)\n");
    console.log(text);
  }
}

async function runCli() {
  try {
    const payload = readJsonInput();
    await createOrg(payload);
  } catch (error) {
    console.error("❌ Unable to create org");
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
