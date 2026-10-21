import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { restoreLegacyRuntimeProfile } from "./runtime-profile-migration.mjs";

test("旧运行目录的浏览器配置会在备份当前数据后恢复一次", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-profile-"));
  const sourcePath = join(root, "infinite-canvas-desktop");
  const targetPath = join(root, "无限画布");
  try {
    await mkdir(join(sourcePath, "IndexedDB"), { recursive: true });
    await mkdir(join(targetPath, "IndexedDB"), { recursive: true });
    await writeFile(join(sourcePath, "IndexedDB", "config.db"), "legacy-config");
    await writeFile(join(targetPath, "IndexedDB", "config.db"), "beta8-config");
    await writeFile(join(targetPath, "unrelated.txt"), "keep");

    const result = restoreLegacyRuntimeProfile({ sourcePath, targetPath });

    assert.equal(result.restored, true);
    assert.equal(await readFile(join(targetPath, "IndexedDB", "config.db"), "utf8"), "legacy-config");
    assert.equal(await readFile(join(targetPath, "profile-backups", "before-legacy-runtime-restore", "IndexedDB", "config.db"), "utf8"), "beta8-config");
    assert.equal(await readFile(join(targetPath, "unrelated.txt"), "utf8"), "keep");

    await writeFile(join(sourcePath, "IndexedDB", "config.db"), "changed");
    assert.equal(restoreLegacyRuntimeProfile({ sourcePath, targetPath }).reason, "already-restored");
    assert.equal(await readFile(join(targetPath, "IndexedDB", "config.db"), "utf8"), "legacy-config");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("旧运行目录不存在时不创建目标目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-profile-missing-"));
  try {
    const result = restoreLegacyRuntimeProfile({ sourcePath: join(root, "missing"), targetPath: join(root, "无限画布") });
    assert.deepEqual(result, { restored: false, reason: "source-missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
