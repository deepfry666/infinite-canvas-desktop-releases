export const APP_VERSION = __APP_VERSION__ || "dev";

export function formatAppVersion(version: string) {
    const normalized = version.trim();
    if (!normalized || normalized.toLowerCase() === "dev") return normalized || "dev";
    return /^v/i.test(normalized) ? `v${normalized.slice(1)}` : `v${normalized}`;
}

export const APP_DISPLAY_VERSION = formatAppVersion(APP_VERSION);

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
