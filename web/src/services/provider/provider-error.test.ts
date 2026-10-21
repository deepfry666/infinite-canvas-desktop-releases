import assert from "node:assert/strict";
import test from "node:test";

import { createProviderHttpError, createProviderTaskTerminalError, withProviderErrorMessage } from "./provider-error.ts";

test("明确的 Provider HTTP 客户端拒绝可被运行器安全重试", () => {
    const error = createProviderHttpError(401, "invalid api key");

    assert.equal(error.submissionState, "rejected");
    assert.equal(error.status, 401);
    assert.equal(error.code, "HTTP_401");
});

test("Provider 服务端错误仍保留提交结果未知语义", () => {
    const error = createProviderHttpError(503, "service unavailable");

    assert.equal(error.submissionState, "unknown");
    assert.equal(error.status, 503);
});

test("本地化 Provider 错误文案时保留提交语义", () => {
    const source = createProviderHttpError(429, "rate limited");
    const localized = withProviderErrorMessage(source, "请求过于频繁");

    assert.equal(localized.message, "请求过于频繁");
    assert.equal(localized.submissionState, "rejected");
    assert.equal(localized.status, 429);
    assert.equal(localized.code, "HTTP_429");
});

test("Provider 请求准备失败可显式标记为未提交拒绝", () => {
    const source = Object.freeze(Object.assign(new Error("invalid reference"), { code: "INVALID_REFERENCE" }));
    const rejected = withProviderErrorMessage(source, "参考图无法准备", "rejected");

    assert.equal(rejected.message, "参考图无法准备");
    assert.equal(rejected.submissionState, "rejected");
    assert.equal(rejected.code, "INVALID_REFERENCE");
    assert.equal(rejected.cause, source);
});

test("远端任务明确失败与暂时无法查询使用独立语义", () => {
    const error = createProviderTaskTerminalError("任务失败", "REMOTE_TASK_REJECTED");
    const localized = withProviderErrorMessage(error, "远端任务失败");

    assert.equal(localized.remoteTaskState, "terminal-failure");
    assert.equal(localized.code, "REMOTE_TASK_REJECTED");
    assert.equal(localized.submissionState, undefined);
});
