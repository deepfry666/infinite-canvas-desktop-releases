import assert from "node:assert/strict";
import test from "node:test";

import {
    appendImportedAssetLibrary,
    deleteFolderInLibrary,
    mergeAssetLibraries,
    moveAssetsInLibrary,
    normalizeAssetFolderName,
    normalizeAssetLibrary,
    prepareAssetLibraryExport,
    readAssetLibrarySnapshot,
    readAssetLibraryPackageData,
    type Asset,
    type AssetFolder,
} from "./asset-library.ts";

type ImageAsset = Extract<Asset, { kind: "image" }>;

const activeFolder: AssetFolder = {
    id: "folder-active",
    name: "参考图",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

const deletedFolder: AssetFolder = {
    id: "folder-deleted",
    name: "旧文件夹",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: "2026-01-02T00:00:00.000Z",
};

function imageAsset(patch: Partial<ImageAsset> & { id: string }): ImageAsset {
    return {
        kind: "image",
        title: "图片",
        coverUrl: "blob:cover",
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: {
            dataUrl: "blob:image",
            storageKey: "image:shared",
            width: 100,
            height: 100,
            bytes: 10,
            mimeType: "image/png",
        },
        ...patch,
    } as ImageAsset;
}

test("规范化素材库时清除失效文件夹引用但保持媒体 storageKey", () => {
    const valid = imageAsset({ id: "valid", folderId: activeFolder.id });
    const deleted = imageAsset({ id: "deleted", folderId: deletedFolder.id });
    const missing = imageAsset({ id: "missing", folderId: "folder-missing" });

    const library = normalizeAssetLibrary({ assets: [valid, deleted, missing], folders: [activeFolder, deletedFolder] });

    assert.equal(library.assets.find((asset) => asset.id === valid.id)?.folderId, activeFolder.id);
    assert.equal(library.assets.find((asset) => asset.id === deleted.id)?.folderId, undefined);
    assert.equal(library.assets.find((asset) => asset.id === missing.id)?.folderId, undefined);
    assert.deepEqual(
        library.assets.map((asset) => (asset.kind === "image" ? asset.data.storageKey : undefined)),
        ["image:shared", "image:shared", "image:shared"],
    );
});

test("文件夹删除墓碑优先于更新时间更晚的活跃副本且不会被同步复活", () => {
    const staleActive = { ...activeFolder, id: deletedFolder.id, updatedAt: "2026-02-01T00:00:00.000Z" };
    const remoteAsset = imageAsset({ id: "asset-1", folderId: deletedFolder.id, updatedAt: "2026-02-01T00:00:00.000Z" });

    const merged = mergeAssetLibraries({ assets: [], folders: [deletedFolder] }, { assets: [remoteAsset], folders: [staleActive] });

    assert.deepEqual(merged.folders, [deletedFolder]);
    assert.equal(merged.assets[0].folderId, undefined);
    assert.equal(merged.assets[0].kind === "image" && merged.assets[0].data.storageKey, "image:shared");
});

test("素材删除墓碑优先于更新时间更晚的远端副本且不会被同步复活", () => {
    const deletedAt = "2026-01-02T00:00:00.000Z";
    const remoteAsset = imageAsset({ id: "asset-deleted", updatedAt: "2026-02-01T00:00:00.000Z" });

    const merged = mergeAssetLibraries(
        { assets: [], folders: [], assetTombstones: [{ id: remoteAsset.id, deletedAt }] },
        { assets: [remoteAsset], folders: [], assetTombstones: [] },
    );

    assert.deepEqual(merged.assets, []);
    assert.deepEqual(merged.assetTombstones, [{ id: remoteAsset.id, deletedAt }]);
    assert.deepEqual(mergeAssetLibraries(
        { assets: [remoteAsset], folders: [], assetTombstones: [] },
        { assets: [], folders: [], assetTombstones: [{ id: remoteAsset.id, deletedAt }] },
    ), merged);
});

test("素材同时间戳冲突从任一同步方向合并都会稳定收敛", () => {
    const left = imageAsset({ id: "same", title: "A" });
    const right = imageAsset({ id: "same", title: "B" });

    assert.deepEqual(
        mergeAssetLibraries({ assets: [left] }, { assets: [right] }),
        mergeAssetLibraries({ assets: [right] }, { assets: [left] }),
    );
});

test("素材库拒绝损坏的删除墓碑而不是静默复活记录", () => {
    assert.throws(() => normalizeAssetLibrary({ assetTombstones: [{ id: "asset", deletedAt: "not-a-date" }] }), /invalid asset tombstone/);
});

test("WebDAV 素材快照兼容仅包含 assets 的旧清单", () => {
    const asset = imageAsset({ id: "legacy" });

    assert.deepEqual(readAssetLibrarySnapshot({ assets: [asset] }), { assets: [asset], folders: [], assetTombstones: [] });
});

test("WebDAV 素材快照严格校验已存在字段和日期", () => {
    const asset = imageAsset({ id: "active", folderId: activeFolder.id });
    const tombstone = { id: "removed", deletedAt: "2026-02-01T00:00:00.000Z" };

    assert.deepEqual(
        readAssetLibrarySnapshot({ assets: [asset], folders: [activeFolder], assetTombstones: [tombstone] }),
        { assets: [asset], folders: [activeFolder], assetTombstones: [tombstone] },
    );
    assert.throws(() => readAssetLibrarySnapshot({ assets: [{ ...asset, updatedAt: "not-a-date" }] }), /invalid asset updatedAt/);
    assert.throws(() => readAssetLibrarySnapshot({ assets: [], folders: {} }), /invalid asset folders/);
    assert.throws(() => readAssetLibrarySnapshot({ assets: [], folders: [{ ...activeFolder, deletedAt: "not-a-date" }] }), /invalid folder deletedAt/);
    assert.throws(() => readAssetLibrarySnapshot({ assets: [], assetTombstones: {} }), /invalid asset tombstones/);
    assert.throws(() => readAssetLibrarySnapshot({ assets: [], assetTombstones: [{ id: "removed", deletedAt: "not-a-date" }] }), /invalid asset tombstone deletedAt/);
});

test("WebDAV 素材快照只接受可解析到活跃节点的文件夹关系", () => {
    const alias = { ...deletedFolder, id: "folder-alias", mergedInto: activeFolder.id };
    const asset = imageAsset({ id: "asset", folderId: alias.id });
    const parsed = readAssetLibrarySnapshot({ assets: [asset], folders: [alias, activeFolder], assetTombstones: [] });

    assert.equal(parsed.assets[0].folderId, activeFolder.id);
    assert.throws(
        () => readAssetLibrarySnapshot({ assets: [], folders: [{ ...activeFolder, mergedInto: "other" }], assetTombstones: [] }),
        /active folder cannot have mergedInto/,
    );
    assert.throws(
        () => readAssetLibrarySnapshot({ assets: [], folders: [{ ...alias, mergedInto: "missing" }], assetTombstones: [] }),
        /invalid folder mergedInto/,
    );
    assert.throws(
        () => readAssetLibrarySnapshot({ assets: [], folders: [{ ...alias, id: "a", mergedInto: "b" }, { ...alias, id: "b", mergedInto: "a" }], assetTombstones: [] }),
        /cyclic folder mergedInto/,
    );
    assert.throws(
        () => readAssetLibrarySnapshot({ assets: [imageAsset({ id: "missing-ref", folderId: "missing" })], folders: [], assetTombstones: [] }),
        /invalid folder reference/,
    );
    assert.throws(
        () => readAssetLibrarySnapshot({ assets: [imageAsset({ id: "deleted-ref", folderId: deletedFolder.id })], folders: [deletedFolder], assetTombstones: [] }),
        /invalid folder reference/,
    );
});

test("两个合法快照交叉合并别名后仍保留一个可解析的活跃文件夹", () => {
    const a = { ...activeFolder, id: "a", name: "共同分类", createdAt: "2026-01-01T00:00:00.000Z" };
    const b = { ...activeFolder, id: "b", name: "共同分类", createdAt: "2026-01-02T00:00:00.000Z" };
    const deletedAt = "2026-02-01T00:00:00.000Z";
    const left = readAssetLibrarySnapshot({
        assets: [imageAsset({ id: "left-asset", folderId: a.id })],
        folders: [{ ...a, updatedAt: deletedAt, deletedAt, mergedInto: b.id }, b],
        assetTombstones: [],
    });
    const right = readAssetLibrarySnapshot({
        assets: [imageAsset({ id: "right-asset", folderId: b.id })],
        folders: [a, { ...b, updatedAt: deletedAt, deletedAt, mergedInto: a.id }],
        assetTombstones: [],
    });

    const merged = mergeAssetLibraries(left, right);

    assert.doesNotThrow(() => readAssetLibrarySnapshot(merged));
    const active = merged.folders.filter((folder) => !folder.deletedAt);
    assert.equal(active.length, 1);
    assert.deepEqual(new Set(merged.assets.map((asset) => asset.folderId)), new Set([active[0].id]));
});

test("同名文件夹从任一同步方向合并都会收敛到同一主文件夹", () => {
    const canonical = { ...activeFolder, id: "folder-a", name: "灵感", createdAt: "2026-01-01T00:00:00.000Z" };
    const duplicate = { ...activeFolder, id: "folder-b", name: " 灵感 ", createdAt: "2026-01-02T00:00:00.000Z" };
    const left = { assets: [imageAsset({ id: "asset-a", folderId: canonical.id })], folders: [canonical], assetTombstones: [] };
    const right = { assets: [imageAsset({ id: "asset-b", folderId: duplicate.id })], folders: [duplicate], assetTombstones: [] };

    const leftFirst = mergeAssetLibraries(left, right);
    const rightFirst = mergeAssetLibraries(right, left);

    assert.deepEqual(leftFirst, rightFirst);
    assert.deepEqual(new Set(leftFirst.assets.map((asset) => asset.folderId)), new Set([canonical.id]));
    assert.equal(leftFirst.folders.find((folder) => folder.id === duplicate.id)?.mergedInto, canonical.id);
});

test("文件夹名称以 NFC 和大小写无关规则归并且反向同步完全收敛", () => {
    const nfc = { ...activeFolder, id: "é", name: " CAFÉ ", createdAt: "2026-01-01T00:00:00.000Z" };
    const nfd = { ...activeFolder, id: "e\u0301", name: "cafe\u0301", createdAt: "2026-01-01T00:00:00.000Z" };
    const left = { assets: [imageAsset({ id: "asset-nfc", folderId: nfc.id })], folders: [nfc], assetTombstones: [] };
    const right = { assets: [imageAsset({ id: "asset-nfd", folderId: nfd.id })], folders: [nfd], assetTombstones: [] };

    const leftFirst = mergeAssetLibraries(left, right);
    const rightFirst = mergeAssetLibraries(right, left);

    assert.equal(normalizeAssetFolderName(" cafe\u0301 "), "café");
    assert.deepEqual(leftFirst, rightFirst);
    assert.equal(leftFirst.folders.filter((folder) => !folder.deletedAt).length, 1);
    assert.ok(leftFirst.folders.every((folder) => folder.name === folder.name.normalize("NFC")));
    assert.equal(new Set(leftFirst.assets.map((asset) => asset.folderId)).size, 1);
});

test("等价时刻使用不同时区文本时素材、文件夹和墓碑仍反向收敛", () => {
    const utc = "2026-01-01T00:00:00.000Z";
    const offset = "2025-12-31T19:00:00.000-05:00";
    const left = {
        assets: [imageAsset({ id: "same-asset", title: "A", updatedAt: utc })],
        folders: [{ ...activeFolder, id: "same-folder", name: "A", updatedAt: utc }],
        assetTombstones: [{ id: "same-tombstone", deletedAt: utc }],
    };
    const right = {
        assets: [imageAsset({ id: "same-asset", title: "B", updatedAt: offset })],
        folders: [{ ...activeFolder, id: "same-folder", name: "B", updatedAt: offset }],
        assetTombstones: [{ id: "same-tombstone", deletedAt: offset }],
    };

    assert.deepEqual(mergeAssetLibraries(left, right), mergeAssetLibraries(right, left));
});

test("追加导入时重新分配 ID、复用同名文件夹且保持 storageKey", () => {
    const current = { assets: [], folders: [activeFolder], assetTombstones: [] };
    const importedFolder = { ...activeFolder, id: "imported-folder" };
    const newFolder = { ...activeFolder, id: "new-folder", name: "新分类" };
    const imported = {
        assets: [
            imageAsset({ id: "old-a", title: "复用分类", folderId: importedFolder.id, data: { ...imageAsset({ id: "temp" }).data, storageKey: "image:keep-a" } }),
            imageAsset({ id: "old-b", title: "新分类", folderId: newFolder.id, data: { ...imageAsset({ id: "temp" }).data, storageKey: "image:keep-b" } }),
        ],
        folders: [importedFolder, newFolder],
        assetTombstones: [],
    };
    const ids = ["created-folder", "created-asset-a", "created-asset-b"];

    const result = appendImportedAssetLibrary(current, imported, () => ids.shift() || "unexpected", "2026-03-01T00:00:00.000Z");
    const reused = result.assets.find((asset) => asset.title === "复用分类");
    const added = result.assets.find((asset) => asset.title === "新分类");

    assert.equal(reused?.folderId, activeFolder.id);
    assert.equal(added?.folderId, "created-folder");
    assert.deepEqual(new Set(result.assets.map((asset) => asset.id)), new Set(["created-asset-a", "created-asset-b"]));
    assert.deepEqual(
        new Set(result.assets.map((asset) => (asset.kind === "image" ? asset.data.storageKey : undefined))),
        new Set(["image:keep-a", "image:keep-b"]),
    );
});

test("素材包解析拒绝重复 ID、无效引用和不完整结构", () => {
    const asset = imageAsset({ id: "asset-1", folderId: activeFolder.id });
    const base = { app: "infinite-canvas", version: 2, assets: [asset], folders: [activeFolder] };

    assert.throws(() => readAssetLibraryPackageData({ ...base, assets: [asset, asset] }), /duplicate asset id/);
    assert.throws(() => readAssetLibraryPackageData({ ...base, folders: [activeFolder, activeFolder] }), /duplicate folder id/);
    assert.throws(() => readAssetLibraryPackageData({ ...base, folders: [] }), /invalid folder reference/);
    assert.throws(() => readAssetLibraryPackageData({ ...base, assets: [{ id: "broken" }] }), /invalid asset/);
});

test("v2 导出保留所有活跃文件夹包括空文件夹并排除墓碑", () => {
    const emptyFolder = { ...activeFolder, id: "folder-empty", name: "空文件夹" };
    const library = prepareAssetLibraryExport({ assets: [imageAsset({ id: "asset-1", folderId: activeFolder.id })], folders: [activeFolder, emptyFolder, deletedFolder] });

    assert.deepEqual(
        library.folders.map((folder) => folder.id),
        [activeFolder.id, emptyFolder.id],
    );
    assert.equal(library.assets[0].folderId, activeFolder.id);
});

test("移动和删除文件夹只改变分类元数据并保持媒体引用", () => {
    const original = imageAsset({ id: "asset-1" });
    const moved = moveAssetsInLibrary({ assets: [original], folders: [activeFolder], assetTombstones: [] }, [original.id], activeFolder.id, "2026-01-03T00:00:00.000Z");

    assert.equal(moved.assets[0].folderId, activeFolder.id);
    assert.equal(moved.assets[0].kind === "image" && moved.assets[0].data.storageKey, "image:shared");

    const deleted = deleteFolderInLibrary(moved, activeFolder.id, "2026-01-04T00:00:00.000Z");
    assert.equal(deleted.assets[0].folderId, undefined);
    assert.equal(deleted.assets[0].kind === "image" && deleted.assets[0].data.storageKey, "image:shared");
    assert.equal(deleted.folders[0].deletedAt, "2026-01-04T00:00:00.000Z");
});

test("素材包解析同时支持 v1 与 v2 并返回完整素材库", () => {
    const asset = imageAsset({ id: "asset-1", folderId: activeFolder.id });

    const version1 = readAssetLibraryPackageData({ app: "infinite-canvas", version: 1, assets: [{ ...asset, folderId: undefined }] });
    const version2 = readAssetLibraryPackageData({ app: "infinite-canvas", version: 2, assets: [asset], folders: [activeFolder] });

    assert.deepEqual(version1.folders, []);
    assert.equal(version1.assets[0].id, asset.id);
    assert.deepEqual(version2, { assets: [asset], folders: [activeFolder], assetTombstones: [] });
    assert.throws(() => readAssetLibraryPackageData({ app: "infinite-canvas", version: 3, assets: [] }), /unsupported asset package version/);
});
