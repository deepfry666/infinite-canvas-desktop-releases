type ViewTransitionLike = {
    skipTransition?: () => void;
};

type ThemeTransitionSession = {
    token: symbol;
    transition: ViewTransitionLike | null;
    finish: () => void;
};

let activeThemeTransition: ThemeTransitionSession | null = null;

function clearThemeViewTransitionMarkers() {
    if (typeof document === "undefined") return false;
    const root = document.documentElement;
    const marked = root.dataset.magicuiThemeVt === "active";
    delete root.dataset.magicuiThemeVt;
    root.style.removeProperty("--magicui-theme-toggle-vt-duration");
    root.style.removeProperty("--magicui-theme-vt-clip-from");
    return marked;
}

export function isThemeViewTransitionActive() {
    return typeof document !== "undefined" && document.documentElement.dataset.magicuiThemeVt === "active";
}

export function beginThemeViewTransition(finish: () => void) {
    try {
        activeThemeTransition?.transition?.skipTransition?.();
    } catch {
        // A replaced browser transition may already have invalidated itself.
    }
    const token = Symbol("theme-view-transition");
    const session: ThemeTransitionSession = {
        token,
        transition: null,
        finish: () => {
            if (activeThemeTransition?.token !== token) return;
            activeThemeTransition = null;
            finish();
        },
    };
    activeThemeTransition = session;
    return {
        attach(transition: ViewTransitionLike) {
            if (activeThemeTransition?.token === token) session.transition = transition;
            else transition.skipTransition?.();
        },
        finish: session.finish,
    };
}

export function cancelThemeViewTransition() {
    const active = activeThemeTransition;
    if (!active) return clearThemeViewTransitionMarkers();
    try {
        active.transition?.skipTransition?.();
    } catch {
        // The route still owns the next snapshot even if the browser has
        // already invalidated the theme transition handle.
    } finally {
        try {
            active.finish();
        } finally {
            clearThemeViewTransitionMarkers();
        }
    }
    return true;
}
