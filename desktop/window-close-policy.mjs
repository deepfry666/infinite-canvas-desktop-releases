export function decideWindowClose({ behavior, activeGenerationCount, quitting }) {
    if (quitting) return "quit";
    if (behavior === "tray") return "hide-to-tray";
    return activeGenerationCount > 0 ? "confirm-quit" : "quit";
}
