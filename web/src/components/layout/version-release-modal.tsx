import type { CSSProperties } from "react";
import { Modal, Tag, Timeline, theme as antdTheme } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useVersionCheck } from "@/hooks/use-version-check";
import { APP_DISPLAY_VERSION, APP_VERSION, formatAppVersion } from "@/constant/env";

type AppToken = ReturnType<typeof antdTheme.useToken>["token"];

function releaseTagStyle(type: string, token: AppToken): CSSProperties {
    const color =
        type === "新增" || type === "Added"
            ? token.colorSuccess
            : type === "修复" || type === "Fixed"
              ? token.colorError
              : type === "调整" || type === "Changed"
                ? token.colorWarning
                : type === "优化" || type === "Optimized"
                  ? token.colorPrimary
                  : token.colorTextSecondary;
    return { color, borderColor: color, background: token.colorFillAlter };
}

function releaseTypeLabel(type: string, t: TFunction) {
    const key = ({ 新增: "added", 修复: "fixed", 调整: "changed", 优化: "optimized", 文档: "docs" } as Record<string, string>)[type];
    return key ? t(`version.types.${key}`) : type;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { t } = useTranslation();
    const { token } = antdTheme.useToken();
    const { open, setOpen, openReleaseModal, latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck();
    const neutralTagStyle = { color: token.colorTextSecondary, borderColor: token.colorBorderSecondary, background: token.colorFillAlter };
    const latestTagStyle = { color: token.colorSuccess, borderColor: token.colorSuccess, background: token.colorFillAlter };

    return (
        <>
            <button
                type="button"
                className={className || "type-numeric shrink-0 cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"}
                style={style}
                onClick={openReleaseModal}
                title={t("version.viewUpdates")}
            >
                <span className="relative inline-flex">
                    {APP_DISPLAY_VERSION}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full" style={{ background: token.colorSuccess }} /> : null}
                </span>
            </button>
            <Modal title={t("version.title")} open={open} width={680} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="mb-5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border p-3.5" style={{ background: token.colorFillAlter, borderColor: token.colorBorderSecondary }}>
                        <div className="type-label" style={{ color: token.colorTextSecondary }}>{t("version.currentVersion")}</div>
                        <div className="type-numeric mt-1.5 text-base" style={{ color: token.colorText }}>{APP_DISPLAY_VERSION}</div>
                    </div>
                    <div className="rounded-xl border p-3.5" style={{ background: token.colorFillAlter, borderColor: token.colorBorderSecondary }}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="type-label" style={{ color: token.colorTextSecondary }}>{t("version.latestVersion")}</div>
                            <button
                                type="button"
                                className="cursor-pointer rounded-md bg-transparent px-1.5 py-1 text-[13px] font-normal transition-colors hover:bg-muted/70"
                                style={{ color: token.colorTextSecondary }}
                                onClick={() => void checkLatestRelease(true)}
                            >
                                {t(checking ? "version.checking" : "version.checkUpdates")}
                            </button>
                        </div>
                        <div className="type-numeric mt-1.5 text-base" style={{ color: token.colorText }}>{formatAppVersion(latestVersion)}</div>
                    </div>
                </div>
                <div className="thin-scrollbar max-h-[56vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            color: release.version === latestVersion ? token.colorSuccess : token.colorBorder,
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="type-numeric text-sm" style={{ color: token.colorText }}>{release.version === "Unreleased" ? t("version.unreleased") : formatAppVersion(release.version)}</span>
                                        <span className="type-numeric text-xs" style={{ color: token.colorTextSecondary }}>{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <Tag className="m-0" style={latestTagStyle}>{t("version.latest")}</Tag> : null}
                                            {release.version === APP_VERSION ? <Tag className="m-0" style={neutralTagStyle}>{t("version.current")}</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="type-body flex items-start gap-2" style={{ color: token.colorTextSecondary }}>
                                                <Tag className="m-0 mt-0.5 shrink-0 whitespace-nowrap" style={releaseTagStyle(item.type, token)}>
                                                    {releaseTypeLabel(item.type, t)}
                                                </Tag>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
            </Modal>
        </>
    );
}
