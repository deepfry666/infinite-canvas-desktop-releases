import { nanoid } from "nanoid";

import { createCreativeSkillRunLedger, type CreativeSkillRunOutput, type CreativeSkillRunRecord } from "@/lib/creative-skill-run-ledger";
import { createCreativeSkillRunner, type CreativeSkillProviderImage, type CreativeSkillRunnerImage } from "@/lib/creative-skill-runner";
import { buildCanvasCreativeSkillRunRequest } from "@/lib/creative-skills/canvas-runtime-request";
import { cancelImageTask, requestEdit, requestGeneration } from "@/services/api/image";
import { findUploadedImageByIdempotencyKey, imageToDataUrl, uploadImage } from "@/services/image-storage";
import { setGenerationActivity } from "@/services/generation-activity";
import { createCreativeSkillRecoveryStorage, createCreativeSkillRunStorage } from "@/services/creative-skill-run-storage";
import { resolveModelForCapability, useConfigStore } from "@/stores/use-config-store";
import type { AgentCreativeSkillExecution } from "@/stores/use-agent-store";
import type { CanvasCreativeSkillProvenance, CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const creativeSkillRunLedger = createCreativeSkillRunLedger({
    storage: createCreativeSkillRunStorage(),
    createId: nanoid,
    now: Date.now,
});

export type MaterializeCreativeSkillOutput = (input: {
    run: CreativeSkillRunRecord;
    output: CreativeSkillRunOutput;
    anchorNodeId: string;
    provenance: CanvasCreativeSkillProvenance;
}) => Promise<string>;

export function createCanvasCreativeSkillRuntime({
    projectId,
    readNodes,
    materializeOutput,
}: {
    projectId: string;
    readNodes: () => CanvasNodeData[];
    materializeOutput: MaterializeCreativeSkillOutput;
}) {
    let activeOperations = 0;
    const withActivity = async <T,>(operation: () => Promise<T>) => {
        activeOperations += 1;
        setGenerationActivity(`creative-skill:${projectId}`, activeOperations);
        try {
            return await operation();
        } finally {
            activeOperations -= 1;
            setGenerationActivity(`creative-skill:${projectId}`, activeOperations);
        }
    };
    const runner = createCreativeSkillRunner({
        ledger: creativeSkillRunLedger,
        recoveryStorage: createCreativeSkillRecoveryStorage(),
        createId: nanoid,
        now: Date.now,
        provider: async (input) => {
            const state = useConfigStore.getState();
            const configured = state.config;
            const model = input.provider.model || resolveModelForCapability(configured, configured.imageModel || configured.model, "image");
            const config = {
                ...configured,
                channelMode: "local" as const,
                model,
                imageModel: model,
                count: "1",
                canvasImageCount: "1",
                size: input.provider.size || configured.size,
                quality: input.provider.quality || configured.quality,
            };
            if (!state.isAiConfigReady(config, model)) throw rejectedError("请先在 AI 服务中配置可用的图片模型", "MODEL_NOT_CONFIGURED");
            const options = {
                signal: input.signal,
                resumeTaskId: input.resumeTaskId,
                idempotencyKey: input.idempotencyKey,
                onRemoteHandle: input.onRemoteHandle,
            };
            if (input.call.task === "image.generate") return requestGeneration(config, input.call.prompt, options);
            const references: ReferenceImage[] = input.references.map((image, index) => ({
                id: `${input.outputId}:reference:${index}`,
                name: `reference-${index + 1}.png`,
                type: image.mimeType || "image/png",
                dataUrl: image.dataUrl || "",
                url: image.url,
                storageKey: image.storageKey,
            }));
            return requestEdit(config, input.call.prompt, references, undefined, options);
        },
        cancelProvider: async (taskId, provider) => {
            const configured = useConfigStore.getState().config;
            const model = provider.model || resolveModelForCapability(configured, configured.imageModel || configured.model, "image");
            return cancelImageTask(configured, model, taskId);
        },
        resolveImage: resolveRunnerImage,
        storeOutput: async ({ outputId, image }) => {
            const stored = await uploadImage(providerImageSource(image), { idempotencyKey: outputId });
            return {
                storageKey: stored.storageKey,
                url: stored.url,
                mimeType: stored.mimeType,
                bytes: stored.bytes,
                width: stored.width,
                height: stored.height,
            };
        },
        findStoredOutput: async ({ outputId }) => {
            const stored = await findUploadedImageByIdempotencyKey(outputId);
            if (!stored) return undefined;
            return {
                storageKey: stored.storageKey,
                url: stored.url,
                mimeType: stored.mimeType,
                bytes: stored.bytes,
                width: stored.width,
                height: stored.height,
            };
        },
        materializeOutput,
    });

    return {
        run: (input: AgentCreativeSkillExecution) => withActivity(async () => {
            if (input.mode === "production" && input.assetSource?.kind === "draft") throw new Error("草稿只能用于测试运行");
            const nodes = readNodes();
            const nodeById = new Map(nodes.map((node) => [node.id, node]));
            if (!nodeById.has(input.anchorNodeId)) throw new Error("创作 Skill 的目标节点已不存在");
            if (input.targetFixture && (input.mode !== "test"
                || input.assetSource?.kind !== "draft"
                || input.assetSource.draftId !== input.targetFixture.draftId
                || input.assetSource.draftRevision !== input.targetFixture.draftRevision)) {
                throw new Error("创作 Skill 样例夹具只能用于对应草稿的测试运行");
            }
            const target = input.targetFixture
                ? await runnerImageFromFixture(input.targetFixture)
                : input.targetNodeId ? await runnerImageFromNode(nodeById.get(input.targetNodeId), "目标") : undefined;
            const references = await Promise.all((input.referenceNodeIds || []).map((nodeId) => runnerImageFromNode(nodeById.get(nodeId), "参考")));
            const assetHashes = [...new Set(input.recipe.steps.flatMap((step) => (step.references || []).flatMap((reference) => reference.type === "asset" ? [reference.sha256] : [])))];
            if (assetHashes.length && !input.assetSource) throw new Error("创作 Skill 缺少固定素材来源");
            const assets = assetHashes.map((sha256): CreativeSkillRunnerImage & { sha256: string } => ({
                sha256,
                skillAsset: input.assetSource?.kind === "draft"
                    ? { kind: "draft", draftId: input.assetSource.draftId, draftRevision: input.assetSource.draftRevision, sha256 }
                    : { kind: "published", skillId: input.assetSource!.skillId, versionId: input.assetSource!.versionId, sha256 },
            }));
            const configured = useConfigStore.getState().config;
            const model = input.provider?.model || resolveModelForCapability(configured, configured.imageModel || configured.model, "image");
            if (!model.trim()) throw rejectedError("请先在 AI 服务中配置可用的图片模型", "MODEL_NOT_CONFIGURED");
            return runner.run(buildCanvasCreativeSkillRunRequest({
                execution: input,
                projectId,
                target,
                references,
                assets,
                provider: {
                    model,
                    size: input.provider?.size || configured.size,
                    quality: input.provider?.quality || configured.quality,
                },
            }));
        }),
        recover: () => withActivity(() => runner.recover({ projectId })),
        resume: (runId: string) => withActivity(() => runner.resume(runId)),
        cancel: (runId: string) => withActivity(() => runner.cancel(runId)),
        cancelCommand: (commandId: string) => withActivity(() => runner.cancelCommand(commandId)),
        dismiss: (runId: string) => withActivity(() => runner.dismiss(runId)),
    };
}

async function runnerImageFromNode(node: CanvasNodeData | undefined, label: string): Promise<CreativeSkillRunnerImage & { sha256: string }> {
    if (!node || node.type !== "image" || !node.metadata?.content) throw new Error(`创作 Skill 的${label}图片不可用`);
    const source = { url: node.metadata.content, storageKey: node.metadata.storageKey, mimeType: node.metadata.mimeType };
    const dataUrl = await imageToDataUrl(source);
    if (!dataUrl) throw new Error(`创作 Skill 的${label}图片不可用`);
    return {
        sha256: await sha256DataUrl(dataUrl),
        nodeId: node.id,
        storageKey: node.metadata.storageKey,
        url: node.metadata.content,
        mimeType: node.metadata.mimeType,
        dataUrl,
    };
}

async function runnerImageFromFixture(fixture: NonNullable<AgentCreativeSkillExecution["targetFixture"]>): Promise<CreativeSkillRunnerImage & { sha256: string }> {
    const bridge = window.infiniteCanvasDesktop?.creativeSkills;
    if (!bridge) throw new Error("桌面端创作 Skill 样例桥接不可用");
    const result = await bridge.query({
        kind: "resolve-fixture",
        draftId: fixture.draftId,
        draftRevision: fixture.draftRevision,
        role: "input",
    });
    if (result.fixture.sha256 !== fixture.sha256) throw new Error("创作 Skill 样例原图已变化");
    const bytes = new Uint8Array(result.fixture.bytes);
    return { sha256: fixture.sha256, mimeType: result.fixture.mimeType, dataUrl: bytesToDataUrl(bytes, result.fixture.mimeType) };
}

async function resolveRunnerImage(image: CreativeSkillRunnerImage) {
    if (image.skillAsset) {
        const bridge = window.infiniteCanvasDesktop?.creativeSkills as unknown as {
            query: (input: unknown) => Promise<{ asset?: { sha256: string; mimeType: string; bytes: ArrayBuffer | Uint8Array } }>;
        } | undefined;
        if (!bridge) throw new Error("桌面端创作 Skill 素材桥接不可用");
        const source = image.skillAsset.kind === "draft"
            ? { kind: "resolve-asset", draftId: image.skillAsset.draftId, draftRevision: image.skillAsset.draftRevision, sha256: image.skillAsset.sha256 }
            : { kind: "resolve-asset", skillId: image.skillAsset.skillId, versionId: image.skillAsset.versionId, sha256: image.skillAsset.sha256 };
        const result = await bridge.query(source);
        if (!result.asset || result.asset.sha256 !== image.skillAsset.sha256) throw new Error("创作 Skill 固定素材不可用");
        const bytes = result.asset.bytes instanceof Uint8Array ? result.asset.bytes : new Uint8Array(result.asset.bytes);
        return { ...image, mimeType: result.asset.mimeType, dataUrl: bytesToDataUrl(bytes, result.asset.mimeType) };
    }
    const dataUrl = image.dataUrl || await imageToDataUrl(image);
    if (!dataUrl) throw new Error("创作 Skill 图片资产不可用");
    return { ...image, dataUrl };
}

function providerImageSource(image: CreativeSkillProviderImage) {
    if (typeof image === "string") return image;
    if (isBlob(image)) return image;
    const source = image.dataUrl || image.url;
    if (!source) throw rejectedError("Provider 没有返回可保存的图片", "MISSING_OUTPUT");
    return source;
}

function isBlob(value: unknown): value is Blob {
    return typeof Blob !== "undefined" && value instanceof Blob;
}

async function sha256DataUrl(dataUrl: string) {
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    return `data:${mimeType};base64,${btoa(binary)}`;
}

function rejectedError(message: string, code: string) {
    return Object.assign(new Error(message), { submissionState: "rejected" as const, code });
}
