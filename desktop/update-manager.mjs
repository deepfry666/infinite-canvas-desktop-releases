import electronUpdater from "electron-updater";

import {
  normalizeUpdatePreferences,
  resolveUpdateSupport,
} from "./update-policy.mjs";

const { autoUpdater } = electronUpdater;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15 * 1000;

export function createUpdateManager({ app, ipcMain, isDevelopment, getWindow, beforeInstall }) {
  const support = resolveUpdateSupport({
    isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
  });
  let preferences = normalizeUpdatePreferences();
  let initialTimer = null;
  let intervalTimer = null;
  let state = {
    status: support.supported ? "idle" : "unsupported",
    currentVersion: app.getVersion(),
    availableVersion: "",
    percent: 0,
    transferred: 0,
    total: 0,
    message: support.reason,
    checkedAt: "",
    manual: false,
  };

  const sendState = (patch = {}) => {
    state = { ...state, ...patch };
    const window = getWindow();
    if (window && !window.isDestroyed())
      window.webContents.send("desktop:update-state", state);
    return state;
  };

  const fail = (error) =>
    sendState({
      status: "error",
      message: updateErrorMessage(error),
      checkedAt: new Date().toISOString(),
    });

  const checkForUpdates = async (manual = false) => {
    if (!support.supported) return sendState({ manual, message: support.reason });
    if (["checking", "downloading"].includes(state.status)) return state;
    sendState({ status: "checking", message: "", manual });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      fail(error);
    }
    return state;
  };

  const downloadUpdate = async () => {
    if (!support.supported || state.status !== "available") return state;
    sendState({ status: "downloading", percent: 0, transferred: 0, total: 0, message: "" });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      fail(error);
    }
    return state;
  };

  const clearSchedule = () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  };

  const scheduleChecks = () => {
    clearSchedule();
    if (!support.supported || !preferences.autoCheck) return;
    initialTimer = setTimeout(() => void checkForUpdates(false), INITIAL_CHECK_DELAY_MS);
    intervalTimer = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS);
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.on("checking-for-update", () =>
    sendState({ status: "checking", message: "" }),
  );
  autoUpdater.on("update-available", (info) =>
    sendState({
      status: "available",
      availableVersion: info.version || "",
      checkedAt: new Date().toISOString(),
      message: "",
    }),
  );
  autoUpdater.on("update-not-available", () =>
    sendState({
      status: "not-available",
      availableVersion: "",
      checkedAt: new Date().toISOString(),
      message: "",
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    sendState({
      status: "downloading",
      percent: Number.isFinite(progress.percent) ? progress.percent : 0,
      transferred: Number.isFinite(progress.transferred) ? progress.transferred : 0,
      total: Number.isFinite(progress.total) ? progress.total : 0,
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    sendState({
      status: "downloaded",
      availableVersion: info.version || state.availableVersion,
      percent: 100,
      checkedAt: new Date().toISOString(),
      message: "",
    }),
  );
  autoUpdater.on("error", fail);

  ipcMain.handle("desktop:get-update-state", () => state);
  ipcMain.handle("desktop:set-update-preferences", (event, value) => {
    if (event.sender !== getWindow()?.webContents) return state;
    preferences = normalizeUpdatePreferences(value);
    autoUpdater.allowPrerelease = preferences.channel === "preview";
    scheduleChecks();
    return state;
  });
  ipcMain.handle("desktop:check-for-updates", (event) => {
    if (event.sender !== getWindow()?.webContents) return state;
    return checkForUpdates(true);
  });
  ipcMain.handle("desktop:download-update", (event) => {
    if (event.sender !== getWindow()?.webContents) return state;
    return downloadUpdate();
  });
  ipcMain.handle("desktop:install-update", (event) => {
    if (event.sender !== getWindow()?.webContents || state.status !== "downloaded")
      return false;
    beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  return { getState: () => state, clearSchedule };
}

function updateErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "未知更新错误");
  return message.replace(/gh[opusr]_[A-Za-z0-9_]+/g, "[已隐藏凭据]").slice(0, 500);
}
