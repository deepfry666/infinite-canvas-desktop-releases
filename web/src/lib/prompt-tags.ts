type PromptTagContext = { author?: string; sourceName?: string; sourceId?: string };

export function sanitizePromptTags(tags: string[], context: PromptTagContext = {}) {
    const excluded = new Set([context.author, context.sourceName, context.sourceId].map(normalizeTag).filter(Boolean));
    const seen = new Set<string>();
    return tags.flatMap((value) => {
        const tag = value.trim();
        const normalized = normalizeTag(tag);
        if (!tag || seen.has(normalized) || excluded.has(normalized) || /^@|^(?:作者|author)\s*[:：]|^by\s+/i.test(tag)) return [];
        seen.add(normalized);
        return [tag];
    }).slice(0, 8);
}

export function collectPopularPromptTags(items: Array<{ tags: string[] }>, limit = 24) {
    const counts = new Map<string, { count: number; index: number }>();
    items.forEach((item) => item.tags.forEach((tag) => {
        const current = counts.get(tag);
        counts.set(tag, { count: (current?.count || 0) + 1, index: current?.index ?? counts.size });
    }));
    return [...counts.entries()].sort((left, right) => right[1].count - left[1].count || left[1].index - right[1].index).slice(0, limit).map(([tag]) => tag);
}

function normalizeTag(value?: string) {
    return (value || "").trim().replace(/^@/, "").toLocaleLowerCase();
}
