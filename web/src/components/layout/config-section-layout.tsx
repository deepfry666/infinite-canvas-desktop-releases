import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ConfigChapter = {
    key: string;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    content?: ReactNode;
    hidden?: boolean;
};

export function ConfigSectionLayout({
    title,
    description,
    aside,
    chapters,
    className,
}: {
    title: ReactNode;
    description: ReactNode;
    aside?: ReactNode;
    chapters: ConfigChapter[];
    className?: string;
}) {
    const headingId = useId();
    const visibleChapters = chapters.filter((chapter) => !chapter.hidden);

    return (
        <div className={cn("min-w-0", className)}>
            <header className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
                <div className="min-w-0">
                    <h2 id={headingId} className="type-section-title">{title}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
                {aside ? <div className="w-full sm:w-auto sm:shrink-0">{aside}</div> : null}
            </header>

            <div aria-labelledby={headingId} className="space-y-8">
                {visibleChapters.map((chapter, index) => (
                    <section key={chapter.key} className={index ? "border-t border-border pt-8" : undefined}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex min-w-0 flex-1 gap-3">
                                <span aria-hidden="true" className="type-numeric mt-1 shrink-0 text-xs text-brand/70">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <div className="min-w-0">
                                    <h3 className="type-section-title !text-[19px]">{chapter.title}</h3>
                                    {chapter.description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{chapter.description}</p> : null}
                                </div>
                            </div>
                            {chapter.action ? <div className="w-full sm:w-auto sm:shrink-0">{chapter.action}</div> : null}
                        </div>
                        {chapter.content ? <div className="mt-4 min-w-0">{chapter.content}</div> : null}
                    </section>
                ))}
            </div>
        </div>
    );
}
