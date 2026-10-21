const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "infiniteCanvasDesktop",
  Object.freeze({
    platform: process.platform,
    version: "desktop-alpha",
    isDesktop: true,
    creativeSkills: Object.freeze({
      query: (input) => ipcRenderer.invoke("desktop:creative-skills:query", input),
      execute: (command) => ipcRenderer.invoke("desktop:creative-skills:execute", command),
      prepare: (input) => ipcRenderer.invoke("desktop:creative-skills:prepare", input),
      commit: (input) => ipcRenderer.invoke("desktop:creative-skills:commit", input),
      createSyncPackage: () => ipcRenderer.invoke("desktop:creative-skills:create-sync-package"),
      subscribe: (listener) => {
        const handler = (_event, change) => listener(change);
        ipcRenderer.on("desktop:creative-skills:changed", handler);
        return () => ipcRenderer.removeListener("desktop:creative-skills:changed", handler);
      },
    }),
    getDataLocation: () => ipcRenderer.invoke("desktop:get-data-location"),
    getWorkspaceInfo: () => ipcRenderer.invoke("desktop:get-workspace-info"),
    getStorageOverview: (protectedStorageKeys) => ipcRenderer.invoke("desktop:get-storage-overview", protectedStorageKeys),
    cleanupStorage: (categories, protectedStorageKeys) => ipcRenderer.invoke("desktop:cleanup-storage", categories, protectedStorageKeys),
    repairStorage: () => ipcRenderer.invoke("desktop:repair-storage"),
    clearUpdateCache: () => ipcRenderer.invoke("desktop:clear-update-cache"),
    chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
    chooseCategoryDirectory: (category) => ipcRenderer.invoke("desktop:choose-category-directory", category),
    resetCategoryDirectory: (category) => ipcRenderer.invoke("desktop:reset-category-directory", category),
    openWorkspace: (section) =>
      ipcRenderer.invoke("desktop:open-workspace", section),
    readWorkspaceState: (name) =>
      ipcRenderer.invoke("desktop:read-workspace-state", name),
    writeWorkspaceState: (name, value) =>
      ipcRenderer.invoke("desktop:write-workspace-state", name, value),
    removeWorkspaceState: (name) =>
      ipcRenderer.invoke("desktop:remove-workspace-state", name),
    storeAsset: (input) => ipcRenderer.invoke("desktop:store-asset", input),
    findAssetByIdempotencyKey: (input) => ipcRenderer.invoke("desktop:find-asset-by-idempotency-key", input),
    writeAsset: (storageKey, bytes) =>
      ipcRenderer.invoke("desktop:write-asset", storageKey, bytes),
    deleteAsset: (storageKey) =>
      ipcRenderer.invoke("desktop:delete-asset", storageKey),
    deleteUnusedAsset: (storageKey) =>
      ipcRenderer.invoke("desktop:delete-unused-asset", storageKey),
    setActiveGenerationCount: (count) => ipcRenderer.send("desktop:set-active-generation-count", count),
    setCloseBehavior: (behavior) => ipcRenderer.send("desktop:set-close-behavior", behavior),
    setTheme: (theme) => ipcRenderer.send("desktop:set-theme", theme),
    getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
    setUpdatePreferences: (preferences) =>
      ipcRenderer.invoke("desktop:set-update-preferences", preferences),
    checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
    installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
    onUpdateState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("desktop:update-state", handler);
      return () => ipcRenderer.removeListener("desktop:update-state", handler);
    },
    onUpdateCompleted: (listener) => {
      const handler = (_event, info) => listener(info);
      ipcRenderer.on("desktop:update-completed", handler);
      return () => ipcRenderer.removeListener("desktop:update-completed", handler);
    },
    notifyTaskComplete: (input) => ipcRenderer.invoke("desktop:notify-task-complete", input),
    onNavigate: (listener) => {
      const handler = (_event, route) => listener(route);
      ipcRenderer.on("desktop:navigate", handler);
      return () => ipcRenderer.removeListener("desktop:navigate", handler);
    },
  }),
);
