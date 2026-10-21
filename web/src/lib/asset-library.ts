export type AssetKind = "text" | "image" | "video";

export type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    folderId?: string;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

export type AssetFolder = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    mergedInto?: string;
};

export type AssetTombstone = { id: string; deletedAt: string };

export type AssetLibrary = {
    assets: Asset[];
    folders: AssetFolder[];
    assetTombstones: AssetTombstone[];
};

export function normalizeAssetLibrary(library: Partial<AssetLibrary>): AssetLibrary {
    const folders = normalizeFolders(Array.isArray(library.folders) ? library.folders : []);
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    if (library.assetTombstones !== undefined && !Array.isArray(library.assetTombstones)) throw new Error("invalid asset tombstones");
    const assetTombstones = mergeAssetTombstones([], library.assetTombstones || []);
    const deletedAssetIds = new Set(assetTombstones.map((item) => item.id));
    const assets = mergeByUpdatedAt([], Array.isArray(library.assets) ? library.assets : [])
        .filter((asset) => !deletedAssetIds.has(asset.id))
        .map((asset) => {
            if (!asset.folderId) return asset;
            const folderId = resolveActiveFolderId(asset.folderId, folderById);
            if (!folderId) return withoutFolderId(asset);
            return folderId === asset.folderId ? asset : { ...asset, folderId };
        });
    return { assets, folders, assetTombstones };
}

export function mergeAssetLibraries(local: Partial<AssetLibrary>, remote: Partial<AssetLibrary>): AssetLibrary {
    return normalizeAssetLibrary({
        assets: mergeByUpdatedAt(local.assets || [], remote.assets || []),
        folders: mergeFolderVersions(local.folders || [], remote.folders || []),
        assetTombstones: mergeAssetTombstones(local.assetTombstones || [], remote.assetTombstones || []),
    });
}

export function prepareAssetLibraryExport(library: Partial<AssetLibrary>): AssetLibrary {
    const normalized = normalizeAssetLibrary(library);
    return { assets: normalized.assets, folders: normalized.folders.filter((folder) => !folder.deletedAt), assetTombstones: [] };
}

export function appendImportedAssetLibrary(current: Partial<AssetLibrary>, imported: Partial<AssetLibrary>, createId: () => string, importedAt: string): AssetLibrary {
    const base = normalizeAssetLibrary(current);
    const incoming = prepareAssetLibraryExport(imported);
    const folderByName = new Map(base.folders.filter((folder) => !folder.deletedAt).map((folder) => [normalizedFolderNameKey(folder.name), folder.id]));
    const importedFolderIds = new Map<string, string>();
    const newFolders: AssetFolder[] = [];
    const usedFolderIds = new Set(base.folders.map((folder) => folder.id));
    const usedAssetIds = new Set([...base.assets.map((asset) => asset.id), ...base.assetTombstones.map((item) => item.id)]);

    incoming.folders.forEach((folder) => {
        const nameKey = normalizedFolderNameKey(folder.name);
        let folderId = folderByName.get(nameKey);
        if (!folderId) {
            folderId = uniqueId(createId, usedFolderIds);
            folderByName.set(nameKey, folderId);
            newFolders.push({ id: folderId, name: normalizeAssetFolderName(folder.name), createdAt: importedAt, updatedAt: importedAt });
        }
        importedFolderIds.set(folder.id, folderId);
    });

    const newAssets = incoming.assets.map((asset) => ({
        ...asset,
        id: uniqueId(createId, usedAssetIds),
        folderId: asset.folderId ? importedFolderIds.get(asset.folderId) : undefined,
        createdAt: importedAt,
        updatedAt: importedAt,
    })) as Asset[];
    return normalizeAssetLibrary({ assets: [...newAssets, ...base.assets], folders: [...base.folders, ...newFolders], assetTombstones: base.assetTombstones });
}

export function moveAssetsInLibrary(library: AssetLibrary, assetIds: Iterable<string>, folderId: string | undefined, updatedAt: string): AssetLibrary {
    if (folderId && !library.folders.some((folder) => folder.id === folderId && !folder.deletedAt)) throw new Error("folder not found");
    const ids = new Set(assetIds);
    return {
        ...library,
        assets: library.assets.map((asset) => {
            if (!ids.has(asset.id) || asset.folderId === folderId) return asset;
            return folderId ? { ...asset, folderId, updatedAt } : withoutFolderId(asset, updatedAt);
        }),
    };
}

export function deleteFolderInLibrary(library: AssetLibrary, folderId: string, deletedAt: string): AssetLibrary {
    const folder = library.folders.find((item) => item.id === folderId);
    if (!folder || folder.deletedAt) return library;
    return {
        ...library,
        folders: library.folders.map((item) => (item.id === folderId ? { ...item, updatedAt: deletedAt, deletedAt } : item)),
        assets: library.assets.map((asset) => (asset.folderId === folderId ? withoutFolderId(asset, deletedAt) : asset)),
    };
}

export function deleteAssetInLibrary(library: AssetLibrary, assetId: string, deletedAt: string): AssetLibrary {
    if (!library.assets.some((asset) => asset.id === assetId)) return library;
    return normalizeAssetLibrary({
        ...library,
        assets: library.assets.filter((asset) => asset.id !== assetId),
        assetTombstones: [...library.assetTombstones, { id: assetId, deletedAt }],
    });
}

export function readAssetLibraryPackageData(value: unknown): AssetLibrary {
    if (!isRecord(value) || value.app !== "infinite-canvas") throw new Error("invalid asset package");
    if (value.version !== 1 && value.version !== 2) throw new Error("unsupported asset package version");
    if (!Array.isArray(value.assets)) throw new Error("invalid asset package");
    const assets = value.assets.map(readAsset);
    assertUniqueIds(assets, "asset");
    const folders = value.version === 1 ? [] : readFolders(value.folders);
    const normalized = normalizeAssetLibrary({ assets, folders, assetTombstones: [] });
    const folderById = new Map(normalized.folders.map((folder) => [folder.id, folder]));
    assets.forEach((asset) => {
        if (asset.folderId && !resolveActiveFolderId(asset.folderId, folderById)) throw new Error("asset package contains an invalid folder reference");
    });
    return normalized;
}

export function readAssetLibrarySnapshot(value: unknown): AssetLibrary {
    if (!isRecord(value) || !Array.isArray(value.assets)) throw new Error("invalid asset library snapshot");
    const assets = value.assets.map(readAsset);
    assertUniqueIds(assets, "asset");
    if (value.folders !== undefined && !Array.isArray(value.folders)) throw new Error("invalid asset folders");
    const folders = value.folders === undefined ? [] : readFolders(value.folders);
    const assetTombstones = value.assetTombstones === undefined ? [] : readAssetTombstones(value.assetTombstones);
    validateSnapshotFolderGraph(assets, folders);
    return normalizeAssetLibrary({ assets, folders, assetTombstones });
}

export function normalizeAssetFolderName(name: string) {
    const normalized = name.trim().normalize("NFC");
    if (!normalized) throw new Error("folder name is required");
    return normalized;
}

export function hasActiveAssetFolderName(folders: AssetFolder[], name: string, exceptId?: string) {
    const key = normalizedFolderNameKey(name);
    return folders.some((folder) => !folder.deletedAt && folder.id !== exceptId && normalizedFolderNameKey(folder.name) === key);
}

function normalizeFolders(folders: AssetFolder[]) {
    return resolveFolderNameConflicts(mergeFolderVersions(folders.map((folder) => ({ ...folder, name: normalizeAssetFolderName(folder.name) })), []));
}

function mergeFolderVersions(local: AssetFolder[], remote: AssetFolder[]) {
    const folders = new Map<string, AssetFolder>();
    const accept = (folder: AssetFolder) => {
        const current = folders.get(folder.id);
        if (!current) folders.set(folder.id, folder);
        else if (folder.deletedAt && !current.deletedAt) folders.set(folder.id, folder);
        else if (!folder.deletedAt && current.deletedAt) return;
        else if (timestamp(folder.updatedAt) > timestamp(current.updatedAt)) folders.set(folder.id, folder);
        else if (timestamp(folder.updatedAt) === timestamp(current.updatedAt) && compareCodePoints(folderSortKey(folder), folderSortKey(current)) < 0) folders.set(folder.id, folder);
    };
    remote.forEach(accept);
    local.forEach(accept);
    return resolveFolderNameConflicts([...folders.values()]);
}

function resolveFolderNameConflicts(folders: AssetFolder[]) {
    const next = new Map<string, AssetFolder>(folders.map((folder): [string, AssetFolder] => [folder.id, folder.deletedAt ? folder : withoutMergedInto(folder)]));
    mergeActiveFolderNameConflicts(next);
    repairFolderAliasCycles(next);
    mergeActiveFolderNameConflicts(next);
    const folderById = new Map(next);
    return [...next.values()]
        .map((folder) => {
            if (!folder.deletedAt || !folder.mergedInto) return folder;
            const mergedInto = resolveActiveFolderId(folder.mergedInto, folderById);
            if (!mergedInto) return withoutMergedInto(folder);
            return mergedInto === folder.mergedInto ? folder : { ...folder, mergedInto };
        })
        .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || compareCodePoints(a.id, b.id));
}

function mergeActiveFolderNameConflicts(folders: Map<string, AssetFolder>) {
    const activeByName = new Map<string, AssetFolder[]>();
    folders.forEach((folder) => {
        if (folder.deletedAt) return;
        const key = normalizedFolderNameKey(folder.name);
        activeByName.set(key, [...(activeByName.get(key) || []), folder]);
    });
    activeByName.forEach((duplicates) => {
        if (duplicates.length < 2) return;
        const sorted = duplicates.sort(compareCanonicalFolder);
        const canonical = sorted[0];
        const conflictAt = sorted.reduce((latest, folder) => latestDateValue(latest, folder.updatedAt), canonical.updatedAt);
        sorted.slice(1).forEach((folder) => folders.set(folder.id, { ...folder, updatedAt: conflictAt, deletedAt: conflictAt, mergedInto: canonical.id }));
    });
}

function repairFolderAliasCycles(folders: Map<string, AssetFolder>) {
    [...folders.keys()].sort(compareCodePoints).forEach((startId) => {
        const path: AssetFolder[] = [];
        const pathIndex = new Map<string, number>();
        let current = folders.get(startId);
        while (current?.deletedAt && current.mergedInto) {
            const cycleStart = pathIndex.get(current.id);
            if (cycleStart !== undefined) {
                const cycle = path.slice(cycleStart);
                const canonical = [...cycle].sort(compareCanonicalFolder)[0];
                const resolvedAt = cycle.reduce((latest, folder) => latestDateValue(latest, folder.updatedAt), canonical.updatedAt);
                folders.set(canonical.id, activateFolder(canonical, resolvedAt));
                cycle.forEach((folder) => {
                    if (folder.id !== canonical.id) folders.set(folder.id, { ...folder, updatedAt: resolvedAt, deletedAt: resolvedAt, mergedInto: canonical.id });
                });
                break;
            }
            pathIndex.set(current.id, path.length);
            path.push(current);
            current = folders.get(current.mergedInto);
        }
    });
}

function mergeAssetTombstones(local: AssetTombstone[], remote: AssetTombstone[]) {
    const items = new Map<string, AssetTombstone>();
    [...remote, ...local].forEach((item) => {
        if (!item || typeof item.id !== "string" || !item.id.trim() || typeof item.deletedAt !== "string" || !Number.isFinite(Date.parse(item.deletedAt))) throw new Error("invalid asset tombstone");
        const current = items.get(item.id);
        if (!current || timestamp(item.deletedAt) > timestamp(current.deletedAt) || timestamp(item.deletedAt) === timestamp(current.deletedAt) && compareCodePoints(item.deletedAt, current.deletedAt) < 0) items.set(item.id, item);
    });
    return [...items.values()].sort((a, b) => timestamp(b.deletedAt) - timestamp(a.deletedAt) || compareCodePoints(a.id, b.id));
}

function mergeByUpdatedAt<T extends { id: string; updatedAt: string }>(local: T[], remote: T[]) {
    const items = new Map<string, T>();
    [...remote, ...local].forEach((item) => {
        const current = items.get(item.id);
        if (!current || timestamp(item.updatedAt) > timestamp(current.updatedAt) || timestamp(item.updatedAt) === timestamp(current.updatedAt) && compareCodePoints(stableValueKey(item), stableValueKey(current)) < 0) items.set(item.id, item);
    });
    return [...items.values()].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || compareCodePoints(a.id, b.id));
}

function resolveActiveFolderId(folderId: string, folderById: Map<string, AssetFolder>) {
    const visited = new Set<string>();
    let currentId: string | undefined = folderId;
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const folder = folderById.get(currentId);
        if (!folder) return undefined;
        if (!folder.deletedAt) return folder.id;
        currentId = folder.mergedInto;
    }
    return undefined;
}

function readFolders(value: unknown) {
    if (!Array.isArray(value)) throw new Error("invalid asset package");
    const folders = value.map((item) => {
        if (!isRecord(item)) throw new Error("invalid asset folder");
        const folder: AssetFolder = {
            id: requiredString(item.id, "folder id"),
            name: normalizeAssetFolderName(requiredString(item.name, "folder name")),
            createdAt: requiredDate(item.createdAt, "folder createdAt"),
            updatedAt: requiredDate(item.updatedAt, "folder updatedAt"),
        };
        if (item.deletedAt !== undefined) folder.deletedAt = requiredDate(item.deletedAt, "folder deletedAt");
        if (item.mergedInto !== undefined) folder.mergedInto = requiredString(item.mergedInto, "folder mergedInto");
        return folder;
    });
    assertUniqueIds(folders, "folder");
    return folders;
}

function readAssetTombstones(value: unknown) {
    if (!Array.isArray(value)) throw new Error("invalid asset tombstones");
    const tombstones = value.map((item) => {
        if (!isRecord(item)) throw new Error("invalid asset tombstone");
        return { id: requiredString(item.id, "asset tombstone id"), deletedAt: requiredDate(item.deletedAt, "asset tombstone deletedAt") };
    });
    assertUniqueIds(tombstones, "asset tombstone");
    return tombstones;
}

function validateSnapshotFolderGraph(assets: Asset[], folders: AssetFolder[]) {
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    folders.forEach((folder) => {
        if (!folder.deletedAt && folder.mergedInto) throw new Error("active folder cannot have mergedInto");
        if (!folder.mergedInto) return;
        const visited = new Set<string>();
        let current: AssetFolder | undefined = folder;
        while (current?.mergedInto) {
            if (visited.has(current.id)) throw new Error("cyclic folder mergedInto");
            visited.add(current.id);
            current = folderById.get(current.mergedInto);
            if (!current) throw new Error("invalid folder mergedInto");
        }
        if (current?.deletedAt) throw new Error("invalid folder mergedInto");
    });
    assets.forEach((asset) => {
        if (asset.folderId && !resolveActiveFolderId(asset.folderId, folderById)) throw new Error("invalid folder reference");
    });
}

function readAsset(value: unknown): Asset {
    if (!isRecord(value) || !isRecord(value.data)) throw new Error("invalid asset");
    const base = {
        id: requiredString(value.id, "asset id"),
        title: requiredString(value.title, "asset title", true),
        coverUrl: requiredString(value.coverUrl, "asset coverUrl", true),
        tags: readStringArray(value.tags, "asset tags"),
        createdAt: requiredDate(value.createdAt, "asset createdAt"),
        updatedAt: requiredDate(value.updatedAt, "asset updatedAt"),
        ...(value.folderId === undefined ? {} : { folderId: requiredString(value.folderId, "asset folderId") }),
        ...(value.source === undefined ? {} : { source: requiredString(value.source, "asset source", true) }),
        ...(value.note === undefined ? {} : { note: requiredString(value.note, "asset note", true) }),
        ...(value.metadata === undefined ? {} : { metadata: readMetadata(value.metadata) }),
    };
    if (value.kind === "text") return { ...base, kind: "text", data: { content: requiredString(value.data.content, "text content", true) } };
    if (value.kind === "image") return { ...base, kind: "image", data: readMediaData(value.data, "dataUrl") };
    if (value.kind === "video") return { ...base, kind: "video", data: readMediaData(value.data, "url") };
    throw new Error("invalid asset kind");
}

function readMediaData<T extends "dataUrl" | "url">(value: Record<string, unknown>, urlKey: T) {
    return {
        [urlKey]: requiredString(value[urlKey], `asset ${urlKey}`, true),
        ...(value.storageKey === undefined ? {} : { storageKey: requiredString(value.storageKey, "asset storageKey") }),
        width: requiredNumber(value.width, "asset width"),
        height: requiredNumber(value.height, "asset height"),
        bytes: requiredNumber(value.bytes, "asset bytes"),
        mimeType: requiredString(value.mimeType, "asset mimeType", true),
    } as Record<T, string> & { storageKey?: string; width: number; height: number; bytes: number; mimeType: string };
}

function requiredString(value: unknown, label: string, allowEmpty = false) {
    if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`invalid ${label}`);
    return value;
}

function requiredDate(value: unknown, label: string) {
    const date = requiredString(value, label);
    if (!Number.isFinite(Date.parse(date))) throw new Error(`invalid ${label}`);
    return date;
}

function requiredNumber(value: unknown, label: string) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`invalid ${label}`);
    return value;
}

function readStringArray(value: unknown, label: string) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`invalid ${label}`);
    return value;
}

function readMetadata(value: unknown) {
    if (!isRecord(value)) throw new Error("invalid asset metadata");
    return value;
}

function assertUniqueIds(items: Array<{ id: string }>, label: string) {
    const ids = new Set<string>();
    items.forEach((item) => {
        if (ids.has(item.id)) throw new Error(`duplicate ${label} id`);
        ids.add(item.id);
    });
}

function uniqueId(createId: () => string, usedIds: Set<string>) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const id = createId();
        if (!id || usedIds.has(id)) continue;
        usedIds.add(id);
        return id;
    }
    throw new Error("failed to create a unique asset library id");
}

function normalizedFolderNameKey(name: string) {
    return normalizeAssetFolderName(name).toLowerCase();
}

function compareCanonicalFolder(a: AssetFolder, b: AssetFolder) {
    return timestamp(a.createdAt) - timestamp(b.createdAt) || compareCodePoints(a.id, b.id);
}

function folderSortKey(folder: AssetFolder) {
    return stableValueKey(folder);
}

function withoutFolderId(asset: Asset, updatedAt?: string): Asset {
    const { folderId: _folderId, ...rest } = asset;
    return { ...rest, ...(updatedAt ? { updatedAt } : {}) } as Asset;
}

function withoutMergedInto(folder: AssetFolder) {
    const { mergedInto: _mergedInto, ...rest } = folder;
    return rest;
}

function activateFolder(folder: AssetFolder, updatedAt: string): AssetFolder {
    const { deletedAt: _deletedAt, mergedInto: _mergedInto, ...rest } = folder;
    return { ...rest, updatedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValueKey(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableValueKey).join(",")}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? String(value);
}

function compareCodePoints(left: string, right: string) {
    const leftPoints = Array.from(left, (value) => value.codePointAt(0) || 0);
    const rightPoints = Array.from(right, (value) => value.codePointAt(0) || 0);
    for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
        if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
    }
    return leftPoints.length - rightPoints.length;
}

function latestDateValue(left: string, right: string) {
    const difference = timestamp(left) - timestamp(right);
    if (difference > 0) return left;
    if (difference < 0) return right;
    return compareCodePoints(left, right) <= 0 ? left : right;
}

function timestamp(value: string) {
    return Date.parse(value) || 0;
}
