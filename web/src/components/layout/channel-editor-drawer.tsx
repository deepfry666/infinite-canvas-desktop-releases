import { Button, Drawer, Input, Modal, Select, Space } from "antd";
import { ChevronDown, ListPlus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ChannelModelAdapterMode, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { APIMART_GPT_IMAGE_PRESET, GEMINI_PRESET, OPENAI_COMPATIBLE_PRESET } from "@/services/provider/presets";
import { detectProviderPreset } from "@/lib/model-onboarding";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type AdapterEditorMode = "inherit" | "preset" | "declarative" | "script";
type AdapterTarget = { name: string; mode: AdapterEditorMode; preset: string; mapping: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [adapterTarget, setAdapterTarget] = useState<AdapterTarget | null>(null);
    const [adapterMappingError, setAdapterMappingError] = useState("");
    const [mappingError, setMappingError] = useState("");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: t("config.protocols.ark"), value: "ark" },
    ];
    const adapterModeOptions: Array<{ label: string; value: Exclude<ChannelModelAdapterMode, "script"> }> = [
        { label: t("config.channelEditor.adapterPreset"), value: "preset" },
        { label: t("config.channelEditor.adapterDeclarative"), value: "declarative" },
    ];
    const adapterPresetOptions = [
        { label: t("config.channelEditor.presetOpenAi"), value: OPENAI_COMPATIBLE_PRESET, description: t("config.channelEditor.presetOpenAiDescription") },
        { label: t("config.channelEditor.presetApimart"), value: APIMART_GPT_IMAGE_PRESET, description: t("config.channelEditor.presetApimartDescription") },
        { label: t("config.channelEditor.presetGemini"), value: GEMINI_PRESET, description: t("config.channelEditor.presetGeminiDescription") },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) {
            setDraft(channel);
            setMappingError("");
            setAdvancedOpen(false);
        }
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl, adapterMode: draft.adapterMode || "preset", adapterPreset: apiFormat === "gemini" ? "gemini" : "openai-compatible" });
    };
    const detectAdapter = () => {
        if (!draft.baseUrl.trim()) return;
        patch(detectProviderPreset(draft.baseUrl));
    };
    const selectAdapterPreset = (adapterPreset: string) => patch({ apiFormat: adapterPreset === GEMINI_PRESET ? "gemini" : "openai", adapterMode: "preset", adapterPreset });

    const applySelection = (names: string[], capabilities: Record<string, ModelCapability> = {}) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: capabilities[name] || guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) =>
        setModels(draft.models.map((model) => (model.name === name ? (script ? { ...model, script, adapterMode: "script" as const } : { ...model, script: undefined, adapterMode: undefined, adapterPreset: undefined, adapterMapping: undefined }) : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));
    const openAdapterEditor = (model: ChannelModel) => {
        setAdapterMappingError("");
        setAdapterTarget({ name: model.name, mode: model.adapterMode || (model.script ? "script" : "inherit"), preset: model.adapterPreset || draft.adapterPreset || OPENAI_COMPATIBLE_PRESET, mapping: model.adapterMapping || draft.adapterMapping || "" });
    };
    const adapterLabel = (model: ChannelModel) => {
        if (model.script) return t("config.channelEditor.modelAdapterScript");
        if (!model.adapterMode) return t("config.channelEditor.modelAdapterInherited");
        if (model.adapterMode === "declarative") return t("config.channelEditor.modelAdapterDeclarative");
        return adapterPresetOptions.find((option) => option.value === model.adapterPreset)?.label || t("config.channelEditor.modelAdapterPreset");
    };
    const saveModelAdapter = () => {
        if (!adapterTarget || adapterTarget.mode === "script") {
            setAdapterTarget(null);
            return;
        }
        if (adapterTarget.mode === "declarative") {
            try {
                const parsed = JSON.parse(adapterTarget.mapping);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.endpoints || typeof parsed.endpoints !== "object") throw new Error();
            } catch {
                setAdapterMappingError(t("config.channelEditor.modelAdapterMappingInvalid"));
                return;
            }
        }
        setModels(
            draft.models.map((model) => {
                if (model.name !== adapterTarget.name) return model;
                if (adapterTarget.mode === "inherit") return { ...model, script: undefined, adapterMode: undefined, adapterPreset: undefined, adapterMapping: undefined };
                if (adapterTarget.mode === "preset") return { ...model, script: undefined, adapterMode: "preset", adapterPreset: adapterTarget.preset || OPENAI_COMPATIBLE_PRESET, adapterMapping: undefined };
                return { ...model, script: undefined, adapterMode: "declarative", adapterPreset: undefined, adapterMapping: adapterTarget.mapping.trim() };
            }),
        );
        setAdapterTarget(null);
    };

    const save = () => {
        if (draft.adapterMode === "declarative" && draft.adapterMapping?.trim()) {
            try {
                JSON.parse(draft.adapterMapping);
            } catch {
                setMappingError(t("config.channelEditor.adapterMappingInvalid"));
                return;
            }
        }
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            size={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="mb-5 rounded-lg border border-border bg-muted/45 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4" />
                    {t("config.channelEditor.quickSetup")}
                </div>
                <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
                    {["connection", "models", "purpose"].map((step, index) => (
                        <div key={step} className="flex items-center gap-2">
                            <span className="type-numeric grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[12px] text-primary-foreground">{index + 1}</span>
                            {t(`config.channelEditor.steps.${step}`)}
                        </div>
                    ))}
                </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} onBlur={detectAdapter} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.adapterPresetLabel")}</span>
                    <Select className="w-full" value={draft.adapterPreset || OPENAI_COMPATIBLE_PRESET} options={adapterPresetOptions} onChange={selectAdapterPreset} />
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {adapterPresetOptions.find((option) => option.value === (draft.adapterPreset || OPENAI_COMPATIBLE_PRESET))?.description}
                    </span>
                </label>
                <div className="flex items-center justify-between gap-3 md:col-span-2">
                    <div className="text-xs leading-5 text-muted-foreground">{t("config.channelEditor.simpleAdapter", { adapter: adapterPresetOptions.find((option) => option.value === (draft.adapterPreset || OPENAI_COMPATIBLE_PRESET))?.label })}</div>
                    <Button type="text" size="small" icon={<ChevronDown className={`size-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />} onClick={() => setAdvancedOpen((value) => !value)}>
                        {t("config.channelEditor.advanced")}
                    </Button>
                </div>
                {advancedOpen ? (
                    <>
                        <label className="block md:col-span-2">
                            <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.adapterMode")}</span>
                            <Select className="w-full" value={draft.adapterMode || "preset"} options={adapterModeOptions} onChange={(value) => patch({ adapterMode: value })} />
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("config.channelEditor.adapterDescription")}</span>
                        </label>
                        {draft.adapterMode === "declarative" ? (
                            <label className="block md:col-span-2">
                                <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.adapterMapping")}</span>
                                <Input.TextArea
                                    rows={9}
                                    value={draft.adapterMapping || ""}
                                    onChange={(event) => {
                                        setMappingError("");
                                        patch({ adapterMapping: event.target.value });
                                    }}
                                    placeholder={t("config.channelEditor.adapterMappingPlaceholder")}
                                    spellCheck={false}
                                />
                                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("config.channelEditor.adapterMappingDescription")}</span>
                                {mappingError ? <span className="mt-1 block text-xs text-destructive">{mappingError}</span> : null}
                            </label>
                        ) : null}
                    </>
                ) : null}
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="type-section-title">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)} disabled={!draft.baseUrl.trim() || !draft.apiKey.trim()}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-card/25 p-2">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Select size="small" className="w-28" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value)} />
                                {advancedOpen ? (
                                    <Button
                                        size="small"
                                        type={model.adapterMode || model.script ? "primary" : "default"}
                                        ghost={Boolean(model.adapterMode || model.script)}
                                        icon={<Settings2 className="size-3.5" />}
                                        onClick={() => openAdapterEditor(model)}
                                        title={t("config.channelEditor.modelAdapterTitle")}
                                    >
                                        {adapterLabel(model)}
                                    </Button>
                                ) : null}
                                {advancedOpen ? (
                                    <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                        {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                    </Button>
                                ) : null}
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-muted-foreground">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />

            <Modal open={Boolean(adapterTarget)} title={t("config.channelEditor.modelAdapterTitle")} onCancel={() => setAdapterTarget(null)} onOk={saveModelAdapter} okText={t("common.save")} cancelText={t("common.cancel")}>
                <div className="space-y-4">
                    <div className="text-xs leading-5 text-muted-foreground">{t("config.channelEditor.modelAdapterDescription")}</div>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.modelAdapterMode")}</span>
                        <Select
                            className="w-full"
                            value={adapterTarget?.mode}
                            options={[
                                { label: t("config.channelEditor.modelAdapterInherited"), value: "inherit" },
                                { label: t("config.channelEditor.adapterPreset"), value: "preset" },
                                { label: t("config.channelEditor.adapterDeclarative"), value: "declarative" },
                                { label: t("config.channelEditor.modelAdapterScript"), value: "script", disabled: true },
                            ]}
                            onChange={(mode: AdapterEditorMode) => {
                                setAdapterMappingError("");
                                setAdapterTarget((current) => (current ? { ...current, mode } : current));
                            }}
                        />
                    </label>
                    {adapterTarget?.mode === "preset" ? (
                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.adapterPresetLabel")}</span>
                            <Select className="w-full" value={adapterTarget.preset} options={adapterPresetOptions} onChange={(preset) => setAdapterTarget((current) => (current ? { ...current, preset } : current))} />
                        </label>
                    ) : null}
                    {adapterTarget?.mode === "declarative" ? (
                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.modelAdapterMapping")}</span>
                            <Input.TextArea
                                rows={10}
                                value={adapterTarget.mapping}
                                onChange={(event) => {
                                    setAdapterMappingError("");
                                    setAdapterTarget((current) => (current ? { ...current, mapping: event.target.value } : current));
                                }}
                                placeholder={t("config.channelEditor.adapterMappingPlaceholder")}
                                spellCheck={false}
                            />
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("config.channelEditor.modelAdapterMappingDescription")}</span>
                            {adapterMappingError ? <span className="mt-1 block text-xs text-destructive">{adapterMappingError}</span> : null}
                        </label>
                    ) : null}
                    {adapterTarget?.mode === "script" ? <div className="rounded-md border border-chart-3/30 bg-chart-3/10 px-3 py-2 text-xs leading-5 text-chart-3">{t("config.channelEditor.modelAdapterScriptHint")}</div> : null}
                </div>
            </Modal>
        </Drawer>
    );
}
