import { getSettings, saveSettings } from '../config.js';
import { fetchDealsList } from '../api/playerok.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Автоопределение параметров playerok. Страница сама шлёт GraphQL
// GET-запросы, где в query string лежат operationName, variables (с userId)
// и sha256-хэш persisted-запроса. Content-script видит эти URL через
// performance API (resource timing) — перехват сети не нужен.
//
// Что где появляется: deals — вкладка «Продажи» профиля; items — «Мои
// товары»; deal — страница любой сделки. userId берём ТОЛЬКО из deals:
// items стреляет и на чужих профилях, и там в variables чужой userId.
export function detectPlayerokParams() {
  const found = {};

  for (const entry of performance.getEntriesByType('resource')) {
    if (!entry.name.includes('/graphql?')) continue;

    let params;
    try {
      params = new URL(entry.name).searchParams;
    } catch {
      continue;
    }

    const op = params.get('operationName');
    if (!op) continue;

    let hash = null;
    let variables = null;
    try {
      hash =
        JSON.parse(params.get('extensions'))?.persistedQuery?.sha256Hash ??
        null;
    } catch {
      // extensions нет или не JSON — просто без хэша
    }
    try {
      variables = JSON.parse(params.get('variables'));
    } catch {
      // variables нет или не JSON
    }

    if (hash) {
      if (op === 'deals') found.dealsHash = hash;
      else if (op === 'deal') found.dealHash = hash;
      else if (op === 'items') found.itemsHash = hash;
    }

    if (op === 'deals') {
      const userId = variables?.filter?.userId;
      if (userId) found.userId = userId;
    }
  }

  return found;
}

// deal hash сам не появится, пока юзер не откроет сделку — добываем его без
// участия юзера: берём id любой сделки из списка продаж (deals hash уже
// известен), грузим её страницу в скрытом iframe и снимаем хэш запроса deal
// из resource timing самого iframe (same-origin — доступ есть).
const HARVEST_TIMEOUT_MS = 30_000;

async function harvestDealHash(cfg) {
  const { edges } = await fetchDealsList({
    userId: cfg.userId,
    limit: 1,
    dealsHash: cfg.dealsHash,
  });
  const dealId = edges?.[0]?.node?.id;
  if (!dealId) return null; // нет ни одной сделки — добыть неоткуда

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = `/deal/${dealId}`;
  document.body.appendChild(iframe);

  try {
    const deadline = Date.now() + HARVEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(1000);
      let entries = [];
      try {
        entries =
          iframe.contentWindow?.performance?.getEntriesByType('resource') ??
          [];
      } catch {
        // страница в iframe ещё не загрузилась или доступ закрыт
      }
      for (const entry of entries) {
        if (!entry.name.includes('/graphql?')) continue;
        let params;
        try {
          params = new URL(entry.name).searchParams;
        } catch {
          continue;
        }
        if (params.get('operationName') !== 'deal') continue;
        try {
          const hash =
            JSON.parse(params.get('extensions'))?.persistedQuery?.sha256Hash;
          if (hash) return hash;
        } catch {
          // extensions не JSON — пропускаем
        }
      }
    }
    return null;
  } finally {
    iframe.remove();
  }
}

// Фоновое самозаполнение: пока какие-то параметры пусты, периодически
// сканируем resource timing и дописываем найденное. Заполняет только пустые
// поля — уже сохранённые значения не трогает (перезапись — за кнопкой
// «Определить автоматически» в настройках).
const AUTO_FILL_INTERVAL_MS = 10_000;
const PARAM_KEYS = ['userId', 'dealsHash', 'dealHash', 'itemsHash'];

export function startParamsAutoFill() {
  // дефолтный буфер resource timing — 250 записей: живая SPA-страница его
  // переполняет, и поздние GraphQL-запросы туда уже не попадают
  try {
    performance.setResourceTimingBufferSize(10_000);
  } catch {
    // старый браузер — работаем с дефолтным буфером
  }

  let harvestingDealHash = false;

  const tick = async () => {
    const cfg = await getSettings();
    if (PARAM_KEYS.every((k) => cfg[k])) return; // всё уже есть

    const found = detectPlayerokParams();
    const patch = {};
    for (const key of PARAM_KEYS) {
      if (!cfg[key] && found[key]) patch[key] = found[key];
    }

    // остался только deal hash, а deals-параметры уже есть — добываем iframe'ом
    const merged = { ...cfg, ...patch };
    if (
      !merged.dealHash &&
      merged.dealsHash &&
      merged.userId &&
      !harvestingDealHash
    ) {
      harvestingDealHash = true; // одна попытка на загрузку страницы
      const hash = await harvestDealHash(merged).catch((error) => {
        console.error('deal hash harvest:', error);
        return null;
      });
      if (hash) patch.dealHash = hash;
    }

    if (Object.keys(patch).length > 0) {
      await saveSettings({ ...cfg, ...patch });
    }
  };

  tick().catch(console.error);
  setInterval(() => tick().catch(console.error), AUTO_FILL_INTERVAL_MS);
}
