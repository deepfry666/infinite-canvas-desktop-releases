import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        const desktop = window.infiniteCanvasDesktop;
        if (desktop) {
            const workspaceValue = await desktop.readWorkspaceState(name);
            if (workspaceValue) return workspaceValue;
            const workspace = await desktop.getWorkspaceInfo();
            if (workspace.isCustom && !workspace.allowLegacyImport) return null;
            const legacyValue = (await localforage.getItem<string>(name)) || null;
            if (legacyValue) await desktop.writeWorkspaceState(name, legacyValue);
            return legacyValue;
        }
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        if (window.infiniteCanvasDesktop) {
            await window.infiniteCanvasDesktop.writeWorkspaceState(name, value);
            try {
                await localforage.setItem(name, value);
            } catch {
                // The readable workspace file is authoritative in the desktop app.
            }
            return;
        }
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        if (window.infiniteCanvasDesktop) {
            await window.infiniteCanvasDesktop.removeWorkspaceState(name);
            try {
                await localforage.removeItem(name);
            } catch {
                // The readable workspace file is authoritative in the desktop app.
            }
            return;
        }
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
