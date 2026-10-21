import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspaceStore } from "./workspace-store.mjs";
import { migrateWorkspaceContents } from "./workspace-migration.mjs";

const electronTestModule = `
const current = () => globalThis.__fourjDesktopElectronTest;
class Emitter {
  constructor() { this.listeners = new Map(); this.onceListeners = new Map(); }
  on(name, listener) { const values = this.listeners.get(name) || []; values.push(listener); this.listeners.set(name, values); return this; }
  once(name, listener) { const values = this.onceListeners.get(name) || []; values.push(listener); this.onceListeners.set(name, values); return this; }
  removeListener(name, listener) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((value) => value !== listener));
    this.onceListeners.set(name, (this.onceListeners.get(name) || []).filter((value) => value !== listener));
    return this;
  }
  emitOnce(name, ...args) {
    const listeners = this.onceListeners.get(name) || [];
    this.onceListeners.delete(name);
    for (const listener of listeners) listener(...args);
  }
}
class TestWebContents extends Emitter {
  setWindowOpenHandler() {}
  send() {}
  openDevTools() {}
  reload() { queueMicrotask(() => this.emitOnce("did-finish-load")); }
}
export class BrowserWindow extends Emitter {
  constructor() { super(); this.webContents = new TestWebContents(); current().window = this; }
  static getAllWindows() { return current().window ? [current().window] : []; }
  isDestroyed() { return false; }
  isMinimized() { return false; }
  isFocused() { return true; }
  restore() {}
  show() {}
  focus() {}
  hide() {}
  setTitleBarOverlay() {}
  setBackgroundColor() {}
  loadURL() { return Promise.resolve(); }
}
export const app = {
  isPackaged: false,
  getPath(name) { return current().paths[name]; },
  getVersion() { return "0.0.0-test"; },
  requestSingleInstanceLock() { return true; },
  whenReady() { return Promise.resolve(); },
  on() {},
  quit() {},
};
export const dialog = {
  showOpenDialog() {
    const result = current().openDialogs.shift() || { canceled: true, filePaths: [] };
    return typeof result === "function" ? result() : Promise.resolve(result);
  },
  showSaveDialog() { return Promise.resolve({ canceled: true }); },
  showMessageBox() { return Promise.resolve(current().messageBoxes.shift() || { response: 1 }); },
};
export const ipcMain = {
  handle(name, handler) { current().handlers.set(name, handler); },
  on(name, handler) { current().listeners.set(name, handler); },
};
export const Menu = { buildFromTemplate(value) { return value; }, setApplicationMenu() {} };
export const net = { fetch: (...args) => fetch(...args) };
export const nativeImage = {
  createFromBuffer() { return { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from([1]) }; },
};
export const nativeTheme = { shouldUseDarkColors: false };
export class Notification extends Emitter { static isSupported() { return false; } show() {} }
export const protocol = { registerSchemesAsPrivileged() {}, handle() {} };
export const shell = { openExternal() {}, openPath() { return Promise.resolve(""); } };
export class Tray extends Emitter { setToolTip() {} setContextMenu() {} }
`;

const electronUpdaterTestModule = `
const autoUpdater = {
  on() { return this; },
  checkForUpdates() { return Promise.resolve(); },
  downloadUpdate() { return Promise.resolve(); },
  quitAndInstall() {},
};
export default { autoUpdater };
`;

const fsPromisesTestModule = `
import {
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename as actualRename,
  unlink,
  writeFile,
} from "fs/promises";
const current = () => globalThis.__fourjDesktopElectronTest;
export { cp, mkdir, open, readFile, readdir, unlink, writeFile };
export async function rename(source, target) {
  if (current()?.failWorkspaceLocationRename && target.endsWith("workspace-location.json")) {
    const error = new Error("injected workspace location rename failure");
    error.code = "EIO";
    throw error;
  }
  return actualRename(source, target);
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron")
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(electronTestModule)}` };
    if (specifier === "electron-updater")
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(electronUpdaterTestModule)}` };
    if (specifier === "node:fs/promises" && new URL(context.parentURL).pathname.endsWith("/desktop/main.mjs"))
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(fsPromisesTestModule)}` };
    return nextResolve(specifier, context);
  },
});

async function loadDesktopMain({ root, openDialogs = [], messageBoxes = [], failWorkspaceLocationRename = false }) {
  const state = {
    failWorkspaceLocationRename,
    handlers: new Map(),
    listeners: new Map(),
    messageBoxes: [...messageBoxes],
    openDialogs: [...openDialogs],
    paths: {
      appData: join(root, "app-data"),
      documents: join(root, "documents"),
      downloads: join(root, "downloads"),
      userData: join(root, "user-data"),
    },
    window: undefined,
  };
  globalThis.__fourjDesktopElectronTest = state;
  await import(`./main.mjs?workspace-test=${randomUUID()}`);
  for (let attempt = 0; attempt < 100 && !state.handlers.has("desktop:choose-workspace"); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(state.handlers.has("desktop:choose-workspace"), true, "桌面 IPC 未完成初始化");
  return {
    state,
    invoke(name, ...args) {
      const handler = state.handlers.get(name);
      assert.equal(typeof handler, "function", `缺少 IPC handler: ${name}`);
      return handler({ sender: state.window?.webContents }, ...args);
    },
    send(name, ...args) {
      const listener = state.listeners.get(name);
      assert.equal(typeof listener, "function", `缺少 IPC listener: ${name}`);
      return listener({ sender: state.window?.webContents }, ...args);
    },
  };
}

async function writeWorkspaceLocation(root, value) {
  const directory = join(root, "app-data", "InfiniteCanvas");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "workspace-location.json"), JSON.stringify(value), "utf8");
}

test("切换总工作区后分类内容和新生成图片都进入新工作区各自目录", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "infinite-canvas-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "infinite-canvas-target-"));
  const customImages = await mkdtemp(join(tmpdir(), "infinite-canvas-custom-images-"));

  try {
    const sourceLocations = {
      images: customImages,
      videos: join(sourceRoot, "assets/videos"),
      audio: join(sourceRoot, "assets/audio"),
      projects: join(sourceRoot, "projects"),
      records: join(sourceRoot, "records"),
      skills: join(sourceRoot, "skills"),
    };
    await mkdir(join(customImages, "objects"), { recursive: true });
    await mkdir(sourceLocations.projects, { recursive: true });
    await mkdir(sourceLocations.skills, { recursive: true });
    await writeFile(join(customImages, "objects", "old.png"), Uint8Array.from([1, 2, 3]));
    await writeFile(join(sourceLocations.projects, "canvas-projects.json"), "{\"projects\":[]}");
    await writeFile(join(sourceLocations.skills, "CURRENT"), "catalog-1");

    await migrateWorkspaceContents({ sourceRoot, targetRoot, sourceLocations });

    const nextStore = createWorkspaceStore({
      root: targetRoot,
      fetch: globalThis.fetch,
      createId: () => "new-image",
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });
    await nextStore.initialize();
    const generated = await nextStore.saveAsset({ bytes: Uint8Array.from([4, 5, 6]), mimeType: "image/png", kind: "image" });

    assert.deepEqual(await readFile(join(targetRoot, "assets/images/objects/old.png")), Buffer.from([1, 2, 3]));
    assert.equal(await readFile(join(targetRoot, "projects/canvas-projects.json"), "utf8"), "{\"projects\":[]}");
    assert.equal(await readFile(join(targetRoot, "skills/CURRENT"), "utf8"), "catalog-1");
    assert.equal(generated.path.startsWith(join(targetRoot, "assets/images")), true);
    assert.equal(generated.path.startsWith(customImages), false);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(targetRoot, { recursive: true, force: true });
    await rm(customImages, { recursive: true, force: true });
  }
});

test("桌面切换总工作区后不再向旧自定义分类目录写入", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-workspace-main-"));
  const sourceRoot = join(root, "source");
  const targetRoot = join(root, "target");
  const customImages = join(root, "custom-images");

  try {
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true }),
      mkdir(customImages, { recursive: true }),
    ]);
    await writeFile(join(customImages, "old.png"), Uint8Array.from([1, 2, 3]));
    await writeWorkspaceLocation(root, {
      schemaVersion: 2,
      path: sourceRoot,
      categoryRoots: { images: customImages },
    });
    const desktop = await loadDesktopMain({
      root,
      openDialogs: [{ canceled: false, filePaths: [targetRoot] }],
    });

    const switched = await desktop.invoke("desktop:choose-workspace");
    assert.equal(switched.path, targetRoot);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const stored = await desktop.invoke("desktop:store-asset", {
      bytes: Uint8Array.from([4, 5, 6]),
      mimeType: "image/png",
      kind: "image",
      idempotencyKey: "workspace-switch:output-0",
    });
    const found = await desktop.invoke("desktop:find-asset-by-idempotency-key", {
      kind: "image",
      idempotencyKey: "workspace-switch:output-0",
    });

    assert.equal(stored.path.startsWith(join(targetRoot, "assets/images")), true);
    assert.equal(stored.path.startsWith(customImages), false);
    assert.equal(found?.storageKey, stored.storageKey);
    assert.equal(found?.path, stored.path);
    assert.deepEqual(await readFile(join(targetRoot, "assets/images/old.png")), Buffer.from([1, 2, 3]));
  } finally {
    delete globalThis.__fourjDesktopElectronTest;
    await rm(root, { recursive: true, force: true });
  }
});

test("分类目录初始化失败后继续使用原目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-category-switch-"));
  const sourceRoot = join(root, "source");
  const brokenSkills = join(root, "broken-skills");

  try {
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(brokenSkills, { recursive: true }),
    ]);
    await writeFile(
      join(brokenSkills, ".infinite-canvas-category.json"),
      JSON.stringify({ schemaVersion: 1, category: "skills", appId: "com.infinitecanvas.desktop" }),
      "utf8",
    );
    await writeFile(join(brokenSkills, "CURRENT"), "not-a-valid-head\n", "utf8");
    await writeWorkspaceLocation(root, {
      schemaVersion: 2,
      path: sourceRoot,
      categoryRoots: {},
    });
    const desktop = await loadDesktopMain({
      root,
      openDialogs: [{ canceled: false, filePaths: [brokenSkills] }],
    });

    await assert.rejects(
      desktop.invoke("desktop:choose-category-directory", "skills"),
      /创作 Skill|CURRENT|指针|标识/,
    );
    const workspace = await desktop.invoke("desktop:get-workspace-info");

    assert.equal(workspace.path, sourceRoot);
    assert.equal(workspace.locations.skills.path, join(sourceRoot, "skills"));
  } finally {
    delete globalThis.__fourjDesktopElectronTest;
    await rm(root, { recursive: true, force: true });
  }
});

test("总工作区初始化失败后继续使用原工作区", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-workspace-switch-failure-"));
  const sourceRoot = join(root, "source");
  const brokenTarget = join(root, "broken-target");
  const originalLocation = {
    schemaVersion: 2,
    path: sourceRoot,
    categoryRoots: {},
  };

  try {
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(join(brokenTarget, "skills"), { recursive: true }),
    ]);
    await writeFile(
      join(brokenTarget, "workspace.json"),
      JSON.stringify({ schemaVersion: 1, appId: "com.infinitecanvas.desktop" }),
      "utf8",
    );
    await writeFile(join(brokenTarget, "skills", "CURRENT"), "not-a-valid-head\n", "utf8");
    await writeWorkspaceLocation(root, originalLocation);
    const desktop = await loadDesktopMain({
      root,
      openDialogs: [{ canceled: false, filePaths: [brokenTarget] }],
    });

    await assert.rejects(
      desktop.invoke("desktop:choose-workspace"),
      /创作 Skill|CURRENT|指针|标识/,
    );
    const workspace = await desktop.invoke("desktop:get-workspace-info");
    const persisted = JSON.parse(await readFile(
      join(root, "app-data", "InfiniteCanvas", "workspace-location.json"),
      "utf8",
    ));

    assert.equal(workspace.path, sourceRoot);
    assert.deepEqual(persisted, originalLocation);
  } finally {
    delete globalThis.__fourjDesktopElectronTest;
    await rm(root, { recursive: true, force: true });
  }
});

test("恢复默认分类目录失败后继续使用原自定义目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-category-reset-failure-"));
  const sourceRoot = join(root, "source");
  const customSkills = join(root, "custom-skills");
  const originalLocation = {
    schemaVersion: 2,
    path: sourceRoot,
    categoryRoots: { skills: customSkills },
  };

  try {
    await Promise.all([
      mkdir(join(sourceRoot, "skills"), { recursive: true }),
      mkdir(customSkills, { recursive: true }),
    ]);
    await writeFile(join(sourceRoot, "skills", "CURRENT"), "not-a-valid-head\n", "utf8");
    await writeWorkspaceLocation(root, originalLocation);
    const desktop = await loadDesktopMain({
      root,
      messageBoxes: [{ response: 0 }],
    });

    await assert.rejects(
      desktop.invoke("desktop:reset-category-directory", "skills"),
      /创作 Skill|CURRENT|指针|标识/,
    );
    const workspace = await desktop.invoke("desktop:get-workspace-info");
    const persisted = JSON.parse(await readFile(
      join(root, "app-data", "InfiniteCanvas", "workspace-location.json"),
      "utf8",
    ));

    assert.equal(workspace.locations.skills.path, customSkills);
    assert.deepEqual(persisted, originalLocation);
  } finally {
    delete globalThis.__fourjDesktopElectronTest;
    await rm(root, { recursive: true, force: true });
  }
});

test("选择工作区期间开始生成会在进入切换 gate 前被拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-active-generation-"));
  const sourceRoot = join(root, "source");
  const targetRoot = join(root, "target");
  let resolveSelection;
  const selection = new Promise((resolve) => {
    resolveSelection = resolve;
  });

  try {
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true }),
    ]);
    await writeWorkspaceLocation(root, {
      schemaVersion: 2,
      path: sourceRoot,
      categoryRoots: {},
    });
    const desktop = await loadDesktopMain({
      root,
      openDialogs: [() => selection],
    });

    const switching = desktop.invoke("desktop:choose-workspace");
    desktop.send("desktop:set-active-generation-count", 1);
    resolveSelection({ canceled: false, filePaths: [targetRoot] });

    await assert.rejects(switching, /生成任务/);
    const workspace = await desktop.invoke("desktop:get-workspace-info");
    assert.equal(workspace.path, sourceRoot);
  } finally {
    delete globalThis.__fourjDesktopElectronTest;
    await rm(root, { recursive: true, force: true });
  }
});

test("工作区位置原子替换失败时保留旧配置和旧活动工作区", async () => {
  const root = await mkdtemp(join(tmpdir(), "fourj-location-atomic-"));
  const sourceRoot = join(root, "source");
  const targetRoot = join(root, "target");
  const originalLocation = {
    schemaVersion: 2,
    path: sourceRoot,
    categoryRoots: {},
  };

  try {
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true }),
    ]);
    await writeWorkspaceLocation(root, originalLocation);
    const desktop = await loadDesktopMain({
      root,
      failWorkspaceLocationRename: true,
      openDialogs: [{ canceled: false, filePaths: [targetRoot] }],
    });

    await assert.rejects(
      desktop.invoke("desktop:choose-workspace"),
      /injected workspace location rename failure/,
    );
    const persisted = JSON.parse(await readFile(
      join(root, "app-data", "InfiniteCanvas", "workspace-location.json"),
      "utf8",
    ));
    const workspace = await desktop.invoke("desktop:get-workspace-info");

    assert.deepEqual(persisted, originalLocation);
    assert.equal(workspace.path, sourceRoot);
  } finally {
    delete globalThis.__fourjDesktopElectronTest;
    await rm(root, { recursive: true, force: true });
  }
});
