import { Check, Download, Pencil, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button, Input } from "antd";
import { useTranslation } from "react-i18next";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { cn } from "@/lib/utils";
import { usePointerHalo } from "@/hooks/use-pointer-halo";
import { useRouteNavigate } from "@/hooks/use-route-navigate";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const { i18n, t } = useTranslation();
    const navigate = useRouteNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const pointerHalo = usePointerHalo<HTMLElement>();
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article
            className={cn(
                "group relative isolate flex min-h-44 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border p-5 transition-[border-color,background-color,box-shadow] duration-300",
                selected ? "border-brand/40 bg-brand/[0.025] ring-1 ring-inset ring-brand/10" : "border-border bg-card hover:border-brand/30 hover:bg-brand/[0.015] hover:shadow-[0_16px_38px_-30px_color-mix(in_srgb,var(--brand-glint)_32%,transparent)]",
            )}
            onPointerMove={pointerHalo.onPointerMove}
            onClick={() => !editing && open()}
        >
            <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: "radial-gradient(240px circle at var(--halo-x, 50%) var(--halo-y, 50%), color-mix(in srgb, var(--brand-glint) 15%, transparent), color-mix(in srgb, var(--brand) 6%, transparent) 34%, color-mix(in srgb, var(--brand) 2%, transparent) 58%, transparent 76%)" }}
            />
            <div className="relative z-[1] flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="mt-1 size-4 accent-foreground"
                    aria-label={t("canvas.project.select", { name: project.title })}
                />
                {editing ? (
                    <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="type-section-title truncate">{project.title}</h2>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                            {t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}
                        </p>
                    </button>
                )}
            </div>
            <div className="relative z-[1] mt-8 flex items-end justify-between gap-3">
                <p className="type-label text-muted-foreground">{t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("canvas.project.saveName")} />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label={t("canvas.project.cancelRename")} />
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || t("canvas.title"))} aria-label={t("canvas.project.export")} />
                            <Button type="text" size="small" shape="circle" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label={t("canvas.project.rename")} />
                            <Button type="text" size="small" shape="circle" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label={t("canvas.project.delete")} />
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
