import { cp, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

const MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};
const EXTENSION_MIME_TYPES = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mimeType, extension]) => [
    extension,
    mimeType,
  ]),
);
EXTENSION_MIME_TYPES[".jpeg"] = "image/jpeg";

const KIND_DIRECTORIES = {
  image: "images",
  video: "videos",
  audio: "audio",
  file: "files",
};
const KIND_EXTENSIONS = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]),
  video: new Set([".mp4", ".webm"]),
  audio: new Set([".mp3", ".wav"]),
};
const IDEMPOTENT_IMAGE_DIRECTORY = ".creative-skill-outputs";
const STATE_FILES = {
  "infinite-canvas:canvas_store": "canvas-projects.json",
  "infinite-canvas:asset_store": "asset-library.json",
  "infinite-canvas:plugin_store": "plugins.json",
};

async function listFiles(root) {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return visit(path);
      if (!entry.isFile()) return;
      const info = await stat(path);
      files.push({ path, bytes: info.size, name: entry.name });
    }));
  };
  await visit(root);
  return files;
}

function collectWorkspaceStorageKeys(value, keys = new Set()) {
  if (typeof value === "string") {
    if (/^workspace:assets\/(images|videos|audio)\//.test(value)) keys.add(value);
    return keys;
  }
  if (!value || typeof value !== "object") return keys;
  const isPurgedTombstone =
    !Array.isArray(value) &&
    ((typeof value.purgedAt === "number" && Number.isFinite(value.purgedAt)) ||
      (typeof value.purgedAt === "string" && value.purgedAt.length > 0));
  Object.entries(value).forEach(([key, item]) => {
    if (isPurgedTombstone && key === "formerOutputStorageKeys") return;
    collectWorkspaceStorageKeys(item, keys);
  });
  return keys;
}

function collectCreativeSkillOutputKeys(value, keys) {
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (key === "outputId" && typeof item === "string" && item.trim() && item.length <= 1024) {
      const fingerprint = idempotentAssetFingerprint(item);
      KIND_EXTENSIONS.image.forEach((extension) => {
        keys.add(`workspace:assets/images/${IDEMPOTENT_IMAGE_DIRECTORY}/${fingerprint}${extension}`);
      });
      return;
    }
    collectCreativeSkillOutputKeys(item, keys);
  });
}

async function readReferencedStorageKeys(directories, { failOnInvalidJson = false } = {}) {
  const keys = new Set();
  const files = (await Promise.all(directories.map(listFiles))).flat().filter((file) => file.name.endsWith(".json"));
  await Promise.all(files.map(async (file) => {
    try {
      const value = JSON.parse(await readFile(file.path, "utf8"));
      collectWorkspaceStorageKeys(value, keys);
      if (file.name === "creative-skill-recovery.json") collectCreativeSkillOutputKeys(value, keys);
    } catch (error) {
      if (failOnInvalidJson)
        throw new Error("工作区包含损坏的数据文件，请先修复或恢复后再删除", { cause: error });
      // A damaged JSON file is reported by the workspace health scan and must not make cleanup unsafe.
    }
  }));
  return keys;
}

function addProtectedStorageKeys(keys, additionalKeys) {
  if (!Array.isArray(additionalKeys)) return keys;
  additionalKeys.forEach((key) => {
    if (typeof key === "string" && /^workspace:assets\/(images|videos|audio)\//.test(key)) keys.add(key);
  });
  return keys;
}

function storageKeyForFile(category, basePath, path) {
  const directory = category === "images" ? "images" : category === "videos" ? "videos" : "audio";
  const relativePath = relative(basePath, path).split(sep).join("/");
  return `workspace:assets/${directory}/${relativePath}`;
}

export function createWorkspaceStore({
  root,
  categoryRoots,
  fetch: fetchAsset,
  createId,
  now,
}) {
  const rootPath = resolve(root);
  const roots = {
    images: resolve(categoryRoots?.images || join(rootPath, "assets/images")),
    videos: resolve(categoryRoots?.videos || join(rootPath, "assets/videos")),
    audio: resolve(categoryRoots?.audio || join(rootPath, "assets/audio")),
    projects: resolve(categoryRoots?.projects || join(rootPath, "projects")),
    records: resolve(categoryRoots?.records || join(rootPath, "records")),
    skills: resolve(categoryRoots?.skills || join(rootPath, "skills")),
  };
  const backupsRoot = join(rootPath, "backups");
  const protectedAssetsPath = join(roots.records, ".infinite-canvas-protected-assets.json");
  const createdAssetPaths = new Set();
  let assetSaveQueue = Promise.resolve();
  let protectedAssetKeys;
  const protectExternalAsset = async (storageKey) => {
    if (!protectedAssetKeys) {
      try {
        const payload = JSON.parse(await readFile(protectedAssetsPath, "utf8"));
        if (payload?.schemaVersion !== 1 || !Array.isArray(payload.storageKeys)) throw new Error("受保护素材清单格式无效");
        protectedAssetKeys = new Set(payload.storageKeys.filter((key) => typeof key === "string"));
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
        protectedAssetKeys = new Set();
      }
    }
    if (protectedAssetKeys.has(storageKey)) return;
    const nextKeys = new Set(protectedAssetKeys);
    nextKeys.add(storageKey);
    const temporaryPath = `${protectedAssetsPath}.${createId()}.tmp`;
    await mkdir(dirname(protectedAssetsPath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify({ schemaVersion: 1, storageKeys: [...nextKeys].sort() }, null, 2), "utf8");
    await rename(temporaryPath, protectedAssetsPath);
    protectedAssetKeys = nextKeys;
  };
  const pathForStorageKey = (storageKey) => {
    const relativeKey =
      typeof storageKey === "string" && storageKey.startsWith("workspace:")
        ? storageKey.slice("workspace:".length)
        : "";
    const route = [
      ["assets/images", roots.images],
      ["assets/videos", roots.videos],
      ["assets/audio", roots.audio],
    ].find(([prefix]) => relativeKey === prefix || relativeKey.startsWith(`${prefix}/`));
    const basePath = route?.[1] || rootPath;
    const routedKey = route ? relativeKey.slice(route[0].length).replace(/^\/+/, "") : relativeKey;
    const path = resolve(basePath, ...routedKey.split("/").filter(Boolean));
    const child = relative(basePath, path);
    if (
      !relativeKey ||
      isAbsolute(child) ||
      child === ".." ||
      child.startsWith(`..${sep}`)
    )
      throw new Error("无效的工作区文件");
    return path;
  };
  const statePath = (name) => {
    if (typeof name !== "string" || !name || name.length > 180)
      throw new Error("无效的工作区状态名称");
    const recordPrefix = "infinite-canvas:records:";
    if (name.startsWith(recordPrefix)) {
      const recordName = name.slice(recordPrefix.length);
      if (!/^[a-z0-9_-]+$/i.test(recordName))
        throw new Error("无效的生成记录名称");
      return join(roots.records, `${recordName}.json`);
    }
    return join(
      roots.projects,
      STATE_FILES[name] || `${encodeURIComponent(name)}.json`,
    );
  };
  return {
    pathForStorageKey,
    async initialize() {
      await Promise.all(
        [...Object.values(roots), join(rootPath, "assets/files")].map((directory) => mkdir(directory, { recursive: true })),
      );
      const manifestPath = join(root, "workspace.json");
      try {
        await writeFile(
          manifestPath,
          JSON.stringify(
            {
              schemaVersion: 1,
              appId: "com.infinitecanvas.desktop",
              createdAt: now().toISOString(),
            },
            null,
            2,
          ),
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "EEXIST")
          throw error;
      }
    },
    async createRecoveryPoint(reason = "manual") {
      const safeReason = String(reason).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "backup";
      const timestamp = now().toISOString().replace(/[:.]/g, "-");
      const target = join(backupsRoot, `${timestamp}-${safeReason}-${createId()}`);
      await mkdir(target, { recursive: true });
      await Promise.all([
        cp(roots.projects, join(target, "projects"), { recursive: true, force: false, errorOnExist: false }).catch((error) => {
          if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
        }),
        cp(roots.records, join(target, "records"), { recursive: true, force: false, errorOnExist: false }).catch((error) => {
          if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
        }),
        cp(roots.skills, join(target, "skills"), { recursive: true, force: false, errorOnExist: false }).catch((error) => {
          if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
        }),
      ]);
      await writeFile(join(target, "recovery.json"), JSON.stringify({ schemaVersion: 1, reason: safeReason, createdAt: now().toISOString() }, null, 2), "utf8");
      const backups = (await readdir(backupsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
      await Promise.all(backups.slice(5).map((name) => rm(join(backupsRoot, name), { recursive: true, force: true })));
      return target;
    },
    async inspectStorage(additionalProtectedStorageKeys = []) {
      const referencedKeys = addProtectedStorageKeys(await readReferencedStorageKeys([roots.projects, roots.records, roots.skills]), additionalProtectedStorageKeys);
      const mediaCategories = ["images", "videos", "audio"];
      const categories = {};
      for (const category of mediaCategories) {
        const files = (await listFiles(roots[category])).filter((file) => !file.name.startsWith(".infinite-canvas-"));
        const unreferenced = files.filter((file) => !referencedKeys.has(storageKeyForFile(category, roots[category], file.path)));
        categories[category] = {
          files: files.length,
          bytes: files.reduce((total, file) => total + file.bytes, 0),
          unreferencedFiles: unreferenced.length,
          unreferencedBytes: unreferenced.reduce((total, file) => total + file.bytes, 0),
        };
      }
      for (const category of ["projects", "records", "skills"]) {
        const files = (await listFiles(roots[category])).filter((file) => !file.name.startsWith(".infinite-canvas-"));
        categories[category] = {
          files: files.length,
          bytes: files.reduce((total, file) => total + file.bytes, 0),
          unreferencedFiles: 0,
          unreferencedBytes: 0,
        };
      }
      const damagedJsonFiles = [];
      const jsonFiles = (await Promise.all([roots.projects, roots.records, roots.skills].map(listFiles))).flat().filter((file) => file.name.endsWith(".json"));
      await Promise.all(jsonFiles.map(async (file) => {
        try {
          JSON.parse(await readFile(file.path, "utf8"));
        } catch {
          damagedJsonFiles.push(file.path);
        }
      }));
      const staleTempFiles = (await Promise.all([roots.projects, roots.records, roots.skills, join(roots.images, IDEMPOTENT_IMAGE_DIRECTORY)].map(listFiles))).flat().filter((file) => file.name.endsWith(".tmp"));
      return {
        categories,
        totalBytes: Object.values(categories).reduce((total, category) => total + category.bytes, 0),
        health: { ok: !damagedJsonFiles.length && !staleTempFiles.length, damagedJsonFiles, staleTempFiles: staleTempFiles.map((file) => file.path) },
      };
    },
    async cleanupStorage(selectedCategories, additionalProtectedStorageKeys = []) {
      const inspection = await this.inspectStorage(additionalProtectedStorageKeys);
      if (inspection.health.damagedJsonFiles.length)
        throw new Error("工作区包含损坏的数据文件，请先修复或恢复后再清理");
      const categories = new Set(Array.isArray(selectedCategories) ? selectedCategories : []);
      await this.createRecoveryPoint("storage-cleanup");
      let deletedFiles = 0;
      let deletedBytes = 0;
      let protectedFiles = 0;
      let protectedBytes = 0;
      const referencedKeys = addProtectedStorageKeys(await readReferencedStorageKeys([roots.projects, roots.records, roots.skills]), additionalProtectedStorageKeys);
      for (const category of ["images", "videos", "audio"]) {
        if (!categories.has(category)) continue;
        const files = (await listFiles(roots[category])).filter((file) => !file.name.startsWith(".infinite-canvas-"));
        await Promise.all(files.map(async (file) => {
          const key = storageKeyForFile(category, roots[category], file.path);
          if (referencedKeys.has(key)) {
            protectedFiles += 1;
            protectedBytes += file.bytes;
            return;
          }
          await unlink(file.path);
          deletedFiles += 1;
          deletedBytes += file.bytes;
        }));
      }
      return { deletedFiles, deletedBytes, protectedFiles, protectedBytes };
    },
    async repairStorage() {
      await this.initialize();
      const tempFiles = (await Promise.all([roots.projects, roots.records, roots.skills, join(roots.images, IDEMPOTENT_IMAGE_DIRECTORY)].map(listFiles))).flat().filter((file) => file.name.endsWith(".tmp"));
      await Promise.all(tempFiles.map((file) => unlink(file.path).catch(() => undefined)));
      return this.inspectStorage();
    },
    async readState(name) {
      try {
        return await readFile(statePath(name), "utf8");
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT")
          return null;
        throw error;
      }
    },
    async writeState(name, value) {
      const path = statePath(name);
      const temporaryPath = `${path}.${createId()}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporaryPath, value, "utf8");
      await rename(temporaryPath, path);
    },
    async removeState(name) {
      try {
        await unlink(statePath(name));
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "ENOENT")
          throw error;
      }
    },
    async writeAsset(storageKey, bytes) {
      const path = pathForStorageKey(storageKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(bytes));
      return path;
    },
    async deleteAsset(storageKey) {
      const referencedKeys = await readReferencedStorageKeys(
        [roots.projects, roots.records, roots.skills],
        { failOnInvalidJson: true },
      );
      if (referencedKeys.has(storageKey)) return false;
      try {
        await unlink(pathForStorageKey(storageKey));
        return true;
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return true;
        throw error;
      }
    },
    async saveAsset({
      remoteUrl,
      bytes: inputBytes,
      mimeType: inputMimeType,
      kind,
      idempotencyKey,
    }) {
      let bytes = inputBytes ? new Uint8Array(inputBytes) : null;
      let mimeType = inputMimeType?.split(";")[0].trim().toLowerCase() || "";
      if (!bytes) {
        const response = await fetchAsset(remoteUrl);
        if (!response.ok)
          throw new Error(`下载生成结果失败（HTTP ${response.status}）`);
        mimeType =
          response.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() || "application/octet-stream";
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      const sourceExtension = remoteUrl
        ? extname(new URL(remoteUrl).pathname).toLowerCase()
        : "";
      const expectedMimePrefix =
        kind === "image"
          ? "image/"
          : kind === "video"
            ? "video/"
            : kind === "audio"
              ? "audio/"
              : "";
      const extensionMimeType = EXTENSION_MIME_TYPES[sourceExtension];
      if (
        mimeType === "application/octet-stream" &&
        KIND_EXTENSIONS[kind]?.has(sourceExtension) &&
        extensionMimeType
      )
        mimeType = extensionMimeType;
      if (expectedMimePrefix && !mimeType.startsWith(expectedMimePrefix)) {
        throw new Error(
          `生成结果不是${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}（${mimeType || "未知类型"}）`,
        );
      }
      const directory = KIND_DIRECTORIES[kind] || KIND_DIRECTORIES.file;
      const date = now().toISOString().slice(0, 10);
      const extension = MIME_EXTENSIONS[mimeType] || sourceExtension || ".bin";
      const save = assetSaveQueue.then(async () => {
        const categoryRoot = roots[directory];
        if (idempotencyKey !== undefined) {
          if (kind !== "image" || !categoryRoot || !KIND_EXTENSIONS.image.has(extension)) throw new Error("创作 Skill 只支持幂等暂存图片输出");
          const fingerprint = idempotentAssetFingerprint(idempotencyKey);
          const idempotentDirectory = join(categoryRoot, IDEMPOTENT_IMAGE_DIRECTORY);
          const candidates = (await listFiles(idempotentDirectory)).filter((file) => file.name.startsWith(`${fingerprint}.`) && KIND_EXTENSIONS.image.has(extname(file.name).toLowerCase()));
          if (candidates.length > 1) throw new Error("创作 Skill 暂存输出冲突");
          const existingFile = candidates[0];
          if (existingFile) {
            const existing = await readFile(existingFile.path);
            if (contentFingerprint(existing) !== contentFingerprint(bytes)) throw new Error("相同创作输出键的内容不一致，已拒绝覆盖");
            const storageKey = storageKeyForFile("images", categoryRoot, existingFile.path);
            return {
              storageKey,
              relativePath: storageKey.slice("workspace:".length),
              path: existingFile.path,
              bytes: existing.byteLength,
              mimeType: EXTENSION_MIME_TYPES[extname(existingFile.path).toLowerCase()] || mimeType,
              created: false,
            };
          }
          const relativePath = posix.join("assets", directory, IDEMPOTENT_IMAGE_DIRECTORY, `${fingerprint}${extension}`);
          const path = pathForStorageKey(`workspace:${relativePath}`);
          const temporaryPath = join(dirname(path), `.${fingerprint}.${createId()}.tmp`);
          await mkdir(dirname(path), { recursive: true });
          try {
            const handle = await open(temporaryPath, "wx");
            try {
              await handle.writeFile(bytes);
              await handle.sync();
            } finally {
              await handle.close();
            }
            await rename(temporaryPath, path);
          } catch (error) {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
          }
          createdAssetPaths.add(path);
          return { storageKey: `workspace:${relativePath}`, relativePath, path, bytes: bytes.byteLength, mimeType, created: true };
        }
        if (categoryRoot) {
          const fingerprint = contentFingerprint(bytes);
          const candidates = (await listFiles(categoryRoot)).filter((file) => file.bytes === bytes.byteLength && KIND_EXTENSIONS[kind]?.has(extname(file.path).toLowerCase()));
          for (const file of candidates) {
            if (contentFingerprint(await readFile(file.path)) !== fingerprint) continue;
            const storageKey = storageKeyForFile(directory, categoryRoot, file.path);
            if (!createdAssetPaths.has(file.path) && !isManagedAssetPath(categoryRoot, file.path)) await protectExternalAsset(storageKey);
            return {
              storageKey,
              relativePath: storageKey.slice("workspace:".length),
              path: file.path,
              bytes: file.bytes,
              mimeType: EXTENSION_MIME_TYPES[extname(file.path).toLowerCase()] || mimeType,
              created: false,
            };
          }
        }
        const relativePath = posix.join("assets", directory, date, `${createId()}${extension}`);
        const path = pathForStorageKey(`workspace:${relativePath}`);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        createdAssetPaths.add(path);
        return { storageKey: `workspace:${relativePath}`, relativePath, path, bytes: bytes.byteLength, mimeType, created: true };
      });
      assetSaveQueue = save.then(() => undefined, () => undefined);
      return save;
    },
    async findAssetByIdempotencyKey({ kind, idempotencyKey }) {
      if (kind !== "image") throw new Error("创作 Skill 只支持查询图片输出");
      const fingerprint = idempotentAssetFingerprint(idempotencyKey);
      const directory = join(roots.images, IDEMPOTENT_IMAGE_DIRECTORY);
      const candidates = (await listFiles(directory)).filter((file) => file.name.startsWith(`${fingerprint}.`) && KIND_EXTENSIONS.image.has(extname(file.name).toLowerCase()));
      if (candidates.length > 1) throw new Error("创作 Skill 暂存输出冲突");
      const file = candidates[0];
      if (!file) return null;
      const storageKey = storageKeyForFile("images", roots.images, file.path);
      return {
        storageKey,
        relativePath: storageKey.slice("workspace:".length),
        path: file.path,
        bytes: file.bytes,
        mimeType: EXTENSION_MIME_TYPES[extname(file.path).toLowerCase()] || "application/octet-stream",
        created: false,
      };
    },
  };
}

function contentFingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function idempotentAssetFingerprint(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new Error("无效的创作 Skill 输出键");
  return contentFingerprint(Buffer.from(value, "utf8"));
}

function isManagedAssetPath(root, path) {
  const managedPath = relative(root, path).split(sep).join("/");
  return /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(managedPath) ||
    new RegExp(`^\\${IDEMPOTENT_IMAGE_DIRECTORY}/[a-f0-9]{64}\\.[a-z0-9]+$`, "i").test(managedPath);
}
