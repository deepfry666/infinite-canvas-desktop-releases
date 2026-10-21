import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
      files.push({ path, bytes: (await stat(path)).size });
    }));
  };
  await visit(root);
  return files;
}

export function createUpdateCache({ cacheDir, markerFile }) {
  const inspect = async () => {
    const files = await listFiles(cacheDir);
    return { path: cacheDir, files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0) };
  };
  const clear = async () => {
    const before = await inspect();
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    return { clearedFiles: before.files, clearedBytes: before.bytes };
  };
  return {
    inspect,
    clear,
    async markHealthyVersion(version) {
      let previous = "";
      try {
        previous = (await readFile(markerFile, "utf8")).trim();
      } catch {
        previous = "";
      }
      if (previous === version)
        return { clearedFiles: 0, clearedBytes: 0, previousVersion: previous, updated: false };
      const result = await clear();
      await mkdir(dirname(markerFile), { recursive: true });
      await writeFile(markerFile, version, "utf8");
      return {
        ...result,
        previousVersion: previous,
        updated: Boolean(previous && previous !== version),
      };
    },
  };
}
