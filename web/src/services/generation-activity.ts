const activity = new Map<string, number>();

export function setGenerationActivity(source: string, count: number) {
    if (count > 0) activity.set(source, count);
    else activity.delete(source);
    if (typeof window !== "undefined") window.infiniteCanvasDesktop?.setActiveGenerationCount(Array.from(activity.values()).reduce((total, value) => total + value, 0));
}
