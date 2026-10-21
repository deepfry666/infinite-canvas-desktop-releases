import { Drawer } from "antd";
import { BarChart3, Home, Settings2, Trash2, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { isPlainRouteClick, prepareRouteTransitionFromClick, shouldUseRouteTransition } from "@/hooks/use-route-navigate";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

type MobileNavItem = {
    path: string;
    label: string;
    icon: LucideIcon;
};

function isRouteActive(pathname: string, path: string) {
    return path === "/" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const activePathname = pathname || (activeToolSlug ? `/${activeToolSlug}` : "/");
    const toolItems = navigationTools.map<MobileNavItem>((tool) => ({ path: `/${tool.slug}`, label: t(`navigation.${tool.slug}`), icon: tool.icon }));
    const pickToolItems = (paths: string[]) => paths.flatMap((path) => toolItems.filter((item) => item.path === path));
    const groups = [
        {
            id: "creation",
            label: t("topNav.creationSection"),
            items: [{ path: "/", label: t("topNav.home"), icon: Home }, ...pickToolItems(["/canvas", "/image", "/video"])],
        },
        {
            id: "library",
            label: t("topNav.librarySection"),
            items: pickToolItems(["/assets", "/prompts", "/skills"]),
        },
        {
            id: "system",
            label: t("topNav.systemSection"),
            items: [
                { path: "/stats", label: t("topNav.imageStats"), icon: BarChart3 },
                { path: "/trash", label: t("navigation.trash"), icon: Trash2 },
                { path: "/config", label: t("navigation.config"), icon: Settings2 },
            ],
        },
    ];

    return (
        <Drawer
            title={
                <Link
                    to="/"
                    viewTransition={shouldUseRouteTransition("/", pathname)}
                    onClick={(event) => {
                        if (!isPlainRouteClick(event)) return;
                        onClose();
                        if (pathname === "/") event.preventDefault();
                        else prepareRouteTransitionFromClick(event, "/", pathname);
                    }}
                    aria-label={t("meta.fullTitle")}
                    className="flex min-w-0 items-center gap-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                    <span className="size-7 shrink-0 bg-brand" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    <span className="min-w-0 leading-none">
                        <span className="type-section-title block truncate text-[16px] !leading-none">{t("meta.title")}</span>
                        <span className="mt-1.5 block truncate font-sans text-[11px] font-normal tracking-[0.06em] text-muted-foreground">FOURJ CANVAS</span>
                    </span>
                </Link>
            }
            placement="left"
            size={280}
            open={open}
            onClose={onClose}
            className="md:hidden"
            styles={{ body: { padding: 12 } }}
        >
            <nav className="space-y-5" aria-label={t("topNav.navigation")}>
                {groups.map((group) => (
                    <section key={group.id} aria-labelledby={`mobile-nav-group-${group.id}`}>
                        <h2 id={`mobile-nav-group-${group.id}`} className="mb-1.5 px-2.5 text-[12px] font-normal tracking-[0.04em] text-muted-foreground/70">
                            {group.label}
                        </h2>
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const Icon = item.icon;
                                const active = isRouteActive(activePathname, item.path);
                                return (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        viewTransition={shouldUseRouteTransition(item.path, pathname)}
                                        onClick={(event) => {
                                            if (!isPlainRouteClick(event)) return;
                                            onClose();
                                            if (active) event.preventDefault();
                                            else prepareRouteTransitionFromClick(event, item.path, pathname);
                                        }}
                                        aria-current={active ? "page" : undefined}
                                        className={cn(
                                            "relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-current before:opacity-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                                            active ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:opacity-70" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                                        )}
                                    >
                                        <Icon className="size-[18px] shrink-0" strokeWidth={active ? 1.9 : 1.6} />
                                        <span className="truncate">{item.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </nav>
        </Drawer>
    );
}
