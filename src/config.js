import { ext, isExtension } from './ext/browser.js';

// userId и persisted-query хэши у каждого аккаунта/версии сайта свои —
// по умолчанию пусто, заполняются кнопкой «Определить автоматически»
export const DEFAULT_SETTINGS = {
  userId: '',
  dealsHash: '',
  dealHash: '',
  itemsHash: '',
  // спрашивать цену копии при дублировании; false — копировать товар как есть
  askPriceOnDuplicate: true,
  // удалять товар одним нажатием 🗑 без подтверждения
  quickDelete: false,
  // панель открыта при запуске: true на первом запуске (онбординг),
  // дальше запоминается последний выбор юзера
  settingsPanelOpen: true,
};

const STORAGE_KEY = 'settings';

export async function getSettings() {
  if (isExtension) {
    const stored = await ext.storage.local.get(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] ?? {}) };
  }
  // vite dev fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (isExtension) {
    await ext.storage.local.set({ [STORAGE_KEY]: merged });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}
