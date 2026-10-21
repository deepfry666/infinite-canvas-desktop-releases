import { useCallback, useEffect, useState } from "react";

import { IMAGE_USAGE_UPDATED_EVENT, buildImageUsageStats, readCreativeUsageData, type ImageUsagePeriod, type ImageUsageRange, type ImageUsageStats } from "@/services/image-usage-stats";

export function useImageUsage(period: ImageUsagePeriod, range: ImageUsageRange) {
    const [stats, setStats] = useState<ImageUsageStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await readCreativeUsageData();
            setStats(buildImageUsageStats(data, period, range));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "读取创作统计失败");
        } finally {
            setLoading(false);
        }
    }, [period, range]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const handleUpdate = () => void refresh();
        window.addEventListener(IMAGE_USAGE_UPDATED_EVENT, handleUpdate);
        return () => window.removeEventListener(IMAGE_USAGE_UPDATED_EVENT, handleUpdate);
    }, [refresh]);

    return { stats, loading, error, refresh };
}
