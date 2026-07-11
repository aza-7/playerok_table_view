// Cross-browser WebExtension API shim (Firefox exposes `browser`, Chrome only `chrome`)
export const ext = globalThis.browser ?? globalThis.chrome;

export const isExtension = Boolean(ext?.runtime?.id);
