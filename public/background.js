const ext = globalThis.browser ?? globalThis.chrome;

// Приложение живёт на самой странице playerok.com (кнопки в профиле).
// Клик по иконке: на вкладке playerok — открыть оверлей на месте, иначе
// открыть сайт с хеш-маркером, по которому content-script покажет оверлей.
const OPEN_URL = "https://playerok.com/#pk-open-table";

ext.action.onClicked.addListener(async (tab) => {
  const isPlayerok = tab?.url?.startsWith("https://playerok.com");
  if (isPlayerok && tab.id != null) {
    try {
      await ext.tabs.sendMessage(tab.id, { type: "pk-open-overlay" });
      return;
    } catch {
      // content-script ещё не загружен на этой вкладке — откроем новую
    }
  }
  ext.tabs.create({ url: OPEN_URL });
});

// Скачивание картинок товара для дублирования: i.playerok.com не отдаёт
// CORS-заголовки, поэтому из content-script fetch блокируется. Фон имеет
// host-разрешение на *.playerok.com и качает без CORS-ограничений.
ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "pk-fetch-image") return;

  (async () => {
    try {
      // credentials: include — CDN за DDoS-Guard отвечает 403 без кук
      // __ddg*/сессии; host-разрешение *.playerok.com позволяет их приложить
      const res = await fetch(msg.url, { credentials: "include" });
      if (!res.ok) {
        sendResponse({ ok: false, error: `HTTP ${res.status}` });
        return;
      }
      const contentType = res.headers.get("content-type") || "image/jpeg";
      // страница-заглушка антибота (text/html) — не картинка, не заливаем её
      if (!contentType.startsWith("image/")) {
        sendResponse({ ok: false, error: `не картинка (${contentType})` });
        return;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      sendResponse({ ok: true, base64: btoa(binary), contentType });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message ?? err) });
    }
  })();

  return true; // async sendResponse
});
