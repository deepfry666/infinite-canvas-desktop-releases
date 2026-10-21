import assert from "node:assert/strict";
import test from "node:test";

import { apimartModelCapability, apimartModelFamily, apimartVideoLimits, isApimartConfig, isApimartSeedance20Standard, isApimartWorkflowModel } from "./apimart-models.ts";
import { buildApimartVideoPayload, parseApimartCreateResponse, parseApimartTaskResponse } from "./apimart-video.ts";

test("APIMart 模型目录能识别字节与 MiniMax 媒体系列", () => {
    assert.equal(isApimartConfig({ baseUrl: "https://api.apimart.ai/v1" }), true);
    assert.equal(apimartModelFamily("doubao-seedream-5-0-pro"), "seedream");
    assert.equal(apimartModelCapability("doubao-seedream-4.5"), "image");
    assert.equal(apimartModelFamily("doubao-seedance-2.0-fast"), "seedance");
    assert.equal(apimartModelCapability("doubao-seedance-1-5-pro"), "video");
    assert.equal(apimartModelFamily("MiniMax-Hailuo-2.3-Fast"), "minimax-hailuo");
    assert.equal(apimartModelFamily("MiniMax-image-01"), "minimax-image");
    assert.equal(apimartModelCapability("MiniMax-image-01"), "image");
    assert.equal(apimartModelFamily("MiniMax-H3"), "minimax-h3");
    assert.equal(apimartModelCapability("MiniMax-H3-Context-IR"), "video");
    assert.deepEqual(apimartVideoLimits("doubao-seedance-2.5"), { images: 30, videos: 10, audios: 10, maxDurationSeconds: 30 });
    assert.deepEqual(apimartVideoLimits("MiniMax-H3"), { images: 9, videos: 3, audios: 3, maxDurationSeconds: 15 });
    assert.equal(isApimartSeedance20Standard("doubao-seedance-2.0"), true);
    assert.equal(isApimartSeedance20Standard("doubao-seedance-2.0-fast"), false);
    assert.equal(isApimartWorkflowModel("MiniMax-H3-Context-IR"), true);
});

test("APIMart 视频请求使用统一 generations JSON 协议并按模型映射字段", () => {
    assert.deepEqual(
        buildApimartVideoPayload({
            model: "doubao-seedance-2.0",
            prompt: "小猫走向镜头",
            duration: 8,
            resolution: "720p",
            ratio: "16:9",
            generateAudio: true,
            watermark: false,
            imageUrls: ["https://example.com/cat.jpg"],
        }),
        {
            model: "doubao-seedance-2.0",
            prompt: "小猫走向镜头",
            duration: 8,
            resolution: "720p",
            size: "16:9",
            generate_audio: true,
            image_urls: ["https://example.com/cat.jpg"],
        },
    );
    assert.deepEqual(
        buildApimartVideoPayload({
            model: "MiniMax-Hailuo-2.3-Fast",
            prompt: "猫咪奔跑",
            duration: 6,
            resolution: "1080p",
            ratio: "16:9",
            generateAudio: true,
            watermark: false,
            promptOptimizer: true,
            fastPretreatment: false,
            imageUrls: ["https://example.com/cat.jpg"],
        }),
        {
            model: "MiniMax-Hailuo-2.3-Fast",
            prompt: "猫咪奔跑",
            duration: 6,
            resolution: "1080p",
            prompt_optimizer: true,
            fast_pretreatment: false,
            watermark: false,
            first_frame_image: "https://example.com/cat.jpg",
        },
    );
});

test("APIMart 任务响应解析 code 200、状态和视频结果", () => {
    assert.equal(parseApimartCreateResponse({ code: 200, data: [{ status: "submitted", task_id: "task-1" }] }), "task-1");
    assert.deepEqual(
        parseApimartTaskResponse({ data: { status: "completed", result: { videos: [{ url: ["https://cdn.example.com/result.mp4"] }] } } }),
        { status: "completed", url: "https://cdn.example.com/result.mp4" },
    );
    assert.deepEqual(parseApimartTaskResponse({ data: { status: "failed", error: { message: "余额不足" } } }), { status: "failed", error: "余额不足" });
});
