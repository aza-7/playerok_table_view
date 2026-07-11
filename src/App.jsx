import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "./config.js";
import { detectPlayerokParams } from "./utils/detectParams.js";
import { IconTrash, IconGear, IconClose } from "./icons.jsx";
import { clearStore } from "./db/db.js";
import DealsPage from "./pages/DealsPage.jsx";
import ItemsPage from "./pages/ItemsPage.jsx";

function App({ initialTab = "sales", onClose }) {
  const [tab, setTab] = useState(initialTab);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [detectStatus, setDetectStatus] = useState("");
  const [itemsVersion, setItemsVersion] = useState(0);
  const [dealsVersion, setDealsVersion] = useState(0);

  // чистит базу только активной вкладки: товары или продажи
  const handleClearDatabase = async () => {
    const isItems = tab === "items";
    const label = isItems ? "товаров" : "продаж";
    if (!confirm(`Удалить локальную базу ${label}?`)) return;
    await clearStore(isItems ? "items" : "deals");
    // remount только очищенной страницы: пустая таблица + свежая подгрузка
    if (isItems) setItemsVersion((v) => v + 1);
    else setDealsVersion((v) => v + 1);
  };

  useEffect(() => {
    getSettings().then((cfg) => {
      setSettings(cfg);
      // на первом запуске панель открыта, дальше — как юзер оставил
      setSettingsOpen(Boolean(cfg.settingsPanelOpen ?? true));
    });
  }, []);

  const PARAM_KEYS = ["userId", "dealsHash", "dealHash", "itemsHash"];
  const missingParams = settings
    ? PARAM_KEYS.filter((k) => !settings[k])
    : [];

  // пока параметры не заполнены — подтягиваем результат фонового
  // автозаполнения, чтобы баннер погас сам; при открытой панели не
  // трогаем состояние, чтобы не затирать ручной ввод
  useEffect(() => {
    if (missingParams.length === 0 || settingsOpen) return;
    const timer = setInterval(async () => {
      setSettings(await getSettings());
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingParams.length === 0, settingsOpen]);

  // каждое изменение сразу в состояние и в storage (кнопки «Сохранить» нет)
  const changeSetting = (field, value) => {
    const next = { ...settings, [field]: value };
    setSettings(next);
    saveSettings(next).catch(console.error);
  };

  const updateSettingsField = (field) => (e) =>
    changeSetting(field, e.target.value);

  // сканирует GraphQL-запросы страницы (performance API) и заполняет
  // userId/хэши; чего не нашлось — подсказывает, какую страницу открыть
  const handleDetectParams = () => {
    const found = detectPlayerokParams();
    const next = { ...settings, ...found };
    setSettings(next);
    saveSettings(next).catch(console.error);

    const PARAM_HINTS = {
      userId: ["User ID", "откройте «Продажи» в своём профиле"],
      dealsHash: ["deals hash", "откройте «Продажи» в профиле"],
      dealHash: ["deal hash", "откройте страницу любой сделки"],
      itemsHash: ["items hash", "откройте «Мои товары» в профиле"],
    };
    const missing = Object.keys(PARAM_HINTS).filter((k) => !next[k]);
    if (missing.length === 0) {
      setDetectStatus("✓ Все параметры определены");
      return;
    }
    const foundNames = Object.keys(found).map((k) => PARAM_HINTS[k][0]);
    setDetectStatus(
      (foundNames.length ? `Найдено: ${foundNames.join(", ")}. ` : "") +
        "Не хватает: " +
        missing.map((k) => `${PARAM_HINTS[k][0]} — ${PARAM_HINTS[k][1]}`).join("; ") +
        ", затем нажмите кнопку ещё раз."
    );
  };

  return (
    <div className="app">
      <div className="app-header">
        <h1>Playerok Table View</h1>

        <div className="tabs">
          <button
            className={tab === "items" ? "tab tab-active" : "tab"}
            onClick={() => setTab("items")}
          >
            Товары
          </button>
          <button
            className={tab === "sales" ? "tab tab-active" : "tab"}
            onClick={() => setTab("sales")}
          >
            Продажи
          </button>
          <button
            className="tab tab-icon"
            onClick={handleClearDatabase}
            title="Очистить локальную базу"
          >
            <IconTrash />
          </button>
          <button
            className="tab tab-icon"
            onClick={() => {
              const next = !settingsOpen;
              setSettingsOpen(next);
              // запоминаем выбор — при следующем открытии панель будет такой же
              if (settings) changeSetting("settingsPanelOpen", next);
            }}
            title="Настройки"
          >
            <IconGear />
          </button>
          {onClose && (
            <button className="tab tab-icon" onClick={onClose} title="Закрыть">
              <IconClose />
            </button>
          )}
        </div>
      </div>

      {missingParams.length > 0 && (
        <div className="banner banner-permission">
          Первичная настройка: откройте <b>«Продажи»</b>, затем{" "}
          <b>«Мои товары»</b> в своём профиле playerok — User ID и хэши
          подхватятся автоматически, ничего вводить не нужно. Этот баннер
          исчезнет сам, когда всё заполнится.
        </div>
      )}

      {authNeeded && (
        <div className="banner banner-auth">
          Сессия не найдена или истекла —{" "}
          <a href="https://playerok.com" target="_blank" rel="noreferrer">
            войдите на playerok.com
          </a>{" "}
          и обновите данные.
        </div>
      )}

      {settingsOpen && settings && (
        <div className="settings-panel">
          <div className="settings-row">
            <label>
              User ID
              <input
                className="limit-input"
                value={settings.userId}
                onChange={updateSettingsField("userId")}
              />
            </label>
            <label>
              deals hash
              <input
                className="limit-input"
                value={settings.dealsHash}
                onChange={updateSettingsField("dealsHash")}
              />
            </label>
            <label>
              deal hash
              <input
                className="limit-input"
                value={settings.dealHash}
                onChange={updateSettingsField("dealHash")}
              />
            </label>
            <label>
              items hash
              <input
                className="limit-input"
                value={settings.itemsHash}
                onChange={updateSettingsField("itemsHash")}
              />
            </label>
            <button
              className="fetch-btn"
              title="Ищет userId и хэши в запросах, которые страница playerok уже сделала"
              onClick={handleDetectParams}
            >
              Определить автоматически
            </button>
          </div>

          {detectStatus && (
            <div className="settings-detect-status">{detectStatus}</div>
          )}

          <div className="settings-row">
            <label className="checkbox-label" title="Иначе товар копируется как есть">
              <input
                type="checkbox"
                checked={Boolean(settings.askPriceOnDuplicate)}
                onChange={(e) =>
                  changeSetting("askPriceOnDuplicate", e.target.checked)
                }
              />
              Спрашивать цену при дублировании
            </label>
            <label
              className="checkbox-label"
              title="Удалять товар одним нажатием 🗑, без подтверждения"
            >
              <input
                type="checkbox"
                checked={Boolean(settings.quickDelete)}
                onChange={(e) => changeSetting("quickDelete", e.target.checked)}
              />
              Быстрое удаление (без подтверждения)
            </label>
          </div>

          <div className="settings-row settings-links">
            <a
              href="https://github.com/aza-7/playerok_table_view"
              target="_blank"
              rel="noreferrer"
            >
              GitHub проекта
            </a>
            <span className="settings-links-sep">·</span>
            <a
              href="https://playerok.com/profile/HelloKitty11/products"
              target="_blank"
              rel="noreferrer"
            >
              Профиль автора на playerok
            </a>
          </div>
        </div>
      )}

      {/* обе страницы остаются смонтированными — переключение не сбрасывает
          фильтры и не перезапускает сетевые запросы */}
      <div style={{ display: tab === "sales" ? "block" : "none" }}>
        <DealsPage key={`deals-${dealsVersion}`} onAuthNeeded={setAuthNeeded} />
      </div>
      <div style={{ display: tab === "items" ? "block" : "none" }}>
        <ItemsPage key={`items-${itemsVersion}`} onAuthNeeded={setAuthNeeded} />
      </div>
    </div>
  );
}

export default App;
