import assert from "node:assert/strict";
import test from "node:test";

import {
    POINTER_HALO_CORE_PHYSICS,
    POINTER_HALO_FIELD_PHYSICS,
    advanceHaloAxis,
    carryHaloPointIntoBounds,
    createPointerHaloMediaStore,
} from "./use-pointer-halo.ts";

test("核心光比外围柔光更快追上指针", () => {
    const core = advanceHaloAxis({ position: 0, velocity: 0 }, 100, POINTER_HALO_CORE_PHYSICS);
    const field = advanceHaloAxis({ position: 0, velocity: 0 }, 100, POINTER_HALO_FIELD_PHYSICS);

    assert.ok(core.position > field.position);
});

test("跨 surface 时从新边界承接旧光心", () => {
    const carried = carryHaloPointIntoBounds(
        { x: 40, y: 280 },
        { left: 80, right: 240, top: 160, bottom: 220 },
    );

    assert.deepEqual(carried, { x: 80, y: 220 });
});

test("多个 halo 实例共享两条底层媒体查询监听", () => {
    const queries = new Map<string, {
        matches: boolean;
        listeners: Set<() => void>;
        addEventListener: (_type: "change", listener: () => void) => void;
        removeEventListener: (_type: "change", listener: () => void) => void;
    }>();
    const matchMedia = (query: string) => {
        let result = queries.get(query);
        if (!result) {
            const listeners = new Set<() => void>();
            result = {
                matches: !query.includes("reduced-motion"),
                listeners,
                addEventListener: (_type, listener) => listeners.add(listener),
                removeEventListener: (_type, listener) => listeners.delete(listener),
            };
            queries.set(query, result);
        }
        return result;
    };
    const store = createPointerHaloMediaStore(() => matchMedia);
    const firstSnapshots: Array<{ fine: boolean; reduced: boolean }> = [];
    const secondSnapshots: Array<{ fine: boolean; reduced: boolean }> = [];

    const unsubscribeFirst = store.subscribe((snapshot) => firstSnapshots.push(snapshot));
    const unsubscribeSecond = store.subscribe((snapshot) => secondSnapshots.push(snapshot));

    assert.equal(queries.size, 2);
    assert.deepEqual([...queries.values()].map((query) => query.listeners.size), [1, 1]);

    const fineQuery = [...queries.entries()].find(([query]) => query.includes("any-pointer"))?.[1];
    assert.ok(fineQuery);
    fineQuery.matches = false;
    fineQuery.listeners.forEach((listener) => listener());
    assert.deepEqual(firstSnapshots.at(-1), { fine: false, reduced: false });
    assert.deepEqual(secondSnapshots.at(-1), { fine: false, reduced: false });

    const reducedQuery = [...queries.entries()].find(([query]) => query.includes("reduced-motion"))?.[1];
    assert.ok(reducedQuery);
    reducedQuery.matches = true;
    reducedQuery.listeners.forEach((listener) => listener());
    assert.deepEqual(firstSnapshots.at(-1), { fine: false, reduced: true });
    assert.deepEqual(secondSnapshots.at(-1), { fine: false, reduced: true });

    unsubscribeFirst();
    assert.deepEqual([...queries.values()].map((query) => query.listeners.size), [1, 1]);
    unsubscribeSecond();
    assert.deepEqual([...queries.values()].map((query) => query.listeners.size), [0, 0]);
});
