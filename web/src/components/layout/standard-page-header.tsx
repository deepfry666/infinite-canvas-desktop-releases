import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function StandardPageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
    return (
        <header className={cn("shrink-0 border-b border-border py-6 lg:py-8", className)}>
            <div className="flex flex-wrap items-end justify-between gap-5">
                <div className="min-w-0 max-w-3xl">
                    <h1 className="type-page-title">{title}</h1>
                    {description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p> : null}
                </div>
                {actions ? <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">{actions}</div> : null}
            </div>
        </header>
    );
}
