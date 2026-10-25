import * as SecureStore from 'expo-secure-store';

// SecureStore caps values at ~2KB on some platforms and a Supabase session can exceed that,
// so a value is split across keys `<key>.0`, `<key>.1`, ... and `<key>` holds the part count.
// 600 chars stays under 2KB even at 3 bytes per char.
const CHUNK_SIZE = 600;

const partKey = (key: string, i: number) => `${key}.${i}`;

async function readCount(key: string): Promise<number> {
  const n = Number(await SecureStore.getItemAsync(key));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function removeParts(key: string, from: number, to: number) {
  for (let i = from; i < to; i++) await SecureStore.deleteItemAsync(partKey(key, i));
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await readCount(key);
    if (count === 0) return null;
    let value = '';
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(partKey(key, i));
      if (part === null) return null;
      value += part;
    }
    return value;
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readCount(key);
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(partKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(key, String(count));
    await removeParts(key, count, previous);
  },

  async removeItem(key: string): Promise<void> {
    const count = await readCount(key);
    await SecureStore.deleteItemAsync(key);
    await removeParts(key, 0, count);
  },
};
