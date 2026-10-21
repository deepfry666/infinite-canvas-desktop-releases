import { ArrowRight, ChevronDown, Clapperboard, ImageIcon, Layers3, Plus } from "lucide-react";
import { Button, Image } from "antd";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useRouteNavigate } from "@/hooks/use-route-navigate";
import { useThumbnail } from "@/hooks/use-thumbnail";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";
import { BrandCursorField } from "./ink-cursor-trail";

type RecentResult = {
    id: string;
    title: string;
    url: string;
    updatedAt: string;
    source: "asset" | "canvas";
    projectId?: string;
    storageKey?: string;
};

const homeBackgroundStyle: CSSProperties = {
    backgroundImage: "radial-gradient(ellipse 68% 36% at 50% 0%, color-mix(in srgb, var(--foreground) 5%, transparent), transparent 74%)",
};

const HOME_INTRO_SESSION_KEY = "fourj-canvas:home-intro-played";

const logoMaskStyle: CSSProperties = {
    WebkitMaskImage: 'url("/logo.svg")',
    WebkitMaskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskImage: 'url("/logo.svg")',
    maskPosition: "center",
    maskRepeat: "no-repeat",
    maskSize: "contain",
};

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children?: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-px opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-normal text-foreground">{children}</span>
        </span>
    );
}

export default function IndexPage() {
    const { i18n, t } = useTranslation();
    const navigate = useRouteNavigate();
    const projectsHydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const assets = useAssetStore((state) => state.assets);
    const pageRef = useRef<HTMLElement>(null);
    const heroRef = useRef<HTMLElement>(null);
    const introBrandRef = useRef<HTMLDivElement>(null);
    const introPatternRef = useRef<HTMLDivElement>(null);
    const introDetailsRef = useRef<HTMLDivElement>(null);
    const introScrollRef = useRef<HTMLButtonElement>(null);
    const workspaceRef = useRef<HTMLDivElement>(null);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const recentProjects = useMemo(() => [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 3), [projects]);
    const recentResults = useMemo(() => collectRecentResults(projects, assets).slice(0, 8), [assets, projects]);
    const createAndOpen = () => {
        const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        navigate(`/canvas/${id}`);
    };

    useLayoutEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        try {
            if (window.sessionStorage.getItem(HOME_INTRO_SESSION_KEY)) return;
        } catch {
            // Storage may be unavailable; the intro can still play for this mount.
        }

        const brand = introBrandRef.current;
        const pattern = introPatternRef.current;
        const details = introDetailsRef.current;
        const scroll = introScrollRef.current;
        if (!brand || !pattern || !details || !scroll) return;

        const animations = [
            brand.animate(
                [{ opacity: 0, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0 0 0% 0)" }],
                { duration: 560, delay: 40, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
            ),
            pattern.animate(
                [{ opacity: 0, clipPath: "inset(48% 0 48% 0)" }, { opacity: 1, clipPath: "inset(0% 0 0% 0)" }],
                { duration: 650, delay: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
            ),
            details.animate(
                [{ opacity: 0, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0 0 0% 0)" }],
                { duration: 560, delay: 780, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
            ),
            scroll.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 1220, easing: "ease-out", fill: "both" }),
        ];
        let disposed = false;
        const markPlayedFrame = window.requestAnimationFrame(() => {
            try {
                window.sessionStorage.setItem(HOME_INTRO_SESSION_KEY, "1");
            } catch {
                // The animation remains safe when session storage is unavailable.
            }
        });
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
            if (!disposed) animations.forEach((animation) => animation.cancel());
        });
        return () => {
            disposed = true;
            window.cancelAnimationFrame(markPlayedFrame);
            animations.forEach((animation) => animation.cancel());
        };
    }, []);

    useEffect(() => {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (reducedMotion.matches) return;
        workspace.style.opacity = "0";
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                observer.disconnect();
                workspace.style.opacity = "1";
                const animation = workspace.animate(
                    [
                        { opacity: 0, transform: "translate3d(0, 12px, 0)" },
                        { opacity: 1, transform: "none" },
                    ],
                    { duration: 440, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
                );
                void animation.finished.then(() => animation.cancel()).catch(() => undefined);
            },
            { root: pageRef.current, threshold: 0.12 },
        );
        observer.observe(workspace);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const page = pageRef.current;
        if (!page) return;
        let hideTimer = 0;
        const revealScrollbar = () => {
            page.dataset.scrolling = "true";
            window.clearTimeout(hideTimer);
            hideTimer = window.setTimeout(() => delete page.dataset.scrolling, 900);
        };
        page.addEventListener("scroll", revealScrollbar, { passive: true });
        return () => {
            page.removeEventListener("scroll", revealScrollbar);
            window.clearTimeout(hideTimer);
        };
    }, []);

    return (
        <main ref={pageRef} data-route-focus-target tabIndex={-1} className="home-auto-scrollbar relative h-full scroll-smooth overflow-y-auto bg-background text-foreground outline-none" style={homeBackgroundStyle}>
            <section ref={heroRef} className="relative flex min-h-full select-none overflow-hidden px-6 py-16 text-center">
                <div ref={introPatternRef} className="pointer-events-none absolute inset-0">
                    <BrandCursorField containerRef={heroRef} />
                </div>
                <div className="relative z-[1] m-auto flex max-w-5xl flex-col items-center">
                    <div ref={introBrandRef} className="flex flex-col items-center">
                        <span aria-hidden="true" className="mb-7 size-16 bg-brand sm:size-20" style={logoMaskStyle} />
                        <h1 className="type-display text-balance text-[clamp(4rem,9vw,8.5rem)] !leading-none">{t("meta.title")}</h1>
                    </div>
                    <div ref={introDetailsRef} className="flex flex-col items-center">
                        <p className="type-display-latin mt-5 text-[clamp(1.1rem,2.3vw,1.8rem)] tracking-[0.06em] text-muted-foreground">FourJ Canvas</p>
                        <p data-home-description className="mt-8 max-w-3xl text-balance text-lg leading-8 text-muted-foreground sm:text-xl sm:leading-9">
                            <Trans
                                i18nKey="home.description"
                                components={{
                                    line: <span className="block" />,
                                    line2: <span className="mt-1 block" />,
                                    canvas: <Highlighter action="underline" color="var(--brand)" />,
                                    content: <Highlighter action="highlight" color="var(--brand-bg)" />,
                                }}
                            />
                        </p>
                        <div className="mt-10 grid w-full max-w-[36rem] gap-2 sm:grid-cols-3">
                            <Button type="primary" size="large" className="!h-11" icon={<Layers3 className="size-4" />} onClick={() => navigate("/canvas")}>{t("home.canvasEntry")}</Button>
                            <Button size="large" className="!h-11" icon={<ImageIcon className="size-4" />} onClick={() => navigate("/image")}>{t("navigation.image")}</Button>
                            <Button size="large" className="!h-11" icon={<Clapperboard className="size-4" />} onClick={() => navigate("/video")}>{t("navigation.video")}</Button>
                        </div>
                    </div>
                </div>
                <button ref={introScrollRef} type="button" onClick={() => document.getElementById("home-workspace")?.scrollIntoView({ behavior: "smooth" })} className="absolute bottom-5 left-1/2 z-[2] flex -translate-x-1/2 flex-col items-center gap-1 text-xs font-normal tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground" aria-label={t("home.continueTitle")}>
                    <span>SCROLL</span>
                    <ChevronDown className="size-4" />
                </button>
            </section>

            <div ref={workspaceRef} id="home-workspace" className="relative mx-auto max-w-7xl px-6 pb-20">

                <div className="grid min-h-[70vh] border-t border-border lg:grid-cols-[minmax(0,1fr)_20rem]">
                    <section className="py-10 lg:pr-10">
                        <SectionHeading title={t("home.continueTitle")} description={t("home.continueDescription")} action={t("home.allCanvases")} onAction={() => navigate("/canvas")} />
                        {!projectsHydrated ? (
                            <LoadingGrid />
                        ) : recentProjects.length ? (
                            <div
                                className={cn(
                                    "grid gap-3",
                                    recentProjects.length === 2 && "lg:grid-cols-2",
                                    recentProjects.length >= 3 && "lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)] lg:grid-rows-2",
                                )}
                            >
                                {recentProjects.map((project, index) => (
                                    <ProjectResumeCard key={project.id} project={project} emphasized={recentProjects.length >= 3 && index === 0} locale={i18n.resolvedLanguage} onOpen={() => navigate(`/canvas/${project.id}`)} />
                                ))}
                            </div>
                        ) : (
                            <EmptyWorkspace icon={<Layers3 className="size-5" />} title={t("home.noCanvasesTitle")} description={t("home.noCanvasesDescription")} action={t("home.newCanvas")} onAction={createAndOpen} />
                        )}
                    </section>

                    <aside className="border-t border-border py-10 lg:border-l lg:border-t-0 lg:pl-8">
                        <div className="mb-5 flex items-center gap-3">
                            <h2 className="type-section-title shrink-0">{t("workbench.new")}</h2>
                            <span aria-hidden="true" className="h-px flex-1 bg-border" />
                        </div>
                        <div>
                            <QuickCreateAction index="01" meta="CANVAS" label={t("home.newCanvas")} icon={<Layers3 className="size-4" />} onClick={createAndOpen} />
                            <QuickCreateAction index="02" meta="IMAGE" label={t("navigation.image")} icon={<ImageIcon className="size-4" />} onClick={() => navigate("/image")} />
                            <QuickCreateAction index="03" meta="VIDEO" label={t("navigation.video")} icon={<Clapperboard className="size-4" />} onClick={() => navigate("/video")} />
                        </div>
                    </aside>
                </div>

                <section className="border-t border-border py-10">
                    <SectionHeading title={t("home.recentResultsTitle")} description={t("home.recentResultsDescription")} action={t("home.allAssets")} onAction={() => navigate("/assets")} />
                    {!projectsHydrated || !assetsHydrated ? (
                        <LoadingGrid />
                    ) : recentResults.length ? (
                        <div className="grid auto-rows-[190px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {recentResults.map((item, index) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        setPreviewIndex(index);
                                        setPreviewOpen(true);
                                    }}
                                    className={cn(
                                        "group relative overflow-hidden rounded-xl border border-border bg-muted text-left outline-none transition-colors focus-visible:border-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/25",
                                        index === 0 && "sm:col-span-2 sm:row-span-2",
                                        index === 3 && "lg:col-span-2",
                                    )}
                                >
                                    <ThumbnailImage item={item} className="h-full w-full object-cover" />
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-4 text-white">
                                        <div className="flex items-center justify-between gap-3 text-white/65">
                                            <span className="type-label !text-[12px] text-white/65">{t(item.source === "asset" ? "home.fromAssets" : "home.fromCanvas")}</span>
                                            <span className="type-numeric !font-normal text-[12px] text-white/55">{formatDate(item.updatedAt, i18n.resolvedLanguage)}</span>
                                        </div>
                                        <div className="mt-1 truncate text-sm font-medium">{item.title}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <EmptyWorkspace icon={<ImageIcon className="size-5" />} title={t("home.noResultsTitle")} description={t("home.noResultsDescription")} action={t("home.openImageStudio")} onAction={() => navigate("/image")} />
                    )}
                </section>
            </div>

            <Image.PreviewGroup preview={{ open: previewOpen, current: previewIndex, onOpenChange: setPreviewOpen, onChange: setPreviewIndex }}>
                <div className="hidden">
                    {recentResults.map((item) => <Image key={item.id} src={item.url} alt={item.title} />)}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}

function SectionHeading({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
                <h2 className="type-section-title">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            <Button type="link" className="!px-0" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={onAction}>{action}</Button>
        </div>
    );
}

function QuickCreateAction({ index, meta, label, icon, onClick }: { index: string; meta: string; label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 border-t border-border py-4 text-left outline-none first:border-t-0 focus-visible:ring-2 focus-visible:ring-ring/25">
            <span className="type-numeric w-5 shrink-0 text-[12px] text-muted-foreground/65">{index}</span>
            <span className="grid size-10 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground transition-colors duration-200 group-hover:border-brand/55 group-hover:text-brand">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="type-label block !text-[12px] !tracking-[0.08em] text-muted-foreground/70">{meta}</span>
                <span className="mt-1 block truncate text-sm font-medium text-foreground">{label}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors duration-200 group-hover:text-foreground" />
        </button>
    );
}

function ProjectResumeCard({ project, emphasized, locale, onOpen }: { project: CanvasProject; emphasized: boolean; locale?: string; onOpen: () => void }) {
    const { t } = useTranslation();
    const images = projectImages(project).slice(0, emphasized ? 3 : 1);
    return (
        <button
            type="button"
            onClick={onOpen}
            className={cn(
                "group overflow-hidden rounded-2xl border border-border bg-background text-left outline-none transition-colors duration-200 hover:border-foreground/35 focus-visible:border-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/25",
                emphasized ? "min-h-72 lg:row-span-2" : "min-h-56 lg:flex lg:min-h-[152px]",
            )}
        >
            <div className={cn("grid h-28 grid-cols-3 gap-px overflow-hidden bg-muted", emphasized ? "lg:h-44" : "lg:h-auto lg:w-36 lg:shrink-0")}>
                {images.length ? images.map((item, index) => <ThumbnailImage key={`${item.id}-${index}`} item={item} className={cn("h-full w-full object-cover", images.length === 1 && "col-span-3")} />) : <div className="col-span-3 grid place-items-center text-muted-foreground/40"><Layers3 className="size-8" /></div>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-between p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="truncate text-lg font-medium">{project.title}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}</p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0" />
                </div>
                <p className="type-label mt-5 text-muted-foreground/70">{t("canvas.project.updated", { date: formatDate(project.updatedAt, locale) })}</p>
            </div>
        </button>
    );
}

function EmptyWorkspace({ icon, title, description, action, onAction }: { icon: ReactNode; title: string; description: string; action: string; onAction: () => void }) {
    return (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/60 px-6 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>
            <h3 className="mt-4 text-base font-semibold">{title}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
            <Button className="mt-5" icon={<Plus className="size-4" />} onClick={onAction}>{action}</Button>
        </div>
    );
}

function LoadingGrid() {
    return <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-56 animate-pulse rounded-2xl bg-muted" />)}</div>;
}

function ThumbnailImage({ item, className }: { item: RecentResult; className?: string }) {
    const url = useThumbnail(item.storageKey || `${item.id}:${item.updatedAt}`, item.url);
    return <img src={url} alt={item.title} className={className} />;
}

function collectRecentResults(projects: CanvasProject[], assets: Asset[]): RecentResult[] {
    const results: RecentResult[] = assets.flatMap((asset) => asset.kind === "image" && (asset.data.dataUrl || asset.coverUrl) ? [{ id: `asset:${asset.id}`, title: asset.title, url: asset.data.dataUrl || asset.coverUrl, storageKey: asset.data.storageKey, updatedAt: asset.updatedAt, source: "asset" as const }] : []);
    projects.forEach((project) => {
        project.nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Image) return;
            const images = node.metadata?.images?.filter((image) => image.status === "success" && image.content) || [];
            if (images.length) {
                images.forEach((image) => results.push({ id: `canvas:${project.id}:${node.id}:${image.id}`, title: node.title || project.title, url: image.content, storageKey: image.storageKey, updatedAt: project.updatedAt, source: "canvas", projectId: project.id }));
                return;
            }
            if (node.metadata?.status === "success" && node.metadata.content) results.push({ id: `canvas:${project.id}:${node.id}`, title: node.title || project.title, url: node.metadata.content, storageKey: node.metadata.storageKey, updatedAt: project.updatedAt, source: "canvas", projectId: project.id });
        });
    });
    const seen = new Set<string>();
    return results
        .filter((item) => {
            if (!item.url || seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function projectImages(project: CanvasProject) {
    return collectRecentResults([project], []);
}

function formatDate(value: string, locale?: string) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
