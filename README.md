# Playerok Table View

**English** | [Русский](#playerok-table-view--русский)

A browser extension (Firefox) that adds sales and item tables right into
your profile on [playerok.com](https://playerok.com) — with local history,
bulk actions and CSV export.

> Unofficial tool, not affiliated with playerok.com. The extension talks to
> the site's GraphQL API under your own browser session — no data is sent
> anywhere and everything is stored only on your machine.

## Features

- **Sales table** — full order history: dates, buyers, statuses, "Price"
  and "Income" columns, date/status filters, CSV export.
- **Items table** — active and completed items: views, sales count,
  prices; change a price right from the table.
- **Duplicate** an item into a draft (with photo re-upload or without),
  with a prompt for the copy's new price.
- **Publish** drafts, delisted and sold items in one click (free priority).
- **Auto-republish** — flag items with "Авто" and they get re-listed
  automatically as soon as they leave the active state. Works in the
  background on any open playerok tab — no need to open the overlay.
- **No manual setup** — your user id and API request hashes are detected
  automatically while you simply browse the site.
- Everything is local: data is cached in your browser's IndexedDB.

## Project structure

```
public/          static extension files (manifest.json, background.js, icons)
src/
  api/           playerok GraphQL client, queries and mutations
  content/       content-script entry point + overlay styles (Shadow DOM)
  db/            IndexedDB stores (sales, items)
  pages/         React pages: sales table, items table
  utils/         parameter auto-detection, formatting
  autoPublish.js background auto-republish daemon
dist/            build output
```

## Building from source

Requirements: [Node.js](https://nodejs.org) 20+ (build verified on Node 25 /
npm 11), any OS.

```bash
npm install
npm run build
```

The ready extension appears in the `dist/` folder (built by Vite: sources
from `src/` are bundled into `dist/content.js`, files from `public/` —
manifest, background.js, icons — are copied as is). To try it in a browser:

- **Firefox** — `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on* → `dist/manifest.json`;
- **Chrome** — `chrome://extensions` → enable developer mode →
  *Load unpacked* → the `dist` folder.

## License

[MIT](LICENSE)

---

# Playerok Table View — Русский

[English](#playerok-table-view) | **Русский**

Браузерное расширение (Firefox), которое добавляет
таблицы продаж и товаров прямо в профиль на
[playerok.com](https://playerok.com) — с локальной историей, массовыми
действиями и экспортом в CSV.

> Неофициальный инструмент, не связан с playerok.com. Расширение работает
> через GraphQL API сайта под вашей собственной сессией в браузере — данные
> никуда не отправляются и хранятся только у вас.

## Возможности

- **Таблица продаж** — вся история заказов: даты, покупатели, статусы,
  колонки «Цена» и «Доход», фильтры по датам и статусам, экспорт CSV.
- **Таблица товаров** — активные и завершённые товары: просмотры, число
  продаж, цены; смена цены прямо из таблицы.
- **Дублирование** товара в черновик (с перезаливкой фото или без),
  с запросом новой цены для копии.
- **Публикация** черновиков, снятых и проданных товаров в один клик
  (бесплатный приоритет).
- **Автопубликация** — отметьте товары флагом «Авто», и они будут
  автоматически выставляться заново, как только уходят из активных.
  Работает в фоне на любой открытой вкладке playerok — оверлей открывать
  не нужно.
- **Настройка без ручного ввода** — ваш user id и хэши API-запросов
  определяются автоматически, пока вы просто пользуетесь сайтом.
- Всё локально: данные кэшируются в IndexedDB вашего браузера.

## Структура проекта

```
public/          статические файлы расширения (manifest.json, background.js, иконки)
src/
  api/           GraphQL-клиент playerok, запросы и мутации
  content/       точка входа content-script + стили оверлея (Shadow DOM)
  db/            хранилища IndexedDB (продажи, товары)
  pages/         React-страницы: таблица продаж, таблица товаров
  utils/         автоопределение параметров, форматирование
  autoPublish.js фоновый daemon автопубликации
dist/            результат сборки
```

## Сборка из исходников

Требования: [Node.js](https://nodejs.org) 20+ (сборка проверена на Node 25 /
npm 11), любая ОС.

```bash
npm install
npm run build
```

Готовое расширение появляется в папке `dist/` (собирается Vite: исходники из
`src/` бандлятся в `dist/content.js`, файлы из `public/` — manifest,
background.js, иконки — копируются как есть). Для проверки в браузере:

- **Firefox** — `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on* → `dist/manifest.json`;
- **Chrome** — `chrome://extensions` → режим разработчика →
  *Загрузить распакованное* → папка `dist`.

## Лицензия

[MIT](LICENSE)
