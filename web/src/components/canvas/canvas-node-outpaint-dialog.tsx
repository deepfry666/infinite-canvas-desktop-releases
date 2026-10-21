import { useEffect, useState } from "react";
import { Button, Input, Modal, Segmented } from "antd";
import { Expand } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageOutpaintParams = {
    ratio: string;
    prompt: string;
};

const ratios = ["1:1", "4:3", "3:2", "16:9", "9:16"];
const defaultParams: CanvasImageOutpaintParams = { ratio: "16:9", prompt: "" };

export function CanvasNodeOutpaintDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageOutpaintParams) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [params, setParams] = useState(defaultParams);

    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [dataUrl, open]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={820} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.editors.outpaintTitle")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.editors.outpaintDescription")}</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-lg border p-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                        <div className="grid max-h-[280px] w-full place-items-center overflow-hidden rounded-md border border-dashed" style={{ aspectRatio: ratioValue(params.ratio), borderColor: theme.node.muted }}>
                            <img src={dataUrl} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                        </div>
                    </div>
                    <div className="space-y-6 py-2">
                        <div className="space-y-2">
                            <div className="text-sm font-medium opacity-75">{t("canvas.editors.targetRatio")}</div>
                            <Segmented block value={params.ratio} options={ratios} onChange={(ratio) => setParams((current) => ({ ...current, ratio }))} />
                        </div>
                        <div className="space-y-2">
                            <div className="text-sm font-medium opacity-75">{t("canvas.editors.outpaintPrompt")}</div>
                            <Input.TextArea
                                value={params.prompt}
                                autoSize={{ minRows: 5, maxRows: 8 }}
                                maxLength={1200}
                                placeholder={t("canvas.editors.outpaintPlaceholder")}
                                onChange={(event) => setParams((current) => ({ ...current, prompt: event.target.value }))}
                            />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<Expand className="size-4" />} onClick={() => onConfirm(params)}>
                        {t("canvas.editors.outpaint")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function ratioValue(ratio: string) {
    const [width, height] = ratio.split(":").map(Number);
    return `${width || 1} / ${height || 1}`;
}
