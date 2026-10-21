import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const CATEGORY_DIRECTORIES = {
  images: "assets/images",
  videos: "assets/videos",
  audio: "assets/audio",
  projects: "projects",
  records: "records",
  skills: "skills",
};

export async function migrateWorkspaceContents({ sourceRoot, targetRoot, sourceLocations = {} }) {
  const sourcePath = resolve(sourceRoot);
  const targetPath = resolve(targetRoot);
  const entries = [
    ...Object.entries(CATEGORY_DIRECTORIES).map(([category, relativePath]) => ({
      source: sourceLocations[category] || join(sourcePath, relativePath),
      target: join(targetPath, relativePath),
    })),
    {
      source: join(sourcePath, "assets/files"),
      target: join(targetPath, "assets/files"),
    },
  ];

  for (const entry of entries) {
    if (!existsSync(entry.source) || resolve(entry.source) === resolve(entry.target)) continue;
    await mkdir(entry.target, { recursive: true });
    await cp(entry.source, entry.target, { recursive: true, force: false, errorOnExist: false });
  }
}
