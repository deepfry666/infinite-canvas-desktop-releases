import { Modal } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export function AppShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();

    useEffect(() => {
        if (!open) return;

        const attribute = "data-canvas-shortcuts-ignore";
        const hadAttribute = document.body.hasAttribute(attribute);
        const previousValue = document.body.getAttribute(attribute);
        document.body.setAttribute(attribute, "");

        return () => {
            if (hadAttribute) document.body.setAttribute(attribute, previousValue ?? "");
            else document.body.removeAttribute(attribute);
        };
    }, [open]);

    return (
        <Modal title={t("topNav.shortcuts")} open={open} onCancel={onClose} footer={null} centered width={680}>
            <div className="grid gap-8 pt-2 sm:grid-cols-[0.72fr_1.28fr]" data-canvas-shortcuts-ignore>
                <section>
                    <h2 className="type-label mb-3 text-muted-foreground">{t("topNav.shortcutGlobal")}</h2>
                    <div className="divide-y divide-border border-y border-border">
                        <ShortcutRow keys={["?"]} value={t("topNav.shortcutOpenPanel")} />
                        <ShortcutRow keys={["Esc"]} value={t("topNav.shortcutClosePanel")} />
                    </div>
                </section>
                <section>
                    <h2 className="type-label mb-3 text-muted-foreground">{t("topNav.shortcutCanvas")}</h2>
                    <div className="divide-y divide-border border-y border-border">
                        <ShortcutRow keys={["Ctrl / Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                        <ShortcutRow keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                        <ShortcutRow keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                        <ShortcutRow keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                        <ShortcutRow keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                        <ShortcutRow keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                        <ShortcutRow keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                    </div>
                </section>
            </div>
        </Modal>
    );
}

function ShortcutRow({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="flex min-h-12 items-center justify-between gap-4 py-2.5 text-sm">
            <span className="text-muted-foreground">{value}</span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {keys.map((key) => (
                    <kbd key={key} className="type-numeric rounded-md border border-border bg-muted/55 px-2 py-1 text-[12px] text-foreground">
                        {key}
                    </kbd>
                ))}
            </span>
        </div>
    );
}
