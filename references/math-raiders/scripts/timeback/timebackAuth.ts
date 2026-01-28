#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * Minimal Timeback authentication helper.
 *
 * Required env vars (set in `.env.local`):
 *   TIMEBACKCLIENTID
 *   TIMEBACKSECRET
 *
 * CLI usage:
 *   bun scripts/timebackAuth.ts
 *   bun scripts/timebackAuth.ts --raw
 */

const AUTH_URL = "https://alpha-auth-production-idp.auth.us-west-2.amazoncognito.com/oauth2/token";
const GRANT_TYPE = "client_credentials";

function requireEnv(name: "TIMEBACKCLIENTID" | "TIMEBACKSECRET"): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`${name} is required. Add it to your .env.local file.`);
  }
  return value;
}

const CLIENT_ID = requireEnv("TIMEBACKCLIENTID");
const CLIENT_SECRET = requireEnv("TIMEBACKSECRET");

export async function fetchAccessToken(): Promise<string> {
  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: GRANT_TYPE,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch token (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Token response missing access_token.");
  }

  return data.access_token;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await fetchAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function runCli() {
  const args = new Set(Bun.argv.slice(2));
  try {
    const token = await fetchAccessToken();
    if (args.has("--raw")) {
      console.log(token);
      return;
    }

    console.log("✅ Retrieved Timeback access token\n");
    console.log(`Token: ${token}`);
  } catch (error) {
    console.error("❌ Unable to fetch Timeback access token");
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
