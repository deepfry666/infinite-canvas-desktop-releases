import { FolderPlus, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { useTranslation } from "react-i18next";

import { StandardPageHeader } from "@/components/layout/standard-page-header";
import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const { query, items: promptItems, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: [], category: ALL_PROMPTS_OPTION });

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success(t("common.addedToAssets"));
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background px-4 sm:px-6 lg:px-8" onScroll={handleListScroll}>
                <div className="mx-auto max-w-7xl">
                    <StandardPageHeader
                        title={t("prompts.title")}
                        description={t("prompts.total", { count: totalPrompts })}
                        actions={<Input className="w-full sm:w-[22rem]" size="large" prefix={<Search className="size-4 text-muted-foreground" />} value={titleKeyword} placeholder={t("prompts.search")} onChange={(event) => setTitleKeyword(event.target.value)} />}
                    />
                    <div className="mt-7">
                        <section className="min-w-0">
                            {query.isLoading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
                            {!query.isLoading ? <PromptGrid items={promptItems} onOpen={setSelectedPrompt} renderActions={(item) => <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>{t("common.addToAssets")}</Button>} onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))} emptyText={t("prompts.empty")} /> : null}
                            <div className="type-label mt-7 text-center text-muted-foreground">{query.isFetchingNextPage ? t("prompts.loading") : query.hasNextPage ? t("prompts.loadMore") : promptItems.length > 0 ? t("prompts.end") : null}</div>
                        </section>
                    </div>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={savePromptAsset} />
        </div>
    );
}

function PromptGrid({ items, onOpen, onCopy, renderActions, emptyText }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; renderActions: (item: Prompt) => ReactNode; emptyText: string }) {
    return <div><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />)}</div>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-16" /> : null}</div>;
}
