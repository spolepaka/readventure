#!/usr/bin/env bun

import { fetchAccessToken } from "./timebackAuth";
import { generateUUID } from "./utils/uuid";
import { getTimebackBaseUrl } from "./utils/timeback";

type ComponentResourcePayload = {
  componentResource: {
    sourcedId?: string;
    status?: string;
    dateLastModified?: string;
    metadata?: Record<string, unknown> | null;
    title: string;
    sortOrder?: number;
    courseComponent: { sourcedId: string };
    resource: { sourcedId: string };
    lessonType?: string;
  };
};

function readJsonInput(): ComponentResourcePayload {
  const args = Bun.argv.slice(2);
  const payloadArg = args.find((arg) => arg.startsWith("--payload="));
  if (!payloadArg) {
    throw new Error("Missing required --payload=<json> argument.");
  }

  const json = payloadArg.replace("--payload=", "");
  try {
    return JSON.parse(json) as ComponentResourcePayload;
  } catch (error) {
    throw new Error(`Unable to parse payload JSON: ${error}`);
  }
}

async function createComponentResource(payload: ComponentResourcePayload) {
  if (!payload.componentResource.sourcedId) {
    payload.componentResource.sourcedId = generateUUID();
    console.log(`ℹ️ Generated component-resource sourcedId: ${payload.componentResource.sourcedId}`);
  }

  if (!payload.componentResource.status) {
    payload.componentResource.status = "active";
  }

  if (!payload.componentResource.dateLastModified) {
    payload.componentResource.dateLastModified = new Date().toISOString();
  }

  const token = await fetchAccessToken();
  const endpoint = `${getTimebackBaseUrl()}/ims/oneroster/rostering/v1p2/courses/component-resources`;

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
    throw new Error(`Component resource creation failed (${response.status}): ${text}`);
  }

  console.log("✅ Component resource created successfully\n");

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
    await createComponentResource(payload);
  } catch (error) {
    console.error("❌ Unable to create component resource");
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
