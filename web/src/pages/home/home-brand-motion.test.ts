import assert from "node:assert/strict";
import test from "node:test";

import {
    advanceBrandVisual,
    advancePointerMotion,
    beginPointerVisual,
    beginSettlingVisual,
    brandGrid,
    BRAND_REPEAT_COUNT,
    BRAND_ROW_COUNT,
    BRAND_WORD,
    createBrandVisualState,
    createIdlePulse,
    createPointerMotionState,
    createSeededRandom,
    isPointerMotionSettled,
    pickIdleCandidate,
    updatePointerTarget,
    type IdleCandidate,
} from "./home-brand-motion.ts";

test("FOURJ 字纹使用九行稳定单字符网格", () => {
    const expectedRow = Array.from({ length: BRAND_REPEAT_COUNT }, () => BRAND_WORD).join(" ");
    assert.equal(brandGrid.length, BRAND_ROW_COUNT);
    assert.equal(brandGrid.flat().filter((cell) => cell.isGlyph).length, 450);
    assert.equal(new Set(brandGrid.flat().map((cell) => cell.id)).size, brandGrid.flat().length);
    for (const row of brandGrid) assert.equal(row.map((cell) => cell.char).join(""), expectedRow);
});

test("闲置字符选择遵守间距、冷却与稳定随机", () => {
    const candidates: IdleCandidate[] = brandGrid.flat().filter((cell) => cell.isGlyph).map((cell) => ({
        index: cell.index,
        row: cell.row,
        column: cell.column,
        x: cell.column * 18 + (cell.row % 2 ? 42 : 0),
        y: cell.row * 82,
    }));
    const activeCandidate = candidates[84];
    const cooldownCandidate = candidates[210];
    const active = new Set([activeCandidate.index]);
    const cooldown = new Map([[cooldownCandidate.index, 10_000]]);
    const firstRandom = createSeededRandom(20260819);
    const secondRandom = createSeededRandom(20260819);
    const first = pickIdleCandidate(candidates, active, cooldown, [], 1000, 100, firstRandom);
    const second = pickIdleCandidate(candidates, active, cooldown, [], 1000, 100, secondRandom);
    assert.deepEqual(first, second);
    assert.ok(first);
    assert.notEqual(first.index, cooldownCandidate.index);
    assert.ok(Math.hypot(first.x - activeCandidate.x, first.y - activeCandidate.y) >= 100);
});

test("闲置点染保持 2.5–4s 周期与低概率单金色", () => {
    const random = createSeededRandom(42);
    const pulses = Array.from({ length: 1000 }, () => createIdlePulse(random, true));
    assert.ok(pulses.every((pulse) => pulse.duration >= 2500 && pulse.duration < 4000));
    assert.ok(pulses.every((pulse) => pulse.peakOpacity > 0 && pulse.peakOpacity < 0.18));
    const goldCount = pulses.filter((pulse) => pulse.gold).length;
    assert.ok(goldCount > 50 && goldCount < 150);
    assert.equal(createIdlePulse(random, false).gold, false);
});

function simulatePointer(fps: number) {
    const elapsed = 1 / fps;
    const state = createPointerMotionState(0, 0);
    for (let frame = 1; frame <= fps; frame += 1) {
        const progress = frame / fps;
        updatePointerTarget(state, 620 * progress, Math.sin(progress * Math.PI) * 150, elapsed);
        advancePointerMotion(state, elapsed, 0);
    }
    return state;
}

test("独立 core/body 物理在不同帧率下保持近似轨迹并随速度拉伸", () => {
    const thirty = simulatePointer(30);
    const sixty = simulatePointer(60);
    const oneTwenty = simulatePointer(120);
    assert.ok(Math.abs(thirty.core.position.x - sixty.core.position.x) < 7);
    assert.ok(Math.abs(sixty.core.position.x - oneTwenty.core.position.x) < 5);
    assert.ok(Math.abs(thirty.body.position.x - sixty.body.position.x) < 9);
    assert.ok(Math.abs(sixty.body.position.x - oneTwenty.body.position.x) < 6);
    assert.ok(Math.abs(sixty.target.x - sixty.core.position.x) < Math.abs(sixty.target.x - sixty.body.position.x));
    assert.ok(sixty.stretch > 0.12);
    assert.ok(sixty.geometry.bodyFront.x - sixty.geometry.bodyBack.x > 20);
});

test("急转保留旧方向回拉，停下后回圆并收束", () => {
    const state = createPointerMotionState(0, 0);
    for (let frame = 1; frame <= 24; frame += 1) {
        updatePointerTarget(state, frame * 18, 0, 1 / 60);
        advancePointerMotion(state, 1 / 60, 0);
    }
    updatePointerTarget(state, state.target.x - 34, 0, 1 / 60);
    assert.ok(state.turnMemory.x > 0);
    for (let frame = 1; frame <= 90; frame += 1) advancePointerMotion(state, 1 / 60, frame / 60);
    assert.ok(state.stretch < 0.012);
    assert.ok(Math.abs(state.turnMemory.x) < 0.12);
    assert.ok(isPointerMotionSettled(state));
});

test("闲置与指针状态在 400ms 内交接，指针退出后才恢复闲置", () => {
    const visual = createBrandVisualState();
    beginPointerVisual(visual);
    for (let frame = 0; frame < 24; frame += 1) {
        advanceBrandVisual(visual, 1 / 60, false);
        assert.ok(visual.idleOpacity + Math.max(visual.coreOpacity, visual.bodyOpacity) <= 1.01);
    }
    assert.equal(visual.phase, "tracking");
    assert.equal(visual.idleOpacity, 0);
    beginSettlingVisual(visual);
    let enteredIdle = false;
    for (let frame = 0; frame < 90; frame += 1) {
        const transition = advanceBrandVisual(visual, 1 / 60, true);
        if (!transition.enteredIdle) continue;
        enteredIdle = true;
        assert.equal(visual.coreOpacity, 0);
        assert.equal(visual.bodyOpacity, 0);
        assert.equal(visual.idleOpacity, 0);
        break;
    }
    assert.ok(enteredIdle);
    advanceBrandVisual(visual, 1 / 60, true);
    assert.ok(visual.idleOpacity > 0);
});
