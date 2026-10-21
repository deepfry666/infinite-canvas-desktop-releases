import { Button, Modal } from "antd";
import { PanelsTopLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

const viewKeys = ["front", "side", "back"] as const;

export function CanvasNodeThreeViewDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={860} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.editors.threeViewTitle")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.editors.threeViewDescription")}</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    {viewKeys.map((view) => (
                        <div key={view} className="min-w-0 rounded-lg border p-2" style={{ borderColor: theme.node.stroke }}>
                            <div className="grid aspect-square place-items-center overflow-hidden rounded-md" style={{ background: theme.node.fill }}>
                                <img src={dataUrl} alt="" className="h-full w-full object-contain" draggable={false} />
                            </div>
                            <div className="pt-2 text-center text-sm font-medium">{t(`canvas.editors.threeView.${view}`)}</div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-5">
                    <span className="text-xs opacity-55">{t("canvas.editors.threeViewNotice")}</span>
                    <Button type="primary" size="large" icon={<PanelsTopLeft className="size-4" />} onClick={onConfirm}>
                        {t("canvas.editors.threeViewGenerate")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
