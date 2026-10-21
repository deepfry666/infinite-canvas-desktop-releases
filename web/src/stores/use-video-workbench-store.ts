import { create } from "zustand";

import { setGenerationActivity } from "@/services/generation-activity";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type GeneratedWorkbenchVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type VideoWorkbenchResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedWorkbenchVideo;
    error?: string;
};

type ValueOrUpdater<T> = T | ((value: T) => T);

type VideoWorkbenchState = {
    prompt: string;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    results: VideoWorkbenchResult[];
    running: boolean;
    activeLogId: string;
    startedAt: number;
    elapsedMs: number;
    setPrompt: (prompt: string) => void;
    setReferences: (value: ValueOrUpdater<ReferenceImage[]>) => void;
    setVideoReferences: (value: ValueOrUpdater<ReferenceVideo[]>) => void;
    setAudioReferences: (value: ValueOrUpdater<ReferenceAudio[]>) => void;
    setResults: (value: ValueOrUpdater<VideoWorkbenchResult[]>) => void;
    setRunning: (running: boolean) => void;
    setActiveLogId: (activeLogId: string) => void;
    setStartedAt: (value: ValueOrUpdater<number>) => void;
    setElapsedMs: (elapsedMs: number) => void;
    reset: () => void;
};

const initialState = {
    prompt: "",
    references: [] as ReferenceImage[],
    videoReferences: [] as ReferenceVideo[],
    audioReferences: [] as ReferenceAudio[],
    results: [] as VideoWorkbenchResult[],
    running: false,
    activeLogId: "",
    startedAt: 0,
    elapsedMs: 0,
};

export const useVideoWorkbenchStore = create<VideoWorkbenchState>((set) => ({
    ...initialState,
    setPrompt: (prompt) => set({ prompt }),
    setReferences: (value) => set((state) => ({ references: typeof value === "function" ? value(state.references) : value })),
    setVideoReferences: (value) => set((state) => ({ videoReferences: typeof value === "function" ? value(state.videoReferences) : value })),
    setAudioReferences: (value) => set((state) => ({ audioReferences: typeof value === "function" ? value(state.audioReferences) : value })),
    setResults: (value) => set((state) => ({ results: typeof value === "function" ? value(state.results) : value })),
    setRunning: (running) => {
        set({ running });
        setGenerationActivity("video-workbench", running ? 1 : 0);
    },
    setActiveLogId: (activeLogId) => set({ activeLogId }),
    setStartedAt: (value) => set((state) => ({ startedAt: typeof value === "function" ? value(state.startedAt) : value })),
    setElapsedMs: (elapsedMs) => set({ elapsedMs }),
    reset: () => {
        set(initialState);
        setGenerationActivity("video-workbench", 0);
    },
}));
