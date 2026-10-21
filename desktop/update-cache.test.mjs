import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUpdateCache } from "./update-cache.mjs";

test("新版本首次健康启动会清除旧安装包且同版本重启不会重复处理", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-update-cache-"));
  const cacheDir = join(root, "cache");
  const markerFile = join(root, "healthy-version.txt");
  const cache = createUpdateCache({ cacheDir, markerFile });
  await mkdir(join(cacheDir, "pending"), { recursive: true });
  await writeFile(join(cacheDir, "pending", "old.exe"), Buffer.alloc(4096));

  const first = await cache.markHealthyVersion("0.1.0-alpha.6");
  assert.equal(first.clearedBytes, 4096);
  assert.equal((await cache.inspect()).bytes, 0);
  assert.equal(await readFile(markerFile, "utf8"), "0.1.0-alpha.6");

  const second = await cache.markHealthyVersion("0.1.0-alpha.6");
  assert.equal(second.clearedBytes, 0);
});

test("跨版本健康启动会标记一次升级完成", async () => {
  const root = await mkdtemp(join(tmpdir(), "infinite-canvas-update-cache-"));
  const cache = createUpdateCache({
    cacheDir: join(root, "cache"),
    markerFile: join(root, "healthy-version.txt"),
  });

  const first = await cache.markHealthyVersion("0.1.0-beta.2");
  const upgraded = await cache.markHealthyVersion("0.1.0-beta.3");
  const restarted = await cache.markHealthyVersion("0.1.0-beta.3");

  assert.equal(first.updated, false);
  assert.equal(upgraded.updated, true);
  assert.equal(upgraded.previousVersion, "0.1.0-beta.2");
  assert.equal(restarted.updated, false);
});
