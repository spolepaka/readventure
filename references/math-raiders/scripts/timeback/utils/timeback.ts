/// <reference types="bun-types" />

/**
 * Returns the base URL for Timeback API requests.
 */
export function getTimebackBaseUrl(): string {
  const baseUrl = Bun.env.TIMEBACK_BASE_URL ?? "https://api.alpha-1edtech.ai";
  return baseUrl.replace(/\/$/, "");
}

/**
 * Gets TimeBack credentials from environment variables or worker/.env.dev.
 */
export async function getTimebackCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  // Check environment variables first
  let clientId = Bun.env.TIMEBACK_CLIENT_ID;
  let clientSecret = Bun.env.TIMEBACK_CLIENT_SECRET;
  
  // Fall back to worker/.env.dev if not in env
  if (!clientId || !clientSecret) {
    const envPath = import.meta.dir + '/../../../worker/.env.dev';
    try {
      const envFile = await Bun.file(envPath).text();
      const lines = envFile.split('\n');
      for (const line of lines) {
        const match = line.match(/^(\w+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          const cleanValue = value.replace(/^["']|["']$/g, '');
          if (key === 'TIMEBACK_CLIENT_ID' && !clientId) {
            clientId = cleanValue;
          }
          if (key === 'TIMEBACK_CLIENT_SECRET' && !clientSecret) {
            clientSecret = cleanValue;
          }
        }
      }
    } catch {
      // File not found, continue with env vars only
    }
  }
  
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing TimeBack credentials. Set TIMEBACK_CLIENT_ID and TIMEBACK_CLIENT_SECRET env vars or in worker/.env.dev`
    );
  }
  
  return { clientId, clientSecret };
}

/**
 * Gets TimeBack API base URL (defaults to production)
 */
export const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';

/**
 * Gets TimeBack auth URL (production)
 */
export const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
