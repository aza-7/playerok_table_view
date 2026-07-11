import { getSettings } from './config.js';
import { ext } from './ext/browser.js';
import { fetchItemsList, publishItem, AuthError } from './api/playerok.js';
import { upsertItems, getAllItems } from './db/itemsStore.js';
import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  PUBLISHABLE_STATUSES,
} from './itemStatuses.js';

// Автопубликация работает в content-script на любой вкладке playerok.com —
// оверлей открывать не нужно. Раз в интервал: обновить свежие статусы →
// переиздать помеченные «Авто» товары, ушедшие из активных.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_COUNT = 15;

// Межвкладочный замок в ext.storage: publish-цикл ведёт одна вкладка,
// остальные пропускают тик. Замок истекает сам — упавшая вкладка не блокирует.
const LOCK_KEY = 'autoPublishLockUntil';
const LOCK_TTL_MS = CHECK_INTERVAL_MS - 30_000;

let running = false;
let pending = false;

async function refreshItemStatuses() {
  const cfg = await getSettings();
  if (!cfg.userId || !cfg.itemsHash) return; // настройки ещё не заполнены
  for (const statuses of [ACTIVE_STATUSES, COMPLETED_STATUSES]) {
    const { edges } = await fetchItemsList({
      userId: cfg.userId,
      statuses,
      limit: REFRESH_COUNT,
      itemsHash: cfg.itemsHash,
    });
    await upsertItems(edges);
  }
}

async function publishCandidates() {
  const all = await getAllItems();
  const candidates = all.filter(
    (item) => item.auto && PUBLISHABLE_STATUSES.includes(item.node.status)
  );

  for (const item of candidates) {
    const id = item.node.id;
    try {
      const published = await publishItem(
        id,
        item.node.price ?? item.node.rawPrice
      );
      if (published) {
        await upsertItems([{ node: published }]);
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      console.error(`автопубликация ${id}:`, error); // остальные продолжаем
    }
  }
}

// Один проход автопубликации. Вызов во время идущего прохода не теряется:
// ставится pending, и по завершении цикл повторяется с уже свежими флагами —
// иначе быстрые клики по чекбоксам публиковали бы только первый товар.
export async function runAutoPublish({ refresh = false } = {}) {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    do {
      pending = false;
      if (refresh) await refreshItemStatuses();
      await publishCandidates();
    } while (pending);
  } catch (error) {
    // фон: без alert; протухшая сессия просто ждёт следующего тика
    console.error('автопубликация:', error);
  } finally {
    running = false;
  }
}

async function tryTakeLock() {
  try {
    const stored = await ext.storage.local.get(LOCK_KEY);
    const lockUntil = stored?.[LOCK_KEY] ?? 0;
    if (Date.now() < lockUntil) return false;
    await ext.storage.local.set({ [LOCK_KEY]: Date.now() + LOCK_TTL_MS });
    return true;
  } catch {
    return true; // dev-режим без ext.storage — работаем без замка
  }
}

export function startAutoPublishDaemon() {
  const tick = async () => {
    if (await tryTakeLock()) {
      await runAutoPublish({ refresh: true });
    }
  };

  // случайная задержка старта размазывает одновременно открытые вкладки,
  // чтобы замок доставался одной без гонки
  setTimeout(tick, 10_000 + Math.random() * 20_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
