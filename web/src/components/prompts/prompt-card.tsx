import { Copy, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card } from "antd";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

const defaultActionIcon = <Copy className="size-3.5" />;

export function PromptCard({
    item,
    onOpen,
    onCopy,
    actionLabel,
    actionIcon = defaultActionIcon,
    actionType = "text",
    extraAction,
    compact = false,
}: {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
    compact?: boolean;
}) {
    const { i18n, t } = useTranslation();
    return (
        <Card
            hoverable
            className={compact ? "cursor-pointer overflow-hidden !border-border !bg-card !shadow-none transition-colors duration-200 hover:!border-foreground/30" : "flex h-full flex-col overflow-hidden !border-border !bg-card !shadow-none transition-colors duration-200 hover:!border-foreground/30"}
            styles={{ body: compact ? { padding: 0 } : { display: "flex", flex: 1, flexDirection: "column", padding: 0 } }}
            cover={
                <button type="button" className="block w-full cursor-pointer text-left" onClick={onOpen}>
                    {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className={compact ? "aspect-square w-full object-cover" : "aspect-[4/3] w-full object-cover"} loading="lazy" /> : <span className={compact ? "grid aspect-square w-full place-items-center bg-muted/35 text-muted-foreground/55" : "grid aspect-[4/3] w-full place-items-center bg-muted/35 text-muted-foreground/55"}><FileText className="size-8" /></span>}
                </button>
            }
        >
            <button type="button" className={compact ? "block w-full cursor-pointer text-left" : "block w-full flex-1 cursor-pointer text-left"} onClick={onOpen}>
                <div className={compact ? "px-3 py-2.5" : "p-4"}>
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-base font-semibold text-foreground">{item.title}</h2>
                        {!compact ? <span className="type-numeric shrink-0 text-xs text-muted-foreground/75">{formatPromptDate(item.updatedAt, i18n.resolvedLanguage)}</span> : null}
                    </div>
                    {!compact ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{item.description || item.prompt}</p> : null}
                </div>
            </button>
            {!compact ? <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border px-3 py-2.5"><Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>{actionLabel || t("common.copy")}</Button>{extraAction}</div> : null}
        </Card>
    );
}
