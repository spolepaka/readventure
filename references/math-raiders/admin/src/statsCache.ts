/**
 * IndexedDB cache for admin stats (stale-while-revalidate pattern)
 * 
 * Uses `idb` for idiomatic Promise-based IndexedDB access.
 * Stores serialized stats as JSON strings to handle BigInt timestamps.
 */
import { openDB, IDBPDatabase } from 'idb';
import type { FactMastery, PerformanceSnapshot } from '../spacetime';

const DB_NAME = 'admin-cache';
const DB_VERSION = 1;
const STORE_NAME = 'stats';

type StatsDB = IDBPDatabase<unknown>;

let dbPromise: Promise<StatsDB> | null = null;

function getDb(): Promise<StatsDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

// BigInt can't be JSON-serialized, convert to string
const toJson = (data: unknown): string => 
  JSON.stringify(data, (_k, v) => typeof v === 'bigint' ? v.toString() : v);

export async function saveStats(
  facts: FactMastery[], 
  snapshots: PerformanceSnapshot[]
): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE_NAME, toJson({ facts, snapshots }), 'data');
  } catch (e) {
    console.warn('Cache save failed:', e);
  }
}

export async function loadStats(): Promise<{
  facts: FactMastery[];
  snapshots: PerformanceSnapshot[];
} | null> {
  try {
    const db = await getDb();
    const json = await db.get(STORE_NAME, 'data');
    if (json) {
      return JSON.parse(json);
    }
  } catch (e) {
    console.warn('Cache load failed:', e);
  }
  return null;
}
