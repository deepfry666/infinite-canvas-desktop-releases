export type AssetPackageMedia = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export function readAssetPackageMediaManifest(value: unknown, version: 1 | 2): AssetPackageMedia[] {
    if (!Array.isArray(value)) throw new Error("invalid asset media manifest");
    const items = value.map(readMediaItem);
    if (version === 2) {
        assertUnique(items.map((item) => item.storageKey), "asset storageKey");
        assertUnique(items.map((item) => item.path), "asset package path");
        return items;
    }
    const byStorageKey = new Map<string, AssetPackageMedia>();
    items.forEach((item) => {
        const current = byStorageKey.get(item.storageKey);
        if (!current) byStorageKey.set(item.storageKey, item);
        else if (current.path !== item.path || current.mimeType !== item.mimeType || current.bytes !== item.bytes) throw new Error("conflicting legacy asset media entry");
    });
    const collapsed = [...byStorageKey.values()];
    assertUnique(collapsed.map((item) => item.path), "asset package path");
    return collapsed;
}

function readMediaItem(value: unknown): AssetPackageMedia {
    if (!isRecord(value)) throw new Error("invalid asset media manifest entry");
    const storageKey = requiredString(value.storageKey, "asset storageKey");
    const path = requiredString(value.path, "asset package path");
    const mimeType = requiredString(value.mimeType, "asset mimeType");
    const bytes = value.bytes;
    if (!/^files\/[a-zA-Z0-9._-]+$/.test(path) || path.includes("..")) throw new Error("invalid asset package path");
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error("invalid asset media bytes");
    return { storageKey, path, mimeType, bytes };
}

function assertUnique(values: string[], label: string) {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function requiredString(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`invalid ${label}`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
