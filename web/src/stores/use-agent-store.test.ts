import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
    },
});
Object.defineProperty(globalThis, "document", { value: { documentElement: { lang: "" } } });

const sourceRoot = new URL("../", import.meta.url).href;
const aliasLoader = `
const sourceRoot = ${JSON.stringify(sourceRoot)};
export async function resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const relativePath = specifier === "@/i18n" ? "i18n/index.ts" : specifier.slice(2) + ".ts";
    return nextResolve(new URL(relativePath, sourceRoot).href, context);
}`;
register(`data:text/javascript,${encodeURIComponent(aliasLoader)}`, { parentURL: import.meta.url });

const {
    CANVAS_AGENT_PANEL_MIN_WIDTH,
    clampAgentPanelWidth,
    persistAgentPanelWidth,
} = await import("./use-agent-store.ts");

test("标准 224px 侧栏下 Agent 最大宽度至少保留 360px 路由内容", () => {
    const panelWidth = clampAgentPanelWidth(760, 1280, 224);

    assert.equal(panelWidth, 695);
    assert.equal(1280 - 224 - panelWidth - 1, 360);
});

test("无停靠侧栏的路由仍可使用 Agent 面板完整最大宽度", () => {
    assert.equal(clampAgentPanelWidth(760, 1280, 0), 760);
});

test("窄桌面优先保留 compact 下限，移动端不预留桌面侧栏", () => {
    assert.equal(clampAgentPanelWidth(760, 800, 224), 240);
    assert.equal(persistAgentPanelWidth(240, 800, 224), 240);
    assert.equal(clampAgentPanelWidth(760, 700, 224), 339);
    assert.equal(clampAgentPanelWidth(100, 1280, 224), CANVAS_AGENT_PANEL_MIN_WIDTH);
});

test("画布宽侧栏参与对话宽度夹取并暴露需要自动收栏的极窄空间", () => {
    const canvasSidebarWidth = 481;
    const panelWidth = clampAgentPanelWidth(760, 800, canvasSidebarWidth);

    assert.equal(panelWidth, 240);
    assert.equal(800 - canvasSidebarWidth - panelWidth - 1, 78);
});
