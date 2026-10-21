import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { zipSync } from "fflate";

const SCHEMA_VERSION = 1;
const SKILL_DIRECTORIES = [
  "catalogs",
  "revisions",
  "bindings",
  "drafts",
  "captures",
  "transactions",
  "import-reports",
];
const TRUST_LEVELS = new Set([
  "builtin-verified",
  "local-reviewed",
  "external-unverified",
  "markdown-quarantined",
]);
const DRAFT_SOURCES = new Set(["builtin", "manual", "canvas", "package", "skill-markdown"]);
const PACKAGE_LIMITS = {
  compressedBytes: 64 * 1024 * 1024,
  extractedBytes: 128 * 1024 * 1024,
  entries: 64,
  manifestBytes: 256 * 1024,
  images: 12,
  imageBytes: 32 * 1024 * 1024,
  imageEdge: 16_384,
  imagePixels: 64 * 1024 * 1024,
  markdownBytes: 1024 * 1024,
};
const SYNC_PACKAGE_LIMITS = {
  compressedBytes: 64 * 1024 * 1024,
  extractedBytes: 128 * 1024 * 1024,
  entries: 2048,
};
const SYNC_PACKAGE_MEDIA_TYPE = "application/vnd.fourj.skill-library+zip";
const TRANSFER_LINK_FALLBACK_ERRORS = new Set(["ENOTSUP", "EOPNOTSUPP", "EPERM", "EXDEV"]);
const catalogWriteQueues = new Map();
const draftWriteQueues = new Map();
const fixtureLifecycleQueues = new Map();
const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};
const EXAMPLE_IMAGE_MIME_TYPES = new Set([
  ...Object.values(IMAGE_MIME_TYPES),
  "image/heic",
  "image/heif",
]);
const BUILTIN_EDITORIAL_POSTER_VERSION = "sha256:6f667985b603cb6e0efcf9691cf7e7ab4840ff6908258209beb0d79dd2413639";
const BUILTIN_CREATIVE_SKILLS = [
  {
    skillId: "fourj.editorial-poster-v1",
    revision: 1,
    lifecycle: "published",
    ownership: "builtin",
    trust: "builtin-verified",
    source: "builtin",
    name: "编辑海报",
    description: "保留原图主体与真实材质，转化为低饱和暖调、纸张印刷质感和自适应字体编排的编辑海报。",
    enabled: true,
    favorite: false,
    activeRevision: BUILTIN_EDITORIAL_POSTER_VERSION,
    versions: [
      {
        versionId: BUILTIN_EDITORIAL_POSTER_VERSION,
        definitionHash: BUILTIN_EDITORIAL_POSTER_VERSION,
        definition: {
          schemaVersion: 1,
          kind: "linear-image",
          parameters: [
            { key: "user-request", label: "创作要求", type: "text", required: true, maxLength: 1200 },
            { key: "headline", label: "主标题", type: "text", required: false, maxLength: 80 },
            { key: "aspect-ratio", label: "画面比例", type: "aspect-ratio", required: false, options: ["auto", "1:1", "4:5", "3:4", "16:9", "9:16"], default: "auto" },
          ],
          steps: [
            {
              operation: "image.edit",
              references: [{ type: "input-target" }, { type: "input-references" }],
              prompt: [
                { type: "literal", text: "把原图转化为具有独立杂志编辑感的艺术海报，并遵循以下稳定视觉语法。第一，完整保留原图主体的身份、面部、姿态、服装或产品结构、真实材质、核心光影与可辨识细节，不随意换人、换物、重绘背景或改变叙事。第二，依据主体位置、视线方向、景深和原图留白自适应排版，不套固定坐标模板；允许裁切边缘，但不能遮住面部、眼睛或关键识别部位。第三，整体采用低饱和暖调电影色彩，压低刺眼高光与数码锐度，保留自然暗部层次；叠加克制的纸纤维、旧印刷、网点和细腻胶片颗粒，让画面有真实纸本触感而不是脏污滤镜。第四，建立清晰的编辑字体层级：用一组大号、高对比衬线标题形成视觉骨架，可与主体边缘穿插、局部遮挡或低透明叠印；辅以少量小号打字机体或杂志字幕。若未提供明确文案，不要生成大段随机文字。第五，只在有助于平衡构图时加入一到两处星形、细线、手写笔触或页码式点缀，装饰必须服从主体。主标题内容（空值则不强行添加文字）：" },
                { type: "parameter", key: "headline" },
                { type: "literal", text: "。具体创作要求：" },
                { type: "parameter", key: "user-request" },
                { type: "literal", text: "。禁止改变主体身份与关键结构，禁止过度磨皮、塑料感、霓虹高饱和、廉价复古滤镜、统一居中模板、密集装饰、无意义乱码、伪造品牌标志和水印；最终结果应像为这张原图单独完成的编辑设计，而不是给所有图片套用同一张版式。" },
              ],
            },
          ],
          finalOutputCount: 1,
        },
        validation: { status: "passed", definitionHash: BUILTIN_EDITORIAL_POSTER_VERSION, issues: [] },
        testRun: { status: "passed", definitionHash: BUILTIN_EDITORIAL_POSTER_VERSION, runId: "builtin-verification", issues: [] },
        compatibility: { status: "compatible", issues: [] },
        health: { status: "healthy", issues: [] },
        assets: [],
        publishedAt: "2026-08-21T00:00:00.000Z",
      },
    ],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  },
];
const QUARANTINE_DEFINITION = {
  schemaVersion: 1,
  kind: "linear-image",
  parameters: [
    { key: "user-request", label: "创作要求", type: "text", required: true },
  ],
  steps: [
    {
      operation: "image.generate",
      prompt: [{ type: "literal", text: "隔离的 SKILL.md 不可执行" }],
    },
  ],
  finalOutputCount: 1,
};
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

function canonicalJson(value) {
  const visit = (item) => {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype)
      throw new Error("创作 Skill 数据必须是可序列化的普通 JSON");
    return Object.fromEntries(
      Object.keys(item).sort().map((key) => [key, visit(item[key])]),
    );
  };
  return `${JSON.stringify(visit(value), null, 2)}\n`;
}

function canonicalCompactJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCompactJson).join(",")}]`;
  if (!isPlainObject(value)) throw new Error("创作 Skill 定义必须是 JSON 数据");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalCompactJson(value[key])}`).join(",")}}`;
}

function definitionHash(definition) {
  return `sha256:${sha256(Buffer.from(canonicalCompactJson(definition)))}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function assertSkillId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id))
    throw new Error("无效的创作 Skill 标识");
  return id;
}

function parseJson(bytes, message) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(message, { cause: error });
  }
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function isPlainObject(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  );
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new Error(`${label}必须是对象`);
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label}包含不允许的字段：${unknown}`);
}

function assertOnlyKeys(value, keys, label) {
  assertExactKeys(value, keys, label);
}

function requiredString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > maxLength)
    throw new Error(`${label} 必须是 1 到 ${maxLength} 个字符`);
  return value;
}

function optionalString(value, label, maxLength) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Array.from(value).length > maxLength)
    throw new Error(`${label} 必须是不超过 ${maxLength} 个字符的文本`);
  return value;
}

function enqueueRootOperation(queues, skillsRoot, operation) {
  const previous = queues.get(skillsRoot) || Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(() => undefined, () => undefined);
  queues.set(skillsRoot, tail);
  void tail.then(() => {
    if (queues.get(skillsRoot) === tail) queues.delete(skillsRoot);
  });
  return result;
}

function enqueueCatalogWrite(skillsRoot, operation) {
  return enqueueRootOperation(catalogWriteQueues, skillsRoot, operation);
}

function enqueueDraftWrite(skillsRoot, operation) {
  return enqueueRootOperation(draftWriteQueues, skillsRoot, operation);
}

function enqueueFixtureLifecycle(skillsRoot, operation) {
  return enqueueRootOperation(fixtureLifecycleQueues, skillsRoot, operation);
}

async function copyFileExclusiveWithIdentity(source, target) {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(await readFile(source));
    await handle.sync();
    const info = await handle.stat({ bigint: true });
    return { device: String(info.dev), inode: String(info.ino) };
  } finally {
    await handle.close();
  }
}

function transferTargetKind(path) {
  let match = typeof path === "string" && path.match(/^catalogs\/([a-f0-9]{64})\.json$/);
  if (match) return { kind: "catalog", contentHash: match[1] };
  match = typeof path === "string" && path.match(/^revisions\/([a-f0-9]{64})\.json$/);
  if (match) return { kind: "revision", contentHash: match[1] };
  match = typeof path === "string" && path.match(
    /^captures\/([a-f0-9]{64})(\.png|\.jpg|\.webp|\.skill\.md)$/,
  );
  if (match) return {
    kind: match[2] === ".skill.md" ? "markdown-capture" : "image-capture",
    contentHash: match[1],
  };
  match = typeof path === "string" && path.match(/^drafts\/([a-z0-9][a-z0-9._-]{0,79})\.json$/i);
  if (match) return { kind: "draft", id: assertSkillId(match[1]) };
  match = typeof path === "string" && path.match(/^import-reports\/([a-f0-9]{64})\.json$/);
  if (match) return { kind: "report", packageHash: match[1] };
  throw new Error("创作 Skill 传输事务目标路径无效");
}

function assertTransferReceipt(value, directoryName) {
  assertExactKeys(
    value,
    ["schemaVersion", "operation", "kind", "transactionId", "baseHead", "nextHead", "files"],
    "创作 Skill 传输事务记录",
  );
  if (value.schemaVersion !== SCHEMA_VERSION || value.operation !== "transfer")
    throw new Error("不支持的创作 Skill 传输事务记录");
  if (!new Set(["skill-markdown", "fourj-skill", "sync-restore", "publish"]).has(value.kind))
    throw new Error("创作 Skill 传输事务类型无效");
  if (typeof value.transactionId !== "string" || !/^[a-z0-9_-]{1,120}$/i.test(value.transactionId))
    throw new Error("创作 Skill 传输事务标识无效");
  if (directoryName !== `${value.transactionId}.transfer`)
    throw new Error("创作 Skill 传输事务目录标识无效");
  if (!/^[a-f0-9]{64}$/.test(value.baseHead || "") || !/^[a-f0-9]{64}$/.test(value.nextHead || ""))
    throw new Error("创作 Skill 传输事务目录版本无效");
  if (value.baseHead === value.nextHead)
    throw new Error("创作 Skill 传输事务不能提交相同目录版本");
  if (
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > SYNC_PACKAGE_LIMITS.entries + 3
  )
    throw new Error("创作 Skill 传输事务文件数量无效");
  const paths = new Set();
  const stages = new Set();
  const counts = new Map();
  let totalBytes = 0;
  const files = value.files.map((file, index) => {
    assertExactKeys(
      file,
      ["path", "stage", "sha256", "bytes", "ownership", "targetIdentity"],
      `创作 Skill 传输事务文件[${index}]`,
    );
    const target = transferTargetKind(file.path);
    if (paths.has(file.path)) throw new Error("创作 Skill 传输事务包含重复目标");
    if (typeof file.stage !== "string" || !/^\d{4}\.stage$/.test(file.stage) || stages.has(file.stage))
      throw new Error("创作 Skill 传输事务暂存文件名无效");
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || ""))
      throw new Error("创作 Skill 传输事务文件哈希无效");
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > SYNC_PACKAGE_LIMITS.extractedBytes)
      throw new Error("创作 Skill 传输事务文件大小无效");
    if (!new Set(["preexisting", "pending", "hardlink", "copying", "copy"]).has(file.ownership))
      throw new Error("创作 Skill 传输事务文件所有权无效");
    if (file.targetIdentity !== undefined) {
      assertExactKeys(file.targetIdentity, ["device", "inode"], `创作 Skill 传输事务文件[${index}].targetIdentity`);
      if (
        !/^(0|[1-9]\d{0,39})$/.test(file.targetIdentity.device || "") ||
        !/^(0|[1-9]\d{0,39})$/.test(file.targetIdentity.inode || "") ||
        !new Set(["copying", "copy"]).has(file.ownership)
      )
        throw new Error("创作 Skill 传输事务复制目标身份无效");
    }
    if (file.ownership === "copy" && !file.targetIdentity)
      throw new Error("创作 Skill 传输事务复制目标缺少身份");
    if (target.contentHash && target.contentHash !== file.sha256)
      throw new Error("创作 Skill 传输事务内容寻址路径不一致");
    paths.add(file.path);
    stages.add(file.stage);
    counts.set(target.kind, (counts.get(target.kind) || 0) + 1);
    totalBytes += file.bytes;
    return { ...file, target };
  });
  if (totalBytes > SYNC_PACKAGE_LIMITS.extractedBytes + 4 * 1024 * 1024)
    throw new Error("创作 Skill 传输事务总大小无效");
  const catalog = files.find((file) => file.target.kind === "catalog");
  if (counts.get("catalog") !== 1 || catalog.target.contentHash !== value.nextHead)
    throw new Error("创作 Skill 传输事务缺少目标目录版本");
  if (value.kind === "skill-markdown" && (
    files.length !== 3 || counts.get("draft") !== 1 ||
    counts.get("markdown-capture") !== 1 || counts.get("catalog") !== 1
  ))
    throw new Error("SKILL.md 传输事务文件集合无效");
  if (value.kind === "fourj-skill" && (
    counts.get("draft") !== 1 || counts.get("report") !== 1 || counts.get("catalog") !== 1 ||
    (counts.get("image-capture") || 0) > PACKAGE_LIMITS.images ||
    counts.has("markdown-capture") || counts.has("revision")
  ))
    throw new Error(".fourj-skill 传输事务文件集合无效");
  if (value.kind === "sync-restore" && (
    counts.get("catalog") !== 1 || counts.has("draft") || counts.has("report") ||
    counts.has("markdown-capture")
  ))
    throw new Error("同步恢复传输事务文件集合无效");
  if (value.kind === "publish" && (
    files.length !== 2 || counts.get("revision") !== 1 || counts.get("catalog") !== 1
  ))
    throw new Error("发布传输事务文件集合无效");
  return { ...value, files };
}

function safeInteger(value, label, positive = false) {
  if (!Number.isSafeInteger(value) || (positive && value <= 0))
    throw new Error(`${label} 必须是${positive ? "正" : "安全"}整数`);
  return value;
}

function assertImageDimensions(width, height, label) {
  safeInteger(width, `${label}.width`, true);
  safeInteger(height, `${label}.height`, true);
  if (width > PACKAGE_LIMITS.imageEdge || height > PACKAGE_LIMITS.imageEdge)
    throw new Error(`${label}单边不能超过 ${PACKAGE_LIMITS.imageEdge} 像素`);
  if (width * height > PACKAGE_LIMITS.imagePixels)
    throw new Error(`${label}总像素不能超过 ${PACKAGE_LIMITS.imagePixels}`);
}

function assertCreativeSkillDefinition(value) {
  assertOnlyKeys(value, ["schemaVersion", "kind", "parameters", "steps", "finalOutputCount"], "recipe");
  if (value.schemaVersion !== 1) throw new Error("recipe.schemaVersion 必须为 1");
  if (value.kind !== "linear-image") throw new Error("recipe.kind 必须为 linear-image");
  const finalOutputCount = safeInteger(value.finalOutputCount, "recipe.finalOutputCount", true);
  if (finalOutputCount > 4) throw new Error("recipe.finalOutputCount 必须为 1 到 4");
  if (!Array.isArray(value.parameters) || value.parameters.length < 1 || value.parameters.length > 16)
    throw new Error("recipe.parameters 参数数量必须为 1 到 16");
  const parameterKeys = value.parameters.map((parameter, index) => {
    const label = `recipe.parameters[${index}]`;
    if (!isPlainObject(parameter)) throw new Error(`${label} 必须是对象`);
    const common = ["key", "label", "description", "required", "type"];
    const key = requiredString(parameter.key, `${label}.key`, 64);
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`${label}.key 参数键格式无效`);
    requiredString(parameter.label, `${label}.label`, 80);
    optionalString(parameter.description, `${label}.description`, 500);
    if (typeof parameter.required !== "boolean") throw new Error(`${label}.required 参数必须是布尔值`);
    if (parameter.type === "text") {
      assertOnlyKeys(parameter, [...common, "default", "maxLength"], label);
      const maxLength = parameter.maxLength === undefined
        ? 20_000
        : safeInteger(parameter.maxLength, `${label}.maxLength`, true);
      if (maxLength > 20_000) throw new Error(`${label}.maxLength 参数不能大于 20000`);
      const defaultValue = optionalString(parameter.default, `${label}.default`, maxLength);
      if (key !== "user-request" && parameter.required && defaultValue === undefined)
        throw new Error(`${label}.default 必填参数必须提供默认值`);
      if (parameter.required && defaultValue === "")
        throw new Error(`${label}.default 必填文本参数不能为空`);
    } else if (parameter.type === "enum") {
      assertOnlyKeys(parameter, [...common, "options", "default"], label);
      if (!Array.isArray(parameter.options) || parameter.options.length < 1 || parameter.options.length > 32)
        throw new Error(`${label}.options 枚举参数必须有 1 到 32 个选项`);
      const values = parameter.options.map((option, optionIndex) => {
        const optionLabel = `${label}.options[${optionIndex}]`;
        assertOnlyKeys(option, ["value", "label"], optionLabel);
        requiredString(option.label, `${optionLabel}.label`, 80);
        return requiredString(option.value, `${optionLabel}.value`, 80);
      });
      if (new Set(values).size !== values.length) throw new Error(`${label}.options 枚举参数选项值重复`);
      const defaultValue = optionalString(parameter.default, `${label}.default`, 80);
      if (parameter.required && defaultValue === undefined)
        throw new Error(`${label}.default 必填参数必须提供默认值`);
      if (defaultValue !== undefined && !values.includes(defaultValue))
        throw new Error(`${label}.default 不是枚举参数选项`);
    } else if (parameter.type === "integer") {
      assertOnlyKeys(parameter, [...common, "min", "max", "step", "default"], label);
      const min = safeInteger(parameter.min, `${label}.min`);
      const max = safeInteger(parameter.max, `${label}.max`);
      const step = safeInteger(parameter.step, `${label}.step`, true);
      if (min > max) throw new Error(`${label} 整数参数 min 不能大于 max`);
      if (parameter.required && parameter.default === undefined)
        throw new Error(`${label}.default 必填参数必须提供默认值`);
      if (parameter.default !== undefined) {
        const defaultValue = safeInteger(parameter.default, `${label}.default`);
        if (defaultValue < min || defaultValue > max || (defaultValue - min) % step !== 0)
          throw new Error(`${label}.default 不符合整数参数范围或步长`);
      }
    } else if (parameter.type === "aspect-ratio") {
      assertOnlyKeys(parameter, [...common, "options", "default"], label);
      const inspectRatio = (ratio, ratioLabel) => {
        requiredString(ratio, ratioLabel, 16);
        if (ratio !== "auto" && !/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(ratio))
          throw new Error(`${ratioLabel} 画幅参数格式无效`);
        return ratio;
      };
      const options = parameter.options === undefined
        ? undefined
        : Array.isArray(parameter.options)
          ? parameter.options.map((ratio, ratioIndex) => inspectRatio(ratio, `${label}.options[${ratioIndex}]`))
          : null;
      if (options === null || (options && (options.length < 1 || options.length > 32 || new Set(options).size !== options.length)))
        throw new Error(`${label}.options 画幅参数选项无效`);
      const defaultValue = parameter.default === undefined
        ? undefined
        : inspectRatio(parameter.default, `${label}.default`);
      if (parameter.required && defaultValue === undefined)
        throw new Error(`${label}.default 必填参数必须提供默认值`);
      if (defaultValue !== undefined && options && !options.includes(defaultValue))
        throw new Error(`${label}.default 不是画幅参数选项`);
    } else {
      throw new Error(`${label}.type 不支持`);
    }
    return key;
  });
  if (new Set(parameterKeys).size !== parameterKeys.length)
    throw new Error("recipe.parameters 参数键重复");
  const userRequest = value.parameters.filter((parameter) => parameter.key === "user-request");
  if (userRequest.length !== 1)
    throw new Error("recipe.parameters 必须且只能声明一个 user-request 参数");
  if (userRequest[0].type !== "text") throw new Error("user-request 参数类型必须为 text");
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 3)
    throw new Error("recipe.steps 步骤数量必须为 1 到 3");
  const declaredParameters = new Set(parameterKeys);
  value.steps.forEach((step, stepIndex) => {
    const label = `recipe.steps[${stepIndex}]`;
    assertOnlyKeys(step, ["operation", "prompt", "references"], label);
    if (step.operation !== "image.generate" && step.operation !== "image.edit")
      throw new Error(`${label}.operation 不支持`);
    if (stepIndex > 0 && step.operation !== "image.edit")
      throw new Error(`${label} 后续步骤必须为图片编辑`);
    if (!Array.isArray(step.prompt) || step.prompt.length < 1 || step.prompt.length > 64)
      throw new Error(`${label}.prompt 必须有 1 到 64 个片段`);
    step.prompt.forEach((segment, segmentIndex) => {
      const segmentLabel = `${label}.prompt[${segmentIndex}]`;
      if (segment?.type === "literal") {
        assertOnlyKeys(segment, ["type", "text"], segmentLabel);
        requiredString(segment.text, `${segmentLabel}.text`, 20_000);
      } else if (segment?.type === "parameter") {
        assertOnlyKeys(segment, ["type", "key"], segmentLabel);
        const key = requiredString(segment.key, `${segmentLabel}.key`, 64);
        if (!declaredParameters.has(key)) throw new Error(`${segmentLabel}.key 引用了未声明参数`);
      } else {
        throw new Error(`${segmentLabel}.type 不支持`);
      }
    });
    if (step.references === undefined) return;
    if (!Array.isArray(step.references) || step.references.length > 8)
      throw new Error(`${label}.references 不能超过 8 项`);
    if (step.operation === "image.generate" && step.references.length)
      throw new Error(`${label} 生成步骤不能声明参考图`);
    const identities = step.references.map((reference, referenceIndex) => {
      const referenceLabel = `${label}.references[${referenceIndex}]`;
      if (reference?.type === "asset") {
        assertOnlyKeys(reference, ["type", "sha256"], referenceLabel);
        if (!/^[a-f0-9]{64}$/.test(requiredString(reference.sha256, `${referenceLabel}.sha256`, 64)))
          throw new Error(`${referenceLabel}.sha256 无效`);
        return `asset:${reference.sha256}`;
      }
      if (reference?.type === "input-target" || reference?.type === "input-references") {
        assertOnlyKeys(reference, ["type"], referenceLabel);
        return reference.type;
      }
      throw new Error(`${referenceLabel}.type 不支持`);
    });
    if (new Set(identities).size !== identities.length)
      throw new Error(`${label}.references 包含重复参考图声明`);
  });
  return value;
}

function binaryBuffer(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new Error(`${label}必须是二进制数据`);
}

function decodeZipPath(bytes, utf8) {
  if (!utf8 && bytes.some((byte) => byte > 0x7f))
    throw new Error("ZIP 非 ASCII 文件名必须明确使用 UTF-8");
  try {
    return new TextDecoder(utf8 ? "utf-8" : "ascii", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("ZIP 文件名编码无效", { cause: error });
  }
}

function assertSafeZipPath(path, directory) {
  if (
    !path ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path)
  )
    throw new Error("ZIP 包含绝对路径、反斜杠或控制字符路径");
  const parts = path.split("/");
  if (directory && parts.at(-1) === "") parts.pop();
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".."))
    throw new Error("ZIP 包含路径穿越或空路径段");
}

function hasZip64Extra(extra) {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw new Error("ZIP extra field 已损坏");
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > extra.length) throw new Error("ZIP extra field 已损坏");
    if (id === 0x0001) return true;
    offset += size;
  }
  return false;
}

function imageMagicMatches(bytes, mimeType) {
  if (mimeType === "image/png")
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp")
    return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function assetReferences(definition) {
  return definition.steps.flatMap((step) =>
    (step.references || [])
      .filter((reference) => reference.type === "asset")
      .map((reference) => reference.sha256),
  );
}

function assertAssetDescriptors(value, label = "创作 Skill 固定资产", maxItems = PACKAGE_LIMITS.images) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems)
    throw new Error(`${label}数量无效`);
  const hashes = new Set();
  return value.map((asset, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(asset, ["sha256", "mimeType", "bytes", "width", "height"], itemLabel);
    if (!/^[a-f0-9]{64}$/.test(requiredString(asset.sha256, `${itemLabel}.sha256`, 64)))
      throw new Error(`${itemLabel}.sha256 无效`);
    if (!Object.values(IMAGE_MIME_TYPES).includes(asset.mimeType))
      throw new Error(`${itemLabel}.mimeType 无效`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > PACKAGE_LIMITS.imageBytes)
      throw new Error(`${itemLabel}.bytes 无效`);
    assertImageDimensions(asset.width, asset.height, itemLabel);
    if (hashes.has(asset.sha256)) throw new Error(`${label}包含重复内容`);
    hashes.add(asset.sha256);
    return asset;
  });
}

function assertDefinitionAssets(definition, assets) {
  const declared = new Set(assertAssetDescriptors(assets).map((asset) => asset.sha256));
  const missing = assetReferences(definition).find((hash) => !declared.has(hash));
  if (missing) throw new Error("创作 Skill 定义引用了草稿未声明的固定资产");
}

function assertExampleFixture(value) {
  if (value === undefined) return undefined;
  assertExactKeys(value, ["input", "expectedOutput"], "创作 Skill 样例夹具");
  const [input, expectedOutput] = [value.input, value.expectedOutput].map((descriptor, index) =>
    assertAssetDescriptors([descriptor], `创作 Skill 样例夹具${index ? "结果图" : "原图"}`)[0],
  );
  if (input.sha256 === expectedOutput.sha256) throw new Error("创作 Skill 样例夹具的原图与结果图不能相同");
  return { input, expectedOutput };
}

function assertQuarantinedMarkdown(value) {
  if (value === undefined) return undefined;
  assertExactKeys(
    value,
    ["sha256", "byteLength", "originalName"],
    "隔离的 SKILL.md 捕获",
  );
  if (!/^[a-f0-9]{64}$/.test(requiredString(value.sha256, "隔离的 SKILL.md SHA-256", 64)))
    throw new Error("隔离的 SKILL.md SHA-256 无效");
  if (
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > PACKAGE_LIMITS.markdownBytes
  )
    throw new Error("隔离的 SKILL.md 大小无效");
  if (value.originalName !== "SKILL.md") throw new Error("隔离的 SKILL.md 原始名称无效");
  return value;
}

function extensionForMimeType(mimeType) {
  return Object.entries(IMAGE_MIME_TYPES).find(([, value]) => value === mimeType)?.[0];
}

function deterministicZip(files, compressedLimit = PACKAGE_LIMITS.compressedBytes) {
  const entries = Object.fromEntries(
    [...files.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => [
      path,
      [binaryBuffer(bytes, `ZIP ${path}`), { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") }],
    ]),
  );
  const bytes = Buffer.from(zipSync(entries, { level: 6 }));
  if (bytes.length > compressedLimit)
    throw new Error(`ZIP 压缩包不能超过 ${compressedLimit} 字节`);
  return bytes;
}

function isoTimestamp(value, label) {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value)))
    throw new Error(`${label} 时间无效`);
  return value;
}

function assertSyncSkill(value, label = "同步包 Skill") {
  assertExactKeys(
    value,
    ["id", "name", "description", "activeRevision", "lifecycle", "ownership", "trust", "source", "createdAt", "updatedAt"],
    label,
  );
  const id = assertSkillId(value.id);
  requiredString(value.name, `${label}.name`, 120);
  optionalString(value.description, `${label}.description`, 1000);
  if (!/^[a-f0-9]{64}$/.test(requiredString(value.activeRevision, `${label}.activeRevision`, 64)))
    throw new Error(`${label}.activeRevision 无效`);
  if (value.lifecycle !== "published" || value.ownership !== "personal")
    throw new Error(`${label} 只能是个人发布记录`);
  if (!new Set(["local-reviewed", "external-unverified"]).has(value.trust))
    throw new Error(`${label}.trust 无效`);
  if (!new Set(["manual", "canvas", "package"]).has(value.source))
    throw new Error(`${label}.source 无效`);
  isoTimestamp(value.createdAt, `${label}.createdAt`);
  isoTimestamp(value.updatedAt, `${label}.updatedAt`);
  return { ...value, id };
}

function assertSyncTombstone(value, label = "同步包删除墓碑") {
  assertExactKeys(value, ["id", "deletedRevision", "deletedAt"], label);
  const id = assertSkillId(value.id);
  if (!/^[a-f0-9]{64}$/.test(requiredString(value.deletedRevision, `${label}.deletedRevision`, 64)))
    throw new Error(`${label}.deletedRevision 无效`);
  isoTimestamp(value.deletedAt, `${label}.deletedAt`);
  return { ...value, id };
}

function assertGate(value, definitionHashValue, testRun = false) {
  const label = testRun ? "同步包试跑门禁" : "同步包校验门禁";
  assertExactKeys(
    value,
    testRun ? ["status", "definitionHash", "runId", "testedAt", "issues"] : ["status", "definitionHash", "issues"],
    label,
  );
  if (value.status !== "passed" || value.definitionHash !== definitionHashValue)
    throw new Error(`${label} 未绑定已通过的当前定义`);
  if (testRun && value.runId !== undefined) optionalString(value.runId, `${label}.runId`, 160);
  if (testRun && value.testedAt !== undefined) isoTimestamp(value.testedAt, `${label}.testedAt`);
  if (!Array.isArray(value.issues) || value.issues.length > 100 || value.issues.some(
    (issue) => typeof issue !== "string" || Array.from(issue).length > 1000,
  ))
    throw new Error(`${label}.issues 无效`);
  return value;
}

function assertSyncRevision(value, expectedHash) {
  assertExactKeys(value, ["schemaVersion", "id", "trust", "source", "content", "publishedAt"], "同步包内容版本");
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error("同步包内容版本 schema 无效");
  const id = assertSkillId(value.id);
  if (!new Set(["local-reviewed", "external-unverified"]).has(value.trust))
    throw new Error("同步包内容版本 trust 无效");
  if (!new Set(["manual", "canvas", "package"]).has(value.source))
    throw new Error("同步包内容版本 source 无效");
  assertExactKeys(
    value.content,
    ["name", "description", "definition", "validation", "testRun", "assets"],
    "同步包内容版本 content",
  );
  requiredString(value.content.name, "同步包内容版本名称", 120);
  optionalString(value.content.description, "同步包内容版本描述", 1000);
  const definition = assertCreativeSkillDefinition(value.content.definition);
  const hash = definitionHash(definition);
  assertGate(value.content.validation, hash);
  assertGate(value.content.testRun, hash, true);
  const assets = assertAssetDescriptors(value.content.assets);
  assertDefinitionAssets(definition, assets);
  isoTimestamp(value.publishedAt, "同步包内容版本 publishedAt");
  if (expectedHash && sha256(Buffer.from(canonicalJson(value))) !== expectedHash)
    throw new Error("同步包内容版本规范化 hash 不一致");
  return { revision: value, id, assets };
}

function syncSemantic({ skills, tombstones, revisions, assets }) {
  return { schemaVersion: SCHEMA_VERSION, skills, tombstones, revisions, assets };
}

function assertSortedUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} 包含重复项`);
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (values.some((value, index) => value !== sorted[index])) throw new Error(`${label} 必须稳定排序`);
}

function inspectCreativeSkillSyncPackage(payload) {
  const bytes = binaryBuffer(payload, "创作 Skill 同步包 payload");
  if (bytes.length < 1 || bytes.length > SYNC_PACKAGE_LIMITS.compressedBytes)
    throw new Error(`创作 Skill 同步包不能超过 ${SYNC_PACKAGE_LIMITS.compressedBytes} 字节`);
  const entries = readZipEntries(bytes, SYNC_PACKAGE_LIMITS);
  const files = new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.name, entry.data]));
  if (entries.some((entry) => entry.directory)) throw new Error("创作 Skill 同步包不允许目录条目");
  const manifestBytes = files.get("fourj-skill-library.json");
  if (!manifestBytes || manifestBytes.length > 4 * 1024 * 1024)
    throw new Error("创作 Skill 同步包清单缺失或过大");
  const manifest = parseJson(manifestBytes, "创作 Skill 同步包清单已损坏");
  assertExactKeys(
    manifest,
    ["schemaVersion", "kind", "head", "publishedSkillCount", "tombstoneCount", "skills", "tombstones", "revisions", "assets"],
    "创作 Skill 同步包清单",
  );
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.kind !== "fourj-skill-library")
    throw new Error("不支持的创作 Skill 同步包 schema");
  if (!/^[a-f0-9]{64}$/.test(manifest.head || "")) throw new Error("创作 Skill 同步包 head 无效");
  if (!Array.isArray(manifest.skills) || manifest.skills.length > 1024)
    throw new Error("创作 Skill 同步包 Skill 数量无效");
  if (!Array.isArray(manifest.tombstones) || manifest.tombstones.length > 4096)
    throw new Error("创作 Skill 同步包墓碑数量无效");
  if (!Array.isArray(manifest.revisions) || manifest.revisions.length > 2047)
    throw new Error("创作 Skill 同步包版本数量无效");
  const skills = manifest.skills.map((skill, index) => assertSyncSkill(skill, `同步包 skills[${index}]`));
  const tombstones = manifest.tombstones.map((item, index) => assertSyncTombstone(item, `同步包 tombstones[${index}]`));
  const skillIds = skills.map((skill) => skill.id);
  const tombstoneIds = tombstones.map((item) => item.id);
  assertSortedUnique(skillIds, "同步包 Skill 标识");
  assertSortedUnique(tombstoneIds, "同步包墓碑标识");
  if (tombstoneIds.some((id) => skillIds.includes(id))) throw new Error("同步包 Skill 与墓碑标识冲突");
  if (manifest.publishedSkillCount !== skills.length || manifest.tombstoneCount !== tombstones.length)
    throw new Error("创作 Skill 同步包计数与清单不一致");
  if (!manifest.revisions.every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)))
    throw new Error("创作 Skill 同步包版本标识无效");
  assertSortedUnique(manifest.revisions, "同步包版本标识");
  const knownSkills = new Set(skillIds);
  const revisionRecords = new Map();
  const referencedAssets = new Map();
  for (const revisionHash of manifest.revisions) {
    const path = `revisions/${revisionHash}.json`;
    const revisionBytes = files.get(path);
    if (!revisionBytes || sha256(revisionBytes) !== revisionHash)
      throw new Error("创作 Skill 同步包版本文件缺失或 hash 不一致");
    const parsed = parseJson(revisionBytes, "创作 Skill 同步包版本已损坏");
    const inspected = assertSyncRevision(parsed, revisionHash);
    if (!knownSkills.has(inspected.id)) throw new Error("同步包版本不属于任何发布 Skill");
    revisionRecords.set(revisionHash, { ...inspected, bytes: Buffer.from(revisionBytes) });
    for (const asset of inspected.assets) {
      const previous = referencedAssets.get(asset.sha256);
      if (previous && canonicalCompactJson(previous) !== canonicalCompactJson(asset))
        throw new Error("同步包版本对同一资产声明不一致");
      referencedAssets.set(asset.sha256, asset);
    }
  }
  for (const skill of skills) {
    const active = revisionRecords.get(skill.activeRevision);
    if (!active || active.id !== skill.id) throw new Error("同步包 Skill 当前版本不存在或归属错误");
    if (
      active.revision.trust !== skill.trust || active.revision.source !== skill.source ||
      active.revision.content.name !== skill.name || (active.revision.content.description || "") !== skill.description
    )
      throw new Error("同步包 Skill 目录与当前版本不一致");
  }
  const assets = assertAssetDescriptors(
    manifest.assets,
    "同步包 assets",
    SYNC_PACKAGE_LIMITS.entries - 1,
  );
  const assetHashes = assets.map((asset) => asset.sha256);
  assertSortedUnique(assetHashes, "同步包资产标识");
  if (
    assets.length !== referencedAssets.size ||
    assets.some((asset) => canonicalCompactJson(asset) !== canonicalCompactJson(referencedAssets.get(asset.sha256)))
  )
    throw new Error("同步包资产清单与版本引用不一致");
  const assetRecords = new Map();
  for (const asset of assets) {
    const extension = extensionForMimeType(asset.mimeType);
    const path = `assets/${asset.sha256}${extension || ""}`;
    const assetBytes = extension && files.get(path);
    if (
      !assetBytes || assetBytes.length !== asset.bytes || sha256(assetBytes) !== asset.sha256 ||
      !imageMagicMatches(assetBytes, asset.mimeType)
    )
      throw new Error("创作 Skill 同步包资产完整性校验失败");
    assetRecords.set(asset.sha256, { descriptor: asset, bytes: Buffer.from(assetBytes), extension });
  }
  const allowedFiles = new Set([
    "fourj-skill-library.json",
    ...manifest.revisions.map((hash) => `revisions/${hash}.json`),
    ...assets.map((asset) => `assets/${asset.sha256}${extensionForMimeType(asset.mimeType)}`),
  ]);
  if (files.size !== allowedFiles.size || [...files.keys()].some((path) => !allowedFiles.has(path)))
    throw new Error("创作 Skill 同步包包含未声明文件");
  const semantic = syncSemantic({ skills, tombstones, revisions: manifest.revisions, assets });
  if (sha256(Buffer.from(canonicalJson(semantic))) !== manifest.head)
    throw new Error("创作 Skill 同步包语义 head 校验失败");
  return { bytes, manifest: { ...manifest, skills, tombstones, assets }, semantic, revisionRecords, assetRecords };
}

function readZipEntries(packageBytes, limits = PACKAGE_LIMITS) {
  if (packageBytes.length < 22) throw new Error(".fourj-skill 不是完整的 ZIP");
  const endOffset = packageBytes.length - 22;
  if (packageBytes.readUInt32LE(endOffset) !== 0x06054b50)
    throw new Error(".fourj-skill ZIP 结尾无效或包含注释/附加数据");
  const disk = packageBytes.readUInt16LE(endOffset + 4);
  const centralDisk = packageBytes.readUInt16LE(endOffset + 6);
  const entriesOnDisk = packageBytes.readUInt16LE(endOffset + 8);
  const entryCount = packageBytes.readUInt16LE(endOffset + 10);
  const centralSize = packageBytes.readUInt32LE(endOffset + 12);
  const centralOffset = packageBytes.readUInt32LE(endOffset + 16);
  const commentLength = packageBytes.readUInt16LE(endOffset + 20);
  if (commentLength !== 0) throw new Error(".fourj-skill ZIP 不允许归档注释");
  if (
    entriesOnDisk === 0xffff || entryCount === 0xffff ||
    centralSize === 0xffffffff || centralOffset === 0xffffffff
  )
    throw new Error(".fourj-skill 不支持 ZIP64");
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount)
    throw new Error(".fourj-skill 不支持分卷 ZIP");
  if (entryCount < 1 || entryCount > limits.entries)
    throw new Error(`ZIP 条目数不能超过 ${limits.entries}`);
  if (centralOffset + centralSize !== endOffset)
    throw new Error("ZIP 中央目录范围无效");

  const entries = [];
  const names = new Set();
  const foldedNames = new Set();
  let extractedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || packageBytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("ZIP 中央目录条目已损坏");
    const versionMadeBy = packageBytes.readUInt16LE(cursor + 4);
    const versionNeeded = packageBytes.readUInt16LE(cursor + 6);
    const flags = packageBytes.readUInt16LE(cursor + 8);
    const method = packageBytes.readUInt16LE(cursor + 10);
    const checksum = packageBytes.readUInt32LE(cursor + 16);
    const compressedSize = packageBytes.readUInt32LE(cursor + 20);
    const uncompressedSize = packageBytes.readUInt32LE(cursor + 24);
    const nameLength = packageBytes.readUInt16LE(cursor + 28);
    const extraLength = packageBytes.readUInt16LE(cursor + 30);
    const entryCommentLength = packageBytes.readUInt16LE(cursor + 32);
    const startDisk = packageBytes.readUInt16LE(cursor + 34);
    const externalAttributes = packageBytes.readUInt32LE(cursor + 38);
    const localOffset = packageBytes.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (entryEnd > endOffset) throw new Error("ZIP 中央目录条目越界");
    const nameBytes = packageBytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const extra = packageBytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    if (
      versionNeeded >= 45 || compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff || localOffset === 0xffffffff ||
      hasZip64Extra(extra)
    )
      throw new Error(".fourj-skill 不支持 ZIP64");
    if (flags & 0x0041) throw new Error(".fourj-skill 不允许加密 ZIP");
    const allowedFlags = 0x0808 | (method === 8 ? 0x0006 : 0);
    if (flags & ~allowedFlags) throw new Error("ZIP 使用了不支持的标志位");
    if (method !== 0 && method !== 8) throw new Error("ZIP 使用了不支持的压缩方法");
    if (startDisk !== 0) throw new Error(".fourj-skill 不支持分卷 ZIP");
    if (entryCommentLength !== 0) throw new Error(".fourj-skill ZIP 条目不允许注释");
    if (extra.length) throw new Error(".fourj-skill ZIP 条目不允许 extra field");
    const name = decodeZipPath(nameBytes, Boolean(flags & 0x0800));
    const unixMode = versionMadeBy >> 8 === 3 ? externalAttributes >>> 16 : 0;
    const unixType = unixMode & 0xf000;
    if (unixType === 0xa000) throw new Error(".fourj-skill 不允许符号链接");
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000)
      throw new Error(".fourj-skill 只允许普通文件和目录");
    const directory = unixType === 0x4000 || Boolean(externalAttributes & 0x10) || name.endsWith("/");
    if (directory !== name.endsWith("/")) throw new Error("ZIP 目录标记与路径不一致");
    assertSafeZipPath(name, directory);
    if (names.has(name)) throw new Error("ZIP 包含重复条目");
    names.add(name);
    const foldedName = name.normalize("NFC").toUpperCase().toLowerCase();
    if (foldedNames.has(foldedName))
      throw new Error("ZIP 包含 Unicode NFC 或大小写折叠后冲突的路径");
    foldedNames.add(foldedName);
    extractedBytes += uncompressedSize;
    if (extractedBytes > limits.extractedBytes)
      throw new Error(`ZIP 解压后不能超过 ${limits.extractedBytes} 字节`);
    entries.push({
      name,
      nameBytes,
      directory,
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = entryEnd;
  }
  if (cursor !== endOffset) throw new Error("ZIP 中央目录长度与条目不一致");

  for (const entry of entries) {
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || packageBytes.readUInt32LE(offset) !== 0x04034b50)
      throw new Error("ZIP 本地文件头已损坏");
    const flags = packageBytes.readUInt16LE(offset + 6);
    const method = packageBytes.readUInt16LE(offset + 8);
    const localChecksum = packageBytes.readUInt32LE(offset + 14);
    const localCompressedSize = packageBytes.readUInt32LE(offset + 18);
    const localUncompressedSize = packageBytes.readUInt32LE(offset + 22);
    const nameLength = packageBytes.readUInt16LE(offset + 26);
    const extraLength = packageBytes.readUInt16LE(offset + 28);
    const headerEnd = offset + 30 + nameLength + extraLength;
    if (headerEnd > centralOffset) throw new Error("ZIP 本地文件头越界");
    const localName = packageBytes.subarray(offset + 30, offset + 30 + nameLength);
    const localExtra = packageBytes.subarray(offset + 30 + nameLength, headerEnd);
    if (!localName.equals(entry.nameBytes) || flags !== entry.flags || method !== entry.method)
      throw new Error("ZIP 本地文件头与中央目录不一致");
    if (hasZip64Extra(localExtra)) throw new Error(".fourj-skill 不支持 ZIP64");
    if (localExtra.length) throw new Error(".fourj-skill ZIP 条目不允许 extra field");
    if (!(flags & 0x0008) && (
      localChecksum !== entry.checksum ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ))
      throw new Error("ZIP 本地文件头尺寸或校验值不一致");
    const dataEnd = headerEnd + entry.compressedSize;
    if (dataEnd > centralOffset) throw new Error("ZIP 压缩数据越界");
    const compressed = packageBytes.subarray(headerEnd, dataEnd);
    let data;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize)
        throw new Error("ZIP 未压缩条目的尺寸不一致");
      data = Buffer.from(compressed);
    } else {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
      } catch (error) {
        throw new Error("ZIP 条目解压失败", { cause: error });
      }
    }
    if (data.length !== entry.uncompressedSize || crc32(data) !== entry.checksum)
      throw new Error("ZIP 条目尺寸或 CRC 校验失败");
    let rangeEnd = dataEnd;
    if (flags & 0x0008) {
      if (packageBytes.readUInt32LE(rangeEnd) === 0x08074b50) rangeEnd += 4;
      if (rangeEnd + 12 > centralOffset) throw new Error("ZIP data descriptor 越界");
      if (
        packageBytes.readUInt32LE(rangeEnd) !== entry.checksum ||
        packageBytes.readUInt32LE(rangeEnd + 4) !== entry.compressedSize ||
        packageBytes.readUInt32LE(rangeEnd + 8) !== entry.uncompressedSize
      )
        throw new Error("ZIP data descriptor 与中央目录不一致");
      rangeEnd += 12;
    }
    entry.data = data;
    entry.rangeEnd = rangeEnd;
  }
  const ranges = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  let expectedOffset = 0;
  for (const entry of ranges) {
    if (entry.localOffset !== expectedOffset)
      throw new Error("ZIP 本地条目重叠、乱序或包含未声明数据");
    expectedOffset = entry.rangeEnd;
  }
  if (expectedOffset !== centralOffset)
    throw new Error("ZIP 本地条目与中央目录之间包含未声明数据");
  return entries;
}

function validatePackageManifest(manifest, entries) {
  assertExactKeys(
    manifest,
    ["schemaVersion", "id", "name", "description", "definition", "assets"],
    ".fourj-skill 清单",
  );
  if (manifest.schemaVersion !== SCHEMA_VERSION)
    throw new Error("不支持的 .fourj-skill 清单版本");
  assertSkillId(manifest.id);
  if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 120)
    throw new Error(".fourj-skill 名称无效");
  if (typeof manifest.description !== "string" || manifest.description.length > 1000)
    throw new Error(".fourj-skill 描述无效");
  if (!isPlainObject(manifest.definition)) throw new Error(".fourj-skill definition 必须是对象");
  if (!Array.isArray(manifest.assets) || manifest.assets.length > PACKAGE_LIMITS.images)
    throw new Error(`.fourj-skill 图片不能超过 ${PACKAGE_LIMITS.images} 张`);

  const files = new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.name, entry]));
  const directories = entries.filter((entry) => entry.directory).map((entry) => entry.name);
  if (directories.some((path) => path !== "assets/"))
    throw new Error(".fourj-skill 包含不允许的目录");
  const seenPaths = new Set();
  const seenHashes = new Set();
  for (const asset of manifest.assets) {
    assertExactKeys(asset, ["path", "mimeType", "sha256", "bytes"], ".fourj-skill asset");
    const match = typeof asset.path === "string" && asset.path.match(/^assets\/([a-f0-9]{64})(\.png|\.jpg|\.webp)$/);
    if (!match) throw new Error(".fourj-skill asset 路径必须使用内容哈希命名");
    if (asset.sha256 !== match[1]) throw new Error(".fourj-skill asset 路径与 sha256 不一致");
    if (asset.mimeType !== IMAGE_MIME_TYPES[match[2]])
      throw new Error(".fourj-skill asset 扩展名与 MIME 不一致");
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > PACKAGE_LIMITS.imageBytes)
      throw new Error(`.fourj-skill 单张图片不能超过 ${PACKAGE_LIMITS.imageBytes} 字节`);
    if (seenPaths.has(asset.path) || seenHashes.has(asset.sha256))
      throw new Error(".fourj-skill 清单包含重复 asset");
    seenPaths.add(asset.path);
    seenHashes.add(asset.sha256);
    const entry = files.get(asset.path);
    if (!entry) throw new Error(".fourj-skill 清单引用了不存在的 asset");
    if (entry.data.length !== asset.bytes || sha256(entry.data) !== asset.sha256)
      throw new Error(".fourj-skill asset 尺寸或 sha256 校验失败");
    if (!imageMagicMatches(entry.data, asset.mimeType))
      throw new Error(".fourj-skill asset 扩展名、MIME 与文件 magic 不一致");
  }
  const allowedFiles = new Set(["fourj-skill.json", ...manifest.assets.map((asset) => asset.path)]);
  if ([...files.keys()].some((path) => !allowedFiles.has(path)) || files.size !== allowedFiles.size)
    throw new Error(".fourj-skill 包含未声明文件或缺少清单文件");
  return files;
}

export async function inspectFourJSkillPackage(input = {}) {
  const hasBytes = input.bytes !== undefined;
  const hasPath = input.path !== undefined;
  if (hasBytes === hasPath) throw new Error("必须且只能提供 .fourj-skill bytes 或 path");
  let packageBytes;
  if (hasPath) {
    if (typeof input.path !== "string" || !input.path) throw new Error(".fourj-skill path 无效");
    const info = await stat(input.path);
    if (!info.isFile()) throw new Error(".fourj-skill path 不是文件");
    if (info.size > PACKAGE_LIMITS.compressedBytes)
      throw new Error(`.fourj-skill 压缩包不能超过 ${PACKAGE_LIMITS.compressedBytes} 字节`);
    packageBytes = await readFile(input.path);
  } else {
    packageBytes = binaryBuffer(input.bytes, ".fourj-skill bytes");
  }
  if (packageBytes.length > PACKAGE_LIMITS.compressedBytes)
    throw new Error(`.fourj-skill 压缩包不能超过 ${PACKAGE_LIMITS.compressedBytes} 字节`);

  const entries = readZipEntries(packageBytes);
  const manifestEntry = entries.find((entry) => entry.name === "fourj-skill.json" && !entry.directory);
  if (!manifestEntry) throw new Error(".fourj-skill 缺少 fourj-skill.json");
  if (manifestEntry.data.length > PACKAGE_LIMITS.manifestBytes)
    throw new Error(`.fourj-skill 清单不能超过 ${PACKAGE_LIMITS.manifestBytes} 字节`);
  let manifest;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(manifestEntry.data);
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(".fourj-skill 清单不是有效 UTF-8 JSON", { cause: error });
  }
  const files = validatePackageManifest(manifest, entries);
  if (manifest.assets.length && typeof input.imageInspector !== "function")
    throw new Error("检查 .fourj-skill 图片需要 imageInspector");

  const assets = [];
  for (const asset of manifest.assets) {
    const source = files.get(asset.path).data;
    const inspected = await input.imageInspector({
      bytes: Buffer.from(source),
      mimeType: asset.mimeType,
      path: asset.path,
    });
    if (!isPlainObject(inspected))
      throw new Error("imageInspector 未返回有效图片尺寸");
    assertImageDimensions(inspected.width, inspected.height, "imageInspector 返回图片");
    const data = inspected.sanitizedBytes === undefined
      ? Buffer.from(source)
      : binaryBuffer(inspected.sanitizedBytes, "imageInspector sanitizedBytes");
    if (data.length < 1 || data.length > PACKAGE_LIMITS.imageBytes)
      throw new Error(`imageInspector 返回的单张图片不能超过 ${PACKAGE_LIMITS.imageBytes} 字节`);
    if (!imageMagicMatches(data, asset.mimeType))
      throw new Error("imageInspector 返回图片的 MIME 与文件 magic 不一致");
    assets.push({
      path: asset.path,
      mimeType: asset.mimeType,
      sourceSha256: asset.sha256,
      sha256: sha256(data),
      byteLength: data.length,
      width: inspected.width,
      height: inspected.height,
      data,
    });
  }
  return {
    kind: "fourj-skill",
    status: "ready-for-review",
    lifecycle: "draft",
    enabled: false,
    trust: "external-unverified",
    packageHash: sha256(packageBytes),
    manifest,
    assets,
  };
}

export function createCreativeSkillStore({
  root,
  skillsRoot: configuredSkillsRoot,
  createId = randomUUID,
  now = () => new Date(),
  onTransactionPhase = () => {},
  pickImportFile,
  imageInspector,
  saveExportFile,
  createRecoveryPoint,
  linkFile = link,
  copyFileExclusive = copyFileExclusiveWithIdentity,
} = {}) {
  if (
    (typeof configuredSkillsRoot !== "string" || !configuredSkillsRoot) &&
    (typeof root !== "string" || !root)
  )
    throw new Error("缺少创作 Skill 或工作区目录");
  const skillsRoot = configuredSkillsRoot
    ? resolve(configuredSkillsRoot)
    : resolve(root, "skills");
  const currentPath = join(skillsRoot, "CURRENT");
  const previousPath = join(skillsRoot, "CURRENT.prev");
  const pathForCatalog = (head) => join(skillsRoot, "catalogs", `${head}.json`);
  const pathForDraft = (id) => join(skillsRoot, "drafts", `${assertSkillId(id)}.json`);
  const pathForRevision = (hash) => {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error("无效的创作 Skill 版本标识");
    return join(skillsRoot, "revisions", `${hash}.json`);
  };
  const inspections = new Map();
  const runCatalogWrite = (operation) => enqueueCatalogWrite(skillsRoot, async () => {
    await replayTransferTransactions();
    await replayPublicationCleanups();
    return operation();
  });
  const runDraftWrite = (operation) => enqueueDraftWrite(skillsRoot, operation);
  const runFixtureLifecycle = (operation) => enqueueFixtureLifecycle(skillsRoot, operation);
  const writeAtomic = async (path, bytes) => {
    const temporaryPath = `${path}.${createId()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, path);
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    }
  };
  const readPointer = async (path, name) => {
    const head = (await readFile(path, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(head)) throw new Error(`创作 Skill ${name} 指针无效`);
    return head;
  };
  const readHead = () => readPointer(currentPath, "CURRENT");
  const readCatalogAt = async (head) => {
    const bytes = await readFile(pathForCatalog(head));
    if (sha256(bytes) !== head) throw new Error("创作 Skill 目录版本完整性校验失败");
    const catalog = parseJson(bytes, "创作 Skill 目录版本已损坏");
    if (
      catalog?.schemaVersion !== SCHEMA_VERSION ||
      !Number.isSafeInteger(catalog.sequence) ||
      catalog.sequence < 0 ||
      !catalog.skills ||
      typeof catalog.skills !== "object" ||
      Array.isArray(catalog.skills) ||
      !catalog.tombstones ||
      typeof catalog.tombstones !== "object" ||
      Array.isArray(catalog.tombstones)
    )
      throw new Error("不支持的创作 Skill 目录版本");
    return { head, catalog };
  };
  const readCatalog = async () => readCatalogAt(await readHead());

  const removeTransferDirectory = async (directoryPath, allowedNames) => {
    const names = (await readdir(directoryPath)).sort();
    if (allowedNames && (
      names.length !== allowedNames.size || names.some((name) => !allowedNames.has(name))
    ))
      throw new Error("创作 Skill 传输事务目录包含未知文件，已保留原目录");
    for (const name of names) {
      const path = join(directoryPath, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("创作 Skill 传输事务目录包含非普通文件，已保留原目录");
    }
    const receiptIndex = names.indexOf("receipt.json");
    if (receiptIndex >= 0) {
      await unlink(join(directoryPath, "receipt.json"));
      names.splice(receiptIndex, 1);
    }
    await Promise.all(names.map((name) => unlink(join(directoryPath, name))));
    await rmdir(directoryPath);
  };

  const readTransferReceipt = async (directoryName) => {
    if (!/^[a-z0-9_-]{1,120}\.transfer$/i.test(directoryName))
      throw new Error("创作 Skill 传输事务目录名无效，已保留原目录");
    const directoryPath = join(skillsRoot, "transactions", directoryName);
    const directoryInfo = await lstat(directoryPath);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
      throw new Error("创作 Skill 传输事务不是普通目录，已保留原路径");
    const names = (await readdir(directoryPath)).sort();
    const nextReceiptIndex = names.indexOf("receipt.next");
    if (nextReceiptIndex >= 0 && names.includes("receipt.json")) {
      const nextPath = join(directoryPath, "receipt.next");
      const nextInfo = await lstat(nextPath);
      if (!nextInfo.isFile() || nextInfo.isSymbolicLink())
        throw new Error("创作 Skill 传输事务临时记录无效，已保留原目录");
      await unlink(nextPath);
      names.splice(nextReceiptIndex, 1);
    }
    if (!names.includes("receipt.json")) {
      if (names.some((name) => name !== "receipt.next" && !/^\d{4}\.stage$/.test(name)))
        throw new Error("创作 Skill 未完成传输事务包含未知文件，已保留原目录");
      await removeTransferDirectory(directoryPath, new Set(names));
      return null;
    }
    const receipt = assertTransferReceipt(parseJson(
      await readFile(join(directoryPath, "receipt.json")),
      "创作 Skill 传输事务记录已损坏，已保留原目录",
    ), directoryName);
    const stageNames = new Set(receipt.files.map((file) => file.stage));
    const allowedNames = new Set(["receipt.json", ...stageNames]);
    for (const name of names) {
      if (name.endsWith(".rollback") && stageNames.has(name.slice(0, -".rollback".length)))
        allowedNames.add(name);
    }
    if (names.length !== allowedNames.size || names.some((name) => !allowedNames.has(name)))
      throw new Error("创作 Skill 传输事务目录包含未知文件，已保留原目录");
    for (const file of receipt.files) {
      const path = join(directoryPath, file.stage);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes)
        throw new Error("创作 Skill 传输事务暂存文件无效，已保留原目录");
      if (sha256(await readFile(path)) !== file.sha256)
        throw new Error("创作 Skill 传输事务暂存文件完整性校验失败，已保留原目录");
    }
    return { directoryPath, receipt, allowedNames };
  };

  const transferReceiptValue = (receipt) => ({
    ...receipt,
    files: receipt.files.map(({ target: _target, ...file }) => file),
  });

  const writeTransferReceipt = async (directoryPath, directoryName, receipt, notifyStaged = false) => {
    const value = transferReceiptValue(receipt);
    assertTransferReceipt(value, directoryName);
    const nextPath = join(directoryPath, "receipt.next");
    try {
      await writeFile(nextPath, canonicalJson(value), { flag: "wx" });
      if (notifyStaged) await onTransactionPhase("transfer-receipt-staged");
      await rename(nextPath, join(directoryPath, "receipt.json"));
    } finally {
      await unlink(nextPath).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    }
  };

  const verifyTransferTarget = async (file, path = join(skillsRoot, file.path)) => {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes)
      throw new Error("创作 Skill 传输目标不是预期的普通文件");
    if (sha256(await readFile(path)) !== file.sha256)
      throw new Error("创作 Skill 传输目标内容已冲突");
    return info;
  };

  const sameTransferInode = async (leftPath, rightPath) => {
    const [left, right] = await Promise.all([
      lstat(leftPath, { bigint: true }),
      lstat(rightPath, { bigint: true }),
    ]);
    return left.dev === right.dev && left.ino === right.ino;
  };

  const readTransferIdentity = async (path) => {
    const info = await lstat(path, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("创作 Skill 传输复制目标不是普通文件");
    return { device: String(info.dev), inode: String(info.ino) };
  };

  const sameTransferIdentity = async (path, identity) => {
    const current = await readTransferIdentity(path);
    return current.device === identity?.device && current.inode === identity?.inode;
  };

  const updateTransferOwnership = async (parsed, index, ownership, targetIdentity) => {
    const { targetIdentity: _identity, ...file } = parsed.receipt.files[index];
    parsed.receipt.files[index] = {
      ...file,
      ownership,
      ...(targetIdentity ? { targetIdentity } : {}),
    };
    await writeTransferReceipt(
      parsed.directoryPath,
      `${parsed.receipt.transactionId}.transfer`,
      parsed.receipt,
    );
  };

  const installTransferTargets = async (parsed) => {
    const { directoryPath, receipt } = parsed;
    for (const [index, file] of receipt.files.entries()) {
      const stagedPath = join(directoryPath, file.stage);
      const targetPath = join(skillsRoot, file.path);
      try {
        await verifyTransferTarget(file);
        if (file.ownership === "pending") {
          const ownership = await sameTransferInode(stagedPath, targetPath)
            ? "hardlink"
            : "preexisting";
          await updateTransferOwnership(parsed, index, ownership);
        }
        if (file.ownership === "copying") {
          if (!file.targetIdentity || !(await sameTransferIdentity(targetPath, file.targetIdentity)))
            throw new Error("创作 Skill 传输复制目标所有权无法确认，已保留事务证据");
          await updateTransferOwnership(parsed, index, "copy", file.targetIdentity);
        }
        if (
          file.ownership === "copy" &&
          !(await sameTransferIdentity(targetPath, file.targetIdentity))
        )
          throw new Error("创作 Skill 传输复制目标已被替换，已保留事务证据");
        continue;
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (file.ownership === "preexisting")
          throw new Error("创作 Skill 传输事务的既有目标已消失，已拒绝提交");
      }
      try {
        await linkFile(stagedPath, targetPath);
        await updateTransferOwnership(parsed, index, "hardlink");
      } catch (error) {
        if (!error || typeof error !== "object") throw error;
        if (error.code === "EEXIST") {
          await verifyTransferTarget(file);
          await updateTransferOwnership(parsed, index, "preexisting");
          continue;
        }
        if (!TRANSFER_LINK_FALLBACK_ERRORS.has(error.code)) throw error;
        await updateTransferOwnership(parsed, index, "copying");
        try {
          const targetIdentity = await copyFileExclusive(stagedPath, targetPath);
          await verifyTransferTarget(file);
          await updateTransferOwnership(
            parsed,
            index,
            "copy",
            targetIdentity,
          );
        } catch (copyError) {
          if (!copyError || typeof copyError !== "object" || copyError.code !== "EEXIST") throw copyError;
          await verifyTransferTarget(file);
          await updateTransferOwnership(parsed, index, "preexisting");
        }
      }
    }
  };

  const restoreTransferTarget = async (sourcePath, targetPath) => {
    try {
      await linkFile(sourcePath, targetPath);
    } catch (error) {
      if (!error || typeof error !== "object") throw error;
      if (error.code === "EEXIST")
        throw new Error("创作 Skill 传输目标在回滚期间再次变化，已保留恢复副本");
      if (!TRANSFER_LINK_FALLBACK_ERRORS.has(error.code)) throw error;
      await copyFileExclusive(sourcePath, targetPath);
    }
  };

  const rollbackTransferTarget = async (parsed, file) => {
    if (file.ownership === "preexisting") return;
    const stagedPath = join(parsed.directoryPath, file.stage);
    const targetPath = join(skillsRoot, file.path);
    const rollbackName = `${file.stage}.rollback`;
    const rollbackPath = join(parsed.directoryPath, rollbackName);
    let candidatePath = rollbackPath;
    if (!parsed.allowedNames.has(rollbackName)) {
      try {
        const targetInfo = await lstat(targetPath);
        if (!targetInfo.isFile() || targetInfo.isSymbolicLink())
          throw new Error("创作 Skill 传输目标在回滚前发生变化，已保留事务目录");
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      await rename(targetPath, rollbackPath);
      parsed.allowedNames.add(rollbackName);
    } else {
      try {
        await lstat(targetPath);
        throw new Error("创作 Skill 传输目标在回滚期间再次出现，已保留恢复副本");
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const owned = file.ownership === "hardlink" || file.ownership === "pending"
      ? await sameTransferInode(stagedPath, candidatePath)
      : file.ownership === "copy" || (file.ownership === "copying" && file.targetIdentity)
        ? await Promise.all([
            sameTransferIdentity(candidatePath, file.targetIdentity),
            verifyTransferTarget(file, candidatePath).then(() => true, () => false),
          ]).then(([sameIdentity, sameContent]) => sameIdentity && sameContent)
        : false;
    if (owned) {
      await unlink(candidatePath);
      parsed.allowedNames.delete(rollbackName);
      return;
    }
    await restoreTransferTarget(candidatePath, targetPath);
    await unlink(candidatePath);
    parsed.allowedNames.delete(rollbackName);
    throw new Error("创作 Skill 传输目标在回滚前发生变化，已保留事务目录");
  };

  const replayTransferDirectory = async (directoryName) => {
    const parsed = await readTransferReceipt(directoryName);
    if (!parsed) return;
    const { directoryPath, receipt, allowedNames } = parsed;
    const currentHead = await readHead();
    if (currentHead === receipt.nextHead) {
      const previousHead = await readPointer(previousPath, "CURRENT.prev");
      if (previousHead !== receipt.baseHead)
        throw new Error("创作 Skill 传输事务提交历史不一致，已保留原目录");
      await installTransferTargets(parsed);
      await readCatalogAt(receipt.nextHead);
      await removeTransferDirectory(directoryPath, allowedNames);
      return;
    }
    if (currentHead !== receipt.baseHead)
      throw new Error("创作 Skill 传输事务与当前目录冲突，已保留原目录");
    await readCatalogAt(receipt.baseHead);
    for (const file of receipt.files) {
      await rollbackTransferTarget(parsed, file);
    }
    await removeTransferDirectory(directoryPath, allowedNames);
  };

  const runTransferTransaction = async ({ kind, current, catalog, files }) => {
    if ((await readHead()) !== current.head)
      throw new Error("创作 Skill 目录已被更新，传输提交冲突已拒绝");
    const catalogBytes = Buffer.from(canonicalJson(catalog));
    const nextHead = sha256(catalogBytes);
    const transactionId = randomUUID();
    const directoryName = `${transactionId}.transfer`;
    const directoryPath = join(skillsRoot, "transactions", directoryName);
    const planned = [
      ...files,
      { path: `catalogs/${nextHead}.json`, bytes: catalogBytes },
    ];
    if (new Set(planned.map((file) => file.path)).size !== planned.length)
      throw new Error("创作 Skill 传输事务包含重复目标");
    await mkdir(directoryPath);
    let receiptWritten = false;
    try {
      const receiptFiles = [];
      for (const [index, file] of planned.entries()) {
        const bytes = Buffer.from(file.bytes);
        const stage = `${String(index).padStart(4, "0")}.stage`;
        const descriptor = { path: file.path, stage, sha256: sha256(bytes), bytes: bytes.length };
        let ownership = "pending";
        try {
          await verifyTransferTarget(descriptor);
          ownership = "preexisting";
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await writeFile(join(directoryPath, stage), bytes, { flag: "wx" });
        receiptFiles.push({ ...descriptor, ownership });
      }
      const receipt = {
        schemaVersion: SCHEMA_VERSION,
        operation: "transfer",
        kind,
        transactionId,
        baseHead: current.head,
        nextHead,
        files: receiptFiles,
      };
      assertTransferReceipt(receipt, directoryName);
      await writeTransferReceipt(directoryPath, directoryName, receipt, true);
      receiptWritten = true;
      await installTransferTargets({
        directoryPath,
        receipt: assertTransferReceipt(receipt, directoryName),
        allowedNames: new Set(["receipt.json", ...receipt.files.map((file) => file.stage)]),
      });
      await onTransactionPhase("transfer-files-linked");
      if ((await readHead()) !== current.head)
        throw new Error("创作 Skill 目录已被更新，传输提交冲突已拒绝");
      await writeAtomic(previousPath, `${current.head}\n`);
      await writeAtomic(currentPath, `${nextHead}\n`);
      await onTransactionPhase("transfer-current-committed");
      await replayTransferDirectory(directoryName);
      return { head: nextHead, catalog };
    } catch (error) {
      try {
        if (receiptWritten) await replayTransferDirectory(directoryName);
        else await removeTransferDirectory(directoryPath);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "创作 Skill 传输失败且自动恢复未完成，已保留事务目录",
        );
      }
      throw error;
    }
  };

  const readDraft = async (id) => {
    try {
      const draft = parseJson(
        await readFile(pathForDraft(id)),
        "创作 Skill 草稿已损坏",
      );
      if (
        draft?.schemaVersion !== SCHEMA_VERSION ||
        draft.id !== id ||
        !Number.isSafeInteger(draft.revision) ||
        draft.revision < 1 ||
        draft.lifecycle !== "draft" ||
        draft.enabled !== false ||
        !TRUST_LEVELS.has(draft.trust) ||
        !DRAFT_SOURCES.has(draft.source) ||
        !draft.content ||
        typeof draft.content !== "object" ||
        Array.isArray(draft.content)
      )
        throw new Error("不支持的创作 Skill 草稿版本");
      return draft;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const readRevision = async (hash) => {
    const bytes = await readFile(pathForRevision(hash));
    if (sha256(bytes) !== hash) throw new Error("创作 Skill 内容版本完整性校验失败");
    const revision = parseJson(bytes, "创作 Skill 内容版本已损坏");
    if (
      revision?.schemaVersion !== SCHEMA_VERSION ||
      typeof revision.id !== "string" ||
      !TRUST_LEVELS.has(revision.trust) ||
      !DRAFT_SOURCES.has(revision.source) ||
      !revision.content ||
      typeof revision.content !== "object" ||
      Array.isArray(revision.content)
    )
      throw new Error("不支持的创作 Skill 内容版本");
    return revision;
  };

  const readAllDrafts = async () => {
    const names = (await readdir(join(skillsRoot, "drafts"))).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}\.json$/i.test(name))
        throw new Error("创作 Skill 草稿文件名无效");
      return readDraft(name.slice(0, -5));
    }));
  };

  const draftForLibrary = (draft) => {
    const definition = assertCreativeSkillDefinition(draft.content.definition);
    const assets = assertAssetDescriptors(draft.content.assets);
    const fixture = assertExampleFixture(draft.content.fixture);
    assertDefinitionAssets(definition, assets);
    const hash = definitionHash(definition);
    const quarantine = assertQuarantinedMarkdown(draft.content.quarantine);
    return {
      draftId: draft.id,
      skillId: draft.content.skillId || draft.id,
      revision: draft.revision,
      lifecycle: "draft",
      ownership: "personal",
      trust: draft.trust,
      source: draft.source,
      enabled: false,
      name: draft.content.name,
      description: draft.content.description || "",
      definition,
      definitionHash: hash,
      validation: draft.content.validation || { status: "passed", definitionHash: hash, issues: [] },
      testRun: draft.content.testRun || { status: "pending", definitionHash: hash, issues: [] },
      assets,
      ...(fixture ? { fixture } : {}),
      ...(quarantine ? { quarantine } : {}),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  };

  const readAllRevisions = async () => {
    const names = (await readdir(join(skillsRoot, "revisions"))).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => {
      if (!/^[a-f0-9]{64}\.json$/.test(name))
        throw new Error("创作 Skill 内容版本文件名无效");
      const revisionHash = name.slice(0, -5);
      return { revisionHash, revision: await readRevision(revisionHash) };
    }));
  };

  const versionForLibrary = (revisionHash, revision, fallbackTimestamp) => {
    const definition = assertCreativeSkillDefinition(revision.content.definition);
    const assets = assertAssetDescriptors(revision.content.assets);
    assertDefinitionAssets(definition, assets);
    const hash = definitionHash(definition);
    return {
      versionId: revisionHash,
      definitionHash: hash,
      definition,
      validation: revision.content.validation || { status: "passed", definitionHash: hash, issues: [] },
      testRun: revision.content.testRun || { status: "pending", definitionHash: hash, issues: [] },
      compatibility: { status: "compatible", issues: [] },
      health: { status: "healthy", issues: [] },
      assets,
      publishedAt: revision.publishedAt || fallbackTimestamp,
    };
  };

  const readLibrarySnapshot = async (current) => {
    const effectiveCurrent = current || await readCatalog();
    const revisions = await readAllRevisions();
    const builtinIds = new Set(BUILTIN_CREATIVE_SKILLS.map((skill) => skill.skillId));
    const builtins = BUILTIN_CREATIVE_SKILLS.map((canonical) => {
      const preference = effectiveCurrent.catalog.skills[canonical.skillId];
      if (!preference) return structuredClone(canonical);
      return {
        ...structuredClone(canonical),
        revision: preference.recordRevision || canonical.revision,
        enabled: preference.enabled,
        favorite: preference.favorite === true,
        updatedAt: preference.updatedAt || canonical.updatedAt,
      };
    });
    const personal = Object.values(effectiveCurrent.catalog.skills)
      .filter((entry) => !builtinIds.has(entry.id) && entry.lifecycle === "published")
      .map((entry) => {
        const versions = revisions
          .filter(({ revision }) => revision.id === entry.id)
          .map(({ revisionHash, revision }) => versionForLibrary(revisionHash, revision, entry.createdAt))
          .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
        if (!versions.some((version) => version.versionId === entry.activeRevision))
          throw new Error("创作 Skill 当前版本不存在");
        return {
          skillId: entry.id,
          revision: entry.recordRevision || 1,
          lifecycle: "published",
          ownership: "personal",
          trust: entry.trust,
          source: entry.source,
          name: entry.name,
          description: entry.description || "",
          enabled: entry.enabled === true,
          favorite: entry.favorite === true,
          activeRevision: entry.activeRevision,
          versions,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };
      });
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: effectiveCurrent.catalog.sequence,
      skills: [...builtins, ...personal],
      drafts: (await readAllDrafts()).filter(Boolean).map(draftForLibrary),
    };
  };

  const readPortableRepository = async (current) => {
    const effectiveCurrent = current || await readCatalog();
    const skills = Object.values(effectiveCurrent.catalog.skills)
      .filter((entry) => entry.ownership === "personal" && entry.lifecycle === "published")
      .map((entry) => assertSyncSkill({
        id: entry.id,
        name: entry.name,
        description: entry.description || "",
        activeRevision: entry.activeRevision,
        lifecycle: "published",
        ownership: "personal",
        trust: entry.trust,
        source: entry.source,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const skillIds = new Set(skills.map((skill) => skill.id));
    const tombstones = Object.values(effectiveCurrent.catalog.tombstones)
      .map((item) => assertSyncTombstone(item))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (tombstones.some((item) => skillIds.has(item.id)))
      throw new Error("创作 Skill 活动目录与删除墓碑冲突");
    const revisions = (await readAllRevisions())
      .filter(({ revision }) => skillIds.has(revision.id))
      .sort((left, right) => left.revisionHash.localeCompare(right.revisionHash));
    const revisionRecords = new Map();
    const assets = new Map();
    for (const { revisionHash, revision } of revisions) {
      const inspected = assertSyncRevision(revision, revisionHash);
      revisionRecords.set(revisionHash, inspected);
      for (const asset of inspected.assets) {
        const previous = assets.get(asset.sha256);
        if (previous && canonicalCompactJson(previous) !== canonicalCompactJson(asset))
          throw new Error("创作 Skill 内容版本对同一资产声明不一致");
        assets.set(asset.sha256, asset);
      }
    }
    for (const skill of skills) {
      const active = revisionRecords.get(skill.activeRevision);
      if (!active || active.id !== skill.id) throw new Error("创作 Skill 同步投影缺少当前版本");
      if (
        active.revision.trust !== skill.trust || active.revision.source !== skill.source ||
        active.revision.content.name !== skill.name || (active.revision.content.description || "") !== skill.description
      )
        throw new Error("创作 Skill 同步投影目录与当前版本不一致");
    }
    const assetList = [...assets.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
    const semantic = syncSemantic({
      skills,
      tombstones,
      revisions: [...revisionRecords.keys()],
      assets: assetList,
    });
    return {
      current: effectiveCurrent,
      semantic,
      head: sha256(Buffer.from(canonicalJson(semantic))),
      skills,
      tombstones,
      revisionRecords,
      assets: assetList,
    };
  };

  const createSyncPackage = async () => {
    const repository = await readPortableRepository();
    const files = new Map();
    for (const [revisionHash, { revision }] of repository.revisionRecords)
      files.set(`revisions/${revisionHash}.json`, Buffer.from(canonicalJson(revision)));
    for (const asset of repository.assets) {
      const extension = extensionForMimeType(asset.mimeType);
      const bytes = extension && await readFile(join(skillsRoot, "captures", `${asset.sha256}${extension}`));
      if (
        !extension || !bytes || bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256 ||
        !imageMagicMatches(bytes, asset.mimeType)
      )
        throw new Error("创作 Skill 同步资产完整性校验失败");
      files.set(`assets/${asset.sha256}${extension}`, bytes);
    }
    const manifest = {
      ...repository.semantic,
      kind: "fourj-skill-library",
      head: repository.head,
      publishedSkillCount: repository.skills.length,
      tombstoneCount: repository.tombstones.length,
    };
    files.set("fourj-skill-library.json", Buffer.from(canonicalJson(manifest)));
    const bytes = deterministicZip(files, SYNC_PACKAGE_LIMITS.compressedBytes);
    const inspected = inspectCreativeSkillSyncPackage(bytes);
    if (inspected.manifest.head !== repository.head)
      throw new Error("创作 Skill 同步包自检 head 不一致");
    return {
      schemaVersion: SCHEMA_VERSION,
      head: repository.head,
      publishedSkillCount: repository.skills.length,
      tombstoneCount: repository.tombstones.length,
      payload: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      mediaType: SYNC_PACKAGE_MEDIA_TYPE,
    };
  };

  const mutateCatalog = (mutate) => {
    const commit = async () => {
      const current = await readCatalog();
      const changedCatalog = await mutate(structuredClone(current.catalog));
      const catalog = { ...changedCatalog, sequence: current.catalog.sequence + 1 };
      const bytes = Buffer.from(canonicalJson(catalog));
      const head = sha256(bytes);
      try {
        await writeFile(pathForCatalog(head), bytes, { flag: "wx" });
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
        if (!(await readFile(pathForCatalog(head))).equals(bytes))
          throw new Error("内容寻址文件与其标识不一致");
      }
      await writeAtomic(previousPath, `${current.head}\n`);
      await writeAtomic(currentPath, `${head}\n`);
      return { head, catalog };
    };
    return runCatalogWrite(commit);
  };

  const bumpCatalog = () => mutateCatalog((catalog) => catalog);

  const saveDraft = (input) => {
    const write = async () => {
      const id = assertSkillId(input?.id || createId());
      const expectedRevision = input?.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new Error("保存草稿时必须提供有效的 expectedRevision");
      if (!TRUST_LEVELS.has(input?.trust)) throw new Error("无效的创作 Skill 信任级别");
      if (!DRAFT_SOURCES.has(input?.source)) throw new Error("无效的创作 Skill 来源");
      if (!input.content || typeof input.content !== "object" || Array.isArray(input.content))
        throw new Error("创作 Skill 草稿内容无效");
      const name = input.content.name;
      const description = input.content.description ?? "";
      if (typeof name !== "string" || !name.trim() || name.length > 120)
        throw new Error("创作 Skill 名称无效");
      if (typeof description !== "string" || description.length > 1000)
        throw new Error("创作 Skill 描述无效");
      canonicalJson(input.content);

      const previous = await readDraft(id);
      if ((previous?.revision || 0) !== expectedRevision)
        throw new Error("创作 Skill 草稿已被更新，请重新载入后再保存");
      const timestamp = now().toISOString();
      const draft = {
        schemaVersion: SCHEMA_VERSION,
        id,
        revision: expectedRevision + 1,
        lifecycle: "draft",
        enabled: false,
        trust: input.trust,
        source: input.source,
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp,
        content: input.content,
      };
      await writeAtomic(pathForDraft(id), canonicalJson(draft));
      return draft;
    };
    return runDraftWrite(write);
  };

  const discardDraft = (id, expectedRevision) => {
    const remove = async () => {
      const draft = await readDraft(assertSkillId(id));
      if (!draft) throw new Error("创作 Skill 草稿不存在");
      if (draft.revision !== expectedRevision)
        throw new Error("创作 Skill 草稿已被更新，请重新载入后再操作");
      await unlink(pathForDraft(id));
      return draft;
    };
    return runDraftWrite(remove);
  };

  const rollbackSavedDraft = (savedDraft) => {
    const rollback = async () => {
      const current = await readDraft(savedDraft.id);
      if (current && canonicalCompactJson(current) === canonicalCompactJson(savedDraft)) {
        await unlink(pathForDraft(savedDraft.id));
        return true;
      }
      return false;
    };
    return runDraftWrite(rollback);
  };

  const captureName = (descriptor) => {
    const extension = extensionForMimeType(descriptor.mimeType);
    if (!extension) throw new Error("创作 Skill 捕获文件 MIME 无效");
    return `${descriptor.sha256}${extension}`;
  };

  const referencedCaptures = async () => {
    const referenced = new Set();
    const drafts = (await readAllDrafts()).filter(Boolean);
    for (const draft of drafts) {
      for (const asset of assertAssetDescriptors(draft.content.assets)) referenced.add(captureName(asset));
      const fixture = assertExampleFixture(draft.content.fixture);
      if (fixture) {
        referenced.add(captureName(fixture.input));
        referenced.add(captureName(fixture.expectedOutput));
      }
      const quarantine = assertQuarantinedMarkdown(draft.content.quarantine);
      if (quarantine) referenced.add(`${quarantine.sha256}.skill.md`);
    }
    for (const { revision } of await readAllRevisions()) {
      for (const asset of assertAssetDescriptors(revision.content.assets)) referenced.add(captureName(asset));
    }
    return referenced;
  };

  const cleanupUnreferencedCaptures = async (candidates, expectedBytes = new Map()) => {
    const referenced = await referencedCaptures();
    await Promise.all([...candidates].filter((name) => !referenced.has(name)).map(async (name) => {
      const path = join(skillsRoot, "captures", name);
      const expected = expectedBytes.get(name);
      try {
        if (expected && !(await readFile(path)).equals(expected))
          throw new Error("创作 Skill 待回滚捕获已被修改，已拒绝删除");
        await unlink(path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }));
  };

  const cleanupFixtureCaptures = async (value) => {
    const fixture = assertExampleFixture(value);
    if (!fixture) return;
    const candidates = new Set([captureName(fixture.input), captureName(fixture.expectedOutput)]);
    await cleanupUnreferencedCaptures(candidates);
  };

  const publicationCleanupPath = ({ id, draftRevision, draftCreatedAt }) => join(
    skillsRoot,
    "transactions",
    `${sha256(Buffer.from(canonicalJson({ id, draftRevision, draftCreatedAt })))}.draft-cleanup`,
  );

  const assertPublicationCleanup = (value) => {
    assertExactKeys(
      value,
      ["schemaVersion", "operation", "id", "draftRevision", "draftCreatedAt", "fixture"],
      "创作 Skill 发布草稿清理记录",
    );
    if (value.schemaVersion !== SCHEMA_VERSION || value.operation !== "finalize-published-draft")
      throw new Error("不支持的创作 Skill 发布草稿清理记录");
    const id = assertSkillId(value.id);
    if (!Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1)
      throw new Error("创作 Skill 发布草稿清理版本无效");
    isoTimestamp(value.draftCreatedAt, "创作 Skill 发布草稿创建时间");
    const fixture = value.fixture === null ? null : assertExampleFixture(value.fixture);
    return { ...value, id, fixture };
  };

  const readPublicationCleanup = async (input) => {
    try {
      return assertPublicationCleanup(parseJson(
        await readFile(publicationCleanupPath(input)),
        "创作 Skill 发布草稿清理记录已损坏",
      ));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const publicationCleanupFromDraft = (draft, draftRevision = draft.revision) => ({
    schemaVersion: SCHEMA_VERSION,
    operation: "finalize-published-draft",
    id: draft.id,
    draftRevision,
    draftCreatedAt: draft.createdAt,
    fixture: assertExampleFixture(draft.content.fixture) || null,
  });

  const completePublicationCleanup = async (input) => {
    const cleanup = assertPublicationCleanup(input);
    const path = publicationCleanupPath(cleanup);
    await writeImmutableCapture(path, Buffer.from(canonicalJson(cleanup)));
    const removePublishedDraft = async () => {
      const current = await readDraft(cleanup.id);
      if (!current || current.createdAt !== cleanup.draftCreatedAt) return;
      if (current.revision < cleanup.draftRevision)
        throw new Error("创作 Skill 草稿版本倒退，已拒绝发布后清理");
      if (current.revision > cleanup.draftRevision) return;
      const currentFixture = assertExampleFixture(current.content.fixture) || null;
      if (canonicalCompactJson(currentFixture) !== canonicalCompactJson(cleanup.fixture || null))
        throw new Error("创作 Skill 草稿样例与发布清理记录不一致");
      await unlink(pathForDraft(cleanup.id));
    };
    await runDraftWrite(removePublishedDraft);
    await cleanupFixtureCaptures(cleanup.fixture || undefined);
    await unlink(path);
  };

  const commandResult = async (current, changed) => ({
    head: current.head,
    snapshot: await readLibrarySnapshot(current),
    ...(changed ? { changed } : {}),
  });

  const normalizeExampleImage = async (value, label) => {
    if (typeof imageInspector !== "function") throw new Error("当前环境不支持检查样例图片");
    const bytes = binaryBuffer(value.data, `${label} `);
    if (bytes.length < 1 || bytes.length > PACKAGE_LIMITS.imageBytes)
      throw new Error(`${label}大小必须在 1 到 ${PACKAGE_LIMITS.imageBytes} 字节之间`);
    if (!EXAMPLE_IMAGE_MIME_TYPES.has(value.mimeType)) throw new Error(`${label} MIME 不受支持`);
    if (!/^[a-f0-9]{64}$/.test(value.sha256) || sha256(bytes) !== value.sha256)
      throw new Error(`${label} SHA-256 校验失败`);
    if (Object.values(IMAGE_MIME_TYPES).includes(value.mimeType) && !imageMagicMatches(bytes, value.mimeType))
      throw new Error(`${label}格式、MIME 与文件内容不一致`);
    const inspected = await imageInspector({
      bytes: Buffer.from(bytes),
      mimeType: value.mimeType,
      role: label,
      normalize: true,
    });
    if (!isPlainObject(inspected))
      throw new Error(`${label}无法解码或尺寸无效`);
    assertImageDimensions(inspected.width, inspected.height, label);
    const mimeType = inspected.mimeType || value.mimeType;
    const normalized = inspected.sanitizedBytes === undefined
      ? Buffer.from(bytes)
      : binaryBuffer(inspected.sanitizedBytes, `${label}规范化图片 `);
    if (
      !Object.values(IMAGE_MIME_TYPES).includes(mimeType) ||
      normalized.length < 1 || normalized.length > PACKAGE_LIMITS.imageBytes ||
      !imageMagicMatches(normalized, mimeType)
    )
      throw new Error(`${label}规范化结果格式或大小无效`);
    const descriptor = {
      sha256: sha256(normalized),
      mimeType,
      bytes: normalized.length,
      width: inspected.width,
      height: inspected.height,
    };
    return { descriptor, bytes: normalized, extension: extensionForMimeType(mimeType) };
  };

  const restoreSyncRepository = (prepared) => {
    const restore = async () => {
      const local = await readPortableRepository();
      if (local.head !== prepared.expectedHead)
        throw new Error("创作 Skill 发布库已被更新，恢复冲突已拒绝");
      if (local.head === prepared.sourceHead) return commandResult(local.current);
      const hasConflict = Boolean(
        (local.skills.length || local.tombstones.length) &&
        prepared.checkpointHead !== prepared.expectedHead,
      );
      if (hasConflict && prepared.resolution !== "replace-local")
        throw new Error("创作 Skill 发布库存在本地内容，恢复冲突已拒绝并保留双方");
      if (!hasConflict && prepared.resolution === "replace-local")
        throw new Error("创作 Skill 冲突状态已经变化，替换已拒绝");
      if (typeof createRecoveryPoint !== "function")
        throw new Error("当前环境不能为创作 Skill 恢复创建恢复点");
      const builtinIds = new Set(BUILTIN_CREATIVE_SKILLS.map((skill) => skill.skillId));
      const preservedBuiltins = Object.fromEntries(
        Object.entries(local.current.catalog.skills).filter(([skillId]) => builtinIds.has(skillId)),
      );
      const restoredSkills = Object.fromEntries(prepared.inspected.manifest.skills.map((skill) => [
        skill.id,
        {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          activeRevision: skill.activeRevision,
          lifecycle: "published",
          ownership: "personal",
          enabled: false,
          favorite: false,
          recordRevision: 1,
          trust: skill.trust,
          source: skill.source,
          createdAt: skill.createdAt,
          updatedAt: skill.updatedAt,
        },
      ]));
      const catalog = {
        schemaVersion: SCHEMA_VERSION,
        sequence: local.current.catalog.sequence + 1,
        skills: { ...preservedBuiltins, ...restoredSkills },
        tombstones: Object.fromEntries(
          prepared.inspected.manifest.tombstones.map((item) => [item.id, item]),
        ),
      };
      await createRecoveryPoint("restore-creative-skills");
      const files = [
        ...[...prepared.inspected.revisionRecords].map(([revisionHash, record]) => ({
          path: `revisions/${revisionHash}.json`,
          bytes: record.bytes,
        })),
        ...[...prepared.inspected.assetRecords.values()].map(({ descriptor, bytes, extension }) => ({
          path: `captures/${descriptor.sha256}${extension}`,
          bytes,
        })),
      ];
      const committed = await runTransferTransaction({
        kind: "sync-restore",
        current: local.current,
        catalog,
        files,
      });
      return commandResult(committed, {});
    };
    return runFixtureLifecycle(() => {
      return runCatalogWrite(restore);
    });
  };

  const issuesFrom = (value) => {
    if (!Array.isArray(value) || value.length > 100 || value.some(
      (issue) => typeof issue !== "string" || Array.from(issue).length > 1000,
    ))
      throw new Error("创作 Skill 门禁问题列表无效");
    return value;
  };

  const execute = async (command) => {
    if (!isPlainObject(command) || typeof command.type !== "string")
      throw new Error("不支持的创作 Skill 命令");

    if (command.type === "create-draft") {
      assertExactKeys(command, ["type", "input"], "创建草稿命令");
      assertExactKeys(command.input, ["name", "description", "definition", "source"], "创建草稿参数");
      const name = requiredString(command.input.name, "创作 Skill 名称", 120).trim();
      const description = optionalString(command.input.description, "创作 Skill 描述", 1000)?.trim() || "";
      const definition = assertCreativeSkillDefinition(command.input.definition);
      const hash = definitionHash(definition);
      const source = command.input.source || "manual";
      if (!new Set(["manual", "canvas"]).has(source)) throw new Error("无效的创作 Skill 草稿来源");
      const draft = await saveDraft({
        expectedRevision: 0,
        trust: "local-reviewed",
        source,
        content: {
          name,
          description,
          definition,
          validation: { status: "passed", definitionHash: hash, issues: [] },
          testRun: { status: "pending", definitionHash: hash, issues: [] },
          assets: [],
        },
      });
      return commandResult(await bumpCatalog(), { draftId: draft.id });
    }

    if (command.type === "create-example-draft") {
      const create = async () => {
      assertExactKeys(command, ["type", "input"], "样例对草稿命令");
      assertExactKeys(command.input, ["name", "description", "definition", "fixture"], "样例对草稿参数");
      assertExactKeys(command.input.fixture, ["input", "expectedOutput"], "样例对图片");
      assertExactKeys(command.input.fixture.input, ["sha256", "mimeType", "data"], "样例原图");
      assertExactKeys(command.input.fixture.expectedOutput, ["sha256", "mimeType", "data"], "样例结果图");
      const name = requiredString(command.input.name, "创作 Skill 名称", 120).trim();
      const description = optionalString(command.input.description, "创作 Skill 描述", 1000)?.trim() || "";
      const definition = assertCreativeSkillDefinition(command.input.definition);
      if (definition.steps[0]?.operation !== "image.edit" || !definition.steps[0].references?.some((reference) => reference.type === "input-target"))
        throw new Error("样例对创建的草稿必须从原图执行图片编辑");
      assertDefinitionAssets(definition, []);
      const [input, expectedOutput] = await Promise.all([
        normalizeExampleImage(command.input.fixture.input, "样例原图"),
        normalizeExampleImage(command.input.fixture.expectedOutput, "样例结果图"),
      ]);
      if (input.descriptor.sha256 === expectedOutput.descriptor.sha256)
        throw new Error("样例原图与结果图不能是同一内容");
      const hash = definitionHash(definition);
      let draft;
      try {
        for (const image of [input, expectedOutput]) {
          const path = join(skillsRoot, "captures", `${image.descriptor.sha256}${image.extension}`);
          await writeImmutableCapture(path, image.bytes);
        }
        draft = await saveDraft({
          expectedRevision: 0,
          trust: "local-reviewed",
          source: "manual",
          content: {
            name,
            description,
            definition,
            validation: { status: "passed", definitionHash: hash, issues: [] },
            testRun: { status: "pending", definitionHash: hash, issues: [] },
            assets: [],
            fixture: { input: input.descriptor, expectedOutput: expectedOutput.descriptor },
          },
        });
        return commandResult(await bumpCatalog(), { draftId: draft.id });
      } catch (error) {
        if (draft) await rollbackSavedDraft(draft);
        await cleanupFixtureCaptures({
          input: input.descriptor,
          expectedOutput: expectedOutput.descriptor,
        });
        throw error;
      }
      };
      return runFixtureLifecycle(create);
    }

    if (command.type === "duplicate-as-draft") {
      assertExactKeys(command, ["type", "skillId"], "复制创作 Skill 命令");
      const snapshot = await readLibrarySnapshot();
      const source = snapshot.skills.find((skill) => skill.skillId === command.skillId);
      if (!source) throw new Error("创作 Skill 不存在");
      const version = source.versions.find((item) => item.versionId === source.activeRevision);
      if (!version) throw new Error("创作 Skill 当前版本不存在");
      const hash = definitionHash(version.definition);
      const draft = await saveDraft({
        expectedRevision: 0,
        trust: "local-reviewed",
        source: "manual",
        content: {
          name: `${source.name}副本`,
          description: source.description,
          definition: version.definition,
          validation: { status: "passed", definitionHash: hash, issues: [] },
          testRun: { status: "pending", definitionHash: hash, issues: [] },
          assets: structuredClone(version.assets || []),
        },
      });
      return commandResult(await bumpCatalog(), { draftId: draft.id });
    }

    if (command.type === "patch-draft") {
      assertExactKeys(command, ["type", "draftId", "expectedRevision", "patch"], "修改草稿命令");
      assertExactKeys(command.patch, ["name", "description", "definition"], "修改草稿参数");
      const previous = await readDraft(assertSkillId(command.draftId));
      if (!previous) throw new Error("创作 Skill 草稿不存在");
      if (previous.trust === "markdown-quarantined" || previous.source === "skill-markdown")
        throw new Error("隔离的 SKILL.md 不能编辑");
      if (previous.revision !== command.expectedRevision)
        throw new Error("创作 Skill 草稿已被更新，请重新载入后再保存");
      const definition = command.patch.definition === undefined
        ? assertCreativeSkillDefinition(previous.content.definition)
        : assertCreativeSkillDefinition(command.patch.definition);
      assertDefinitionAssets(definition, previous.content.assets);
      const hash = definitionHash(definition);
      const previousHash = definitionHash(previous.content.definition);
      const content = {
        ...previous.content,
        ...(command.patch.name === undefined
          ? {}
          : { name: requiredString(command.patch.name, "创作 Skill 名称", 120).trim() }),
        ...(command.patch.description === undefined
          ? {}
          : { description: optionalString(command.patch.description, "创作 Skill 描述", 1000).trim() }),
        definition,
        validation: { status: "passed", definitionHash: hash, issues: [] },
        testRun: hash === previousHash
          ? previous.content.testRun
          : { status: "pending", definitionHash: hash, issues: [] },
      };
      const draft = await saveDraft({
        id: previous.id,
        expectedRevision: command.expectedRevision,
        trust: previous.trust,
        source: previous.source,
        content,
      });
      return commandResult(await bumpCatalog(), { draftId: draft.id });
    }

    if (command.type === "discard-draft") {
      assertExactKeys(command, ["type", "draftId", "expectedRevision"], "丢弃草稿命令");
      return runFixtureLifecycle(async () => {
        const discarded = await discardDraft(command.draftId, command.expectedRevision);
        await cleanupFixtureCaptures(discarded.content.fixture);
        return commandResult(await bumpCatalog(), { draftId: command.draftId });
      });
    }

    if (command.type === "record-test-run") {
      assertExactKeys(
        command,
        ["type", "draftId", "expectedRevision", "definitionHash", "runId", "status", "issues"],
        "记录试跑命令",
      );
      if (!new Set(["passed", "failed"]).has(command.status))
        throw new Error("无效的创作 Skill 试跑状态");
      if (command.runId !== undefined)
        optionalString(command.runId, "创作 Skill 试跑标识", 160);
      const previous = await readDraft(assertSkillId(command.draftId));
      if (!previous) throw new Error("创作 Skill 草稿不存在");
      if (previous.trust === "markdown-quarantined" || previous.source === "skill-markdown")
        throw new Error("隔离的 SKILL.md 不能试跑");
      if (previous.revision !== command.expectedRevision)
        throw new Error("创作 Skill 草稿已被更新，请重新载入后再记录试跑");
      const currentHash = definitionHash(assertCreativeSkillDefinition(previous.content.definition));
      if (command.definitionHash !== currentHash)
        throw new Error("创作 Skill 定义已更新，旧试跑结果不能写入");
      const draft = await saveDraft({
        id: previous.id,
        expectedRevision: command.expectedRevision,
        trust: previous.trust,
        source: previous.source,
        content: {
          ...previous.content,
          testRun: {
            status: command.status,
            definitionHash: currentHash,
            ...(command.runId ? { runId: command.runId } : {}),
            testedAt: now().toISOString(),
            issues: issuesFrom(command.issues),
          },
        },
      });
      return commandResult(await bumpCatalog(), { draftId: draft.id });
    }

    if (command.type === "publish-draft") {
      const publish = async () => {
        assertExactKeys(command, ["type", "draftId", "expectedRevision"], "发布草稿命令");
        const id = assertSkillId(command.draftId);
        if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1)
          throw new Error("发布草稿时必须提供有效的 expectedRevision");
        const current = await readCatalog();
        const publishedEntry = current.catalog.skills[id];
        if (publishedEntry?.publishedDraftRevision === command.expectedRevision) {
          if (typeof publishedEntry.publishedDraftCreatedAt !== "string")
            throw new Error("创作 Skill 发布草稿清理标记无效");
          const cleanupInput = {
            id,
            draftRevision: command.expectedRevision,
            draftCreatedAt: publishedEntry.publishedDraftCreatedAt,
          };
          const pending = await readPublicationCleanup(cleanupInput);
          const remaining = await readDraft(id);
          if (pending) await completePublicationCleanup(pending);
          else if (remaining?.createdAt === publishedEntry.publishedDraftCreatedAt)
            await completePublicationCleanup(publicationCleanupFromDraft(remaining, command.expectedRevision));
          return commandResult(await readCatalog(), { skillId: id });
        }
        const draft = await readDraft(id);
        if (!draft) throw new Error("创作 Skill 草稿不存在");
        if (draft.trust === "markdown-quarantined" || draft.source === "skill-markdown")
          throw new Error("隔离的 SKILL.md 不能直接发布");
        if (draft.revision !== command.expectedRevision)
          throw new Error("创作 Skill 草稿已被更新，请重新载入后再发布");
        const hash = definitionHash(assertCreativeSkillDefinition(draft.content.definition));
        if (draft.content.validation?.status !== "passed" || draft.content.validation.definitionHash !== hash)
          throw new Error("创作 Skill 必须先通过校验才能发布");
        if (draft.content.testRun?.status !== "passed" || draft.content.testRun.definitionHash !== hash)
          throw new Error("创作 Skill 必须用当前版本通过试跑才能发布");
        await publishDraft({
          id: draft.id,
          expectedDraftRevision: draft.revision,
          expectedHead: current.head,
          enabled: false,
        });
        await completePublicationCleanup(publicationCleanupFromDraft(draft));
        return commandResult(
          await readCatalog(),
          { skillId: draft.id },
        );
      };
      return runFixtureLifecycle(publish);
    }

    if (new Set(["set-enabled", "set-favorite", "delete-skill"]).has(command.type)) {
      const allowedKeys = command.type === "set-enabled"
        ? ["type", "skillId", "expectedRevision", "enabled"]
        : command.type === "set-favorite"
          ? ["type", "skillId", "expectedRevision", "favorite"]
          : ["type", "skillId", "expectedRevision"];
      assertExactKeys(command, allowedKeys, "修改创作 Skill 命令");
      const snapshot = await readLibrarySnapshot();
      const skill = snapshot.skills.find((item) => item.skillId === command.skillId);
      if (!skill) throw new Error("创作 Skill 不存在");
      if (skill.revision !== command.expectedRevision)
        throw new Error("创作 Skill 已被更新，请重新载入后再操作");
      if (command.type === "delete-skill" && skill.ownership !== "personal")
        throw new Error("内置创作 Skill 不能删除");
      if (command.type === "set-enabled" && typeof command.enabled !== "boolean")
        throw new Error("创作 Skill 启用状态无效");
      if (command.type === "set-favorite" && typeof command.favorite !== "boolean")
        throw new Error("创作 Skill 收藏状态无效");
      if (command.type === "set-enabled" && command.enabled) {
        const version = skill.versions.find((item) => item.versionId === skill.activeRevision);
        if (!version || version.validation.status !== "passed" || version.testRun.status !== "passed" || version.testRun.definitionHash !== version.definitionHash)
          throw new Error("创作 Skill 当前版本尚未通过试跑");
        if (version.compatibility.status !== "compatible")
          throw new Error("创作 Skill 当前版本与应用不兼容");
        if (version.health.status !== "healthy")
          throw new Error("创作 Skill 当前版本未通过健康检查");
      }
      const current = await mutateCatalog((catalog) => {
        const builtin = BUILTIN_CREATIVE_SKILLS.find((item) => item.skillId === skill.skillId);
        const catalogEntry = catalog.skills[skill.skillId];
        const currentRevision = catalogEntry
          ? catalogEntry.recordRevision || 1
          : builtin?.revision || 0;
        if (currentRevision !== command.expectedRevision)
          throw new Error("创作 Skill 已被更新，请重新载入后再操作");
        if (!builtin && (!catalogEntry || catalogEntry.lifecycle !== "published"))
          throw new Error("创作 Skill 不存在");
        if (command.type === "delete-skill") {
          delete catalog.skills[skill.skillId];
          catalog.tombstones[skill.skillId] = {
            id: skill.skillId,
            deletedRevision: catalogEntry.activeRevision,
            deletedAt: now().toISOString(),
          };
          return catalog;
        }
        const timestamp = now().toISOString();
        const existing = catalogEntry || {
          id: skill.skillId,
          name: skill.name,
          description: skill.description,
          activeRevision: skill.activeRevision,
          lifecycle: "published",
          ownership: skill.ownership,
          trust: skill.trust,
          source: skill.source,
          createdAt: skill.createdAt,
        };
        catalog.skills[skill.skillId] = {
          ...existing,
          enabled: command.type === "set-enabled"
            ? command.enabled
            : catalogEntry ? catalogEntry.enabled === true : builtin.enabled,
          favorite: command.type === "set-favorite"
            ? command.favorite
            : catalogEntry?.favorite === true || (!catalogEntry && builtin.favorite === true),
          recordRevision: currentRevision + 1,
          updatedAt: timestamp,
        };
        return catalog;
      });
      return commandResult(current, { skillId: skill.skillId });
    }

    throw new Error("不支持的创作 Skill 命令");
  };

  const resolveAsset = async (input) => {
    if (typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256))
      throw new Error("无效的创作 Skill 资产哈希");
    let descriptor;
    if ("draftId" in input || "draftRevision" in input) {
      assertExactKeys(input, ["kind", "draftId", "draftRevision", "sha256"], "创作 Skill 草稿资产查询");
      const draft = await readDraft(assertSkillId(input.draftId));
      if (!draft) throw new Error("创作 Skill 草稿不存在");
      if (draft.revision !== input.draftRevision)
        throw new Error("创作 Skill 草稿已被更新，请重新载入后再读取资产");
      descriptor = draft.content.assets?.find((asset) => asset.sha256 === input.sha256);
    } else if ("skillId" in input || "versionId" in input) {
      assertExactKeys(input, ["kind", "skillId", "versionId", "sha256"], "创作 Skill 发布资产查询");
      const snapshot = await readLibrarySnapshot();
      const skill = snapshot.skills.find((item) => item.skillId === input.skillId);
      const version = skill?.versions.find((item) => item.versionId === input.versionId);
      if (!skill || !version) throw new Error("创作 Skill 发布版本不存在");
      descriptor = version.assets?.find((asset) => asset.sha256 === input.sha256);
    } else {
      throw new Error("创作 Skill 资产必须按草稿或发布版本二选一查询");
    }
    if (!descriptor) throw new Error("创作 Skill 版本未声明该资产");
    const extension = extensionForMimeType(descriptor.mimeType);
    if (!extension) throw new Error("创作 Skill 资产 MIME 无效");
    const bytes = await readFile(join(skillsRoot, "captures", `${descriptor.sha256}${extension}`));
    if (
      bytes.length !== descriptor.bytes ||
      sha256(bytes) !== descriptor.sha256 ||
      !imageMagicMatches(bytes, descriptor.mimeType)
    )
      throw new Error("创作 Skill 固定资产完整性校验失败");
    return {
      asset: {
        sha256: descriptor.sha256,
        mimeType: descriptor.mimeType,
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      },
    };
  };

  const resolveFixture = async (input) => {
    assertExactKeys(input, ["kind", "draftId", "draftRevision", "role"], "创作 Skill 样例夹具查询");
    if (input.role !== "input" && input.role !== "expected-output") throw new Error("创作 Skill 样例夹具角色无效");
    const draft = await readDraft(assertSkillId(input.draftId));
    if (!draft) throw new Error("创作 Skill 草稿不存在");
    if (draft.revision !== input.draftRevision) throw new Error("创作 Skill 草稿已被更新，请重新载入后再读取样例");
    const fixture = assertExampleFixture(draft.content.fixture);
    if (!fixture) throw new Error("创作 Skill 草稿未声明样例夹具");
    const descriptor = input.role === "input" ? fixture.input : fixture.expectedOutput;
    const extension = extensionForMimeType(descriptor.mimeType);
    const bytes = await readFile(join(skillsRoot, "captures", `${descriptor.sha256}${extension}`));
    if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256 || !imageMagicMatches(bytes, descriptor.mimeType))
      throw new Error("创作 Skill 样例夹具完整性校验失败");
    return {
      fixture: {
        ...descriptor,
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      },
    };
  };

  const query = async (input) => {
    if (input?.kind === "resolve-asset") return resolveAsset(input);
    if (input?.kind === "resolve-fixture") return resolveFixture(input);
    if (input?.kind === "normalize-example-image") {
      assertExactKeys(input, ["kind", "sha256", "mimeType", "data"], "创作 Skill 样例图片规范化查询");
      const normalized = await normalizeExampleImage(input, "样例图片");
      return {
        image: {
          ...normalized.descriptor,
          data: normalized.bytes.buffer.slice(
            normalized.bytes.byteOffset,
            normalized.bytes.byteOffset + normalized.bytes.byteLength,
          ),
        },
      };
    }
    if (input !== undefined) {
      assertExactKeys(input, ["kind", "filter"], "创作 Skill 资料库查询");
      if (input.kind !== "library") throw new Error("不支持的创作 Skill 查询");
    }
    const current = await readCatalog();
    return { head: current.head, snapshot: await readLibrarySnapshot(current) };
  };

  const importInspection = async () => {
    const inspectionToken = `import:${randomUUID()}`;
    if (typeof pickImportFile !== "function") {
      return {
        inspectionToken,
        operation: "import",
        status: "unavailable",
        canCommit: false,
        issues: ["当前环境不支持选择创作 Skill 文件"],
      };
    }
    try {
      const selectedPath = await pickImportFile();
      if (!selectedPath) {
        return {
          inspectionToken,
          operation: "import",
          status: "unavailable",
          canCommit: false,
          issues: ["已取消选择文件"],
        };
      }
      const info = await lstat(selectedPath);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("只能导入直接选择的普通文件");
      const fileName = basename(selectedPath);
      if (extname(fileName).toLowerCase() !== ".fourj-skill" && fileName.toLowerCase() !== "skill.md")
        throw new Error("请选择 .fourj-skill 或 SKILL.md 文件");
      const bytes = await readFile(selectedPath);
      if (fileName.toLowerCase() === "skill.md") {
        if (bytes.length < 1 || bytes.length > PACKAGE_LIMITS.markdownBytes)
          throw new Error(`SKILL.md 不能超过 ${PACKAGE_LIMITS.markdownBytes} 字节`);
        let markdown;
        try {
          markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (error) {
          throw new Error("SKILL.md 必须是有效 UTF-8 文本", { cause: error });
        }
        if (markdown.includes("\u0000")) throw new Error("SKILL.md 包含 NUL 字符");
        const markdownHash = sha256(bytes);
        const heading = markdown.match(/^#\s+(.+)$/m)?.[1].trim();
        const name = heading && Array.from(heading).length <= 120 ? heading : "隔离的外部 Skill";
        const id = `skill-markdown-${markdownHash.slice(0, 16)}`;
        const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
        const inspection = {
          inspectionToken,
          operation: "import",
          status: "verified",
          canCommit: true,
          expiresAt,
          packageName: fileName,
          summary: { id, name, description: "外部 SKILL.md 隔离副本", assetCount: 0 },
          issues: ["SKILL.md 只会隔离保存，不能执行、试跑或直接发布"],
        };
        inspections.set(inspectionToken, {
          inspection,
          kind: "skill-markdown",
          id,
          name,
          markdownHash,
          bytes,
        });
        return structuredClone(inspection);
      }
      const inspected = await inspectFourJSkillPackage({ bytes, imageInspector });
      const replacements = new Map(inspected.assets.map((asset) => [asset.sourceSha256, asset.sha256]));
      const definition = structuredClone(assertCreativeSkillDefinition(inspected.manifest.definition));
      for (const step of definition.steps) {
        for (const reference of step.references || []) {
          if (reference.type === "asset" && replacements.has(reference.sha256))
            reference.sha256 = replacements.get(reference.sha256);
        }
      }
      const referencedAssets = new Set(assetReferences(definition));
      const packagedAssets = new Set(inspected.assets.map((asset) => asset.sha256));
      if (
        referencedAssets.size !== packagedAssets.size ||
        [...referencedAssets].some((hash) => !packagedAssets.has(hash))
      )
        throw new Error(".fourj-skill 的 recipe 资产引用与清单不一致");
      const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
      const inspection = {
        inspectionToken,
        operation: "import",
        status: "verified",
        canCommit: true,
        expiresAt,
        packageName: fileName,
        summary: {
          id: inspected.manifest.id,
          name: inspected.manifest.name,
          description: inspected.manifest.description,
          assetCount: inspected.assets.length,
        },
        issues: ["导入内容将先保存为禁用草稿，发布前必须重新试跑"],
      };
      inspections.set(inspectionToken, { inspection, kind: "fourj-skill", inspected, definition });
      return structuredClone(inspection);
    } catch (error) {
      return {
        inspectionToken,
        operation: "import",
        status: "rejected",
        canCommit: false,
        issues: [error instanceof Error ? error.message : "创作 Skill 文件安全检查失败"],
      };
    }
  };

  const exportInspection = async (input) => {
    assertExactKeys(input, ["kind", "skillId", "versionId"], "创作 Skill 导出准备请求");
    const inspectionToken = `export:${randomUUID()}`;
    if (typeof saveExportFile !== "function") {
      return {
        inspectionToken,
        operation: "export",
        status: "unavailable",
        canCommit: false,
        issues: ["当前环境不支持保存创作 Skill 文件"],
      };
    }
    const snapshot = await readLibrarySnapshot();
    const skill = snapshot.skills.find((item) => item.skillId === input.skillId);
    if (!skill) throw new Error("创作 Skill 不存在");
    const versionId = input.versionId || skill.activeRevision;
    const version = skill.versions.find((item) => item.versionId === versionId);
    if (!version) throw new Error("创作 Skill 版本不存在");
    const assets = assertAssetDescriptors(version.assets);
    assertDefinitionAssets(version.definition, assets);
    const files = new Map();
    const manifestAssets = [];
    for (const asset of assets) {
      const extension = extensionForMimeType(asset.mimeType);
      if (!extension) throw new Error("创作 Skill 资产 MIME 无效");
      const bytes = await readFile(join(skillsRoot, "captures", `${asset.sha256}${extension}`));
      if (
        bytes.length !== asset.bytes ||
        sha256(bytes) !== asset.sha256 ||
        !imageMagicMatches(bytes, asset.mimeType)
      )
        throw new Error("创作 Skill 固定资产完整性校验失败");
      const path = `assets/${asset.sha256}${extension}`;
      files.set(path, bytes);
      manifestAssets.push({ path, mimeType: asset.mimeType, sha256: asset.sha256, bytes: asset.bytes });
    }
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      id: skill.skillId,
      name: skill.name,
      description: skill.description,
      definition: version.definition,
      assets: manifestAssets,
    };
    files.set("fourj-skill.json", Buffer.from(canonicalJson(manifest)));
    const bytes = deterministicZip(files);
    const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
    const inspection = {
      inspectionToken,
      operation: "export",
      status: "verified",
      canCommit: true,
      expiresAt,
      packageName: `${skill.skillId}.fourj-skill`,
      summary: {
        id: skill.skillId,
        name: skill.name,
        description: skill.description,
        assetCount: assets.length,
      },
      issues: [],
    };
    inspections.set(inspectionToken, {
      inspection,
      kind: "export",
      bytes,
      suggestedName: inspection.packageName,
    });
    return structuredClone(inspection);
  };

  const syncImportInspection = async (input) => {
    const inspectionToken = `sync-import:${randomUUID()}`;
    try {
      assertExactKeys(
        input,
        ["kind", "payload", "expectedHead", "sourceHead", "checkpointHead", "resolution"],
        "创作 Skill 同步恢复准备请求",
      );
      if (!/^[a-f0-9]{64}$/.test(input.expectedHead || ""))
        throw new Error("创作 Skill 同步恢复 expectedHead 无效");
      if (!/^[a-f0-9]{64}$/.test(input.sourceHead || ""))
        throw new Error("创作 Skill 同步恢复 sourceHead 无效");
      if (
        input.checkpointHead !== undefined &&
        !/^[a-f0-9]{64}$/.test(input.checkpointHead || "")
      )
        throw new Error("创作 Skill 同步恢复 checkpointHead 无效");
      if (input.resolution !== undefined && input.resolution !== "replace-local")
        throw new Error("创作 Skill 同步恢复冲突处理方式无效");
      const inspected = inspectCreativeSkillSyncPackage(input.payload);
      if (inspected.manifest.head !== input.sourceHead)
        throw new Error("创作 Skill 同步包 sourceHead 与清单不一致");
      const local = await readPortableRepository();
      if (local.head !== input.expectedHead)
        throw new Error("创作 Skill 发布库已被更新，恢复准备冲突已拒绝");
      const hasConflict = (
        local.head !== input.sourceHead &&
        (local.skills.length > 0 || local.tombstones.length > 0) &&
        input.checkpointHead !== input.expectedHead
      );
      if (hasConflict && input.resolution !== "replace-local")
        throw new Error("创作 Skill 发布库存在本地内容，恢复冲突已拒绝并保留双方");
      if (!hasConflict && input.resolution === "replace-local")
        throw new Error("当前创作 Skill 发布库不存在需要替换的双边冲突");
      if (local.head !== input.sourceHead && typeof createRecoveryPoint !== "function")
        throw new Error("当前环境不能为创作 Skill 恢复创建恢复点");
      const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
      const inspection = {
        inspectionToken,
        operation: "import",
        status: "verified",
        canCommit: true,
        expiresAt,
        packageName: "creative-skills.fourj-skills",
        target: "library",
        summary: {
          id: "fourj-creative-skill-library",
          name: "创作 Skill 发布库",
          description: `${inspected.manifest.publishedSkillCount} 个发布 Skill，${inspected.manifest.tombstoneCount} 个删除墓碑`,
          assetCount: inspected.manifest.assets.length,
        },
        ...(input.resolution ? { resolution: input.resolution } : {}),
        issues: local.head === input.sourceHead
          ? ["本地发布库与同步包已经一致"]
          : input.resolution === "replace-local"
            ? ["继续会以远端发布库替换本机个人 Skill；提交前会先创建恢复点"]
            : [],
      };
      inspections.set(inspectionToken, {
        inspection,
        kind: "sync-import",
        inspected,
        expectedHead: input.expectedHead,
        sourceHead: input.sourceHead,
        checkpointHead: input.checkpointHead,
        resolution: input.resolution,
      });
      return structuredClone(inspection);
    } catch (error) {
      return {
        inspectionToken,
        operation: "import",
        status: "rejected",
        canCommit: false,
        issues: [error instanceof Error ? error.message : "创作 Skill 同步包安全检查失败"],
      };
    }
  };

  const prepare = async (input) => {
    if (!isPlainObject(input))
      throw new Error("不支持的创作 Skill 传输准备请求");
    if (input.kind === "import" && input.source === "file-picker") {
      assertExactKeys(input, ["kind", "source"], "创作 Skill 导入准备请求");
      return importInspection();
    }
    if (input.kind === "export") return exportInspection(input);
    if (input.kind === "sync-import") return syncImportInspection(input);
    throw new Error("不支持的创作 Skill 传输准备请求");
  };

  const writeImmutableCapture = async (path, bytes) => {
    try {
      await writeFile(path, bytes, { flag: "wx" });
      return true;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
      if (!(await readFile(path)).equals(bytes))
        throw new Error("创作 Skill 不可变文件与其内容哈希不一致");
      return false;
    }
  };

  const cleanupCreatedImmutableFile = async (path, bytes, label) => {
    try {
      if (!(await readFile(path)).equals(bytes))
        throw new Error(`创作 Skill 待回滚${label}已被修改，已拒绝删除`);
      await unlink(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  };

  const commit = async (input) => {
    assertExactKeys(input, ["inspectionToken"], "创作 Skill 传输提交请求");
    const prepared = inspections.get(input.inspectionToken);
    if (!prepared) throw new Error("创作 Skill 检查 token 无效或已使用");
    inspections.delete(input.inspectionToken);
    if (Date.parse(prepared.inspection.expiresAt) <= now().getTime())
      throw new Error("创作 Skill 安全检查已过期，请重新选择文件");
    if (prepared.kind === "export") {
      const result = await saveExportFile({
        suggestedName: prepared.suggestedName,
        bytes: Buffer.from(prepared.bytes),
      });
      const current = await readCatalog();
      const base = await commandResult(current);
      const fileName = typeof result === "string" ? result : result?.fileName;
      return fileName ? { ...base, exported: { fileName: basename(fileName) } } : base;
    }
    if (prepared.kind === "sync-import") return restoreSyncRepository(prepared);
    if (prepared.kind === "skill-markdown") {
      return runFixtureLifecycle(() => {
        const importMarkdown = async () => {
        const [existingDraft, currentCatalog] = await Promise.all([
          readDraft(prepared.id),
          readCatalog(),
        ]);
        if (existingDraft || currentCatalog.catalog.skills[prepared.id])
          throw new Error("同内容的 SKILL.md 已经导入");
        const hash = definitionHash(QUARANTINE_DEFINITION);
        const timestamp = now().toISOString();
        const draft = {
          schemaVersion: SCHEMA_VERSION,
          id: prepared.id,
          revision: 1,
          lifecycle: "draft",
          enabled: false,
          trust: "markdown-quarantined",
          source: "skill-markdown",
          createdAt: timestamp,
          updatedAt: timestamp,
          content: {
            name: prepared.name,
            description: "外部 SKILL.md 隔离副本",
            definition: QUARANTINE_DEFINITION,
            validation: { status: "failed", definitionHash: hash, issues: ["隔离的 SKILL.md 不可执行"] },
            testRun: { status: "failed", definitionHash: hash, issues: ["隔离的 SKILL.md 不能试跑"] },
            quarantine: {
              sha256: prepared.markdownHash,
              byteLength: prepared.bytes.length,
              originalName: "SKILL.md",
            },
          },
        };
        const catalog = {
          ...currentCatalog.catalog,
          sequence: currentCatalog.catalog.sequence + 1,
        };
        const committed = await runTransferTransaction({
          kind: "skill-markdown",
          current: currentCatalog,
          catalog,
          files: [
            { path: `captures/${prepared.markdownHash}.skill.md`, bytes: prepared.bytes },
            { path: `drafts/${prepared.id}.json`, bytes: Buffer.from(canonicalJson(draft)) },
          ],
        });
        return commandResult(committed, { draftId: draft.id });
        };
        return runCatalogWrite(importMarkdown);
      });
    }
    if (prepared.kind !== "fourj-skill") throw new Error("不支持的创作 Skill 导入类型");
    return runFixtureLifecycle(() => {
      const importPackage = async () => {
        const { inspected } = prepared;
        const id = assertSkillId(inspected.manifest.id);
        const [existingDraft, currentCatalog] = await Promise.all([readDraft(id), readCatalog()]);
        if (existingDraft || currentCatalog.catalog.skills[id])
          throw new Error("同标识的创作 Skill 已存在，不能由导入包覆盖");
        const definition = prepared.definition;
        const hash = definitionHash(definition);
        const timestamp = now().toISOString();
        const draft = {
          schemaVersion: SCHEMA_VERSION,
          id,
          revision: 1,
          lifecycle: "draft",
          enabled: false,
          trust: "external-unverified",
          source: "package",
          createdAt: timestamp,
          updatedAt: timestamp,
          content: {
            name: inspected.manifest.name.trim(),
            description: inspected.manifest.description.trim(),
            definition,
            validation: { status: "passed", definitionHash: hash, issues: [] },
            testRun: { status: "pending", definitionHash: hash, issues: [] },
            assets: inspected.assets.map((asset) => ({
              sha256: asset.sha256,
              mimeType: asset.mimeType,
              bytes: asset.byteLength,
              width: asset.width,
              height: asset.height,
            })),
          },
        };
        const reportBytes = Buffer.from(canonicalJson({
          schemaVersion: SCHEMA_VERSION,
          kind: "fourj-skill",
          packageHash: inspected.packageHash,
          skillId: id,
          importedAt: timestamp,
        }));
        const catalog = {
          ...currentCatalog.catalog,
          sequence: currentCatalog.catalog.sequence + 1,
        };
        const committed = await runTransferTransaction({
          kind: "fourj-skill",
          current: currentCatalog,
          catalog,
          files: [
            ...inspected.assets.map((asset) => ({
              path: `captures/${asset.sha256}${extname(asset.path)}`,
              bytes: asset.data,
            })),
            { path: `drafts/${id}.json`, bytes: Buffer.from(canonicalJson(draft)) },
            { path: `import-reports/${inspected.packageHash}.json`, bytes: reportBytes },
          ],
        });
        return commandResult(committed, { draftId: draft.id });
      };
      return runCatalogWrite(importPackage);
    });
  };

  const publishDraft = (input) => {
    const publish = async () => {
      const id = assertSkillId(input?.id);
      if (!Number.isSafeInteger(input?.expectedDraftRevision) || input.expectedDraftRevision < 1)
        throw new Error("发布草稿时必须提供有效的 expectedDraftRevision");
      if (typeof input?.expectedHead !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedHead))
        throw new Error("发布草稿时必须提供有效的 expectedHead");

      const current = await readCatalog();
      if (current.head !== input.expectedHead)
        throw new Error("创作 Skill 目录已被更新，请重新载入后再发布");
      const draft = await readDraft(id);
      if (!draft) throw new Error("找不到要发布的创作 Skill 草稿");
      if (draft.revision !== input.expectedDraftRevision)
        throw new Error("创作 Skill 草稿已被更新，请重新载入后再发布");
      if (draft.trust === "markdown-quarantined" || draft.source === "skill-markdown")
        throw new Error("隔离的 SKILL.md 不能直接发布");

      const timestamp = now().toISOString();
      const { fixture: _fixture, ...publishedContent } = draft.content;
      const revision = {
        schemaVersion: SCHEMA_VERSION,
        id,
        trust: draft.trust,
        source: draft.source,
        content: publishedContent,
        ...(draft.content.validation && draft.content.testRun ? { publishedAt: timestamp } : {}),
      };
      const revisionBytes = Buffer.from(canonicalJson(revision));
      const revisionHash = sha256(revisionBytes);
      const previousEntry = current.catalog.skills[id];
      const enabled = draft.trust === "external-unverified" ? false : input.enabled === true;
      const catalog = {
        schemaVersion: SCHEMA_VERSION,
        sequence: current.catalog.sequence + 1,
        skills: {
          ...current.catalog.skills,
          [id]: {
            id,
            name: draft.content.name,
            description: draft.content.description || "",
            activeRevision: revisionHash,
            publishedDraftRevision: draft.revision,
            publishedDraftCreatedAt: draft.createdAt,
            lifecycle: "published",
            enabled,
            ...(draft.content.validation && draft.content.testRun
              ? {
                  favorite: previousEntry?.favorite === true,
                  ownership: "personal",
                  recordRevision: (previousEntry?.recordRevision || 0) + 1,
                }
              : {}),
            trust: draft.trust,
            source: draft.source,
            createdAt: previousEntry?.createdAt || timestamp,
            updatedAt: timestamp,
          },
        },
        tombstones: Object.fromEntries(
          Object.entries(current.catalog.tombstones).filter(([skillId]) => skillId !== id),
        ),
      };
      const committed = await runTransferTransaction({
        kind: "publish",
        current,
        catalog,
        files: [{ path: `revisions/${revisionHash}.json`, bytes: revisionBytes }],
      });
      return { ...committed, revisionHash, revision };
    };
    return runCatalogWrite(publish);
  };

  const replayTransferTransactions = async () => {
    const transactionRoot = join(skillsRoot, "transactions");
    const entries = (await readdir(transactionRoot, { withFileTypes: true }))
      .filter((entry) => entry.name.endsWith(".transfer"))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error("创作 Skill 传输事务不是普通目录，已保留原路径");
      await replayTransferDirectory(entry.name);
    }
  };

  const replayPublicationCleanups = async () => {
    const transactionRoot = join(skillsRoot, "transactions");
    const names = (await readdir(transactionRoot)).filter((name) => name.endsWith(".draft-cleanup")).sort();
    for (const name of names) {
      const cleanup = assertPublicationCleanup(parseJson(
        await readFile(join(transactionRoot, name)),
        "创作 Skill 发布草稿清理记录已损坏",
      ));
      if (name !== basename(publicationCleanupPath(cleanup)))
        throw new Error("创作 Skill 发布草稿清理记录标识无效，已保留原文件");
      const current = await readCatalog();
      const published = current.catalog.skills[cleanup.id];
      if (
        published?.publishedDraftRevision !== cleanup.draftRevision ||
        published.publishedDraftCreatedAt !== cleanup.draftCreatedAt
      )
        throw new Error("创作 Skill 发布草稿清理记录与当前目录冲突，已保留原文件");
      await completePublicationCleanup(cleanup);
    }
  };

  const createInitialCatalog = async () => {
    const catalog = { schemaVersion: SCHEMA_VERSION, sequence: 0, skills: {}, tombstones: {} };
    const bytes = Buffer.from(canonicalJson(catalog));
    const head = sha256(bytes);
    try {
      await writeFile(pathForCatalog(head), bytes, { flag: "wx" });
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
      if (!(await readFile(pathForCatalog(head))).equals(bytes))
        throw new Error("初始创作 Skill 目录完整性校验失败");
    }
    const pointer = `${head}\n`;
    await writeAtomic(previousPath, pointer);
    await writeAtomic(currentPath, pointer);
    return { head, catalog };
  };

  return {
    async initialize() {
      await mkdir(skillsRoot, { recursive: true });
      await Promise.all(
        SKILL_DIRECTORIES.map((directory) =>
          mkdir(join(skillsRoot, directory), { recursive: true }),
        ),
      );
      try {
        await readHead();
      } catch (error) {
        if (!isMissing(error)) throw error;
        try {
          const previousHead = await readPointer(previousPath, "CURRENT.prev");
          await readCatalogAt(previousHead);
          await writeAtomic(currentPath, `${previousHead}\n`);
        } catch (previousError) {
          if (!isMissing(previousError)) throw previousError;
          return createInitialCatalog();
        }
      }
      await replayTransferTransactions();
      await replayPublicationCleanups();
      return readCatalog();
    },
    readCatalog,
    readDraft,
    readRevision,
    saveDraft,
    publishDraft,
    query,
    execute,
    prepare,
    commit,
    createSyncPackage,
  };
}
