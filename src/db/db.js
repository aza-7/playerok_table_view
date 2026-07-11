import { openDB } from 'idb';

const DB_NAME = 'playerok';
const DB_VERSION = 2;

let dbPromise = null;

export function getDb() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('deals')) {
        db.createObjectStore('deals', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('items')) {
        db.createObjectStore('items', { keyPath: 'id' });
      }
    },
  });
  return dbPromise;
}

export async function clearStore(storeName) {
  const db = await getDb();
  await db.clear(storeName);
}

// Port of back/main.py parse_price_to_int: strip spaces/currency, comma → dot.
export function parsePriceToInt(value) {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }
  if (typeof value === 'string') {
    const s = value
      .trim()
      .replaceAll(' ', '')
      .replaceAll(' ', '')
      .replaceAll('₽', '')
      .replaceAll('руб', '')
      .replaceAll(',', '.');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}
