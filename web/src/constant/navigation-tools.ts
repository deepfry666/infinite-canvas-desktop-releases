import { FileText, ImagePlus, Images, Maximize2, Sparkles, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "skills",
        icon: Sparkles,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
