import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markSource = await readFile(join(root, "assets/fourj-mark.svg"), "utf8");
const markPath = markSource.match(/<path[^>]* d="([^"]+)"/u)?.[1];

if (!markPath) throw new Error("assets/fourj-mark.svg must contain one path with a d attribute");

const markScale = 700 / 804;
const markX = (1024 - 700) / 2;
const markY = (1024 - 699 * markScale) / 2;
const mark = (color) => `<g transform="translate(${markX} ${markY}) scale(${markScale})"><path d="${markPath}" fill="${color}" fill-rule="evenodd"/></g>`;
const svg = (content) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${content}</svg>\n`;
const paper = "#f6f4ee";
const ink = "#211d19";
const macSvg = svg(`<rect x="64" y="64" width="896" height="896" rx="208" fill="${paper}"/>${mark(ink)}`);
const winSvg = svg(`<rect width="1024" height="1024" fill="${paper}"/>${mark(ink)}`);
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 804 699" role="img" aria-labelledby="fourj-logo-title">
  <title id="fourj-logo-title">四季画布 FourJ Canvas</title>
  <style>:root{color:#211d19}@media(prefers-color-scheme:dark){:root{color:#f0ece4}}</style>
  <path d="${markPath}" fill="currentColor" fill-rule="evenodd"/>
</svg>\n`;

await mkdir(join(root, "build"), { recursive: true });
await Promise.all([
  writeFile(join(root, "build/icon.svg"), macSvg),
  writeFile(join(root, "build/icon-win.svg"), winSvg),
  writeFile(join(root, "web/public/logo.svg"), logoSvg),
  writeFile(join(root, "docs/public/logo.svg"), logoSvg),
  writeFile(join(root, "docs/src/app/icon.svg"), logoSvg),
  sharp(Buffer.from(macSvg)).png().toFile(join(root, "build/icon.png")),
  sharp(Buffer.from(winSvg)).png().toFile(join(root, "build/icon-win.png")),
]);

if (process.platform === "darwin") {
  const temp = await mkdtemp(join(tmpdir(), "fourj-icons-"));
  const iconset = join(temp, "FourJCanvas.iconset");
  await mkdir(iconset);
  const slots = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  await Promise.all(slots.map(([size, name]) => sharp(Buffer.from(macSvg)).resize(size, size).png().toFile(join(iconset, name))));
  await execFileAsync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", join(root, "build/icon.icns")]);
  await rm(temp, { recursive: true, force: true });
}

console.log("FourJ Canvas icons generated.");
