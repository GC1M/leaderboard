import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { HealthMetric } from './healthkit';
import type { HealthJournal, JournalState } from './changes';

const connections = new Map<string, Promise<import('expo-sqlite').SQLiteDatabase>>();
export async function getHealthDeviceId(): Promise<string> {
  const key = 'health-device-id';
  let id = await SecureStore.getItemAsync(key);
  if (!id) { id = Crypto.randomUUID(); await SecureStore.setItemAsync(key, id); }
  return id;
}

async function open(userId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(userId)) throw new Error('Invalid Health account.');
  let connection = connections.get(userId);
  if (!connection) {
    connection = (async () => {
      // Lazy load: Expo Go/web never need the native SQLite journal. Native build uses SQLCipher.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SQLite: typeof import('expo-sqlite') = require('expo-sqlite');
      const keyName = `health-journal-key-${userId}`;
      let key = await SecureStore.getItemAsync(keyName);
      if (!key) { key = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join(''); await SecureStore.setItemAsync(keyName, key); }
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid Health journal key.');
      const db = await SQLite.openDatabaseAsync(`health-${userId}.db`);
      try {
        await db.execAsync(`PRAGMA key = "x'${key}'";`);
        const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
        if (!cipher?.cipher_version) throw new Error('Health journal requires a new iPhone build with SQLCipher.');
        await db.execAsync('CREATE TABLE IF NOT EXISTS health_journal (metric TEXT PRIMARY KEY, state TEXT NOT NULL)');
        return db;
      } catch (e) { await db.closeAsync(); throw e; }
    })();
    connections.set(userId, connection);
    connection.catch(() => connections.delete(userId));
  }
  return connection;
}

export function healthJournal(userId: string): HealthJournal {
  return {
    async read(metric: HealthMetric) {
      const db = await open(userId);
      const row = await db.getFirstAsync<{ state: string }>('SELECT state FROM health_journal WHERE metric = ?', metric);
      return row ? JSON.parse(row.state) as JournalState : null;
    },
    async write(metric: HealthMetric, state: JournalState) {
      const db = await open(userId);
      await db.runAsync('INSERT OR REPLACE INTO health_journal (metric,state) VALUES (?,?)', metric, JSON.stringify(state));
    },
  };
}

// Re-query visible history without erasing existing samples or inferring deletions. Must be called
// while the account coordinator is idle; pending uploads are replayed before the fresh query.
export async function resetHealthAnchors(userId: string): Promise<void> {
  const store = healthJournal(userId);
  for (const metric of ['steps','sleep','weight'] as const) {
    const state = await store.read(metric);
    if (state) await store.write(metric, { ...state, anchor: undefined });
  }
}

// Call after stopping account sync when deleting imported local history/account data (#26).
export async function deleteHealthJournal(userId: string): Promise<void> {
  const db = await connections.get(userId);
  if (db) await db.closeAsync();
  connections.delete(userId);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SQLite: typeof import('expo-sqlite') = require('expo-sqlite');
  await SQLite.deleteDatabaseAsync(`health-${userId}.db`);
  await SecureStore.deleteItemAsync(`health-journal-key-${userId}`);
}
