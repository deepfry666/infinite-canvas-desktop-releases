export function normalizeUpdatePreferences(value = {}) {
  return {
    autoCheck: value.autoCheck === false ? false : true,
    channel: value.channel === "stable" ? "stable" : "preview",
  };
}

export function resolveUpdateSupport({ isDevelopment, isPackaged, platform }) {
  if (isDevelopment || !isPackaged)
    return { supported: false, reason: "开发环境不执行应用更新" };
  if (platform !== "win32")
    return { supported: false, reason: "当前版本仅支持 Windows 自动更新" };
  return { supported: true, reason: "" };
}
