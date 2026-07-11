import { getDb, parsePriceToInt } from './db.js';

// { id, slug, name, price, raw_price, status, views, created_at, updated_at,
//   auto } — auto: флаг автопубликации, живёт только локально (upsert с
// сервера его не трогает, т.к. обновляет поля точечно)
const STORE = 'items';

export async function upsertItems(edges) {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const now = new Date().toISOString();

  for (const edge of edges) {
    const node = edge?.node;
    const itemId = node?.id;
    if (!itemId) continue;

    const incoming = {
      slug: node.slug ?? null,
      name: node.name ?? null,
      price: parsePriceToInt(node.price ?? node.rawPrice),
      raw_price: parsePriceToInt(node.rawPrice),
      status: node.status ?? null,
      views: node.viewsCounter ?? node.views ?? node.viewCount ?? null,
      created_at: node.createdAt ?? null,
    };

    const existing = await tx.store.get(itemId);

    if (!existing) {
      await tx.store.put({
        id: itemId,
        ...incoming,
        updated_at: now,
      });
      continue;
    }

    let changed = false;
    const updated = { ...existing };

    if (incoming.views != null && incoming.views !== existing.views) {
      updated.views = incoming.views;
      changed = true;
    }

    for (const key of ['slug', 'name', 'price', 'raw_price', 'status']) {
      if (incoming[key] !== existing[key]) {
        updated[key] = incoming[key];
        changed = true;
      }
    }
    if (incoming.created_at && incoming.created_at !== existing.created_at) {
      updated.created_at = incoming.created_at;
      changed = true;
    }

    if (changed) {
      updated.updated_at = now;
      await tx.store.put(updated);
    }
  }

  await tx.done;
}

export async function deleteItemLocal(id) {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function setItemPrice(id, price) {
  const db = await getDb();
  const existing = await db.get(STORE, id);
  if (!existing) return;
  await db.put(STORE, {
    ...existing,
    price,
    updated_at: new Date().toISOString(),
  });
}

// Флаг автопубликации для набора товаров (одна транзакция)
export async function setItemsAuto(ids, auto) {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const now = new Date().toISOString();

  for (const id of ids) {
    const existing = await tx.store.get(id);
    if (!existing) continue;
    await tx.store.put({ ...existing, auto: Boolean(auto), updated_at: now });
  }

  await tx.done;
}

export async function getAllItems() {
  const db = await getDb();
  const records = await db.getAll(STORE);
  records.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  return records.map((d) => ({
    auto: Boolean(d.auto),
    node: {
      id: d.id,
      slug: d.slug,
      name: d.name,
      price: d.price,
      rawPrice: d.raw_price,
      status: d.status,
      views: d.views,
      createdAt: d.created_at,
    },
  }));
}
