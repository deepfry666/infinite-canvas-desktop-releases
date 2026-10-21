import { Alert, App, Button, Dropdown, Empty, Input, Modal, Segmented, Select, Spin, Switch, Tag, Tooltip } from "antd";
import {
    Beaker,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    Copy,
    Download,
    FileInput,
    Heart,
    Images,
    PencilLine,
    Plus,
    Search,
    ShieldCheck,
    Sparkles,
    Trash2,
    Upload,
    Workflow,
    XCircle,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { StandardPageHeader } from "@/components/layout/standard-page-header";
import i18n from "@/i18n";
import { prepareCreativeSkillDraftFromExamplePair } from "@/lib/creative-skills/draft-sources";
import { extractCreativeSkillStyle } from "@/services/api/creative-skill-style-extraction";
import type { CreativeSkillDefinition, CreativeSkillDraft, CreativeSkillListItem, CreativeSkillPrepareInput, CreativeSkillTransferInspection } from "@/types/creative-skill";
import { cn } from "@/lib/utils";
import { modelOptionLabel, resolveModelForCapability, useConfigStore } from "@/stores/use-config-store";
import { useCreativeSkillStore } from "@/stores/use-creative-skill-store";
import { SkillRecipeEditorDrawer } from "./components/skill-recipe-editor-drawer";

type ScopeFilter = "all" | "builtin" | "personal" | "draft";
type StateFilter = "all" | "enabled" | "favorite";

type DefinitionReference = NonNullable<CreativeSkillDefinition["steps"][number]["references"]>[number];

export default function SkillsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const items = useCreativeSkillStore((state) => state.items);
    const selectedRecordId = useCreativeSkillStore((state) => state.selectedRecordId);
    const hydrated = useCreativeSkillStore((state) => state.hydrated);
    const loading = useCreativeSkillStore((state) => state.loading);
    const error = useCreativeSkillStore((state) => state.error);
    const inspection = useCreativeSkillStore((state) => state.transferInspection);
    const load = useCreativeSkillStore((state) => state.load);
    const select = useCreativeSkillStore((state) => state.select);
    const createDraft = useCreativeSkillStore((state) => state.createDraft);
    const createExampleDraft = useCreativeSkillStore((state) => state.createExampleDraft);
    const patchDraft = useCreativeSkillStore((state) => state.patchDraft);
    const prepareTransfer = useCreativeSkillStore((state) => state.prepareTransfer);
    const commitTransfer = useCreativeSkillStore((state) => state.commitTransfer);
    const clearTransfer = useCreativeSkillStore((state) => state.clearTransfer);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
    const [scope, setScope] = useState<ScopeFilter>("all");
    const [stateFilter, setStateFilter] = useState<StateFilter>("all");
    const [editorDraftId, setEditorDraftId] = useState<string>();
    const [examplePairOpen, setExamplePairOpen] = useState(false);
    const [action, setAction] = useState<string>();

    useEffect(() => { void load().catch(() => undefined); }, [load]);

    const visibleItems = useMemo(() => items.filter((item) => {
        if (scope === "draft" && item.lifecycle !== "draft") return false;
        if ((scope === "builtin" || scope === "personal") && item.ownership !== scope) return false;
        if (stateFilter === "enabled" && !item.enabled) return false;
        if (stateFilter === "favorite" && !item.favorite) return false;
        return !deferredQuery || `${item.name}\n${item.description}`.toLocaleLowerCase().includes(deferredQuery);
    }), [deferredQuery, items, scope, stateFilter]);
    const selected = visibleItems.find((item) => item.recordId === selectedRecordId) || visibleItems[0];
    const editorDraft = items.find((item) => item.recordId === editorDraftId)?.draft;

    const run = async (key: string, operation: () => Promise<void>) => {
        setAction(key);
        try {
            await operation();
        } catch (caught) {
            message.error(caught instanceof Error ? caught.message : t("creativeSkills.operationFailed"));
        } finally {
            setAction(undefined);
        }
    };
    const addDraft = () => run("new", async () => {
        const draft = await createDraft({ name: t("creativeSkills.newDraftName"), description: "", definition: emptyDefinition(t("creativeSkills.editor.userRequest")) });
        setEditorDraftId(draft.draftId);
    });
    const addExampleDraft = async (value: ExamplePairFormValue) => {
        setAction("examples");
        try {
            const [input, output] = await Promise.all([readExampleImage(value.input), readExampleImage(value.output)]);
            const prepared = prepareCreativeSkillDraftFromExamplePair({
                name: value.name,
                description: value.description,
                instruction: value.instruction,
                input: { sha256: input.sha256, mimeType: input.mimeType, bytes: input.data.byteLength },
                output: { sha256: output.sha256, mimeType: output.mimeType, bytes: output.data.byteLength },
                userRequestLabel: t("creativeSkills.editor.userRequest"),
            });
            if (!prepared.ok) throw new Error(prepared.issues.join("；"));
            const { source: _source, ...draftInput } = prepared.prepared.input;
            const draft = await createExampleDraft({
                ...draftInput,
                fixture: {
                    input: { sha256: input.sha256, mimeType: input.mimeType, data: input.data },
                    expectedOutput: { sha256: output.sha256, mimeType: output.mimeType, data: output.data },
                },
            });
            select(draft.draftId);
            setExamplePairOpen(false);
            message.success(t("creativeSkills.creation.examplePairCreated"));
        } catch (caught) {
            message.error(caught instanceof Error ? caught.message : t("creativeSkills.operationFailed"));
        } finally {
            setAction(undefined);
        }
    };
    const startTransfer = (input: CreativeSkillPrepareInput) => run(input.kind, async () => { await prepareTransfer(input); });
    const confirmTransfer = () => inspection && run(`commit-${inspection.operation}`, async () => {
        const result = await commitTransfer(inspection.inspectionToken);
        if (result.changed?.draftId) select(result.changed.draftId);
        message.success(inspection.operation === "export"
            ? t("creativeSkills.transfer.exported", { name: result.exported?.fileName || inspection.packageName || "" })
            : t(inspection.target === "library" ? "creativeSkills.transfer.restored" : "creativeSkills.transfer.imported"));
    });

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background px-4 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <StandardPageHeader
                        title={t("creativeSkills.title")}
                        description={t("creativeSkills.description")}
                        actions={
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button icon={<FileInput className="size-4" />} loading={action === "import"} onClick={() => void startTransfer({ kind: "import", source: "file-picker" })}>{t("creativeSkills.import")}</Button>
                                <Dropdown
                                    placement="bottomRight"
                                    menu={{
                                        items: [
                                            { key: "blank", icon: <Plus className="size-4" />, label: t("creativeSkills.creation.blank") },
                                            { key: "canvas", icon: <Workflow className="size-4" />, disabled: true, label: <Tooltip title={t("creativeSkills.creation.canvasSelectionHint")} placement="left"><span>{t("creativeSkills.creation.canvasSelection")}</span></Tooltip> },
                                            { key: "examples", icon: <Images className="size-4" />, label: t("creativeSkills.creation.examplePair") },
                                        ],
                                        onClick: ({ key }) => {
                                            if (key === "blank") void addDraft();
                                            if (key === "examples") setExamplePairOpen(true);
                                        },
                                    }}
                                >
                                    <Button type="primary" icon={<Plus className="size-4" />} loading={action === "new"}>{t("creativeSkills.new")}</Button>
                                </Dropdown>
                            </div>
                        }
                    />

                    {error ? <Alert className="mb-5" type="error" showIcon message={t("creativeSkills.loadFailed")} description={<span data-selectable-text>{error}</span>} /> : null}

                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                        <Input
                            allowClear
                            size="large"
                            className="w-full lg:max-w-sm"
                            prefix={<Search className="size-4 text-muted-foreground" />}
                            placeholder={t("creativeSkills.search")}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <Segmented<ScopeFilter>
                            className="max-w-full overflow-x-auto"
                            value={scope}
                            onChange={setScope}
                            options={[
                                { value: "all", label: t("creativeSkills.filters.all") },
                                { value: "builtin", label: t("creativeSkills.filters.builtin") },
                                { value: "personal", label: t("creativeSkills.filters.personal") },
                                { value: "draft", label: t("creativeSkills.filters.draft") },
                            ]}
                        />
                        <Select<StateFilter>
                            className="w-full lg:ml-auto lg:w-36"
                            value={stateFilter}
                            onChange={setStateFilter}
                            options={[
                                { value: "all", label: t("creativeSkills.filters.anyState") },
                                { value: "enabled", label: t("creativeSkills.filters.enabled") },
                                { value: "favorite", label: t("creativeSkills.filters.favorite") },
                            ]}
                        />
                    </div>

                    <div className="mb-8 grid overflow-hidden border-y border-border lg:min-h-[38rem] lg:grid-cols-[21rem_minmax(0,1fr)]">
                        <aside className="border-b border-border lg:min-h-[18rem] lg:border-b-0 lg:border-r" aria-label={t("creativeSkills.listLabel")}>
                            <div className="flex h-10 items-center justify-between border-b border-border px-3 text-sm text-muted-foreground">
                                <span>{t("creativeSkills.resultCount", { count: visibleItems.length })}</span>
                                {loading && hydrated ? <Spin size="small" /> : null}
                            </div>
                            {!hydrated && loading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
                            {hydrated && visibleItems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(items.length ? "creativeSkills.emptyFiltered" : "creativeSkills.empty")} className="py-16" /> : null}
                            {visibleItems.length ? (
                                <div role="listbox" className="max-h-96 overflow-y-auto p-2 sm:max-h-[32rem] lg:max-h-[calc(100vh-18rem)]">
                                    {visibleItems.map((item) => (
                                        <button
                                            key={item.recordId}
                                            type="button"
                                            role="option"
                                            aria-selected={selected?.recordId === item.recordId}
                                            className={cn(
                                                "group mb-1 flex min-h-[5.5rem] w-full items-start gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                                                selected?.recordId === item.recordId ? "bg-muted text-foreground" : "hover:bg-muted/50",
                                            )}
                                            onClick={() => select(item.recordId)}
                                        >
                                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true">
                                                {item.lifecycle === "draft" ? <PencilLine className="size-[18px]" /> : item.ownership === "builtin" ? <ShieldCheck className="size-[18px]" /> : <Sparkles className="size-[18px]" />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span className="truncate text-[15px] font-medium">{item.name}</span>
                                                    {item.favorite ? <Heart className="size-3.5 shrink-0 fill-current text-brand" aria-label={t("creativeSkills.favorite")} /> : null}
                                                </span>
                                                <span className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{item.description || t("creativeSkills.noDescription")}</span>
                                                <span className="mt-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                                                    <span>{t(`creativeSkills.lifecycle.${item.lifecycle}`)}</span>
                                                    {item.lifecycle === "published" ? <><span aria-hidden="true">·</span><span>{t(item.enabled ? "creativeSkills.enabled" : "creativeSkills.disabled")}</span></> : null}
                                                </span>
                                            </span>
                                            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/60" />
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </aside>

                        <section className={cn("min-w-0 p-5 sm:p-7 lg:p-8", !selected && "hidden lg:block")}>
                            {selected ? (
                                <SkillDetail
                                    key={selected.recordId}
                                    item={selected}
                                    action={action}
                                    setAction={setAction}
                                    onEditDraft={setEditorDraftId}
                                    onPrepareExport={(skillId, versionId) => startTransfer({ kind: "export", skillId, versionId })}
                                />
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("creativeSkills.selectHint")} className="py-28" />}
                        </section>
                    </div>
                </div>
            </main>

            <SkillRecipeEditorDrawer
                draft={editorDraft}
                open={Boolean(editorDraftId && editorDraft)}
                saving={action === "save-draft"}
                onClose={() => setEditorDraftId(undefined)}
                onSave={async (patch) => {
                    if (!editorDraft) return;
                    await run("save-draft", async () => {
                        await patchDraft(editorDraft.draftId, editorDraft.revision, patch);
                        setEditorDraftId(undefined);
                        message.success(t("creativeSkills.draftSaved"));
                    });
                }}
            />
            <ExamplePairModal
                open={examplePairOpen}
                creating={action === "examples"}
                onCancel={() => setExamplePairOpen(false)}
                onCreate={addExampleDraft}
            />
            <TransferModal inspection={inspection} committing={action === `commit-${inspection?.operation}`} onCancel={clearTransfer} onCommit={() => void confirmTransfer()} />
        </div>
    );
}

function SkillDetail({
    item,
    action,
    setAction,
    onEditDraft,
    onPrepareExport,
}: {
    item: CreativeSkillListItem;
    action?: string;
    setAction: (value?: string) => void;
    onEditDraft: (draftId: string) => void;
    onPrepareExport: (skillId: string, versionId?: string) => Promise<void>;
}) {
    const { message, modal } = App.useApp();
    const { t, i18n } = useTranslation();
    const duplicateAsDraft = useCreativeSkillStore((state) => state.duplicateAsDraft);
    const discardDraft = useCreativeSkillStore((state) => state.discardDraft);
    const publishDraft = useCreativeSkillStore((state) => state.publishDraft);
    const requestTestRun = useCreativeSkillStore((state) => state.requestTestRun);
    const deleteSkill = useCreativeSkillStore((state) => state.deleteSkill);
    const setEnabled = useCreativeSkillStore((state) => state.setEnabled);
    const setFavorite = useCreativeSkillStore((state) => state.setFavorite);
    const skill = useCreativeSkillStore((state) => state.snapshot?.skills.find((candidate) => candidate.skillId === item.skillId));
    const [versionId, setVersionId] = useState(item.activeRevision);
    const version = skill?.versions.find((candidate) => candidate.versionId === versionId) || item.version;
    const definition = item.draft?.definition || version?.definition;
    const draft = item.draft;
    const quarantined = draft?.trust === "markdown-quarantined";
    const publishable = draft ? isDraftPublishable(draft) : false;

    const run = async (key: string, operation: () => Promise<void>) => {
        setAction(key);
        try {
            await operation();
        } catch (caught) {
            message.error(caught instanceof Error ? caught.message : t("creativeSkills.operationFailed"));
        } finally {
            setAction(undefined);
        }
    };
    const duplicate = () => run("duplicate", async () => {
        const created = await duplicateAsDraft(item.skillId);
        onEditDraft(created.draftId);
        message.success(t("creativeSkills.copied"));
    });
    const confirmDiscard = () => modal.confirm({
        title: t("creativeSkills.confirmDiscard.title"),
        content: t("creativeSkills.confirmDiscard.description", { name: item.name }),
        okText: t("creativeSkills.discard"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: () => run("discard", async () => { await discardDraft(item.recordId, item.revision); message.success(t("creativeSkills.discarded")); }),
    });
    const confirmPublish = () => modal.confirm({
        title: t("creativeSkills.confirmPublish.title"),
        content: t("creativeSkills.confirmPublish.description", { name: item.name }),
        okText: t("creativeSkills.publish"),
        cancelText: t("common.cancel"),
        onOk: () => run("publish", async () => { await publishDraft(item.recordId, item.revision); message.success(t("creativeSkills.published")); }),
    });
    const confirmDelete = () => modal.confirm({
        title: t("creativeSkills.confirmDelete.title"),
        content: t("creativeSkills.confirmDelete.description", { name: item.name }),
        okText: t("common.delete"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: () => run("delete", async () => { await deleteSkill(item.skillId, item.revision); message.success(t("creativeSkills.deleted")); }),
    });

    return (
        <div>
            <header className="border-b border-border pb-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Tag variant="filled">{t(`creativeSkills.ownership.${item.ownership}`)}</Tag>
                            <Tag variant="filled">{t(`creativeSkills.lifecycle.${item.lifecycle}`)}</Tag>
                            <TrustTag trust={item.trust} />
                        </div>
                        <h2 className="type-section-title break-words text-[24px] sm:text-[26px]">{item.name}</h2>
                        <p data-selectable-text className="mt-2 max-w-3xl break-words text-[15px] leading-7 text-muted-foreground">{item.description || t("creativeSkills.noDescription")}</p>
                    </div>
                    {item.lifecycle === "published" ? (
                        <div className="flex shrink-0 items-center gap-3">
                            <Tooltip title={t(item.favorite ? "creativeSkills.unfavorite" : "creativeSkills.favorite")}>
                                <Button
                                    type="text"
                                    shape="circle"
                                    aria-label={t(item.favorite ? "creativeSkills.unfavorite" : "creativeSkills.favorite")}
                                    aria-pressed={item.favorite}
                                    icon={<Heart className={cn("size-4", item.favorite && "fill-current text-brand")} />}
                                    loading={action === "favorite"}
                                    onClick={() => void run("favorite", () => setFavorite(item.skillId, item.revision, !item.favorite))}
                                />
                            </Tooltip>
                            <span className="text-sm text-muted-foreground">{t(item.enabled ? "creativeSkills.enabled" : "creativeSkills.disabled")}</span>
                            <Switch checked={item.enabled} loading={action === "enabled"} onChange={(enabled) => void run("enabled", () => setEnabled(item.skillId, item.revision, enabled))} />
                        </div>
                    ) : null}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                    {draft && !quarantined ? (
                        <>
                            <Button icon={<PencilLine className="size-4" />} onClick={() => onEditDraft(draft.draftId)}>{t("creativeSkills.edit")}</Button>
                            <Button icon={<Beaker className="size-4" />} onClick={() => { requestTestRun(draft); message.info(t("creativeSkills.testRequested")); }}>{t("creativeSkills.testRun")}</Button>
                            <Tooltip title={publishable ? undefined : publishGateReason(draft, t)}>
                                <span><Button type="primary" icon={<Upload className="size-4" />} disabled={!publishable} loading={action === "publish"} onClick={() => void confirmPublish()}>{t("creativeSkills.publish")}</Button></span>
                            </Tooltip>
                            <Button danger type="text" icon={<Trash2 className="size-4" />} loading={action === "discard"} onClick={() => void confirmDiscard()}>{t("creativeSkills.discard")}</Button>
                        </>
                    ) : draft ? (
                        <Button danger type="text" icon={<Trash2 className="size-4" />} loading={action === "discard"} onClick={() => void confirmDiscard()}>{t("creativeSkills.discard")}</Button>
                    ) : (
                        <>
                            <Button icon={<Copy className="size-4" />} loading={action === "duplicate"} onClick={() => void duplicate()}>{t("creativeSkills.copyAsDraft")}</Button>
                            <Button icon={<Download className="size-4" />} loading={action === "export"} onClick={() => void onPrepareExport(item.skillId, versionId)}>{t("creativeSkills.export")}</Button>
                            {item.ownership === "personal" ? <Button danger type="text" icon={<Trash2 className="size-4" />} loading={action === "delete"} onClick={() => void confirmDelete()}>{t("common.delete")}</Button> : null}
                        </>
                    )}
                </div>
            </header>

            {quarantined ? <Alert className="my-6" type="warning" showIcon message={t("creativeSkills.quarantine.title")} description={t("creativeSkills.quarantine.description")} /> : draft ? <GateSummary draft={draft} /> : null}

            {draft?.fixture ? <ExampleFixtureReview draft={draft} /> : null}

            {skill && skill.versions.length ? (
                <section className="border-b border-border py-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-[17px] font-medium">{t("creativeSkills.versions.title")}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{t("creativeSkills.versions.count", { count: skill.versions.length })}</p>
                        </div>
                        <Select
                            className="w-full sm:w-72"
                            value={version?.versionId}
                            onChange={setVersionId}
                            options={[...skill.versions].reverse().map((candidate, index) => ({
                                value: candidate.versionId,
                                label: `${candidate.versionId === skill.activeRevision ? t("creativeSkills.versions.current") : t("creativeSkills.versions.version", { count: skill.versions.length - index })} · ${formatDate(candidate.publishedAt, i18n.language)}`,
                            }))}
                        />
                    </div>
                    {version ? (
                        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                            <StatusLine label={t("creativeSkills.gates.validation")} passed={version.validation.status === "passed"} />
                            <StatusLine label={t("creativeSkills.gates.testRun")} passed={version.testRun.status === "passed" && version.testRun.definitionHash === version.definitionHash} />
                            <StatusLine label={t("creativeSkills.gates.health")} passed={version.health.status === "healthy" && version.compatibility.status === "compatible"} />
                            <code data-selectable-text className="col-span-full break-all text-xs text-muted-foreground">{version.versionId}</code>
                        </div>
                    ) : null}
                </section>
            ) : null}

            {definition ? <DefinitionDetails definition={definition} /> : null}

            <footer className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-muted-foreground">
                <span>{t("creativeSkills.updatedAt", { time: formatDate(item.updatedAt, i18n.language) })}</span>
                <span>{t("creativeSkills.source", { source: t(`creativeSkills.sources.${item.source}`) })}</span>
            </footer>
        </div>
    );
}

function GateSummary({ draft }: { draft: CreativeSkillDraft }) {
    const { t, i18n } = useTranslation();
    const validationPassed = draft.validation.status === "passed" && draft.validation.definitionHash === draft.definitionHash;
    const testPassed = draft.testRun.status === "passed" && draft.testRun.definitionHash === draft.definitionHash;
    return (
        <section className="border-b border-border py-6">
            <h3 className="text-[17px] font-medium">{t("creativeSkills.gates.title")}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("creativeSkills.gates.description")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <GateLine title={t("creativeSkills.gates.validation")} passed={validationPassed} detail={validationPassed ? t("creativeSkills.gates.validationPassed") : draft.validation.issues.join("；") || t("creativeSkills.gates.validationPending")} />
                <GateLine title={t("creativeSkills.gates.testRun")} passed={testPassed} detail={testPassed ? t("creativeSkills.gates.testPassed", { time: draft.testRun.testedAt ? formatDate(draft.testRun.testedAt, i18n.language) : "" }) : draft.testRun.issues.join("；") || t("creativeSkills.gates.testPending")} />
            </div>
        </section>
    );
}

function GateLine({ title, detail, passed }: { title: string; detail: string; passed: boolean }) {
    return (
        <div className="flex items-start gap-3 py-1">
            {passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
            <div className="min-w-0"><div className="text-sm font-medium">{title}</div><div data-selectable-text className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</div></div>
        </div>
    );
}

function DefinitionDetails({ definition }: { definition: CreativeSkillDefinition }) {
    const { t } = useTranslation();
    return (
        <section className="py-6">
            <div className="flex items-end justify-between gap-4">
                <div className="min-w-0"><h3 className="text-[17px] font-medium">{t("creativeSkills.recipe.title")}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{t("creativeSkills.recipe.summary", { parameters: definition.parameters.length, steps: definition.steps.length, outputs: definition.finalOutputCount })}</p></div>
                <Tag variant="filled" className="shrink-0">Recipe v{definition.schemaVersion}</Tag>
            </div>
            <div className="mt-6">
                <h4 className="type-label text-muted-foreground">{t("creativeSkills.recipe.parameters")}</h4>
                <div className="mt-2 divide-y divide-border/70 border-y border-border/70">
                    {definition.parameters.map((parameter) => (
                        <div key={parameter.key} className="grid gap-1 py-3 sm:grid-cols-[11rem_8rem_minmax(0,1fr)] sm:gap-3">
                            <div className="min-w-0"><div className="break-words text-sm font-medium">{parameter.label}</div><code data-selectable-text className="break-all text-xs text-muted-foreground">{parameter.key}</code></div>
                            <div className="text-sm text-muted-foreground">{t(`creativeSkills.editor.parameterTypes.${parameter.type === "aspect-ratio" ? "aspectRatio" : parameter.type}`)}</div>
                            <div className="break-words text-sm leading-6 text-muted-foreground">{parameter.description || t(parameter.required ? "creativeSkills.recipe.required" : "creativeSkills.recipe.optional")}</div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="mt-6">
                <h4 className="type-label text-muted-foreground">{t("creativeSkills.recipe.steps")}</h4>
                <div className="mt-2 divide-y divide-border/70 border-y border-border/70">
                    {definition.steps.map((step, index) => (
                        <div key={index} className="py-4">
                            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{t("creativeSkills.recipe.step", { count: index + 1 })}</span><Tag variant="filled">{t(step.operation === "image.generate" ? "creativeSkills.editor.operations.generate" : "creativeSkills.editor.operations.edit")}</Tag></div>
                            <p data-selectable-text className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{step.prompt.map((segment) => segment.type === "literal" ? segment.text : `{{${segment.key}}}`).join("")}</p>
                            {step.references?.length ? <div className="mt-2 text-xs text-muted-foreground">{t("creativeSkills.recipe.references", { references: step.references.map((reference) => referenceLabel(reference, t)).join(t("creativeSkills.recipe.referenceSeparator")) })}</div> : null}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

type ExamplePairFormValue = {
    name: string;
    description: string;
    instruction: string;
    input: File;
    output: File;
};

type ReadExampleImageResult = {
    data: ArrayBuffer;
    sha256: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
};

const exampleImageReadCache = new WeakMap<File, Promise<ReadExampleImageResult>>();

function ExamplePairModal({
    open,
    creating,
    onCancel,
    onCreate,
}: {
    open: boolean;
    creating: boolean;
    onCancel: () => void;
    onCreate: (value: ExamplePairFormValue) => Promise<void>;
}) {
    const { message } = App.useApp();
    const { t, i18n } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [instruction, setInstruction] = useState("");
    const [input, setInput] = useState<File>();
    const [output, setOutput] = useState<File>();
    const [extracting, setExtracting] = useState(false);
    const [extractionError, setExtractionError] = useState<string>();
    const [extracted, setExtracted] = useState(false);
    const extractionController = useRef<AbortController | undefined>(undefined);
    const textModel = resolveModelForCapability(config, config.textModel || config.model, "text");
    const modelReady = isAiConfigReady(config, textModel);
    useEffect(() => {
        if (open) return;
        extractionController.current?.abort();
        extractionController.current = undefined;
        setName("");
        setDescription("");
        setInstruction("");
        setInput(undefined);
        setOutput(undefined);
        setExtracting(false);
        setExtractionError(undefined);
        setExtracted(false);
    }, [open]);
    useEffect(() => () => extractionController.current?.abort(), []);
    const ready = Boolean(name.trim() && instruction.trim() && input && output && !extracting);
    const cancel = () => {
        extractionController.current?.abort();
        extractionController.current = undefined;
        onCancel();
    };
    const changeImage = (role: "input" | "output", file?: File) => {
        extractionController.current?.abort();
        extractionController.current = undefined;
        setExtracting(false);
        setExtractionError(undefined);
        if (extracted) {
            setName("");
            setDescription("");
            setInstruction("");
            setExtracted(false);
        }
        if (role === "input") setInput(file);
        else setOutput(file);
    };
    const extract = async () => {
        if (!modelReady) {
            openConfigDialog(true, "channels");
            return;
        }
        if (!input || !output) return;
        extractionController.current?.abort();
        const controller = new AbortController();
        extractionController.current = controller;
        setExtracting(true);
        setExtractionError(undefined);
        try {
            const [inputImage, outputImage] = await Promise.all([readExampleImage(input), readExampleImage(output)]);
            const result = await extractCreativeSkillStyle(config, {
                inputImage: new Blob([inputImage.data], { type: inputImage.mimeType }),
                outputImage: new Blob([outputImage.data], { type: outputImage.mimeType }),
                language: i18n.language,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            setName(result.name);
            setDescription(result.description);
            setInstruction(result.instruction);
            setExtracted(true);
            message.success(t("creativeSkills.examplePair.extractionSucceeded"));
        } catch (caught) {
            if (!controller.signal.aborted) setExtractionError(caught instanceof Error ? caught.message : t("creativeSkills.examplePair.extractionFailed"));
        } finally {
            if (extractionController.current === controller) {
                extractionController.current = undefined;
                setExtracting(false);
            }
        }
    };
    return (
        <Modal
            open={open}
            destroyOnHidden
            width={760}
            centered
            title={t("creativeSkills.examplePair.title")}
            okText={t("creativeSkills.examplePair.create")}
            cancelText={t("common.cancel")}
            confirmLoading={creating}
            okButtonProps={{ disabled: !ready }}
            onCancel={cancel}
            onOk={() => { if (input && output) void onCreate({ name, description, instruction, input, output }); }}
            styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto" } }}
        >
            <div className="space-y-4 pt-1">
                <Alert
                    type="info"
                    showIcon
                    message={t("creativeSkills.examplePair.extractionNotice")}
                    description={t("creativeSkills.examplePair.fixtureNotice")}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                    <ExampleImagePicker label={t("creativeSkills.examplePair.input")} file={input} onChange={(file) => changeImage("input", file)} />
                    <ExampleImagePicker label={t("creativeSkills.examplePair.output")} file={output} onChange={(file) => changeImage("output", file)} />
                </div>
                <div className="flex flex-col gap-3 border-y border-border py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <div className="text-sm font-medium">{t("creativeSkills.examplePair.extract")}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={modelReady ? modelOptionLabel(config, textModel) : undefined}>
                            {modelReady
                                ? t("creativeSkills.examplePair.extractionModel", { model: modelOptionLabel(config, textModel) })
                                : t("creativeSkills.examplePair.modelRequired")}
                        </div>
                    </div>
                    <Button
                        className="shrink-0"
                        icon={<Sparkles className="size-4" />}
                        loading={extracting}
                        disabled={modelReady && (!input || !output)}
                        onClick={() => void extract()}
                    >
                        {modelReady ? t("creativeSkills.examplePair.extract") : t("creativeSkills.examplePair.configureModel")}
                    </Button>
                </div>
                {extractionError ? (
                    <Alert
                        type="warning"
                        showIcon
                        message={t("creativeSkills.examplePair.extractionFailed")}
                        description={<span data-selectable-text>{`${extractionError} ${t("creativeSkills.examplePair.manualFallback")}`}</span>}
                    />
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">{t("creativeSkills.fields.name")}</span>
                        <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t("creativeSkills.examplePair.namePlaceholder")} />
                    </label>
                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">{t("creativeSkills.fields.description")}</span>
                        <Input value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder={t("creativeSkills.examplePair.descriptionPlaceholder")} />
                    </label>
                </div>
                <label className="block">
                    <span className="mb-2 block text-sm font-medium">{t("creativeSkills.examplePair.instruction")}</span>
                    <Input.TextArea value={instruction} maxLength={20_000} autoSize={{ minRows: 4, maxRows: 8 }} onChange={(event) => setInstruction(event.target.value)} placeholder={t("creativeSkills.examplePair.instructionPlaceholder")} />
                </label>
            </div>
        </Modal>
    );
}

function ExampleImagePicker({ label, file, onChange }: { label: string; file?: File; onChange: (file?: File) => void }) {
    const { t } = useTranslation();
    const { url: preview, error } = useFilePreview(file);
    const supportsHeic = supportsHeicExampleImages();
    return (
        <div>
            <div className="mb-2 text-sm font-medium">{label}</div>
            <label className="flex h-40 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/20 p-3 text-center transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring/50 focus-within:ring-offset-2 sm:h-44">
                <input
                    type="file"
                    className="sr-only"
                    aria-label={label}
                    accept={supportsHeic ? "image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" : "image/png,image/jpeg,image/webp"}
                    onChange={(event) => {
                        onChange(event.target.files?.[0]);
                        event.currentTarget.value = "";
                    }}
                />
                <div className="flex h-24 w-full items-center justify-center sm:h-28">
                    {preview ? <img src={preview} alt={label} className="size-full object-contain" /> : error ? <Tooltip title={error}><CircleAlert className="size-7 text-danger" aria-label={error} /></Tooltip> : <Images className="size-7 text-muted-foreground" />}
                </div>
                <span className="mt-2 block max-w-full truncate text-sm text-muted-foreground" title={file?.name || undefined}>{file?.name || t(supportsHeic ? "creativeSkills.examplePair.chooseImageMac" : "creativeSkills.examplePair.chooseImage")}</span>
            </label>
        </div>
    );
}

function ExampleFixtureReview({ draft }: { draft: CreativeSkillDraft }) {
    const { t } = useTranslation();
    const [previews, setPreviews] = useState<{ input: string; output: string }>();
    const [error, setError] = useState<string>();
    useEffect(() => {
        let active = true;
        const urls: string[] = [];
        setPreviews(undefined);
        setError(undefined);
        const bridge = window.infiniteCanvasDesktop?.creativeSkills;
        if (!bridge) {
            setError(t("creativeSkills.examplePair.previewUnavailable"));
            return;
        }
        void Promise.all([
            bridge.query({ kind: "resolve-fixture", draftId: draft.draftId, draftRevision: draft.revision, role: "input" }),
            bridge.query({ kind: "resolve-fixture", draftId: draft.draftId, draftRevision: draft.revision, role: "expected-output" }),
        ]).then(([input, output]) => {
            if (!active) return;
            const next = {
                input: URL.createObjectURL(new Blob([fixtureArrayBuffer(input.fixture.bytes)], { type: input.fixture.mimeType })),
                output: URL.createObjectURL(new Blob([fixtureArrayBuffer(output.fixture.bytes)], { type: output.fixture.mimeType })),
            };
            urls.push(next.input, next.output);
            setPreviews(next);
        }).catch((caught) => {
            if (active) setError(caught instanceof Error ? caught.message : t("creativeSkills.examplePair.previewUnavailable"));
        });
        return () => {
            active = false;
            urls.forEach(URL.revokeObjectURL);
        };
    }, [draft.draftId, draft.revision, t]);
    return (
        <section className="border-b border-border py-6">
            <h3 className="text-[17px] font-medium">{t("creativeSkills.examplePair.reviewTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("creativeSkills.examplePair.reviewDescription")}</p>
            {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {(["input", "expectedOutput"] as const).map((role) => {
                    const descriptor = draft.fixture![role];
                    const url = role === "input" ? previews?.input : previews?.output;
                    return (
                        <figure key={role} className="overflow-hidden rounded-md border border-border bg-muted/20">
                            <div className="flex aspect-[4/3] items-center justify-center p-2">
                                {url ? <img src={url} alt={t(role === "input" ? "creativeSkills.examplePair.input" : "creativeSkills.examplePair.output")} className="size-full object-contain" /> : <Spin size="small" />}
                            </div>
                            <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{t(role === "input" ? "creativeSkills.examplePair.input" : "creativeSkills.examplePair.output")}</span>
                                <span className="ml-2">{descriptor.width} × {descriptor.height} · {formatBytes(descriptor.bytes)}</span>
                            </figcaption>
                        </figure>
                    );
                })}
            </div>
        </section>
    );
}

function useFilePreview(file?: File) {
    const [preview, setPreview] = useState<{ url?: string; error?: string }>({});
    useEffect(() => {
        if (!file) {
            setPreview({});
            return;
        }
        let active = true;
        let url: string | undefined;
        setPreview({});
        void readExampleImage(file).then((image) => {
            if (!active) return;
            url = URL.createObjectURL(new Blob([image.data], { type: image.mimeType }));
            setPreview({ url });
        }).catch((caught) => {
            if (active) setPreview({ error: caught instanceof Error ? caught.message : "样例图读取失败" });
        });
        return () => {
            active = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, [file]);
    return preview;
}

async function readExampleImage(file: File) {
    const cached = exampleImageReadCache.get(file);
    if (cached) return cached;
    const task = normalizeExampleImage(file);
    exampleImageReadCache.set(file, task);
    void task.catch(() => exampleImageReadCache.delete(file));
    return task;
}

async function normalizeExampleImage(file: File): Promise<ReadExampleImageResult> {
    const mimeType = exampleImageMimeType(file);
    if (!mimeType) throw new Error(i18n.t("creativeSkills.examplePair.unsupportedFormat", {
        formats: supportsHeicExampleImages() ? "PNG、JPEG、WebP、HEIC、HEIF" : "PNG、JPEG、WebP",
    }));
    if (file.size < 1 || file.size > 32 * 1024 * 1024) throw new Error("单张样例图不能超过 32 MB");
    const data = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", data);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const bridge = window.infiniteCanvasDesktop?.creativeSkills;
    if (bridge) {
        const normalized = (await bridge.query({ kind: "normalize-example-image", sha256, mimeType, data })).image;
        return {
            data: fixtureArrayBuffer(normalized.data),
            sha256: normalized.sha256,
            mimeType: normalized.mimeType,
        };
    }
    if (mimeType === "image/heic" || mimeType === "image/heif") throw new Error(i18n.t("creativeSkills.examplePair.heicDesktopRequired"));
    return { data, sha256, mimeType };
}

function exampleImageMimeType(file: File) {
    const declared = file.type.toLowerCase();
    if (declared === "image/png" || declared === "image/jpeg" || declared === "image/webp") return declared;
    if (supportsHeicExampleImages() && (declared === "image/heic" || declared === "image/heif")) return declared;
    const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (extension === "png") return "image/png" as const;
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg" as const;
    if (extension === "webp") return "image/webp" as const;
    if (supportsHeicExampleImages() && extension === "heic") return "image/heic" as const;
    if (supportsHeicExampleImages() && extension === "heif") return "image/heif" as const;
    return undefined;
}

function supportsHeicExampleImages() {
    return window.infiniteCanvasDesktop?.platform === "darwin";
}

function fixtureArrayBuffer(bytes: ArrayBuffer) {
    return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).slice().buffer;
}

function formatBytes(bytes: number) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TransferModal({ inspection, committing, onCancel, onCommit }: { inspection?: CreativeSkillTransferInspection; committing: boolean; onCancel: () => void; onCommit: () => void }) {
    const { t } = useTranslation();
    const operation = inspection?.operation || "import";
    const restoringLibrary = inspection?.target === "library";
    const replacingLocal = inspection?.resolution === "replace-local";
    const titleKey = replacingLocal ? "replaceLocalReviewTitle" : restoringLibrary ? "restoreReviewTitle" : `${operation}ReviewTitle`;
    const descriptionKey = replacingLocal ? "replaceLocalReviewDescription" : restoringLibrary ? "restoreReviewDescription" : `${operation}ReviewDescription`;
    const commitKey = replacingLocal ? "replaceLocalCommit" : restoringLibrary ? "restoreCommit" : `${operation}Commit`;
    return (
        <Modal
            open={Boolean(inspection)}
            title={t(`creativeSkills.transfer.${titleKey}`)}
            onCancel={onCancel}
            onOk={onCommit}
            okText={t(`creativeSkills.transfer.${commitKey}`)}
            cancelText={t("common.cancel")}
            confirmLoading={committing}
            okButtonProps={{ danger: replacingLocal, disabled: !inspection?.canCommit || inspection.status !== "verified" }}
        >
            {inspection ? (
                <div>
                    <Alert
                        type={replacingLocal ? "warning" : inspection.status === "verified" ? "success" : inspection.status === "rejected" ? "error" : "warning"}
                        showIcon
                        message={t(`creativeSkills.transfer.status.${inspection.status}`)}
                        description={t(`creativeSkills.transfer.${descriptionKey}`)}
                    />
                    {inspection.summary ? (
                        <div className="mt-5 border-y border-border py-4">
                            <div className="text-base font-medium">{inspection.summary.name}</div>
                            <p data-selectable-text className="mt-1 text-sm leading-6 text-muted-foreground">{inspection.summary.description || t("creativeSkills.noDescription")}</p>
                            <div className="mt-2 text-xs text-muted-foreground">{t("creativeSkills.transfer.assetCount", { count: inspection.summary.assetCount })}</div>
                        </div>
                    ) : null}
                    {inspection.packageName ? <div data-selectable-text className="mt-4 text-sm text-muted-foreground">{t("creativeSkills.transfer.packageName", { name: inspection.packageName })}</div> : null}
                    {inspection.issues.length ? (
                        <ul data-selectable-text className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
                            {inspection.issues.map((issue, index) => <li key={`${issue}:${index}`} className="flex gap-2"><CircleAlert className="mt-1 size-3.5 shrink-0 text-warning" /><span>{issue}</span></li>)}
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </Modal>
    );
}

function TrustTag({ trust }: { trust: CreativeSkillListItem["trust"] }) {
    const { t } = useTranslation();
    const icon: ReactNode = trust === "builtin-verified" ? <ShieldCheck className="size-3" /> : trust === "local-reviewed" ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />;
    return <Tag variant="filled" icon={icon}>{t(`creativeSkills.trust.${trust}`)}</Tag>;
}

function StatusLine({ label, passed }: { label: string; passed: boolean }) {
    return <div className="flex items-center gap-2 text-muted-foreground">{passed ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}<span>{label}</span></div>;
}

function isDraftPublishable(draft: CreativeSkillDraft) {
    return draft.validation.status === "passed" && draft.validation.definitionHash === draft.definitionHash
        && draft.testRun.status === "passed" && draft.testRun.definitionHash === draft.definitionHash;
}

function publishGateReason(draft: CreativeSkillDraft, t: (key: string) => string) {
    if (draft.validation.status !== "passed" || draft.validation.definitionHash !== draft.definitionHash) return t("creativeSkills.gates.publishNeedsValidation");
    return t("creativeSkills.gates.publishNeedsTest");
}

function referenceLabel(reference: DefinitionReference, t: (key: string) => string) {
    if (reference.type === "input-target") return t("creativeSkills.recipe.referenceTarget");
    if (reference.type === "input-references") return t("creativeSkills.recipe.referenceInputs");
    return reference.sha256.slice(0, 12);
}

function formatDate(value: string, locale: string) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestamp) : value;
}

function emptyDefinition(userRequestLabel: string): CreativeSkillDefinition {
    return {
        schemaVersion: 1,
        kind: "linear-image",
        parameters: [{ key: "user-request", label: userRequestLabel, type: "text", required: true, maxLength: 1200 }],
        steps: [{ operation: "image.generate", prompt: [{ type: "parameter", key: "user-request" }] }],
        finalOutputCount: 1,
    };
}
