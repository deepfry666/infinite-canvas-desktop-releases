import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  nativeTheme,
  Notification,
  protocol,
  shell,
  Tray,
} from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { createWorkspaceStore } from "./workspace-store.mjs";
import { createCreativeSkillImageInspector } from "./creative-skill-image-inspector.mjs";
import { createCreativeSkillStore } from "./creative-skill-store.mjs";
import { migrateWorkspaceContents } from "./workspace-migration.mjs";
import { createUpdateManager } from "./update-manager.mjs";
import { createUpdateCache } from "./update-cache.mjs";
import { decideWindowClose } from "./window-close-policy.mjs";
import { getDefaultWorkspacePath } from "./workspace-path.mjs";
import { restoreLegacyRuntimeProfile } from "./runtime-profile-migration.mjs";

const isDevelopment = Boolean(process.env.ELECTRON_START_URL);
const PRODUCT_NAME = "四季画布 FourJ Canvas";
const WINDOWS_TITLE_BAR_HEIGHT = 38;
const WINDOWS_TITLE_BAR_THEMES = {
  light: { background: "#faf8f4", overlay: { color: "#00000000", symbolColor: "#211d19", height: WINDOWS_TITLE_BAR_HEIGHT } },
  dark: { background: "#1c1916", overlay: { color: "#00000000", symbolColor: "#f0ece4", height: WINDOWS_TITLE_BAR_HEIGHT } },
};
const desktopDir = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(desktopDir, "..");
const webDist = join(appRoot, "web", "dist");

if (app.isPackaged) {
  const appDataPath = app.getPath("appData");
  const legacyRuntimeDataPath = join(appDataPath, "无限画布");
  restoreLegacyRuntimeProfile({
    sourcePath: join(appDataPath, "infinite-canvas-desktop"),
    targetPath: legacyRuntimeDataPath,
  });
  mkdirSync(legacyRuntimeDataPath, { recursive: true });
  app.setPath("userData", legacyRuntimeDataPath);
  app.setPath("sessionData", legacyRuntimeDataPath);
}

const defaultUserDataPath = app.getPath("userData");
const defaultWorkspacePath = getDefaultWorkspacePath(app.getPath("documents"));
const workspaceLocationFile = join(
  app.getPath("appData"),
  "InfiniteCanvas",
  "workspace-location.json",
);
let missingWorkspacePath = null;
let missingCategoryRoots = {};

const CATEGORY_META = {
  images: { label: "图片", defaultPath: (root) => join(root, "assets/images") },
  videos: { label: "视频", defaultPath: (root) => join(root, "assets/videos") },
  audio: { label: "音频", defaultPath: (root) => join(root, "assets/audio") },
  projects: { label: "项目数据", defaultPath: (root) => join(root, "projects") },
  records: { label: "生成记录", defaultPath: (root) => join(root, "records") },
  skills: { label: "创作 Skill", defaultPath: (root) => join(root, "skills") },
};

function readWorkspaceLocation() {
  try {
    const value = JSON.parse(readFileSync(workspaceLocationFile, "utf8"));
    if (typeof value.path !== "string" || !isAbsolute(value.path)) return null;
    const path = resolve(value.path);
    if (!existsSync(path)) {
      missingWorkspacePath = path;
      return null;
    }
    if (!statSync(path).isDirectory()) return null;
    const categoryEntries = Object.keys(CATEGORY_META).flatMap((category) => {
        const categoryPath = value.categoryRoots?.[category];
        if (typeof categoryPath !== "string" || !isAbsolute(categoryPath)) return [];
        const resolvedPath = resolve(categoryPath);
        if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
          missingCategoryRoots[category] = resolvedPath;
          return [];
        }
        return [[category, resolvedPath]];
      });
    const categoryRoots = Object.fromEntries(categoryEntries);
    return { path, categoryRoots };
  } catch {
    return null;
  }
}

const workspaceLocation = readWorkspaceLocation();
let activeWorkspacePath = workspaceLocation?.path || defaultWorkspacePath;
let activeCategoryRoots = workspaceLocation?.categoryRoots || {};
let workspaceStore = createStore(activeWorkspacePath, activeCategoryRoots);
let creativeSkillStore;
let workspaceSwitching = false;
const pendingWorkspaceWrites = new Set();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
    },
  },
  {
    scheme: "workspace",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow;
let tray;
let activeGenerationCount = 0;
let closeBehavior = "tray";
let appQuitting = false;
let closePromptOpen = false;
let updateManager;
let updateCache;
const WINDOWS_FIRST_SHOW_FALLBACK_MS = 6000;
let mainWindowReadyToShow = process.platform !== "win32";
let mainWindowThemeReady = process.platform !== "win32";
let mainWindowFirstShowPending = false;
let mainWindowFirstShowFallbackTimer;

function updaterCachePath() {
  const base = process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Caches")
      : process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "infinite-canvas-desktop-updater");
}

function createStore(root, categoryRoots = activeCategoryRoots) {
  return createWorkspaceStore({
    root,
    categoryRoots,
    fetch: (url) => net.fetch(url),
    createId: randomUUID,
    now: () => new Date(),
  });
}

const inspectCreativeSkillImage = createCreativeSkillImageInspector({ nativeImage });

async function pickCreativeSkillImportFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入创作 Skill",
    properties: ["openFile"],
    filters: [
      { name: "四季画布 Skill", extensions: ["fourj-skill"] },
      { name: "Skill Markdown", extensions: ["md"] },
    ],
  });
  return result.canceled ? undefined : result.filePaths[0];
}

async function saveCreativeSkillExportFile({ suggestedName, bytes }) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出创作 Skill",
    defaultPath: join(app.getPath("downloads"), suggestedName),
    filters: [{ name: "四季画布 Skill", extensions: ["fourj-skill"] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  const temporaryPath = join(dirname(result.filePath), `.${basename(result.filePath)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(Buffer.from(bytes));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, result.filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch((error) => {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    });
  }
  return { fileName: basename(result.filePath) };
}

async function createInitializedCreativeSkillStore({ root, categoryRoots, recoveryStore }) {
  const next = createCreativeSkillStore({
    skillsRoot: categoryRoots.skills || CATEGORY_META.skills.defaultPath(root),
    createId: randomUUID,
    now: () => new Date(),
    pickImportFile: pickCreativeSkillImportFile,
    imageInspector: inspectCreativeSkillImage,
    saveExportFile: saveCreativeSkillExportFile,
    createRecoveryPoint: (label) => recoveryStore.createRecoveryPoint(label),
  });
  await next.initialize();
  return next;
}

async function initializeCreativeSkillStore() {
  creativeSkillStore = await createInitializedCreativeSkillStore({
    root: activeWorkspacePath,
    categoryRoots: activeCategoryRoots,
    recoveryStore: workspaceStore,
  });
}

function requireCreativeSkillStore() {
  if (!creativeSkillStore) throw new Error("创作 Skill 权威存储尚未就绪");
  return creativeSkillStore;
}

function assertMainRenderer(event) {
  if (event.sender !== mainWindow?.webContents)
    throw new Error("拒绝非主窗口的创作 Skill 请求");
}

function broadcastCreativeSkillChange(result) {
  if (!result?.changed || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:creative-skills:changed", {
    revision: result.snapshot.revision,
    head: result.head,
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

function clearMainWindowFirstShowFallback() {
  if (!mainWindowFirstShowFallbackTimer) return;
  clearTimeout(mainWindowFirstShowFallbackTimer);
  mainWindowFirstShowFallbackTimer = undefined;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindowFirstShowPending = false;
  clearMainWindowFirstShowFallback();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showMainWindowWhenReady() {
  if (
    mainWindowFirstShowPending &&
    (!mainWindowReadyToShow || !mainWindowThemeReady)
  )
    return;
  showMainWindow();
}

function showSystemNotification(title, body) {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title,
    body,
    icon: join(appRoot, "build", "icon-win.png"),
  });
  notification.on("click", showMainWindow);
  notification.show();
  return true;
}

async function requestQuit() {
  if (closePromptOpen) return;
  if (activeGenerationCount > 0) {
    showMainWindow();
    closePromptOpen = true;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "仍有生成任务在运行",
      message: `当前还有 ${activeGenerationCount} 个生成任务，退出会中断任务。`,
      detail: "中转端可能已经开始计费。如果只是暂时不用，请选择继续运行，应用会留在系统托盘。",
      buttons: ["继续运行", "强制退出"],
      defaultId: 0,
      cancelId: 0,
    });
    closePromptOpen = false;
    if (response !== 1) return;
  }
  appQuitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  tray = new Tray(join(appRoot, "build", "icon-win.png"));
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `打开${PRODUCT_NAME}`, click: showMainWindow },
    { type: "separator" },
    { label: "完全退出", click: () => void requestQuit() },
  ]));
  tray.on("double-click", showMainWindow);
}

function contentType(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeDistPath(requestUrl) {
  const url = new URL(requestUrl);
  const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const candidate = resolve(webDist, requested);
  const relativePath = relative(webDist, candidate);
  if (
    !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`)
  )
    return candidate;
  return join(webDist, "index.html");
}

async function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    if (isDevelopment)
      return fetch(
        `${process.env.ELECTRON_START_URL}${new URL(request.url).pathname}`,
      );
    let filePath = safeDistPath(request.url);
    if (!existsSync(filePath) || !statSync(filePath).isFile())
      filePath = join(webDist, "index.html");
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        "Content-Type": contentType(filePath),
        "Cache-Control": "no-cache",
      },
    });
  });
  protocol.handle("workspace", async (request) => {
    try {
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = workspaceStore.pathForStorageKey(
        `workspace:${relativePath}`,
      );
      const data = await readFile(filePath);
      return new Response(data, {
        headers: {
          "Content-Type": contentType(filePath),
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function createWindow() {
  clearMainWindowFirstShowFallback();
  const initialTitleBarTheme =
    WINDOWS_TITLE_BAR_THEMES[
      nativeTheme.shouldUseDarkColors ? "dark" : "light"
    ];
  mainWindowReadyToShow = process.platform !== "win32";
  mainWindowThemeReady = process.platform !== "win32";
  mainWindowFirstShowPending = process.platform === "win32";
  mainWindow = new BrowserWindow({
    show: process.platform !== "win32",
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    title: PRODUCT_NAME,
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: initialTitleBarTheme.overlay,
          backgroundColor: initialTitleBarTheme.background,
        }
      : {}),
    webPreferences: {
      preload: join(desktopDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  if (process.platform === "win32") {
    const pendingWindow = mainWindow;
    mainWindowFirstShowFallbackTimer = setTimeout(() => {
      mainWindowFirstShowFallbackTimer = undefined;
      if (mainWindow !== pendingWindow || pendingWindow.isDestroyed()) return;
      showMainWindow();
    }, WINDOWS_FIRST_SHOW_FALLBACK_MS);
    mainWindowFirstShowFallbackTimer.unref?.();
  }

  mainWindow.once("ready-to-show", () => {
    mainWindowReadyToShow = true;
    if (mainWindowFirstShowPending) showMainWindowWhenReady();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://") && !url.startsWith("http://localhost:"))
      event.preventDefault();
  });
  mainWindow.webContents.on("did-finish-load", () => {
    activeGenerationCount = 0;
    setTimeout(() => {
      void (async () => {
        const result = await updateCache?.markHealthyVersion(app.getVersion());
        if (!result?.updated || !mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("desktop:update-completed", {
          version: app.getVersion(),
          previousVersion: result.previousVersion,
        });
        if (!mainWindow.isFocused())
          showSystemNotification(`${PRODUCT_NAME} 更新完成`, `已更新到 ${displayVersion(app.getVersion())}。`);
      })();
    }, 3000);
  });
  mainWindow.on("close", (event) => {
    const action = decideWindowClose({ behavior: closeBehavior, activeGenerationCount, quitting: appQuitting });
    if (action === "quit") return;
    event.preventDefault();
    if (action === "hide-to-tray") {
      mainWindow.hide();
      return;
    }
    void requestQuit();
  });

  // Keep the browser pathname at `/` so createBrowserRouter enters the home route.
  // `/index.html` is a static file path, not an application route, and would render NotFound.
  const startUrl = isDevelopment
    ? process.env.ELECTRON_START_URL
    : "app://local/";
  void mainWindow.loadURL(startUrl);
  if (isDevelopment) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function displayVersion(version) {
  const normalized = String(version || "").trim();
  if (!normalized) return "";
  return /^v/i.test(normalized) ? `v${normalized.slice(1)}` : `v${normalized}`;
}

function pathsEqual(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function pathContains(parent, candidate) {
  const root = resolve(parent);
  const value = resolve(candidate);
  const child = relative(root, value);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

function workspaceInfo() {
  const legacyWorkspace =
    existsSync(join(activeWorkspacePath, "IndexedDB")) ||
    existsSync(join(activeWorkspacePath, "Network"));
  return {
    path: activeWorkspacePath,
    defaultPath: defaultWorkspacePath,
    isCustom: !pathsEqual(activeWorkspacePath, defaultWorkspacePath),
    configuredPath: missingWorkspacePath,
    locationMissing: Boolean(missingWorkspacePath),
    allowLegacyImport:
      pathsEqual(activeWorkspacePath, defaultWorkspacePath) || legacyWorkspace,
    locationFile: workspaceLocationFile,
    locations: Object.fromEntries(
      Object.entries(CATEGORY_META).map(([category, meta]) => {
        const defaultPath = meta.defaultPath(activeWorkspacePath);
        const path = activeCategoryRoots[category] || defaultPath;
        return [category, { path, defaultPath, isCustom: !pathsEqual(path, defaultPath), configuredPath: missingCategoryRoots[category], locationMissing: Boolean(missingCategoryRoots[category]) }];
      }),
    ),
  };
}

async function saveWorkspaceLocation({ path, categoryRoots, unavailableCategoryRoots }) {
  await mkdir(resolve(workspaceLocationFile, ".."), { recursive: true });
  const temporaryPath = join(dirname(workspaceLocationFile), `.${basename(workspaceLocationFile)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(
      JSON.stringify({ schemaVersion: 2, path, categoryRoots: { ...unavailableCategoryRoots, ...categoryRoots }, updatedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, workspaceLocationFile);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch((error) => {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    });
  }
}

async function reloadWorkspace() {
  workspaceSwitching = true;
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      workspaceSwitching = false;
      return;
    }
    const finishSwitch = () => {
      mainWindow?.webContents.removeListener("did-finish-load", finishSwitch);
      mainWindow?.webContents.removeListener("did-fail-load", finishSwitch);
      workspaceSwitching = false;
    };
    mainWindow.webContents.once("did-finish-load", finishSwitch);
    mainWindow.webContents.once("did-fail-load", finishSwitch);
    mainWindow.webContents.reload();
  }, 200);
}

function trackWorkspaceWrite(operation) {
  const pending = Promise.resolve().then(operation);
  pendingWorkspaceWrites.add(pending);
  void pending.finally(() => pendingWorkspaceWrites.delete(pending)).catch(() => undefined);
  return pending;
}

async function beginWorkspaceSwitch() {
  if (workspaceSwitching) throw new Error("工作区正在切换，请等待页面重新载入。");
  workspaceSwitching = true;
  while (pendingWorkspaceWrites.size) {
    await Promise.allSettled([...pendingWorkspaceWrites]);
  }
}

function abortWorkspaceSwitch() {
  workspaceSwitching = false;
}

async function chooseCategoryDirectory(category) {
  const meta = CATEGORY_META[category];
  if (!meta) throw new Error("无效的数据类型");
  if (activeGenerationCount > 0) throw new Error("请等待当前生成任务完成后再更换数据目录。");
  const currentPath = workspaceInfo().locations[category].path;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `选择${meta.label}保存目录`,
    message: `请选择空文件夹，或之前由${PRODUCT_NAME}使用的${meta.label}目录。`,
    defaultPath: currentPath,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true, ...workspaceInfo() };
  const targetPath = resolve(result.filePaths[0]);
  if (pathsEqual(currentPath, targetPath)) return { cancelled: false, reloaded: false, ...workspaceInfo() };
  if (pathContains(defaultUserDataPath, targetPath) || pathContains(targetPath, defaultUserDataPath)) throw new Error("数据目录不能选择应用运行目录。");
  for (const location of Object.values(workspaceInfo().locations)) {
    if (pathsEqual(location.path, currentPath)) continue;
    if (pathContains(location.path, targetPath) || pathContains(targetPath, location.path)) throw new Error("不同类型的数据目录不能互相包含。");
  }
  await beginWorkspaceSwitch();
  try {
    await mkdir(targetPath, { recursive: true });
    const markerPath = join(targetPath, ".infinite-canvas-category.json");
    let marker = null;
    try {
      marker = JSON.parse(await readFile(markerPath, "utf8"));
    } catch {
      marker = null;
    }
    const entries = (await readdir(targetPath)).filter((name) => name !== ".infinite-canvas-category.json");
    if (entries.length && marker?.category !== category) throw new Error(`为避免覆盖其他文件，请为${meta.label}选择一个空文件夹。`);
    if (!entries.length) await cp(currentPath, targetPath, { recursive: true, force: false, errorOnExist: false });
    await workspaceStore.createRecoveryPoint(`change-${category}-directory`);
    await writeFile(markerPath, JSON.stringify({ schemaVersion: 1, category, appId: "com.infinitecanvas.desktop" }, null, 2), "utf8");
    const nextCategoryRoots = { ...activeCategoryRoots, [category]: targetPath };
    const { [category]: _missing, ...remainingMissing } = missingCategoryRoots;
    const nextStore = createStore(activeWorkspacePath, nextCategoryRoots);
    await nextStore.initialize();
    const nextCreativeSkillStore = await createInitializedCreativeSkillStore({
      root: activeWorkspacePath,
      categoryRoots: nextCategoryRoots,
      recoveryStore: nextStore,
    });
    await saveWorkspaceLocation({
      path: activeWorkspacePath,
      categoryRoots: nextCategoryRoots,
      unavailableCategoryRoots: remainingMissing,
    });
    activeCategoryRoots = nextCategoryRoots;
    missingCategoryRoots = remainingMissing;
    workspaceStore = nextStore;
    creativeSkillStore = nextCreativeSkillStore;
    await reloadWorkspace();
    return { cancelled: false, reloaded: true, ...workspaceInfo() };
  } catch (error) {
    abortWorkspaceSwitch();
    throw error;
  }
}

async function resetCategoryDirectory(category) {
  const meta = CATEGORY_META[category];
  if (!meta) throw new Error("无效的数据类型");
  if (!activeCategoryRoots[category] && !missingCategoryRoots[category]) return { reloaded: false, ...workspaceInfo() };
  if (activeGenerationCount > 0) throw new Error("请等待当前生成任务完成后再更换数据目录。");
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: `恢复${meta.label}默认目录`,
    message: `将${meta.label}切回默认目录？`,
    detail: "自定义目录中的原文件会保留，不会删除。",
    buttons: ["恢复默认", "取消"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response !== 0) return { cancelled: true, ...workspaceInfo() };
  await beginWorkspaceSwitch();
  try {
    await workspaceStore.createRecoveryPoint(`reset-${category}-directory`);
    const { [category]: _removed, ...remaining } = activeCategoryRoots;
    const { [category]: _missing, ...remainingMissing } = missingCategoryRoots;
    const nextStore = createStore(activeWorkspacePath, remaining);
    await nextStore.initialize();
    const nextCreativeSkillStore = await createInitializedCreativeSkillStore({
      root: activeWorkspacePath,
      categoryRoots: remaining,
      recoveryStore: nextStore,
    });
    await saveWorkspaceLocation({
      path: activeWorkspacePath,
      categoryRoots: remaining,
      unavailableCategoryRoots: remainingMissing,
    });
    activeCategoryRoots = remaining;
    missingCategoryRoots = remainingMissing;
    workspaceStore = nextStore;
    creativeSkillStore = nextCreativeSkillStore;
    await reloadWorkspace();
    return { cancelled: false, reloaded: true, ...workspaceInfo() };
  } catch (error) {
    abortWorkspaceSwitch();
    throw error;
  }
}

async function chooseAndMigrateWorkspace() {
  if (activeGenerationCount > 0) throw new Error("请等待当前生成任务完成后再更换数据目录。");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `选择${PRODUCT_NAME}数据目录`,
    message:
      "请选择保存项目、生成记录和原始素材的文件夹。切换后页面会自动重新载入。",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0])
    return { cancelled: true, ...workspaceInfo() };

  const targetPath = resolve(result.filePaths[0]);
  const sourcePath = resolve(activeWorkspacePath);
  const sourceLocations = Object.fromEntries(
    Object.entries(workspaceInfo().locations).map(([category, location]) => [category, location.path]),
  );
  if (pathsEqual(sourcePath, targetPath))
    return { cancelled: false, restarted: false, ...workspaceInfo() };
  if (
    pathContains(defaultUserDataPath, targetPath) ||
    pathContains(targetPath, defaultUserDataPath)
  ) {
    throw new Error(
      "数据目录不能选择应用运行目录，请改选文档、图片或其他普通文件夹。",
    );
  }
  if (
    pathContains(sourcePath, targetPath) ||
    pathContains(targetPath, sourcePath)
  ) {
    throw new Error("新工作区不能位于当前工作区内部，也不能包含当前工作区。");
  }

  if (activeGenerationCount > 0) throw new Error("请等待当前生成任务完成后再更换数据目录。");
  await beginWorkspaceSwitch();
  try {
    const targetHasWorkspace = existsSync(join(targetPath, "workspace.json"));
    await workspaceStore.createRecoveryPoint("change-workspace");
    const nextCategoryRoots = {};
    const nextStore = createStore(targetPath, nextCategoryRoots);
    if (!targetHasWorkspace) {
      await mkdir(targetPath, { recursive: true });
      await workspaceStore.initialize();
      await migrateWorkspaceContents({ sourceRoot: sourcePath, targetRoot: targetPath, sourceLocations });
    }
    await nextStore.initialize();
    const nextMissingCategoryRoots = {};
    const nextCreativeSkillStore = await createInitializedCreativeSkillStore({
      root: targetPath,
      categoryRoots: nextCategoryRoots,
      recoveryStore: nextStore,
    });
    await saveWorkspaceLocation({
      path: targetPath,
      categoryRoots: nextCategoryRoots,
      unavailableCategoryRoots: nextMissingCategoryRoots,
    });
    activeWorkspacePath = targetPath;
    activeCategoryRoots = nextCategoryRoots;
    missingCategoryRoots = nextMissingCategoryRoots;
    missingWorkspacePath = null;
    workspaceStore = nextStore;
    creativeSkillStore = nextCreativeSkillStore;
    await reloadWorkspace();
    return { cancelled: false, reloaded: true, ...workspaceInfo() };
  } catch (error) {
    abortWorkspaceSwitch();
    throw error;
  }
}

function ensureWorkspaceWritable() {
  if (workspaceSwitching)
    throw new Error("工作区正在切换，请等待页面重新载入。");
}

if (hasSingleInstanceLock)
  app.whenReady().then(async () => {
    await workspaceStore.initialize();
    await initializeCreativeSkillStore();
    updateCache = createUpdateCache({
      cacheDir: updaterCachePath(),
      markerFile: join(app.getPath("userData"), "healthy-version.txt"),
    });
    ipcMain.handle("desktop:get-data-location", () => activeWorkspacePath);
    ipcMain.on("desktop:set-active-generation-count", (event, count) => {
      if (event.sender !== mainWindow?.webContents) return;
      activeGenerationCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    });
    ipcMain.on("desktop:set-close-behavior", (event, behavior) => {
      if (event.sender !== mainWindow?.webContents) return;
      closeBehavior = behavior === "quit" ? "quit" : "tray";
    });
    ipcMain.on("desktop:set-theme", (event, theme) => {
      if (process.platform !== "win32" || event.sender !== mainWindow?.webContents || !mainWindow || mainWindow.isDestroyed()) return;
      const colors = WINDOWS_TITLE_BAR_THEMES[theme === "dark" ? "dark" : "light"];
      mainWindow.setTitleBarOverlay(colors.overlay);
      mainWindow.setBackgroundColor(colors.background);
      mainWindowThemeReady = true;
      if (mainWindowFirstShowPending) showMainWindowWhenReady();
    });
    ipcMain.handle("desktop:get-workspace-info", () => workspaceInfo());
    ipcMain.handle("desktop:creative-skills:query", (event, input) => {
      assertMainRenderer(event);
      ensureWorkspaceWritable();
      return requireCreativeSkillStore().query(input);
    });
    ipcMain.handle("desktop:creative-skills:execute", async (event, command) => {
      assertMainRenderer(event);
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(async () => {
        const result = await requireCreativeSkillStore().execute(command);
        broadcastCreativeSkillChange(result);
        return result;
      });
    });
    ipcMain.handle("desktop:creative-skills:prepare", (event, input) => {
      assertMainRenderer(event);
      ensureWorkspaceWritable();
      return requireCreativeSkillStore().prepare(input);
    });
    ipcMain.handle("desktop:creative-skills:commit", async (event, input) => {
      assertMainRenderer(event);
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(async () => {
        const result = await requireCreativeSkillStore().commit(input);
        broadcastCreativeSkillChange(result);
        return result;
      });
    });
    ipcMain.handle("desktop:creative-skills:create-sync-package", (event) => {
      assertMainRenderer(event);
      ensureWorkspaceWritable();
      return requireCreativeSkillStore().createSyncPackage();
    });
    ipcMain.handle("desktop:get-storage-overview", async (_event, protectedStorageKeys) => {
      const [workspace, updates] = await Promise.all([workspaceStore.inspectStorage(protectedStorageKeys), updateCache.inspect()]);
      return { workspace, updates: { ...updates, status: updateManager?.getState().status || "idle" } };
    });
    ipcMain.handle("desktop:cleanup-storage", (_event, categories, protectedStorageKeys) => {
      ensureWorkspaceWritable();
      if (activeGenerationCount > 0) throw new Error("请等待当前生成任务完成后再清理未引用文件。");
      const allowed = new Set(["images", "videos", "audio"]);
      const selected = Array.isArray(categories) ? categories.filter((category) => allowed.has(category)) : [];
      if (!selected.length) throw new Error("请选择需要清理的内容");
      return trackWorkspaceWrite(() => workspaceStore.cleanupStorage(selected, protectedStorageKeys));
    });
    ipcMain.handle("desktop:repair-storage", () => {
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(() => workspaceStore.repairStorage());
    });
    ipcMain.handle("desktop:choose-workspace", () =>
      chooseAndMigrateWorkspace(),
    );
    ipcMain.handle("desktop:choose-category-directory", (_event, category) => chooseCategoryDirectory(category));
    ipcMain.handle("desktop:reset-category-directory", (_event, category) => resetCategoryDirectory(category));
    ipcMain.handle("desktop:open-workspace", async (_event, section) => {
      const path = typeof section === "string" && workspaceInfo().locations[section]?.path ? workspaceInfo().locations[section].path : activeWorkspacePath;
      await mkdir(path, { recursive: true });
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
      return true;
    });
    ipcMain.handle("desktop:read-workspace-state", (_event, name) =>
      workspaceStore.readState(name),
    );
    ipcMain.handle("desktop:write-workspace-state", (_event, name, value) => {
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(() => workspaceStore.writeState(name, value));
    });
    ipcMain.handle("desktop:remove-workspace-state", (_event, name) => {
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(() => workspaceStore.removeState(name));
    });
    ipcMain.handle("desktop:store-asset", async (_event, input) => {
      ensureWorkspaceWritable();
      if (!input || typeof input !== "object")
        throw new Error("无效的素材数据");
      if (input.remoteUrl) {
        const url = new URL(input.remoteUrl);
        if (!["http:", "https:"].includes(url.protocol))
          throw new Error("仅支持下载 HTTP 或 HTTPS 生成结果");
      }
      const stored = await trackWorkspaceWrite(() => workspaceStore.saveAsset(input));
      const url = `workspace://local/${stored.relativePath.split("/").map(encodeURIComponent).join("/")}`;
      return { ...stored, url };
    });
    ipcMain.handle("desktop:find-asset-by-idempotency-key", (_event, input) => {
      if (!input || typeof input !== "object" || input.kind !== "image" || typeof input.idempotencyKey !== "string")
        throw new Error("无效的创作 Skill 输出查询");
      return workspaceStore.findAssetByIdempotencyKey(input);
    });
    ipcMain.handle("desktop:delete-asset", async (_event, storageKey) => {
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(() => workspaceStore.deleteAsset(storageKey));
    });
    ipcMain.handle("desktop:delete-unused-asset", async (_event, storageKey) => {
      ensureWorkspaceWritable();
      if (activeGenerationCount > 0) throw new Error("请等待当前生成任务完成后再永久删除成果文件。");
      return trackWorkspaceWrite(() => workspaceStore.deleteAsset(storageKey));
    });
    ipcMain.handle("desktop:write-asset", (_event, storageKey, bytes) => {
      ensureWorkspaceWritable();
      return trackWorkspaceWrite(() => workspaceStore.writeAsset(storageKey, bytes));
    });
    updateManager = createUpdateManager({
      app,
      ipcMain,
      isDevelopment,
      getWindow: () => mainWindow,
      beforeInstall: () => {
        appQuitting = true;
        showSystemNotification(`${PRODUCT_NAME} 正在更新`, "应用即将重启并安装已下载的更新。适合保存中的内容请先确认已保存。");
      },
    });
    ipcMain.handle("desktop:clear-update-cache", async () => {
      const status = updateManager.getState().status;
      if (status === "downloading" || status === "downloaded") throw new Error("更新正在下载或等待安装，暂时不能清理更新缓存。");
      return updateCache.clear();
    });
    ipcMain.handle("desktop:notify-task-complete", (_event, input) => {
      if (!Notification.isSupported() || mainWindow?.isFocused()) return false;
      const title = typeof input?.title === "string" ? input.title.slice(0, 80) : PRODUCT_NAME;
      const body = typeof input?.body === "string" ? input.body.slice(0, 200) : "后台任务已完成";
      const route = typeof input?.route === "string" && input.route.startsWith("/") ? input.route : "/";
      const notification = new Notification({ title, body, icon: join(appRoot, "build", "icon-win.png") });
      notification.on("click", () => {
        showMainWindow();
        mainWindow?.webContents.send("desktop:navigate", route);
      });
      notification.show();
      return true;
    });
    await registerAppProtocol();
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  });

app.on("before-quit", () => {
  appQuitting = true;
  updateManager?.clearSchedule();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && (closeBehavior === "quit" || appQuitting)) app.quit();
});

process.on("uncaughtException", (error) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    void dialog.showMessageBox(mainWindow, {
      type: "error",
      title: `${PRODUCT_NAME} 遇到错误`,
      message: error.message,
    });
  }
});
