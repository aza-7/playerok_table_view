import { getDb, parsePriceToInt } from './db.js';

// Mirrors the old SQLite `deals` table:
// { id, status, created_at, username, item_name, price, updated_at,
//   fee_multiplier } — fee_multiplier: комиссия товара из полного запроса
// deal; -1 = запрос был, но комиссии в ответе нет (товар удалён и т.п.)
const STORE = 'deals';

export { parsePriceToInt };

// Port of back/main.py save_deals. Also saves node.createdAt when the list
// response includes it — the old backend never did, which is why the slow
// per-deal time backfill existed.
export async function upsertDeals(edges) {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const now = new Date().toISOString();

  for (const edge of edges) {
    const node = edge?.node;
    const dealId = node?.id;
    if (!dealId) continue;

    const incoming = {
      status: node.status ?? null,
      username: node.user?.username ?? null,
      item_name: node.item?.name ?? null,
      price: parsePriceToInt(node.item?.price),
      created_at: node.createdAt ?? null,
    };

    const existing = await tx.store.get(dealId);

    if (!existing) {
      await tx.store.put({
        id: dealId,
        ...incoming,
        updated_at: now,
      });
      continue;
    }

    let changed = false;
    const updated = { ...existing };

    for (const key of ['status', 'username', 'item_name', 'price']) {
      if (incoming[key] !== existing[key]) {
        updated[key] = incoming[key];
        changed = true;
      }
    }
    // never overwrite a known date with null
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

// All deals, id desc (matches SQLite ORDER BY id DESC on a TEXT PK), mapped
// into the { node: {...} } shape the deals table renders.
export async function getAllDeals() {
  const db = await getDb();
  const records = await db.getAll(STORE);
  records.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  return records.map((d) => ({
    node: {
      id: d.id,
      status: d.status,
      createdAt: d.created_at,
      user: { username: d.username },
      item: {
        name: d.item_name,
        price: d.price,
        feeMultiplier: d.fee_multiplier ?? null,
      },
    },
  }));
}

// Заказы, которым нужен полный запрос deal: нет даты или комиссии
// (fee_multiplier == null — в т.ч. заказы, скачанные до этой фичи)
export async function getIdsMissingDealMeta() {
  const db = await getDb();
  const records = await db.getAll(STORE);
  return records
    .filter((d) => !d.created_at || d.fee_multiplier == null)
    .map((d) => d.id);
}

// Данные из полного запроса deal: дата и комиссия товара.
// feeMultiplier null → пишем -1 (запрос был, комиссии нет) — чтобы заказ
// не перезапрашивался бесконечно.
export async function setDealMeta(id, { createdAt, feeMultiplier }) {
  const db = await getDb();
  const existing = await db.get(STORE, id);
  if (!existing) return;
  await db.put(STORE, {
    ...existing,
    created_at: createdAt || existing.created_at,
    fee_multiplier: feeMultiplier ?? -1,
    updated_at: new Date().toISOString(),
  });
}
