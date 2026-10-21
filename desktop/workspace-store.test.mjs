import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspaceStore } from "./workspace-store.mjs";

test("远程生成结果会保存为工作区中的可见图片文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const store = createWorkspaceStore({
    root,
    fetch: async () =>
      new Response(png, { headers: { "content-type": "image/png" } }),
    createId: () => "generated-image",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });

  const result = await store.saveAsset({
    remoteUrl: "https://cdn.example.com/result",
    kind: "image",
  });

  assert.equal(
    result.storageKey,
    "workspace:assets/images/2026-08-13/generated-image.png",
  );
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.bytes, png.byteLength);
  assert.deepEqual(await readFile(result.path), Buffer.from(png));
});

test("新图片按生成日期写入图片区域而不是内容寻址目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "generated-image",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });

  const result = await store.saveAsset({
    bytes: Uint8Array.from([137, 80, 78, 71]),
    mimeType: "image/png",
    kind: "image",
  });

  assert.equal(
    result.storageKey,
    "workspace:assets/images/2026-08-13/generated-image.png",
  );
  assert.equal(
    result.path,
    join(root, "assets/images/2026-08-13/generated-image.png"),
  );
});

test("初始化工作区不会复制或覆盖文件夹中已有内容", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  await writeFile(join(root, "用户文件.txt"), "keep");
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });

  await store.initialize();

  assert.equal(await readFile(join(root, "用户文件.txt"), "utf8"), "keep");
  assert.equal(
    JSON.parse(await readFile(join(root, "workspace.json"), "utf8")).appId,
    "com.infinitecanvas.desktop",
  );
  for (const directory of [
    "assets/images",
    "assets/videos",
    "assets/audio",
    "projects",
    "records",
    "skills",
  ]) {
    assert.equal((await stat(join(root, directory))).isDirectory(), true);
  }
});

test("用户导入的媒体也按类型保存到工作区", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "clip",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });

  const result = await store.saveAsset({
    bytes: Uint8Array.from([1, 2, 3]),
    mimeType: "video/mp4",
    kind: "video",
  });

  assert.equal(
    result.storageKey,
    "workspace:assets/videos/2026-08-13/clip.mp4",
  );
  assert.deepEqual(await readFile(result.path), Buffer.from([1, 2, 3]));
});

test("相同媒体只保存一份并复用原文件标识", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  let imageId = 0;
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => `image-${++imageId}`,
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  const input = { bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png", kind: "image" };

  const first = await store.saveAsset(input);
  const second = await store.saveAsset(input);

  assert.equal(second.storageKey, first.storageKey);
  assert.equal(second.path, first.path);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.match(first.storageKey, /^workspace:assets\/images\/2026-08-13\/image-1\.png$/);
  assert.deepEqual(await readFile(first.path), Buffer.from(input.bytes));
  assert.equal(imageId, 1);
});

test("创作 Skill 输出按幂等键原子暂存并可在重启后查询", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const options = {
    root,
    fetch: globalThis.fetch,
    createId: () => "temporary-output",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  };
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const firstStore = createWorkspaceStore(options);

  const saved = await firstStore.saveAsset({ bytes, mimeType: "image/png", kind: "image", idempotencyKey: "run-1:step-0:output-0" });
  const restartedStore = createWorkspaceStore(options);
  const found = await restartedStore.findAssetByIdempotencyKey({ kind: "image", idempotencyKey: "run-1:step-0:output-0" });

  assert.match(saved.storageKey, /^workspace:assets\/images\/\.creative-skill-outputs\/[a-f0-9]{64}\.png$/);
  assert.equal(found?.storageKey, saved.storageKey);
  assert.deepEqual(await readFile(found.path), Buffer.from(bytes));
});

test("相同创作输出键不能被不同内容覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "temporary-output",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  const first = Uint8Array.from([1, 2, 3]);
  const input = { mimeType: "image/png", kind: "image", idempotencyKey: "run-1:step-0:output-0" };
  const saved = await store.saveAsset({ ...input, bytes: first });

  await assert.rejects(() => store.saveAsset({ ...input, bytes: Uint8Array.from([4, 5, 6]) }), /内容不一致/);
  assert.deepEqual(await readFile(saved.path), Buffer.from(first));
});

test("相同创作输出键跨 MIME 元数据仍只复用一份暂存文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "temporary-output",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  const bytes = Uint8Array.from([1, 2, 3]);
  const idempotencyKey = "run-1:step-0:output-0";

  const first = await store.saveAsset({ bytes, mimeType: "image/png", kind: "image", idempotencyKey });
  const second = await store.saveAsset({ bytes, mimeType: "image/jpeg", kind: "image", idempotencyKey });
  const found = await store.findAssetByIdempotencyKey({ kind: "image", idempotencyKey });

  assert.equal(second.storageKey, first.storageKey);
  assert.equal(second.mimeType, "image/png");
  assert.equal(second.created, false);
  assert.equal(found?.storageKey, first.storageKey);
});

test("恢复记录中的创作输出键会保护尚未入账的暂存图片", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "temporary-output",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  const outputId = "run-1:step-0:output-0";
  const saved = await store.saveAsset({ bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png", kind: "image", idempotencyKey: outputId });
  await store.writeState("infinite-canvas:records:creative-skill-recovery", JSON.stringify({
    entries: [{ calls: [{ outputId, idempotencyKey: `sha256:${"a".repeat(64)}:0:0` }] }],
  }));

  const overview = await store.inspectStorage();
  const cleanup = await store.cleanupStorage(["images"]);

  assert.equal(overview.categories.images.unreferencedFiles, 0);
  assert.equal(cleanup.deletedFiles, 0);
  assert.deepEqual(await readFile(saved.path), Buffer.from([1, 2, 3]));

  await store.removeState("infinite-canvas:records:creative-skill-recovery");
  const released = await store.cleanupStorage(["images"]);
  assert.equal(released.deletedFiles, 1);
});

test("自定义图片目录已有同内容文件时直接引用原文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const images = await mkdtemp(join(tmpdir(), "fourj-source-images-"));
  await writeFile(join(images, "reference.png"), Buffer.from([1, 2, 3]));
  const store = createWorkspaceStore({
    root,
    categoryRoots: { images },
    fetch: globalThis.fetch,
    createId: () => "copy",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });

  const result = await store.saveAsset({ bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png", kind: "image" });

  assert.equal(result.storageKey, "workspace:assets/images/reference.png");
  assert.equal(result.path, join(images, "reference.png"));
  assert.equal(result.created, false);
  assert.equal(await store.deleteAsset(result.storageKey), false);
  const cleanup = await store.cleanupStorage(["images"]);
  assert.equal(cleanup.deletedFiles, 0);
  assert.deepEqual(await readFile(result.path), Buffer.from([1, 2, 3]));
});

test("工作区文件标识不能越过用户选择的目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date(),
  });

  assert.equal(
    store.pathForStorageKey("workspace:assets/images/a.png"),
    join(root, "assets/images/a.png"),
  );
  assert.throws(
    () => store.pathForStorageKey("workspace:../../Cookies"),
    /无效的工作区文件/,
  );
});

test("项目状态按工作区隔离保存和读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date(),
  });
  await store.initialize();

  await store.writeState("infinite-canvas:canvas_store", '{"projects":[1]}');

  assert.equal(
    await store.readState("infinite-canvas:canvas_store"),
    '{"projects":[1]}',
  );
  assert.equal(await store.readState("missing"), null);
});

test("图片、视频、音频、项目和生成记录可分别使用自定义目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const categoryRoots = Object.fromEntries(
    await Promise.all(
      ["images", "videos", "audio", "projects", "records", "skills"].map(async (category) => [
        category,
        await mkdtemp(join(tmpdir(), `infinite-canvas-${category}-`)),
      ]),
    ),
  );
  const store = createWorkspaceStore({
    root,
    categoryRoots,
    fetch: globalThis.fetch,
    createId: () => "custom-image",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  await store.initialize();

  await store.writeState("infinite-canvas:canvas_store", '{"projects":[1]}');
  await store.writeState("infinite-canvas:records:image_generation_logs", "[]");
  const image = await store.saveAsset({ bytes: Uint8Array.from([1]), mimeType: "image/png", kind: "image" });

  assert.equal(image.path.startsWith(join(categoryRoots.images, "2026-08-13")), true);
  assert.equal(await readFile(join(categoryRoots.projects, "canvas-projects.json"), "utf8"), '{"projects":[1]}');
  assert.equal(await readFile(join(categoryRoots.records, "image_generation_logs.json"), "utf8"), "[]");
  assert.equal((await stat(categoryRoots.skills)).isDirectory(), true);
  assert.equal(store.pathForStorageKey("workspace:assets/videos/clip.mp4"), join(categoryRoots.videos, "clip.mp4"));
  assert.equal(store.pathForStorageKey("workspace:assets/audio/voice.mp3"), join(categoryRoots.audio, "voice.mp3"));
});

test("中转返回错误页面时不会把它误存成图片", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: async () =>
      new Response('{"error":"expired"}', {
        headers: { "content-type": "application/json" },
      }),
    createId: () => "bad-image",
    now: () => new Date(),
  });

  await assert.rejects(
    () =>
      store.saveAsset({
        remoteUrl: "https://cdn.example.com/result",
        kind: "image",
      }),
    /不是图片/,
  );
});

test("通用二进制响应只有图片扩展名时才能作为图片保存", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: async () =>
      new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "application/octet-stream" },
      }),
    createId: () => "binary-image",
    now: () => new Date(),
  });

  await assert.rejects(
    () =>
      store.saveAsset({
        remoteUrl: "https://cdn.example.com/result.json",
        kind: "image",
      }),
    /不是图片/,
  );
  assert.equal(
    (
      await store.saveAsset({
        remoteUrl: "https://cdn.example.com/result.png",
        kind: "image",
      })
    ).mimeType,
    "image/png",
  );
});

test("生成记录写入 records 而不是项目目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date(),
  });
  await store.initialize();

  await store.writeState("infinite-canvas:records:image_generation_logs", "{}");

  assert.equal(
    await readFile(join(root, "records", "image_generation_logs.json"), "utf8"),
    "{}",
  );
});

test("恢复备份时可以按原工作区标识写回文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date(),
  });

  await store.writeAsset(
    "workspace:assets/images/2026-08-13/restored.png",
    Uint8Array.from([7, 8, 9]),
  );

  assert.deepEqual(
    await readFile(join(root, "assets/images/2026-08-13/restored.png")),
    Buffer.from([7, 8, 9]),
  );
});

test("存储清理只删除未被项目和记录引用的成果", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  let assetId = 0;
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => `recovery-${++assetId}`,
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  await store.initialize();
  const used = await store.saveAsset({ bytes: Uint8Array.from([1]), mimeType: "image/png", kind: "image" });
  const unused = await store.saveAsset({ bytes: Uint8Array.from([2]), mimeType: "image/png", kind: "image" });
  await store.writeState("infinite-canvas:canvas_store", JSON.stringify({ projects: [{ image: { storageKey: used.storageKey } }] }));

  const before = await store.inspectStorage();
  assert.equal(before.categories.images.files, 2);
  assert.equal(before.categories.images.unreferencedFiles, 1);

  const result = await store.cleanupStorage(["images"]);
  assert.equal(result.deletedFiles, 1);
  assert.equal(result.protectedFiles, 1);
  assert.deepEqual(await readFile(used.path), Buffer.from([1]));
  await assert.rejects(() => readFile(unused.path), /ENOENT/);
});

test("项目数据损坏时拒绝清理成果文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "recovery-id",
    now: () => new Date("2026-08-13T08:30:00.000Z"),
  });
  await store.initialize();
  const image = await store.saveAsset({ bytes: Uint8Array.from([3]), mimeType: "image/png", kind: "image" });
  await store.writeState("infinite-canvas:canvas_store", "{ damaged");

  await assert.rejects(() => store.cleanupStorage(["images"]), /损坏的数据文件/);
  assert.deepEqual(await readFile(image.path), Buffer.from([3]));
});

test("直接删除成果时仍会保护项目或素材库正在引用的文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date(),
  });
  await store.initialize();
  const image = await store.saveAsset({ bytes: Uint8Array.from([4]), mimeType: "image/png", kind: "image" });
  await store.writeState("infinite-canvas:asset_store", JSON.stringify({ assets: [{ storageKey: image.storageKey }] }));

  assert.equal(await store.deleteAsset(image.storageKey), false);
  assert.deepEqual(await readFile(image.path), Buffer.from([4]));
  await store.removeState("infinite-canvas:asset_store");
  assert.equal(await store.deleteAsset(image.storageKey), true);
  await assert.rejects(() => readFile(image.path), /ENOENT/);
});

test("直接删除成果时任一项目或记录 JSON 损坏都会保留文件并报错", async () => {
  for (const damagedState of [
    "infinite-canvas:canvas_store",
    "infinite-canvas:records:image_generation_logs",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
    const store = createWorkspaceStore({
      root,
      fetch: globalThis.fetch,
      createId: () => "id",
      now: () => new Date(),
    });
    await store.initialize();
    const image = await store.saveAsset({ bytes: Uint8Array.from([5]), mimeType: "image/png", kind: "image" });
    await store.writeState(damagedState, "{ damaged");

    await assert.rejects(() => store.deleteAsset(image.storageKey), /损坏的数据文件/);
    assert.deepEqual(await readFile(image.path), Buffer.from([5]));
  }
});

test("永久删除不会被已清空墓碑中的原成果标识自我保护", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  let assetId = 0;
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => `id-${++assetId}`,
    now: () => new Date(),
  });
  await store.initialize();
  const image = await store.saveAsset({ bytes: Uint8Array.from([6]), mimeType: "image/png", kind: "image" });
  const retained = await store.saveAsset({ bytes: Uint8Array.from([7]), mimeType: "image/png", kind: "image" });
  await store.writeState("infinite-canvas:records:image_generation_logs", JSON.stringify({
    records: [{
      id: "purged-record",
      purgedAt: Date.parse("2026-08-19T08:00:00.000Z"),
      formerOutputStorageKeys: [image.storageKey],
      retainedReference: retained.storageKey,
    }],
  }));

  assert.equal(await store.deleteAsset(image.storageKey), true);
  await assert.rejects(() => readFile(image.path), /ENOENT/);
  assert.equal(await store.deleteAsset(retained.storageKey), false);
  assert.deepEqual(await readFile(retained.path), Buffer.from([7]));
});

test("普通生成记录中的成果标识仍会阻止直接删除", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-workspace-"));
  const store = createWorkspaceStore({
    root,
    fetch: globalThis.fetch,
    createId: () => "id",
    now: () => new Date(),
  });
  await store.initialize();
  const image = await store.saveAsset({ bytes: Uint8Array.from([7]), mimeType: "image/png", kind: "image" });
  await store.writeState("infinite-canvas:records:image_generation_logs", JSON.stringify({
    records: [{ id: "active-record", outputStorageKeys: [image.storageKey] }],
  }));

  assert.equal(await store.deleteAsset(image.storageKey), false);
  assert.deepEqual(await readFile(image.path), Buffer.from([7]));
});
