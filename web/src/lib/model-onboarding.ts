export type DetectedProviderSetup = {
    apiFormat: "openai" | "gemini";
    adapterMode: "preset";
    adapterPreset: "openai-compatible" | "gemini" | "apimart-gpt-image";
};

export function detectProviderPreset(baseUrl: string): DetectedProviderSetup {
    const value = baseUrl.trim().toLowerCase();
    if (value.includes("apimart")) return { apiFormat: "openai", adapterMode: "preset", adapterPreset: "apimart-gpt-image" };
    if (value.includes("generativelanguage.googleapis.com")) return { apiFormat: "gemini", adapterMode: "preset", adapterPreset: "gemini" };
    return { apiFormat: "openai", adapterMode: "preset", adapterPreset: "openai-compatible" };
}
