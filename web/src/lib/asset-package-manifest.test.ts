import assert from "node:assert/strict";
import test from "node:test";

import { readAssetPackageMediaManifest } from "./asset-package-manifest.ts";

const file = { storageKey: "image:shared", path: "files/image_shared.png", mimeType: "image/png", bytes: 10 };

test("v1 素材包兼容多个素材共享同一媒体条目", () => {
    assert.deepEqual(readAssetPackageMediaManifest([file, { ...file }], 1), [file]);
    assert.throws(() => readAssetPackageMediaManifest([file, { ...file, bytes: 11 }], 1), /conflicting legacy asset media entry/);
});

test("v2 素材包要求 storageKey 和路径各自唯一", () => {
    assert.deepEqual(readAssetPackageMediaManifest([file], 2), [file]);
    assert.throws(() => readAssetPackageMediaManifest([file, { ...file }], 2), /duplicate asset storageKey/);
    assert.throws(() => readAssetPackageMediaManifest([file, { ...file, storageKey: "image:other" }], 2), /duplicate asset package path/);
});

test("素材包媒体清单拒绝越界路径和无效字节数", () => {
    assert.throws(() => readAssetPackageMediaManifest([{ ...file, path: "../image.png" }], 2), /invalid asset package path/);
    assert.throws(() => readAssetPackageMediaManifest([{ ...file, bytes: -1 }], 2), /invalid asset media bytes/);
});
