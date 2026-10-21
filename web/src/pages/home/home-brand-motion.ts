export type Point = { x: number; y: number };

export type BrandCell = {
    id: string;
    index: number;
    row: number;
    column: number;
    char: string;
    isGlyph: boolean;
};

export type IdleCandidate = Pick<BrandCell, "index" | "row" | "column"> & Point;

export const BRAND_ROW_COUNT = 9;
export const BRAND_REPEAT_COUNT = 10;
export const BRAND_WORD = "FOURJ";

// `white-space: nowrap` collapsed the former two-space separator to one visible gap.
const rowText = Array.from({ length: BRAND_REPEAT_COUNT }, () => BRAND_WORD).join(" ");

export const brandGrid: readonly (readonly BrandCell[])[] = Array.from({ length: BRAND_ROW_COUNT }, (_, row) =>
    Array.from(rowText, (char, column) => ({
        id: `r${row}-c${column}`,
        index: row * rowText.length + column,
        row,
        column,
        char,
        isGlyph: char !== " ",
    })),
);

export function createSeededRandom(seed: number) {
    let value = seed || 0x6d2b79f5;
    return () => {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        return (value >>> 0) / 4294967296;
    };
}

function distance(left: Point, right: Point) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}

export function pickIdleCandidate(
    candidates: readonly IdleCandidate[],
    active: ReadonlySet<number>,
    cooldownUntil: ReadonlyMap<number, number>,
    recent: readonly number[],
    now: number,
    minDistance: number,
    random: () => number,
) {
    const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
    const activeCandidates = [...active].map((index) => byIndex.get(index)).filter((candidate): candidate is IdleCandidate => Boolean(candidate));
    const recentCandidates = recent.slice(-3).map((index) => byIndex.get(index)).filter((candidate): candidate is IdleCandidate => Boolean(candidate));
    const available = candidates.filter((candidate) => !active.has(candidate.index) && (cooldownUntil.get(candidate.index) || 0) <= now && activeCandidates.every((item) => distance(candidate, item) >= minDistance));
    const dispersed = available.filter((candidate) => recentCandidates.every((item) => distance(candidate, item) >= minDistance * 0.72));
    const pool = dispersed.length ? dispersed : available;
    return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : null;
}

export function createIdlePulse(random: () => number, goldAllowed: boolean) {
    const gold = goldAllowed && random() < 0.1;
    return {
        gold,
        peakOpacity: gold ? 0.075 + random() * 0.025 : 0.125 + random() * 0.045,
        duration: 2500 + random() * 1500,
    };
}

type MotionNode = { position: Point; velocity: Point };

export type PointerMotionState = {
    target: Point;
    core: MotionNode;
    body: MotionNode;
    inputVelocity: Point;
    inputDirection: Point;
    direction: Point;
    turnMemory: Point;
    speed: number;
    stretch: number;
    geometry: {
        coreFront: Point;
        coreBack: Point;
        bodyFront: Point;
        bodyBack: Point;
        coreFrontRadius: number;
        coreBackRadius: number;
        bodyFrontRadius: number;
        bodyBackRadius: number;
    };
};

export function createPointerMotionState(x: number, y: number): PointerMotionState {
    return {
        target: { x, y },
        core: { position: { x, y }, velocity: { x: 0, y: 0 } },
        body: { position: { x, y }, velocity: { x: 0, y: 0 } },
        inputVelocity: { x: 0, y: 0 },
        inputDirection: { x: 1, y: 0 },
        direction: { x: 1, y: 0 },
        turnMemory: { x: 0, y: 0 },
        speed: 0,
        stretch: 0,
        geometry: {
            coreFront: { x, y },
            coreBack: { x, y },
            bodyFront: { x, y },
            bodyBack: { x, y },
            coreFrontRadius: 215,
            coreBackRadius: 188,
            bodyFrontRadius: 380,
            bodyBackRadius: 344,
        },
    };
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

export function updatePointerTarget(state: PointerMotionState, x: number, y: number, elapsedSeconds: number) {
    const elapsed = clamp(elapsedSeconds, 0.008, 0.12);
    const sampleX = clamp((x - state.target.x) / elapsed, -1600, 1600);
    const sampleY = clamp((y - state.target.y) / elapsed, -1600, 1600);
    const blend = 1 - Math.exp(-elapsed / 0.052);
    const oldDirectionX = state.inputDirection.x;
    const oldDirectionY = state.inputDirection.y;
    const oldSpeed = state.speed;
    const sampleSpeed = Math.hypot(sampleX, sampleY);
    state.inputVelocity.x += (sampleX - state.inputVelocity.x) * blend;
    state.inputVelocity.y += (sampleY - state.inputVelocity.y) * blend;
    state.speed = Math.hypot(state.inputVelocity.x, state.inputVelocity.y);

    if (sampleSpeed > 45) {
        const nextDirectionX = sampleX / sampleSpeed;
        const nextDirectionY = sampleY / sampleSpeed;
        const dot = oldDirectionX * nextDirectionX + oldDirectionY * nextDirectionY;
        if (oldSpeed > 220 && sampleSpeed > 220 && dot < 0.25) {
            const severity = clamp((0.25 - dot) / 1.25, 0, 1);
            const pull = Math.min(26, oldSpeed * 0.018) * severity;
            state.turnMemory.x += oldDirectionX * pull;
            state.turnMemory.y += oldDirectionY * pull;
        }
        state.inputDirection.x = nextDirectionX;
        state.inputDirection.y = nextDirectionY;
        const directionBlend = 1 - Math.exp(-elapsed / 0.045);
        const currentAngle = Math.atan2(state.direction.y, state.direction.x);
        const nextAngle = Math.atan2(nextDirectionY, nextDirectionX);
        const angleDelta = ((nextAngle - currentAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const angle = currentAngle + angleDelta * directionBlend;
        state.direction.x = Math.cos(angle);
        state.direction.y = Math.sin(angle);
    }
    state.target.x = x;
    state.target.y = y;
}

function stepNode(node: MotionNode, targetX: number, targetY: number, smoothTime: number, elapsed: number) {
    const omega = 2 / smoothTime;
    const value = omega * elapsed;
    const decay = 1 / (1 + value + 0.48 * value * value + 0.235 * value * value * value);
    const changeX = node.position.x - targetX;
    const changeY = node.position.y - targetY;
    const temporaryX = (node.velocity.x + omega * changeX) * elapsed;
    const temporaryY = (node.velocity.y + omega * changeY) * elapsed;
    node.velocity.x = (node.velocity.x - omega * temporaryX) * decay;
    node.velocity.y = (node.velocity.y - omega * temporaryY) * decay;
    node.position.x = targetX + (changeX + temporaryX) * decay;
    node.position.y = targetY + (changeY + temporaryY) * decay;
}

const smoothstep = (minimum: number, maximum: number, value: number) => {
    const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
};

export function advancePointerMotion(state: PointerMotionState, elapsedSeconds: number, secondsSinceInput: number) {
    const elapsed = clamp(elapsedSeconds, 1 / 240, 0.05);
    if (secondsSinceInput > 0.045) {
        const velocityDecay = Math.exp(-elapsed / 0.075);
        state.inputVelocity.x *= velocityDecay;
        state.inputVelocity.y *= velocityDecay;
    }
    const turnDecay = Math.exp(-elapsed / 0.12);
    state.turnMemory.x *= turnDecay;
    state.turnMemory.y *= turnDecay;
    state.speed = Math.hypot(state.inputVelocity.x, state.inputVelocity.y);

    stepNode(state.core, state.target.x - state.inputVelocity.x * 0.004, state.target.y - state.inputVelocity.y * 0.004, 0.11, elapsed);
    stepNode(state.body, state.target.x - state.inputVelocity.x * 0.016 + state.turnMemory.x, state.target.y - state.inputVelocity.y * 0.016 + state.turnMemory.y, 0.235, elapsed);

    const targetStretch = smoothstep(120, 1300, state.speed);
    state.stretch += (targetStretch - state.stretch) * (1 - Math.exp(-elapsed / 0.075));
    const coreSeparation = state.stretch * 28;
    const bodySeparation = state.stretch * 68;
    const directionX = state.direction.x;
    const directionY = state.direction.y;
    const geometry = state.geometry;

    geometry.coreFront.x = state.core.position.x + directionX * coreSeparation * 0.55;
    geometry.coreFront.y = state.core.position.y + directionY * coreSeparation * 0.55;
    geometry.coreBack.x = state.core.position.x - directionX * coreSeparation * 0.45 + state.turnMemory.x * 0.08;
    geometry.coreBack.y = state.core.position.y - directionY * coreSeparation * 0.45 + state.turnMemory.y * 0.08;
    geometry.bodyFront.x = state.body.position.x + directionX * bodySeparation * 0.4;
    geometry.bodyFront.y = state.body.position.y + directionY * bodySeparation * 0.4;
    geometry.bodyBack.x = state.body.position.x - directionX * bodySeparation * 0.6 + state.turnMemory.x * 0.45;
    geometry.bodyBack.y = state.body.position.y - directionY * bodySeparation * 0.6 + state.turnMemory.y * 0.45;
    geometry.coreFrontRadius = 215 + state.stretch * 10;
    geometry.coreBackRadius = 188 + state.stretch * 8;
    geometry.bodyFrontRadius = 380 + state.stretch * 20;
    geometry.bodyBackRadius = 344 + state.stretch * 14;
}

export function isPointerMotionSettled(state: PointerMotionState) {
    const targetDistance = Math.hypot(state.target.x - state.core.position.x, state.target.y - state.core.position.y) + Math.hypot(state.target.x - state.body.position.x, state.target.y - state.body.position.y);
    const velocity = Math.hypot(state.core.velocity.x, state.core.velocity.y) + Math.hypot(state.body.velocity.x, state.body.velocity.y) + state.speed;
    return targetDistance < 0.9 && velocity < 7 && state.stretch < 0.012 && Math.hypot(state.turnMemory.x, state.turnMemory.y) < 0.12;
}

export type VisualPhase = "idle" | "handoff" | "tracking" | "settling" | "paused";

export type BrandVisualState = {
    phase: VisualPhase;
    idleOpacity: number;
    coreOpacity: number;
    bodyOpacity: number;
    settlingElapsed: number;
};

export function createBrandVisualState(): BrandVisualState {
    return { phase: "idle", idleOpacity: 1, coreOpacity: 0, bodyOpacity: 0, settlingElapsed: 0 };
}

export function beginPointerVisual(state: BrandVisualState) {
    state.phase = state.idleOpacity > 0.001 ? "handoff" : "tracking";
    state.settlingElapsed = 0;
}

export function beginSettlingVisual(state: BrandVisualState) {
    if (state.phase === "paused" || state.phase === "idle") return;
    state.phase = "settling";
    state.settlingElapsed = 0;
}

export function pauseBrandVisual(state: BrandVisualState) {
    state.phase = "paused";
    state.idleOpacity = 0;
    state.coreOpacity = 0;
    state.bodyOpacity = 0;
    state.settlingElapsed = 0;
}

const moveToward = (current: number, target: number, maximumDelta: number) => current < target ? Math.min(target, current + maximumDelta) : Math.max(target, current - maximumDelta);

export function advanceBrandVisual(state: BrandVisualState, elapsedSeconds: number, motionSettled: boolean) {
    const elapsed = clamp(elapsedSeconds, 1 / 240, 0.05);
    const previousPhase = state.phase;
    if (state.phase === "idle") {
        state.idleOpacity = moveToward(state.idleOpacity, 1, elapsed / 0.38);
        state.coreOpacity = moveToward(state.coreOpacity, 0, elapsed / 0.24);
        state.bodyOpacity = moveToward(state.bodyOpacity, 0, elapsed / 0.32);
    } else if (state.phase === "handoff") {
        state.idleOpacity = moveToward(state.idleOpacity, 0, elapsed / 0.4);
        const pointerEnergy = clamp(1 - state.idleOpacity, 0, 1);
        state.coreOpacity = moveToward(state.coreOpacity, pointerEnergy, elapsed / 0.18);
        state.bodyOpacity = moveToward(state.bodyOpacity, pointerEnergy, elapsed / 0.26);
        if (state.idleOpacity <= 0.0001) {
            state.idleOpacity = 0;
            state.phase = "tracking";
        }
    } else if (state.phase === "tracking") {
        state.idleOpacity = 0;
        state.coreOpacity = moveToward(state.coreOpacity, 1, elapsed / 0.18);
        state.bodyOpacity = moveToward(state.bodyOpacity, 1, elapsed / 0.26);
    } else if (state.phase === "settling") {
        state.settlingElapsed += elapsed;
        state.idleOpacity = moveToward(state.idleOpacity, 0, elapsed / 0.22);
        const mayExit = state.settlingElapsed >= 0.12 && (motionSettled || state.settlingElapsed >= 0.3);
        if (mayExit) {
            state.coreOpacity = moveToward(state.coreOpacity, 0, elapsed / 0.28);
            state.bodyOpacity = moveToward(state.bodyOpacity, 0, elapsed / 0.38);
        }
        if (state.coreOpacity === 0 && state.bodyOpacity === 0 && state.idleOpacity === 0) {
            state.phase = "idle";
            state.settlingElapsed = 0;
        }
    }
    return { enteredIdle: previousPhase !== "idle" && state.phase === "idle", finishedHandoff: previousPhase === "handoff" && state.phase === "tracking" };
}
