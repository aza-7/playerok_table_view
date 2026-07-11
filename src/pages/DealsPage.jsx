import { useState, useEffect, useRef } from "react";
import { getSettings } from "../config.js";
import { fetchDealsList, fetchDealTimes, AuthError } from "../api/playerok.js";
import {
  upsertDeals,
  getAllDeals,
  getIdsMissingDealMeta,
  setDealMeta,
} from "../db/dealsStore.js";
import { formatDate } from "../utils/format.js";

const ALL_STATUSES = ["PAID", "CONFIRMED", "ROLLED_BACK", "SENT"];

// авто-обновление: свежие записи при открытии и фоном раз в интервал
const AUTO_REFRESH_COUNT = 15;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function DealsPage({ onAuthNeeded }) {
  const [statuses, setStatuses] = useState(["PAID"]);
  const [limit, setLimit] = useState("");
  const [loading, setLoading] = useState(false);
  const [deals, setDeals] = useState([]);
  const [timeLoading, setTimeLoading] = useState(false);
  const [timeProgress, setTimeProgress] = useState(null); // { done, total }
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const didInit = useRef(false);
  const loadingRef = useRef(false); // для интервала: не накладывать загрузки

  const handleStatusChange = (status) => {
    setStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  // Доход = цена − комиссия товара. feeMultiplier — доля комиссии из полного
  // запроса deal (0.1 = 10%, у части товаров выше), подтягивается кнопкой
  // «Получить дату и доход». Пока комиссии нет — null, колонка пустая
  // (никаких усреднённых прикидок).
  const calculateProfit = (price, feeMultiplier) => {
    const fee = Number(feeMultiplier);
    if (!Number.isFinite(fee) || fee <= 0 || fee >= 1) return null;
    return Math.floor(price - price * fee);
  };

  // загрузка заказов: playerok.com → IndexedDB → таблица
  // overrideLimit: авто-обновление качает только свежие записи,
  // ручное "Обновить" с пустым лимитом качает всю историю (limit 0 = все страницы);
  // silent — фоновое обновление не показывает alert при ошибке
  const fetchDeals = async (overrideLimit, { silent = false } = {}) => {
    if (loadingRef.current) return;
    try {
      loadingRef.current = true;
      setLoading(true);
      onAuthNeeded(false);

      const cfg = await getSettings();
      if (!cfg.userId || !cfg.dealsHash) {
        if (!silent) {
          alert(
            "Не заданы User ID / deals hash — откройте настройки (⚙) и нажмите «Определить автоматически»"
          );
        }
        return;
      }
      const { edges } = await fetchDealsList({
        userId: cfg.userId,
        limit: overrideLimit ?? (limit === "" ? 0 : Number(limit)),
        dealsHash: cfg.dealsHash,
      });

      await upsertDeals(edges);
      setDeals(await getAllDeals());
    } catch (error) {
      console.error(error);
      if (error instanceof AuthError) {
        onAuthNeeded(true);
      } else if (!silent) {
        alert("Ошибка загрузки: " + error.message);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // сбор дат для заказов без created_at: persisted-запрос deal по одному id
  // (как в старом бэкенде), пачками по 40 параллельно
  const fetchDealsTime = async () => {
    try {
      setTimeLoading(true);
      onAuthNeeded(false);

      const cfg = await getSettings();
      if (!cfg.dealHash) {
        alert(
          "Не задан deal hash — откройте настройки (⚙) и нажмите «Определить автоматически»"
        );
        return;
      }
      const ids = await getIdsMissingDealMeta();

      if (ids.length === 0) {
        setDeals(await getAllDeals());
        return;
      }

      let done = 0;
      setTimeProgress({ done: 0, total: ids.length });

      await fetchDealTimes(ids, cfg.dealHash, async ({ id, createdAt, feeMultiplier, error }) => {
        if (error instanceof AuthError) throw error;
        if (error) {
          console.error(`deal ${id}:`, error); // пропускаем, дата останется пустой
        } else {
          await setDealMeta(id, { createdAt, feeMultiplier });
        }
        done += 1;
        setTimeProgress({ done, total: ids.length });
        if (done % 10 === 0) {
          setDeals(await getAllDeals());
        }
      });

      setDeals(await getAllDeals());
    } catch (err) {
      console.error(err);
      if (err instanceof AuthError) onAuthNeeded(true);
    } finally {
      setTimeLoading(false);
      setTimeProgress(null);
    }
  };

  // Экспорт в CSV (UTF-8 с BOM)
  const exportToCSV = () => {
    const rows = [
      [
        "Товар",
        "ID заказа",
        "Дата",
        "Покупатель",
        "Статус",
        "Цена",
        "Доход"
      ]
    ];

    // Только сделки со статусом не ROLLED_BACK, и в порядке снизу-вверх (реверс)
    const toExport = filteredDeals
      .filter((d) => d.node.status !== "ROLLED_BACK")
      .slice()
      .reverse();

    toExport.forEach((deal) => {
      const item = deal.node.item || {};
      const user = deal.node.user || {};
      const price = Number(item.price) || 0;

      const sanitize = (v) => String(v ?? "").replace(/[\r\n;]/g, " ");

      rows.push([
        sanitize(item.name),
        sanitize(deal.node.id),
        sanitize(formatDate(deal.node.createdAt)),
        sanitize(user.username),
        sanitize(deal.node.status),
        sanitize(price),
        sanitize(calculateProfit(price, item.feeMultiplier) ?? "")
      ]);
    });

    // Используем разделитель ';' и без кавычек
    const csvContent = rows.map((r) => r.join(";")).join("\r\n");

    const bom = "﻿"; // UTF-8 BOM
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deals.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!didInit.current) {
      // StrictMode double-invoke guard — только для стартовой загрузки
      didInit.current = true;
      (async () => {
        // мгновенный рендер из кэша, затем фоновое обновление с сервера
        setDeals(await getAllDeals());
        fetchDeals(AUTO_REFRESH_COUNT); // только свежие записи при открытии
      })();
    }

    // периодическое фоновое обновление свежих записей без участия юзера
    const timer = setInterval(
      () => fetchDeals(AUTO_REFRESH_COUNT, { silent: true }),
      AUTO_REFRESH_MS
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredDeals = deals.filter((deal) => {
    // фильтр по статусу
    if (
      statuses.length > 0 &&
      !statuses.includes(deal.node.status)
    ) {
      return false;
    }

    const dealDate = new Date(deal.node.createdAt);

    if (dateFrom) {
      const from = new Date(dateFrom);
      if (dealDate < from) return false;
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (dealDate > to) return false;
    }

    return true;
  });

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
                {ALL_STATUSES.map((status) => (
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

          <button className="fetch-btn" onClick={() => fetchDeals()}>
            {loading ? "Загрузка..." : "Обновить"}
          </button>

          <button
            className="fetch-btn"
            onClick={fetchDealsTime}
            disabled={timeLoading}
          >
            {timeLoading
              ? timeProgress
                ? `Загрузка: ${timeProgress.done}/${timeProgress.total}`
                : "Загрузка..."
              : "Получить дату и доход"}
          </button>
          <button
            className="fetch-btn"
            onClick={exportToCSV}
            disabled={filteredDeals.length === 0}
          >
            Экспорт CSV
          </button>
        </div>
      </div>

      <h2 className="section-title">Продажи ({filteredDeals.length})</h2>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>ID заказа</th>
              <th>Дата</th>
              <th>Покупатель</th>
              <th>Статус</th>
              <th>Цена</th>
              <th>Доход</th>
            </tr>
          </thead>

          <tbody>
            {filteredDeals.map((deal) => {
              const item = deal.node.item;
              const user = deal.node.user;
              const profit = calculateProfit(
                item?.price || 0,
                item?.feeMultiplier
              );

              return (
                <tr key={deal.node.id}>
                  <td>
                    <a
                      href={`https://playerok.com/deal/${deal.node.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="deal-link"
                    >
                      {item?.name}
                    </a>
                  </td>
                  <td>
                    <a
                      href={`https://playerok.com/deal/${deal.node.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="deal-link"
                    >
                      {deal.node.id}
                    </a>
                  </td>
                  <td>
                    <a
                      href={`https://playerok.com/deal/${deal.node.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="deal-link"
                    >
                      {formatDate(deal.node.createdAt)}
                    </a>
                  </td>
                  <td>
                    <a
                      href={`https://playerok.com/deal/${deal.node.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="deal-link"
                    >
                      {user?.username}
                    </a>
                  </td>

                  <td>
                    <span
                      className={
                        deal.node.status === "PAID"
                          ? "status paid"
                          : deal.node.status === "CONFIRMED"
                          ? "status confirmed"
                          : deal.node.status === "ROLLED_BACK"
                          ? "status rolled-back"
                          : "status sent"
                      }
                    >
                      {deal.node.status}
                    </span>
                  </td>

                  <td>
                    <a
                      href={`https://playerok.com/deal/${deal.node.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="deal-link"
                    >
                      {item?.price} ₽
                    </a>
                  </td>

                  <td>
                    <a
                      href={`https://playerok.com/deal/${deal.node.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="deal-link"
                    >
                      {profit != null ? `${profit} ₽` : ""}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default DealsPage;
