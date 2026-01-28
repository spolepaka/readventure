#!/usr/bin/env bun

import { fetchAccessToken } from "./timebackAuth";
import { generateUUID } from "./utils/uuid";
import { getTimebackBaseUrl } from "./utils/timeback";

type CourseComponentPayload = {
  courseComponent: {
    sourcedId?: string;
    status?: string;
    dateLastModified?: string;
    metadata?: Record<string, unknown> | null;
    title: string;
    sortOrder?: number;
    courseSourcedId?: string;
    course?: { sourcedId: string };
    parent?: { sourcedId: string } | null;
    prerequisites?: Array<{ sourcedId: string }> | string[];
    prerequisiteCriteria?: string | null;
    unlockDate?: string | null;
  };
};

function readJsonInput(): CourseComponentPayload {
  const args = Bun.argv.slice(2);
  const payloadArg = args.find((arg) => arg.startsWith("--payload="));
  if (!payloadArg) {
    throw new Error("Missing required --payload=<json> argument.");
  }

  const json = payloadArg.replace("--payload=", "");
  try {
    return JSON.parse(json) as CourseComponentPayload;
  } catch (error) {
    throw new Error(`Unable to parse payload JSON: ${error}`);
  }
}

async function createCourseComponent(payload: CourseComponentPayload) {
  if (!payload.courseComponent.sourcedId) {
    payload.courseComponent.sourcedId = generateUUID();
    console.log(`ℹ️ Generated component sourcedId: ${payload.courseComponent.sourcedId}`);
  }

  if (!payload.courseComponent.status) {
    payload.courseComponent.status = "active";
  }

  if (!payload.courseComponent.dateLastModified) {
    payload.courseComponent.dateLastModified = new Date().toISOString();
  }

  const token = await fetchAccessToken();
  const endpoint = `${getTimebackBaseUrl()}/ims/oneroster/rostering/v1p2/courses/components`;

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
    throw new Error(`Course component creation failed (${response.status}): ${text}`);
  }

  console.log("✅ Course component created successfully\n");

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
    await createCourseComponent(payload);
  } catch (error) {
    console.error("❌ Unable to create course component");
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
