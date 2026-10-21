import {
    buildCreativeSkillStyleExtractionMessages,
    parseCreativeSkillStyleExtraction,
    type CreativeSkillStyleExtraction,
} from "@/lib/creative-skills/style-extraction";
import { resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import { requestImageQuestion, type AiTextMessage } from "./image";

type ExtractCreativeSkillStyleInput = {
    inputImage: Blob;
    outputImage: Blob;
    language?: string;
    signal?: AbortSignal;
};

const MAX_VISION_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_VISION_IMAGE_EDGE = 1600;

export async function extractCreativeSkillStyle(
    config: AiConfig,
    input: ExtractCreativeSkillStyleInput,
): Promise<CreativeSkillStyleExtraction> {
    const model = resolveModelForCapability(config, config.textModel || config.model, "text");
    if (!model.trim()) throw new Error("请先配置可用的文字模型");
    input.signal?.throwIfAborted();
    const [inputDataUrl, outputDataUrl] = await Promise.all([
        prepareVisionImage(input.inputImage, input.signal),
        prepareVisionImage(input.outputImage, input.signal),
    ]);
    input.signal?.throwIfAborted();
    const messages = buildCreativeSkillStyleExtractionMessages({
        inputDataUrl,
        outputDataUrl,
        language: input.language,
    }) as AiTextMessage[];
    const answer = await requestImageQuestion(
        { ...config, model, systemPrompt: "" },
        messages,
        () => undefined,
        { signal: input.signal },
    );
    return parseCreativeSkillStyleExtraction(answer);
}

async function prepareVisionImage(image: Blob, signal?: AbortSignal) {
    const bitmap = await createImageBitmap(image);
    try {
        signal?.throwIfAborted();
        if (image.size <= MAX_VISION_IMAGE_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_VISION_IMAGE_EDGE) return readBlobAsDataUrl(image);
        const scale = Math.min(1, MAX_VISION_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法为文字模型准备样例图");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const resized = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error("无法为文字模型压缩样例图")),
            "image/webp",
            0.88,
        ));
        signal?.throwIfAborted();
        return readBlobAsDataUrl(resized);
    } finally {
        bitmap.close();
    }
}

function readBlobAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("样例图读取失败"));
        reader.readAsDataURL(blob);
    });
}
