import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PROFILE_STORAGE_ENTRIES = ["Local Storage", "IndexedDB", "Session Storage", "WebStorage"];
const RESTORE_MARKER = ".legacy-runtime-profile-restored-v1.json";

export function restoreLegacyRuntimeProfile({ sourcePath, targetPath }) {
  const source = resolve(sourcePath);
  const target = resolve(targetPath);
  const markerPath = join(target, RESTORE_MARKER);
  if (source === target || !existsSync(source)) return { restored: false, reason: "source-missing" };
  if (existsSync(markerPath)) return { restored: false, reason: "already-restored" };

  const entries = PROFILE_STORAGE_ENTRIES.filter((entry) => existsSync(join(source, entry)));
  if (!entries.length) return { restored: false, reason: "storage-missing" };

  mkdirSync(target, { recursive: true });
  const backupRoot = join(target, "profile-backups", "before-legacy-runtime-restore");
  const backedUp = [];
  for (const entry of entries) {
    const sourceEntry = join(source, entry);
    const targetEntry = join(target, entry);
    const backupEntry = join(backupRoot, entry);
    if (existsSync(targetEntry)) {
      if (!existsSync(backupEntry)) {
        mkdirSync(dirname(backupEntry), { recursive: true });
        renameSync(targetEntry, backupEntry);
        backedUp.push(entry);
      } else {
        rmSync(targetEntry, { recursive: true, force: true });
      }
    }
    cpSync(sourceEntry, targetEntry, { recursive: true, force: true });
  }

  writeFileSync(markerPath, JSON.stringify({ version: 1, restoredEntries: entries, backedUpEntries: backedUp }), "utf8");
  return { restored: true, entries, backedUp };
}
