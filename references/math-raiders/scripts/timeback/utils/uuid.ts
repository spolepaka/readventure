/**
 * Generates a v4 UUID using Bun/Web Crypto.
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
