import { createRoot } from "react-dom/client";
import App from "../App.jsx";
import { startAutoPublishDaemon } from "../autoPublish.js";
import { startParamsAutoFill } from "../utils/detectParams.js";
import { ext } from "../ext/browser.js";
import appCss from "../index.css?inline";
import overlayCss from "./overlay.css?inline";

const BTN_CLASS = "pk-open-btn";
const BTN_FLAG = "data-pk-injected";

// ── overlay (Shadow DOM) ──────────────────────────────────────────────
let hostEl = null;
let root = null;
let openSeq = 0;

function ensureOverlay() {
  if (hostEl) return;

  hostEl = document.createElement("div");
  hostEl.id = "pk-orders-overlay-host";
  hostEl.style.display = "none";
  const shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = appCss + "\n" + overlayCss;
  shadow.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.className = "pk-overlay-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeOverlay();
  });

  const panel = document.createElement("div");
  panel.className = "pk-overlay-panel";
  const mount = document.createElement("div");
  panel.appendChild(mount);
  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);

  document.body.appendChild(hostEl);
  root = createRoot(mount);
}

function openOverlay(tab) {
  ensureOverlay();
  // новый key → свежий монтаж, чтобы всегда открывалась нужная вкладка
  openSeq += 1;
  root.render(<App key={openSeq} initialTab={tab} onClose={closeOverlay} />);
  hostEl.style.display = "block";
  document.documentElement.style.overflow = "hidden";
}

function closeOverlay() {
  if (!hostEl) return;
  hostEl.style.display = "none";
  document.documentElement.style.overflow = "";
}

// ── inject the two buttons into the profile tab row ───────────────────

// React перерисовывает ряд вкладок при навигации и может пропатчить классы
// наших кнопок как своих (например, навесить active — кнопки синеют).
// Храним исходный вид и откатываем любые чужие правки.
const pristineButtons = new WeakMap(); // el → { className, innerHTML }

function normalizeButtons(row) {
  for (const el of row.querySelectorAll(`[${BTN_FLAG}]`)) {
    const orig = pristineButtons.get(el);
    if (!orig) continue;
    if (el.className !== orig.className) el.className = orig.className;
    if (el.innerHTML !== orig.innerHTML) el.innerHTML = orig.innerHTML;
  }
}

function injectButtons() {
  // якорь: ряд вкладок профиля со ссылками .../purchases и .../sales
  // (Покупки есть только на своём профиле — так отсекаем чужие)
  const salesLink = document.querySelector('a[href*="/profile/"][href$="/sales"]');
  const purchasesLink = document.querySelector(
    'a[href*="/profile/"][href$="/purchases"]'
  );
  if (!salesLink || !purchasesLink) return;

  const row = salesLink.parentElement;
  if (!row) return;

  // сперва чиним уже вставленные кнопки (ищем по атрибуту — класс React
  // мог перезаписать), иначе проверка ниже их не увидит и вставит дубли
  normalizeButtons(row);
  if (row.querySelector(`.${BTN_CLASS}`)) return;

  // шаблон — «Покупки»/«Продажи», та, что точно не текущая страница: класс
  // active при перерисовке роута навешивается с запозданием, и выбор «первая
  // без active» мог клонировать активную вкладку с её синими стилями
  const template =
    [purchasesLink, salesLink].find(
      (a) =>
        a.getAttribute("href") !== location.pathname &&
        !a.classList.contains("active")
    ) ?? purchasesLink;

  const make = (label, tab) => {
    const el = template.cloneNode(true);
    el.classList.add(BTN_CLASS);
    el.classList.remove("active");
    el.setAttribute(BTN_FLAG, "1");
    el.removeAttribute("href");
    el.style.cursor = "pointer";
    el.style.textDecoration = "none"; // playerok-вкладки без подчёркивания

    // именно вложенный span: он несёт класс с цветом текста вкладки.
    // querySelector("span, p") находил p (родителя) и textContent сносил
    // span — без него текст наследовал синий цвет MuiLink на части страниц
    const textNode =
      el.querySelector("p span") || el.querySelector("span, p") || el;
    textNode.textContent = label;
    textNode.style.fontSize = "18px"; // чуть крупнее нативных вкладок

    // цвет фиксируем инлайном (!important) с живой неактивной вкладки: каскад
    // MuiLink на отдельных страницах (products/completed) перекрашивает текст
    // в синий, инлайновый important перебивает любые правила
    const templateText = template.querySelector("p span, span, p");
    const nativeColor = getComputedStyle(templateText ?? template).color;
    el.style.setProperty("color", nativeColor, "important");
    textNode.style.setProperty("color", nativeColor, "important");

    el.addEventListener("click", (e) => {
      e.preventDefault();
      openOverlay(tab);
    });

    // эталон для normalizeButtons — откат правок React
    pristineButtons.set(el, {
      className: el.className,
      innerHTML: el.innerHTML,
    });
    return el;
  };

  row.appendChild(make("Таблица товаров", "items"));
  row.appendChild(make("Таблица продаж", "sales"));
}

// клик по иконке расширения: фон шлёт сообщение (вкладка playerok уже
// открыта) или открывает сайт с хеш-маркером — оба пути ведут в оверлей
ext.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "pk-open-overlay") openOverlay("items");
});

// SPA (Next.js): ряд вкладок перерисовывается при навигации — держим кнопки
function start() {
  injectButtons();
  startAutoPublishDaemon(); // автопубликация «Авто»-товаров без оверлея
  startParamsAutoFill(); // userId/хэши подхватываются сами по мере серфинга

  if (location.hash === "#pk-open-table") {
    // маркер одноразовый — убираем из адреса и показываем оверлей
    history.replaceState(null, "", location.pathname + location.search);
    openOverlay("items");
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      injectButtons();
    });
  });
  // attributes: ловим и правку классов наших кнопок Реактом (без childList)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
