import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);

async function convertHeicToPng(bytes, mimeType, temporaryRoot, timeout, maxOutputBytes) {
  const directory = await mkdtemp(join(temporaryRoot, "fourj-skill-image-"));
  try {
    const sourcePath = join(directory, mimeType === "image/heif" ? "source.heif" : "source.heic");
    const outputPath = join(directory, "canonical.png");
    await writeFile(sourcePath, bytes, { flag: "wx", mode: 0o600 });
    await new Promise((resolve, reject) => {
      execFile(
        "/usr/bin/sips",
        ["-s", "format", "png", sourcePath, "--out", outputPath],
        { timeout, killSignal: "SIGKILL", maxBuffer: 64 * 1024, windowsHide: true },
        (error) => error ? reject(error) : resolve(),
      );
    });
    const output = await stat(outputPath);
    if (!output.isFile() || output.size < 1 || output.size > maxOutputBytes)
      throw new Error("HEIC/HEIF 规范化输出大小无效");
    return await readFile(outputPath);
  } catch (error) {
    throw new Error("创作 Skill HEIC/HEIF 图片无法解码", { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createCreativeSkillImageInspector({
  nativeImage,
  temporaryRoot = tmpdir(),
  conversionTimeout = 30_000,
  maxOutputBytes = 32 * 1024 * 1024,
  maxImageEdge = 16_384,
  maxImagePixels = 64 * 1024 * 1024,
}) {
  if (typeof nativeImage?.createFromBuffer !== "function")
    throw new Error("缺少 Electron nativeImage 图片解码器");
  return async ({ bytes, mimeType, normalize }) => {
    const source = Buffer.from(bytes);
    const converted = HEIC_MIME_TYPES.has(mimeType);
    if (converted && !normalize) throw new Error("HEIC/HEIF 图片必须先规范化");
    const normalized = converted
      ? await convertHeicToPng(source, mimeType, temporaryRoot, conversionTimeout, maxOutputBytes)
      : source;
    const image = nativeImage.createFromBuffer(normalized, { scaleFactor: 1 });
    if (image.isEmpty()) throw new Error("创作 Skill 图片无法解码");
    const size = image.getSize();
    if (!Number.isSafeInteger(size.width) || size.width < 1 || !Number.isSafeInteger(size.height) || size.height < 1)
      throw new Error("创作 Skill 图片尺寸无效");
    if (size.width > maxImageEdge || size.height > maxImageEdge || size.width * size.height > maxImagePixels)
      throw new Error("创作 Skill 图片尺寸超过安全上限");
    if (!normalize) return size;
    const sanitizedBytes = converted ? normalized : image.toPNG();
    const canonical = nativeImage.createFromBuffer(sanitizedBytes, { scaleFactor: 1 });
    const canonicalSize = canonical.getSize();
    if (
      canonical.isEmpty() || canonicalSize.width !== size.width || canonicalSize.height !== size.height
    )
      throw new Error("创作 Skill 图片规范化后无法解码或尺寸不一致");
    return { ...size, mimeType: "image/png", sanitizedBytes };
  };
}
