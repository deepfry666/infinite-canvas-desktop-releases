import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App, Button } from "antd";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { formatAppVersion } from "@/constant/env";
import { TASK_COMPLETION_EVENT, type TaskCompletionNotice } from "@/lib/task-completion-notification";
import { prepareRouteTransition } from "@/hooks/use-route-navigate";
import { router } from "@/router";

function navigateToRoute(route: string) {
    const target = new URL(route, window.location.origin);
    const nextRoute = `${target.pathname}${target.search}${target.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextRoute) return;
    const transaction = prepareRouteTransition(nextRoute);
    void router.navigate(nextRoute, { viewTransition: transaction?.driver === "view-transition" });
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message, modal, notification } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const promptedUpdate = useRef("");
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        window.infiniteCanvasDesktop?.setCloseBehavior(config.desktopCloseBehavior);
    }, [config.desktopCloseBehavior]);

    useEffect(() => {
        void window.infiniteCanvasDesktop?.setUpdatePreferences({
            autoCheck: config.desktopAutoUpdate,
            channel: config.desktopUpdateChannel,
        });
    }, [config.desktopAutoUpdate, config.desktopUpdateChannel]);

    useEffect(() => {
        const desktop = window.infiniteCanvasDesktop;
        if (!desktop) return;
        const handleUpdate = (state: DesktopUpdateState) => {
            if (state.status === "available" && promptedUpdate.current !== `available:${state.availableVersion}`) {
                promptedUpdate.current = `available:${state.availableVersion}`;
                modal.confirm({
                    title: t("desktopUpdate.availableTitle"),
                    content: t("desktopUpdate.availableDescription", { version: formatAppVersion(state.availableVersion) }),
                    okText: t("desktopUpdate.download"),
                    cancelText: t("desktopUpdate.later"),
                    onOk: () => void desktop.downloadUpdate(),
                });
            }
            if (state.status === "downloaded" && promptedUpdate.current !== `downloaded:${state.availableVersion}`) {
                promptedUpdate.current = `downloaded:${state.availableVersion}`;
                modal.confirm({
                    title: t("desktopUpdate.downloadedTitle"),
                    content: t("desktopUpdate.downloadedDescription", { version: formatAppVersion(state.availableVersion) }),
                    okText: t("desktopUpdate.restartInstall"),
                    cancelText: t("desktopUpdate.later"),
                    onOk: () => void desktop.installUpdate(),
                });
            }
        };
        void desktop.getUpdateState().then(handleUpdate);
        return desktop.onUpdateState(handleUpdate);
    }, [modal, t]);

    useEffect(() => {
        const desktop = window.infiniteCanvasDesktop;
        if (!desktop) return;
        return desktop.onUpdateCompleted(({ version }) => {
            message.success(t("desktopUpdate.completedDescription", { version: formatAppVersion(version) }));
        });
    }, [message, t]);

    useEffect(
        () =>
            window.infiniteCanvasDesktop?.onNavigate((route) => {
                navigateToRoute(route);
            }),
        [],
    );

    useEffect(() => {
        const handleTaskCompletion = (event: Event) => {
            const notice = (event as CustomEvent<TaskCompletionNotice>).detail;
            if (!notice?.route?.startsWith("/")) return;
            if (window.infiniteCanvasDesktop && !document.hasFocus()) return;
            const targetPath = new URL(notice.route, window.location.origin).pathname;
            if (window.location.pathname === targetPath) {
                message.success(notice.body);
                return;
            }
            const key = `task-completed:${notice.id}`;
            const openResult = () => {
                notification.destroy(key);
                navigateToRoute(notice.route);
            };
            notification.success({
                key,
                title: notice.title,
                description: notice.body,
                icon: <span aria-hidden="true" className="task-completion-mark" />,
                actions: (
                    <Button
                        type="text"
                        size="small"
                        icon={<ArrowRight className="size-3.5" />}
                        iconPlacement="end"
                        onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openResult();
                        }}
                    >
                        {t("taskNotifications.viewResult")}
                    </Button>
                ),
                className: "task-completion-notification",
                placement: "topRight",
                duration: 8,
                showProgress: true,
                pauseOnHover: true,
                role: "status",
                onClick: openResult,
            });
        };
        window.addEventListener(TASK_COMPLETION_EVENT, handleTaskCompletion);
        return () => window.removeEventListener(TASK_COMPLETION_EVENT, handleTaskCompletion);
    }, [message, notification, t]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: t("config.channels.defaultName"), baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success(t("config.importedDirectConfig"));
    }, [config.channels, message, openConfigDialog, t, updateConfig]);

    return <>{children}</>;
}
