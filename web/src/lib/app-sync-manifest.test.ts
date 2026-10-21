import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import {
    assertMatchingCreativeSkillSyncSnapshot,
    conditionalWriteHeaders,
    decideCreativeSkillSync,
    readAppSyncManifestFiles,
    readCreativeSkillSyncData,
    requireStrongEntityTag,
    validateDownloadedSyncFile,
} from "./app-sync-manifest.ts";

test("同步媒体清单只接受当前域内的唯一安全路径", () => {
    const file = { storageKey: "image:one", path: "assets/files/image_one.png", mimeType: "image/png", bytes: 3 };
    assert.deepEqual(readAppSyncManifestFiles([file], "assets"), [file]);
    assert.equal(readAppSyncManifestFiles([{ ...file, path: "assets/files/四季画布.png" }], "assets")[0].path, "assets/files/四季画布.png");
    assert.deepEqual(readAppSyncManifestFiles(undefined, "assets"), []);
    assert.throws(() => readAppSyncManifestFiles([file, file], "assets"), /duplicate sync storageKey/);
    assert.throws(() => readAppSyncManifestFiles([{ ...file, path: "canvas/files/image.png" }], "assets"), /invalid sync media path/);
    assert.throws(() => readAppSyncManifestFiles([{ ...file, path: "assets/files/../secret" }], "assets"), /invalid sync media path/);
});

test("同步媒体下载缺失或字节数不符时拒绝应用", () => {
    const file = { storageKey: "image:one", path: "assets/files/image_one.png", mimeType: "image/png", bytes: 3 };
    assert.throws(() => validateDownloadedSyncFile(null, file), /missing remote media/);
    assert.throws(() => validateDownloadedSyncFile(new Blob(["xx"]), file), /damaged remote media/);
    const blob = validateDownloadedSyncFile(new Blob(["xxx"]), file);
    assert.equal(blob.type, "image/png");
    assert.equal(blob.size, 3);
});

test("创作 Skill 条件写必须使用强 ETag，首次创建使用 create-only", () => {
    assert.deepEqual(conditionalWriteHeaders(null), { "If-None-Match": "*" });
    assert.deepEqual(conditionalWriteHeaders('"head-1"'), { "If-Match": '"head-1"' });
    assert.equal(requireStrongEntityTag('"head-1"'), '"head-1"');
    assert.throws(() => requireStrongEntityTag(null), /strong ETag/);
    assert.throws(() => requireStrongEntityTag('W/"head-1"'), /strong ETag/);
});

test("创作 Skill 同步清单只接受受限的内容寻址便携包", () => {
    const sha256 = "b".repeat(64);
    const data = {
        schemaVersion: 1 as const,
        head: "a".repeat(64),
        publishedSkillCount: 2,
        tombstoneCount: 1,
        package: {
            path: `creative-skills/packages/${sha256}.fourj-skills`,
            sha256,
            bytes: 1024,
            mediaType: "application/vnd.fourj.skill-library+zip" as const,
        },
    };

    assert.deepEqual(readCreativeSkillSyncData(data), data);
    assert.throws(() => readCreativeSkillSyncData({ ...data, snapshot: { skills: [] } }), /invalid creative skill sync data/);
    assert.throws(() => readCreativeSkillSyncData({ ...data, package: { ...data.package, path: "creative-skills/packages/other.fourj-skills" } }), /invalid creative skill package path/);
    assert.throws(() => readCreativeSkillSyncData({ ...data, package: { ...data.package, bytes: 64 * 1024 * 1024 + 1 } }), /invalid creative skill package bytes/);
});

test("创作 Skill 按共同 checkpoint 判断单边推进、恢复与冲突", () => {
    const sha256 = "c".repeat(64);
    const local = {
        schemaVersion: 1 as const,
        head: "a".repeat(64),
        publishedSkillCount: 1,
        tombstoneCount: 0,
        package: { path: `creative-skills/packages/${sha256}.fourj-skills`, sha256, bytes: 12, mediaType: "application/vnd.fourj.skill-library+zip" as const },
    };
    const base = { ...local, head: "b".repeat(64) };
    const remoteAdvanced = { ...local, head: "c".repeat(64) };
    assert.deepEqual(decideCreativeSkillSync(local, null, null), { data: local, action: "upload" });
    assert.deepEqual(decideCreativeSkillSync(local, { ...local, publishedSkillCount: 2 }, null), { data: local, action: "none" });
    assert.deepEqual(decideCreativeSkillSync(local, base, base.head), { data: local, action: "upload" });
    assert.deepEqual(decideCreativeSkillSync(base, remoteAdvanced, base.head), { data: base, action: "recovery" });
    assert.deepEqual(decideCreativeSkillSync(local, remoteAdvanced, base.head), { data: local, action: "conflict" });
    assert.deepEqual(decideCreativeSkillSync(local, remoteAdvanced, null), { data: local, action: "conflict" });

    const emptyLocal = { ...local, publishedSkillCount: 0 };
    assert.deepEqual(decideCreativeSkillSync(emptyLocal, null, null), { data: emptyLocal, action: "none" });
    assert.deepEqual(decideCreativeSkillSync(emptyLocal, remoteAdvanced, null), { data: emptyLocal, action: "recovery" });

    const deletedAll = { ...emptyLocal, head: "d".repeat(64), tombstoneCount: 1 };
    assert.deepEqual(decideCreativeSkillSync(deletedAll, null, null), { data: deletedAll, action: "upload" });
    assert.deepEqual(decideCreativeSkillSync(deletedAll, remoteAdvanced, deletedAll.head), { data: deletedAll, action: "recovery" });
});

test("创作 Skill 相同 head 仍要求计数和内容寻址包描述完全一致", () => {
    const sha256 = "c".repeat(64);
    const local = {
        schemaVersion: 1 as const,
        head: "a".repeat(64),
        publishedSkillCount: 1,
        tombstoneCount: 0,
        package: { path: `creative-skills/packages/${sha256}.fourj-skills`, sha256, bytes: 12, mediaType: "application/vnd.fourj.skill-library+zip" as const },
    };

    assert.equal(assertMatchingCreativeSkillSyncSnapshot(local, structuredClone(local)), undefined);
    assert.throws(
        () => assertMatchingCreativeSkillSyncSnapshot(local, { ...local, publishedSkillCount: 2 }),
        /相同 head.*计数|计数.*不一致/,
    );
    const otherHash = "d".repeat(64);
    assert.throws(
        () => assertMatchingCreativeSkillSyncSnapshot(local, {
            ...local,
            package: { ...local.package, path: `creative-skills/packages/${otherHash}.fourj-skills`, sha256: otherHash },
        }),
        /相同 head.*便携包|便携包.*不一致/,
    );
});

async function loadAppSync(context: TestContext) {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => { values.delete(key); },
        setItem: (key, value) => { values.set(key, value); },
    };
    const browserWindow = { localStorage: storage } as unknown as Window;
    const originals = new Map(["window", "document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "" } } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    const server = await createServer({
        root: fileURLToPath(new URL("../..", import.meta.url)),
        server: { middlewareMode: true },
        appType: "custom",
        logLevel: "silent",
    });
    context.after(async () => {
        await server.close();
        originals.forEach((descriptor, key) => {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
    });
    const appSync = await server.ssrLoadModule("/src/services/app-sync.ts");
    return { appSync, browserWindow };
}

test("创作 Skill 同步 lineage 按桌面工作区隔离且不持久化完整路径", async (context) => {
    const { appSync, browserWindow } = await loadAppSync(context);
    const config = { url: "https://dav.example.test", directory: "fourj", username: "user" };
    let workspacePath = "/Users/alice/Documents/workspace-a";
    let skillsPath = "/Volumes/private/skills-a";
    browserWindow.infiniteCanvasDesktop = {
        getWorkspaceInfo: async () => ({ path: workspacePath, locations: { skills: { path: skillsPath } } }),
    } as unknown as NonNullable<Window["infiniteCanvasDesktop"]>;

    const first = await appSync.createCreativeSkillSyncCheckpointTarget(config);
    workspacePath = "/Users/alice/Documents/workspace-b";
    skillsPath = "/Volumes/private/skills-b";
    const second = await appSync.createCreativeSkillSyncCheckpointTarget(config);

    assert.notEqual(first, second);
    assert.equal(first.includes("/Users/alice/Documents/workspace-a"), false);
    assert.equal(first.includes("/Volumes/private/skills-a"), false);
});

test("创作 Skill 同步无法取得权威工作区身份时拒绝建立 lineage", async (context) => {
    const { appSync, browserWindow } = await loadAppSync(context);
    const config = { url: "https://dav.example.test", directory: "fourj", username: "user" };

    await assert.rejects(
        () => appSync.createCreativeSkillSyncCheckpointTarget(config),
        /权威工作区身份不可用/,
    );

    browserWindow.infiniteCanvasDesktop = {
        getWorkspaceInfo: async () => ({ path: "", locations: { skills: { path: "" } } }),
    } as unknown as NonNullable<Window["infiniteCanvasDesktop"]>;
    await assert.rejects(
        () => appSync.createCreativeSkillSyncCheckpointTarget(config),
        /权威工作区身份不可用/,
    );
});
