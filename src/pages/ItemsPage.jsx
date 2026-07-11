import { useState, useEffect, useRef } from "react";
import { getSettings } from "../config.js";
import {
  fetchItemsList,
  updateItemPrice,
  removeItem,
  duplicateItem,
  publishItem,
  AuthError,
} from "../api/playerok.js";
import {
  upsertItems,
  getAllItems,
  setItemPrice,
  setItemsAuto,
  deleteItemLocal,
} from "../db/itemsStore.js";
import { getAllDeals } from "../db/dealsStore.js";
import { parsePriceToInt } from "../db/db.js";
import { runAutoPublish } from "../autoPublish.js";
import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  ALL_STATUSES,
  PUBLISHABLE_STATUSES,
} from "../itemStatuses.js";
import {
  IconDuplicate,
  IconDuplicateNoPhoto,
  IconPublish,
  IconSave,
  IconTrash,
} from "../icons.jsx";

const STATUS_CLASS = {
  APPROVED: "item-approved",
  PENDING_MODERATION: "item-pending",
  PENDING_APPROVAL: "item-pending",
  SOLD: "item-sold",
  DECLINED: "item-declined",
  BLOCKED: "item-declined",
  EXPIRED: "item-expired",
  DRAFT: "item-draft",
  DISCONTINUED: "item-expired",
};

// авто-обновление: свежие записи при открытии и фоном раз в интервал
const AUTO_REFRESH_COUNT = 15;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function itemUrl(node) {
  return node.slug ? `https://playerok.com/products/${node.slug}` : null;
}

function ItemsTable({
  items,
  salesByName,
  newPrices,
  savingIds,
  busyIds,
  onNewPriceChange,
  onSavePrice,
  onDuplicate,
  onPublish,
  onDelete,
  onAutoToggle,
}) {
  const allAuto = items.length > 0 && items.every((item) => item.auto);

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>ID</th>
            <th>Статус</th>
            <th>Просмотры</th>
            <th>Продажи</th>
            <th>Raw price</th>
            <th>Цена</th>
            <th>Новая цена</th>
            <th
              className="auto-col"
              title="Автопубликация: товар выставляется заново, когда уходит из активных. Чекбокс в шапке — выбрать все."
            >
              <label className="auto-label">
                Авто
                <input
                  type="checkbox"
                  checked={allAuto}
                  onChange={(e) =>
                    onAutoToggle(
                      items.map((item) => item.node.id),
                      e.target.checked
                    )
                  }
                />
              </label>
            </th>
            <th>Действия</th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => {
            const node = item.node;
            const url = itemUrl(node);
            const isSaving = savingIds.has(node.id);
            const isBusy = busyIds.has(node.id);
            const newPrice = newPrices[node.id] ?? "";

            const cell = (content) =>
              url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="deal-link"
                >
                  {content}
                </a>
              ) : (
                content
              );

            return (
              <tr key={node.id}>
                <td>{cell(node.name)}</td>
                <td>{cell(node.id)}</td>
                <td>
                  <span
                    className={`status ${STATUS_CLASS[node.status] ?? "item-expired"}`}
                  >
                    {node.status}
                  </span>
                </td>
                <td>{cell(node.views ?? "")}</td>
                <td>{cell(salesByName[node.name] ?? 0)}</td>
                <td>
                  {cell(
                    node.rawPrice != null ? (
                      <span className="raw-price">{node.rawPrice} ₽</span>
                    ) : (
                      ""
                    )
                  )}
                </td>
                <td>{cell(`${node.price} ₽`)}</td>
                <td>
                  <div className="price-edit">
                    <input
                      className="limit-input price-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="₽"
                      value={newPrice}
                      onChange={(e) => onNewPriceChange(node.id, e.target.value)}
                    />
                    <button
                      className="fetch-btn save-btn"
                      title="Сохранить цену на playerok"
                      disabled={!newPrice || isSaving}
                      onClick={() => onSavePrice(node.id)}
                    >
                      {isSaving ? "..." : <IconSave />}
                    </button>
                  </div>
                </td>
                <td className="auto-col">
                  <input
                    type="checkbox"
                    title="Автопубликация"
                    checked={Boolean(item.auto)}
                    onChange={(e) => onAutoToggle([node.id], e.target.checked)}
                  />
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="fetch-btn action-btn"
                      title="Дублировать с фото"
                      disabled={isBusy}
                      onClick={() => onDuplicate(node.id, true)}
                    >
                      <IconDuplicate />
                    </button>
                    <button
                      className="fetch-btn action-btn"
                      title="Дублировать без фото"
                      disabled={isBusy}
                      onClick={() => onDuplicate(node.id, false)}
                    >
                      <IconDuplicateNoPhoto />
                    </button>
                    <button
                      className="fetch-btn action-btn action-danger"
                      title="Удалить на playerok"
                      disabled={isBusy}
                      onClick={() => onDelete(node.id)}
                    >
                      {isBusy ? "…" : <IconTrash />}
                    </button>
                    {PUBLISHABLE_STATUSES.includes(node.status) && (
                      <button
                        className="fetch-btn action-btn"
                        title="Опубликовать на playerok"
                        disabled={isBusy}
                        onClick={() => onPublish(node.id)}
                      >
                        <IconPublish />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ItemsPage({ onAuthNeeded }) {
  const [statuses, setStatuses] = useState(ALL_STATUSES);
  const [limit, setLimit] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [newPrices, setNewPrices] = useState({});
  const [savingIds, setSavingIds] = useState(new Set());
  const [busyIds, setBusyIds] = useState(new Set());
  const [salesByName, setSalesByName] = useState({});
  const [loadedCount, setLoadedCount] = useState(0);
  const didInit = useRef(false);
  const loadingRef = useRef(false); // для интервала: не накладывать загрузки

  const markBusy = (id, busy) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  // удаляет товар на playerok (removeItem, необратимо), затем из кэша;
  // при включённой настройке quickDelete — сразу, без подтверждения
  const handleDeleteItem = async (id) => {
    const cfg = await getSettings();
    if (
      !cfg.quickDelete &&
      !confirm("Удалить товар на playerok? Действие необратимо.")
    ) {
      return;
    }
    try {
      markBusy(id, true);
      onAuthNeeded(false);
      await removeItem(id);
      await deleteItemLocal(id);
      setItems(await getAllItems());
    } catch (error) {
      console.error(error);
      if (error instanceof AuthError) onAuthNeeded(true);
      else alert("Ошибка удаления: " + error.message);
    } finally {
      markBusy(id, false);
    }
  };

  // создаёт черновик-копию товара (с фото или без); при включённой
  // настройке askPriceOnDuplicate спрашивает цену копии (по умолчанию —
  // цена оригинала), иначе копирует товар как есть
  const handleDuplicateItem = async (id, withImages) => {
    let price = null;
    const cfg = await getSettings();
    if (cfg.askPriceOnDuplicate) {
      const node = items.find((it) => it.node.id === id)?.node;
      const original = node?.price ?? node?.rawPrice ?? "";
      const answer = prompt(
        `Цена оригинала: ${original} ₽\nВведите цену для копии:`,
        String(original)
      );
      if (answer === null) return; // отмена — не дублируем
      price = parsePriceToInt(answer);
      if (price <= 0) {
        alert("Некорректная цена: " + answer);
        return;
      }
    }

    try {
      markBusy(id, true);
      onAuthNeeded(false);
      const created = await duplicateItem(id, { withImages, price });
      if (created) {
        await upsertItems([{ node: created }]);
        setItems(await getAllItems());
      }
      alert(
        "Создан черновик-копия" +
          (withImages ? " с фото" : " без фото") +
          (price != null ? `, цена ${price} ₽` : "")
      );
    } catch (error) {
      console.error(error);
      if (error instanceof AuthError) onAuthNeeded(true);
      else alert("Ошибка дублирования: " + error.message);
    } finally {
      markBusy(id, false);
    }
  };

  // публикует черновик/снятый товар (бесплатный приоритет), затем
  // обновляет запись в кэше свежим статусом
  const handlePublishItem = async (id) => {
    try {
      markBusy(id, true);
      onAuthNeeded(false);
      const node = items.find((it) => it.node.id === id)?.node;
      const published = await publishItem(id, node?.price ?? node?.rawPrice);
      if (published) {
        await upsertItems([{ node: published }]);
        setItems(await getAllItems());
      }
      alert("Товар опубликован");
    } catch (error) {
      console.error(error);
      if (error instanceof AuthError) onAuthNeeded(true);
      else alert("Ошибка публикации: " + error.message);
    } finally {
      markBusy(id, false);
    }
  };

  // флаг «Авто» для одного или всех товаров таблицы; после включения сразу
  // прогоняем автопубликацию (модуль коалесцирует параллельные вызовы —
  // быстрые клики по нескольким чекбоксам обработаются одним проходом)
  const handleAutoToggle = async (ids, on) => {
    await setItemsAuto(ids, on);
    setItems(await getAllItems());
    if (on) {
      runAutoPublish()
        .then(async () => setItems(await getAllItems()))
        .catch(console.error);
    }
  };

  // объём продаж по товару из БД сделок: только CONFIRMED и SENT,
  // сопоставление по названию товара (item_name)
  const loadSalesVolume = async () => {
    const deals = await getAllDeals();
    const counts = {};
    for (const d of deals) {
      const status = d.node.status;
      if (status !== "CONFIRMED" && status !== "SENT") continue;
      const name = d.node.item?.name;
      if (!name) continue;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    setSalesByName(counts);
  };

  const handleNewPriceChange = (id, value) => {
    // разрешаем только цифры и пустую строку
    if (/^\d*$/.test(value)) {
      setNewPrices((prev) => ({ ...prev, [id]: value }));
    }
  };

  // меняет цену товара на playerok (мутация updateItem), затем обновляет кэш
  const handleSavePrice = async (id) => {
    const value = Number(newPrices[id]);
    if (!value) return;

    try {
      setSavingIds((prev) => new Set(prev).add(id));
      onAuthNeeded(false);

      const updated = await updateItemPrice(id, value);
      await setItemPrice(id, updated?.price ?? value);
      setItems(await getAllItems());
      setNewPrices((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error(error);
      if (error instanceof AuthError) {
        onAuthNeeded(true);
      } else {
        alert("Ошибка изменения цены: " + error.message);
      }
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleStatusChange = (status) => {
    setStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  // товары: активные, затем завершённые, постранично → IndexedDB → таблицы.
  // Каждая скачанная страница сразу пишется в базу и появляется в таблице
  // (rate-limiter в api сам выдерживает паузы, 429 не всплывает).
  // overrideLimit: авто-обновление качает только свежие записи,
  // ручное "Обновить" с пустым лимитом качает всё (limit 0 = все страницы);
  // silent — фоновое обновление не показывает alert при ошибке
  const fetchItems = async (overrideLimit, { silent = false } = {}) => {
    if (loadingRef.current) return; // уже идёт загрузка — не накладываемся
    try {
      loadingRef.current = true;
      setLoading(true);
      setLoadedCount(0);
      onAuthNeeded(false);

      const cfg = await getSettings();
      if (!cfg.userId || !cfg.itemsHash) {
        if (!silent) {
          alert(
            "Не заданы User ID / items hash — откройте настройки (⚙) и нажмите «Определить автоматически»"
          );
        }
        return;
      }
      const first = overrideLimit ?? (limit === "" ? 0 : Number(limit));

      let fetched = 0;
      const onPage = async (edges) => {
        await upsertItems(edges);
        setItems(await getAllItems());
        fetched += edges.length;
        setLoadedCount(fetched);
      };

      for (const groupStatuses of [ACTIVE_STATUSES, COMPLETED_STATUSES]) {
        await fetchItemsList({
          userId: cfg.userId,
          statuses: groupStatuses,
          limit: first,
          itemsHash: cfg.itemsHash,
          onPage,
        });
      }

      // свежие статусы получены — переиздаём помеченные «Авто» неактивные
      await runAutoPublish();
      setItems(await getAllItems());
    } catch (error) {
      console.error(error);
      if (error instanceof AuthError) {
        onAuthNeeded(true);
      } else if (!silent) {
        alert("Ошибка загрузки товаров: " + error.message);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadedCount(0);
    }
  };

  useEffect(() => {
    if (!didInit.current) {
      // StrictMode double-invoke guard — только для стартовой загрузки
      didInit.current = true;
      (async () => {
        // мгновенный рендер из кэша, затем фоновое обновление с сервера
        setItems(await getAllItems());
        loadSalesVolume();

        fetchItems(AUTO_REFRESH_COUNT); // только свежие записи при открытии
      })();
    }

    // периодическое фоновое обновление свежих записей без участия юзера
    const timer = setInterval(
      () => fetchItems(AUTO_REFRESH_COUNT, { silent: true }),
      AUTO_REFRESH_MS
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Экспорт в CSV (UTF-8 с BOM), тот же формат что и в продажах
  const exportToCSV = () => {
    const rows = [
      ["Товар", "ID", "Статус", "Просмотры", "Продажи", "Raw price", "Цена"],
    ];

    const sanitize = (v) => String(v ?? "").replace(/[\r\n;]/g, " ");

    filteredItems.forEach((item) => {
      const n = item.node;
      rows.push([
        sanitize(n.name),
        sanitize(n.id),
        sanitize(n.status),
        sanitize(n.views),
        sanitize(salesByName[n.name] ?? 0),
        sanitize(n.rawPrice),
        sanitize(n.price),
      ]);
    });

    const csvContent = rows.map((r) => r.join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "items.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const filteredItems = items.filter((item) => {
    if (statuses.length > 0 && !statuses.includes(item.node.status)) {
      return false;
    }

    if (!dateFrom && !dateTo) return true;

    const itemDate = new Date(item.node.createdAt);

    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!item.node.createdAt || itemDate < from) return false;
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (!item.node.createdAt || itemDate > to) return false;
    }

    return true;
  });

  const activeItems = filteredItems.filter((i) =>
    ACTIVE_STATUSES.includes(i.node.status)
  );
  const completedItems = filteredItems.filter(
    (i) => !ACTIVE_STATUSES.includes(i.node.status)
  );

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="limit-input"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="limit-input"
          />

          <button
            className="fetch-btn"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            Сброс
          </button>

          <div className="status-dropdown">
            <button
              type="button"
              className="status-dropdown-btn"
              onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
            >
              Статусы ({statuses.length})
              <span className={`arrow ${statusDropdownOpen ? "open" : ""}`}>
                ▼
              </span>
            </button>

            {statusDropdownOpen && (
              <div className="status-dropdown-menu">
                <div className="status-group-label">Активные</div>
                {ACTIVE_STATUSES.map((status) => (
                  <label key={status} className="status-option">
                    <input
                      type="checkbox"
                      checked={statuses.includes(status)}
                      onChange={() => handleStatusChange(status)}
                    />
                    <span>{status}</span>
                  </label>
                ))}
                <div className="status-group-label">Завершённые</div>
                {COMPLETED_STATUSES.map((status) => (
                  <label key={status} className="status-option">
                    <input
                      type="checkbox"
                      checked={statuses.includes(status)}
                      onChange={() => handleStatusChange(status)}
                    />
                    <span>{status}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="controls">
          <input
            className="limit-input"
            type="text"
            inputMode="numeric"
            value={limit}
            onChange={(e) => {
              const value = e.target.value;

              // разрешаем только цифры и пустую строку
              if (/^\d*$/.test(value)) {
                setLimit(value);
              }
            }}
          />

          <button className="fetch-btn" onClick={() => fetchItems()} disabled={loading}>
            {loading
              ? loadedCount > 0
                ? `Загрузка… ${loadedCount}`
                : "Загрузка…"
              : "Обновить"}
          </button>

          <button
            className="fetch-btn"
            onClick={exportToCSV}
            disabled={filteredItems.length === 0}
          >
            Экспорт CSV
          </button>
        </div>
      </div>

      <h2 className="section-title">Активные ({activeItems.length})</h2>
      <ItemsTable
        items={activeItems}
        salesByName={salesByName}
        newPrices={newPrices}
        savingIds={savingIds}
        busyIds={busyIds}
        onNewPriceChange={handleNewPriceChange}
        onSavePrice={handleSavePrice}
        onDuplicate={handleDuplicateItem}
        onPublish={handlePublishItem}
        onDelete={handleDeleteItem}
        onAutoToggle={handleAutoToggle}
      />

      <h2 className="section-title">Завершённые ({completedItems.length})</h2>
      <ItemsTable
        items={completedItems}
        salesByName={salesByName}
        newPrices={newPrices}
        savingIds={savingIds}
        busyIds={busyIds}
        onNewPriceChange={handleNewPriceChange}
        onSavePrice={handleSavePrice}
        onDuplicate={handleDuplicateItem}
        onPublish={handlePublishItem}
        onDelete={handleDeleteItem}
        onAutoToggle={handleAutoToggle}
      />
    </>
  );
}

export default ItemsPage;
