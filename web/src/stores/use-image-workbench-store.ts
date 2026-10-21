import { create } from "zustand";
import { createStore } from "zustand/vanilla";

import type { ReferenceImage } from "@/types/image";
import { setGenerationActivity } from "../services/generation-activity.ts";

export type GeneratedWorkbenchImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

export type ImageWorkbenchResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedWorkbenchImage;
    error?: string;
};

type ValueOrUpdater<T> = T | ((value: T) => T);

type ImageWorkbenchState = {
    prompt: string;
    references: ReferenceImage[];
    results: ImageWorkbenchResult[];
    running: boolean;
    activeLogId: string;
    startedAt: number;
    elapsedMs: number;
    setPrompt: (prompt: string) => void;
    setReferences: (value: ValueOrUpdater<ReferenceImage[]>) => void;
    setResults: (value: ValueOrUpdater<ImageWorkbenchResult[]>) => void;
    setRunning: (running: boolean) => void;
    setActiveLogId: (activeLogId: string) => void;
    setStartedAt: (startedAt: number) => void;
    setElapsedMs: (elapsedMs: number) => void;
    reset: () => void;
};

const initialState = { prompt: "", references: [] as ReferenceImage[], results: [] as ImageWorkbenchResult[], running: false, activeLogId: "", startedAt: 0, elapsedMs: 0 };

const stateCreator = (set: (value: Partial<ImageWorkbenchState> | ((state: ImageWorkbenchState) => Partial<ImageWorkbenchState>)) => void): ImageWorkbenchState => ({
    ...initialState,
    setPrompt: (prompt) => set({ prompt }),
    setReferences: (value) => set((state) => ({ references: typeof value === "function" ? value(state.references) : value })),
    setResults: (value) => set((state) => ({ results: typeof value === "function" ? value(state.results) : value })),
    setRunning: (running) => {
        set({ running });
        setGenerationActivity("image-workbench", running ? 1 : 0);
    },
    setActiveLogId: (activeLogId) => set({ activeLogId }),
    setStartedAt: (startedAt) => set({ startedAt }),
    setElapsedMs: (elapsedMs) => set({ elapsedMs }),
    reset: () => {
        set(initialState);
        setGenerationActivity("image-workbench", 0);
    },
});

export const createImageWorkbenchStore = () => createStore<ImageWorkbenchState>(stateCreator);
export const useImageWorkbenchStore = create<ImageWorkbenchState>(stateCreator);
