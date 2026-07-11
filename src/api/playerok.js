import { UPDATE_ITEM_MUTATION } from './updateItemMutation.js';
import { CREATE_ITEM_MUTATION } from './createItemMutation.js';
import { PUBLISH_ITEM_MUTATION } from './publishItemMutation.js';
import { REMOVE_ITEM_MUTATION } from './removeItemMutation.js';
import { ITEM_QUERY } from './itemQuery.js';
import { parsePriceToInt } from '../db/db.js';
import { ext } from '../ext/browser.js';

const GRAPHQL_URL = 'https://playerok.com/graphql';

const HEADERS = {
  Accept: '*/*',
  'x-gql-op': 'deals',
  'x-gql-path': '/profile/[username]/sales',
  'x-timezone-offset': '-300',
  'apollo-require-preflight': 'true',
  'apollographql-client-name': 'web',
};

export class AuthError extends Error {
  constructor(message = 'Not authenticated on playerok.com') {
    super(message);
    this.name = 'AuthError';
  }
}

function throwIfAuthError(status, json) {
  if (status === 401 || status === 403) throw new AuthError();

  const errors = json?.errors;
  if (!Array.isArray(errors)) return;

  const isAuth = errors.some((e) => {
    const code = e?.extensions?.code ?? '';
    return (
      code === 'UNAUTHENTICATED' ||
      code === 'FORBIDDEN' ||
      /unauth|forbidden|not.?logged/i.test(e?.message ?? '')
    );
  });
  if (isAuth) throw new AuthError();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── глобальный rate-limiter
const MAX_RATE_LIMIT_RETRIES = 5;
const DEFAULT_RESET_SECONDS = 10;

let pauseUntil = 0;
let queue = Promise.resolve();

function noteRateLimitHeaders(response) {
  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  if (remaining === 0) {
    const reset =
      Number(response.headers.get('x-ratelimit-reset')) || DEFAULT_RESET_SECONDS;
    pauseUntil = Math.max(pauseUntil, Date.now() + reset * 1000);
  }
}

async function rateLimitedFetch(url, options, { queued = true } = {}) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = pauseUntil - Date.now();
      if (wait > 0) await sleep(wait);

      const response = await fetch(url, options);
      noteRateLimitHeaders(response);

      if (response.status !== 429) return response;
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error('превышен лимит запросов playerok (429), попробуйте позже');
      }

      const reset =
        Number(response.headers.get('x-ratelimit-reset')) || DEFAULT_RESET_SECONDS;
      pauseUntil = Math.max(pauseUntil, Date.now() + reset * 1000);
    }
  };

  if (!queued) return run();

  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

async function gqlGet(operationName, variables, sha256Hash, { queued = true } = {}) {
  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash },
    }),
  });

  const response = await rateLimitedFetch(
    `${GRAPHQL_URL}?${params}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: { ...HEADERS, 'x-gql-op': operationName },
    },
    { queued }
  );

  return parseGqlResponse(response);
}

async function parseGqlResponse(response) {
  return parseGqlText(response.status, response.ok, await response.text());
}

function parseGqlText(status, ok, text) {
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body (e.g. HTML error page) — fall through to status checks
  }

  throwIfAuthError(status, json);

  if (!ok) {
    const serverMsg = json?.message || json?.errors?.[0]?.message;
    throw new Error(
      `playerok.com responded with HTTP ${status}${serverMsg ? `: ${serverMsg}` : ''}`
    );
  }
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message ?? 'GraphQL error');
  }

  return json?.data ?? {};
}

async function postGraphqlJson(
  operationName,
  query,
  variables,
  xGqlPath,
  { queued = true } = {}
) {
  const response = await rateLimitedFetch(
    GRAPHQL_URL,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json',
        'x-gql-op': operationName,
        'x-gql-path': xGqlPath,
      },
      body: JSON.stringify({ operationName, query, variables }),
    },
    { queued }
  );
  return parseGqlResponse(response);
}

// GraphQL multipart (graphql-multipart-request-spec) для загрузки картинок
async function postGraphqlMultipart(operationName, query, variables, files, xGqlPath) {
  const operations = { operationName, query, variables };
  const map = {};
  files.forEach((_, i) => {
    map[String(i + 1)] = [`variables.attachments.${i}`];
  });

  const form = new FormData();
  form.append('operations', JSON.stringify(operations));
  form.append('map', JSON.stringify(map));
  files.forEach((f, i) => form.append(String(i + 1), f.blob, f.filename));

  const response = await rateLimitedFetch(GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { ...HEADERS, 'x-gql-op': operationName, 'x-gql-path': xGqlPath },
    body: form,
  });
  return parseGqlResponse(response);
}

export async function updateItemPrice(id, price) {
  const data = await postGraphqlJson(
    'updateItem',
    UPDATE_ITEM_MUTATION,
    { addedAttachments: null, input: { id, price } },
    '/products/[slug]/edit'
  );
  return data?.updateItem ?? null;
}

// Хэш persisted-запроса itemPriorityStatuses — не секрет, виден в каждом
// запросе страницы публикации playerok.com (как deals/items хэши).
const ITEM_PRIORITY_STATUSES_HASH =
  'b922220c6f979537e1b99de6af8f5c13727daeff66727f679f07f986ce1c025a';

async function fetchFreePriorityStatusId(itemId, price) {
  const data = await gqlGet(
    'itemPriorityStatuses',
    { itemId, price },
    ITEM_PRIORITY_STATUSES_HASH
  );
  const statuses = data?.itemPriorityStatuses ?? [];
  const free =
    statuses.find((s) => s?.type === 'DEFAULT') ??
    statuses.find((s) => !s?.price);
  if (!free?.id) {
    throw new Error('не найден бесплатный статус публикации');
  }
  return free.id;
}

// Публикует черновик/снятый товар: бесплатный приоритет, оплата LOCAL (баланс)
export async function publishItem(id, price) {
  const priorityStatusId = await fetchFreePriorityStatusId(
    id,
    parsePriceToInt(price)
  );
  const data = await postGraphqlJson(
    'publishItem',
    PUBLISH_ITEM_MUTATION,
    {
      input: {
        itemId: id,
        priorityStatuses: [priorityStatusId],
        transactionProviderId: 'LOCAL',
      },
    },
    '/products/[slug]/edit'
  );
  return data?.publishItem ?? null;
}

// Полностью удаляет товар в аккаунте playerok (необратимо)
export async function removeItem(id) {
  const data = await postGraphqlJson(
    'removeItem',
    REMOVE_ITEM_MUTATION,
    { id, showForbiddenImage: true },
    '/products/[slug]/edit'
  );
  return data?.removeItem ?? null;
}

// Полные данные товара (категория, тип получения, поля, атрибуты, вложения)
async function fetchItemFull(id) {
  const data = await postGraphqlJson(
    'item',
    ITEM_QUERY,
    { id, hasSupportAccess: false, showForbiddenImage: true },
    '/products/[slug]'
  );
  return data?.item ?? null;
}

function buildCreateInput(full) {
  const dataFields = (full.dataFields ?? [])
    .filter((f) => f.value != null && f.type !== 'OBTAINING_DATA')
    .map((f) => ({ fieldId: f.id, value: f.value }));

  return {
    gameCategoryId: full.category?.id,
    obtainingTypeId: full.obtainingType?.id,
    name: full.name,
    price: parsePriceToInt(full.price ?? full.rawPrice),
    description: full.description ?? '',
    attributes: full.attributes ?? {},
    dataFields,
  };
}

// Картинки товара качает фоновый скрипт (обходит CORS i.playerok.com) и
// возвращает base64 → пересобираем Blob.
async function fetchImageBlob(url) {
  const resp = await ext.runtime.sendMessage({ type: 'pk-fetch-image', url });
  if (!resp?.ok) throw new Error(resp?.error || 'image fetch failed');
  const bin = atob(resp.base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: resp.contentType });
}

async function loadAttachmentFiles(full) {
  const attachments = full.attachments ?? [];
  const files = [];
  const errors = [];
  for (let i = 0; i < attachments.length; i++) {
    const url = attachments[i]?.url;
    if (!url) continue;
    try {
      const blob = await fetchImageBlob(url);
      let name = url.split('?')[0].split('/').pop() || `image_${i + 1}`;
      if (!name.includes('.')) name += '.jpg';
      files.push({ blob, filename: name });
    } catch (err) {
      console.error('фото не скачалось:', url, err);
      errors.push(err);
    }
  }
  return { files, errors };
}

// playerok требует хотя бы одно изображение — чёрный плейсхолдер как запасной
function makePlaceholderFile() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => resolve({ blob, filename: 'placeholder.png' }),
      'image/png'
    );
  });
}

// Дублирует товар: тянет полные данные и создаёт новый черновик через createItem
// (multipart, т.к. хотя бы одно изображение обязательно; Upload принимает только
// файл — сослаться на существующий URL/id вложения API не позволяет).
// withImages=true — перезаливает фото товара, при провале скачивания бросает
// ошибку; без фото (или withImages=false) используется чёрный плейсхолдер.
// price — цена копии; не задана → цена оригинала.
export async function duplicateItem(id, { withImages, price = null }) {
  const full = await fetchItemFull(id);
  if (!full) throw new Error('товар не найден');

  const input = buildCreateInput(full);
  if (price != null) input.price = price;
  if (!input.gameCategoryId || !input.obtainingTypeId) {
    throw new Error('нет категории/типа получения — дублирование недоступно');
  }

  let files = [];
  if (withImages) {
    const { files: loaded, errors } = await loadAttachmentFiles(full);
    if (loaded.length === 0 && errors.length > 0) {
      throw new Error(
        `фото не скачались: ${errors[0]?.message ?? errors[0]}` +
          ' — попробуйте «дублировать без фото»'
      );
    }
    files = loaded;
  }
  if (files.length === 0) {
    files = [await makePlaceholderFile()];
  }

  const data = await postGraphqlMultipart(
    'createItem',
    CREATE_ITEM_MUTATION,
    { input, attachments: files.map(() => null) },
    files,
    '/item/create'
  );
  return data?.createItem ?? null;
}

// Запрос items отклоняет first > 24 (HTTP 403), поэтому товары качаем
// курсорной пагинацией страницами по 24 (limit = 0 → все страницы).
// Запрос deals принимает большие first (проверено на 2000) — он идёт одним запросом.
const PAGE_SIZE = 24;

async function fetchAllEdges(
  operationName,
  rootField,
  baseVariables,
  hash,
  limit,
  onPage
) {
  const edges = [];
  let after = null;

  for (;;) {
    const first =
      limit > 0 ? Math.min(PAGE_SIZE, limit - edges.length) : PAGE_SIZE;
    if (first <= 0) break;

    const variables = {
      ...baseVariables,
      pagination: after ? { first, after } : { first },
    };

    const data = await gqlGet(operationName, variables, hash);
    const connection = data?.[rootField] ?? {};
    const pageEdges = connection.edges ?? [];
    edges.push(...pageEdges);

    if (pageEdges.length > 0) {
      await onPage?.(pageEdges);
    }

    const pageInfo = connection.pageInfo ?? {};
    after = pageInfo.endCursor ?? null;
    if (!pageInfo.hasNextPage || !after || pageEdges.length === 0) break;
  }

  return edges;
}

export async function fetchDealsList({ userId, limit, dealsHash }) {
  const data = await gqlGet(
    'deals',
    {
      pagination: { first: limit },
      filter: {
        userId,
        direction: 'OUT',
        status: ['PAID', 'SENT', 'CONFIRMED', 'ROLLED_BACK'],
      },
      showForbiddenImage: true,
    },
    dealsHash
  );

  const deals = data?.deals ?? {};
  return { edges: deals.edges ?? [] };
}

export async function fetchItemsList({ userId, statuses, limit, itemsHash, onPage }) {
  const edges = await fetchAllEdges(
    'items',
    'items',
    {
      filter: { userId, status: statuses, withOfficial: false },
      showForbiddenImage: true,
    },
    itemsHash,
    limit,
    onPage
  );
  return { edges };
}

// Один заказ, persisted-запрос deal — единственный формат, который принимает
// сервер (полнотекстовый/алиасный запрос deal отвечает HTTP 500)
export async function fetchDeal(id, dealHash, { queued = true } = {}) {
  const data = await gqlGet(
    'deal',
    { id, hasSupportAccess: false, showForbiddenImage: true },
    dealHash,
    { queued }
  );
  return data?.deal ?? null;
}

// массовая догрузка дат заказов
// Формат запроса тот же, что в старом бэкенде (persisted deal, по одному id),
// но пачка из 40 запросов уходит параллельно, между
// пачками пауза 2с. Через общую очередь то же шло бы строго по одному и на
// порядок дольше.
const DEAL_TIME_BATCH_SIZE = 40;
const DEAL_TIME_BATCH_PAUSE_MS = 2000;

// onResult({id, createdAt, error}) вызывается по каждому заказу по мере
// готовности пачки; throw из onResult (например AuthError) прерывает обход.
export async function fetchDealTimes(ids, dealHash, onResult) {
  for (let offset = 0; offset < ids.length; offset += DEAL_TIME_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + DEAL_TIME_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const deal = await fetchDeal(id, dealHash, { queued: false });
          return {
            id,
            createdAt: deal?.createdAt ?? null,
            // комиссия товара — для точного расчёта дохода по каждой сделке
            feeMultiplier: deal?.item?.feeMultiplier ?? null,
            error: null,
          };
        } catch (error) {
          return { id, createdAt: null, feeMultiplier: null, error };
        }
      })
    );
    for (const result of results) {
      await onResult(result);
    }

    if (offset + DEAL_TIME_BATCH_SIZE < ids.length) {
      await sleep(DEAL_TIME_BATCH_PAUSE_MS);
    }
  }
}

