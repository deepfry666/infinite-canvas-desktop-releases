import { useEffect, useState } from "react";

import { resolveThumbnail } from "@/services/thumbnail-cache";

export function useThumbnail(cacheKey: string, sourceUrl: string) {
    const [url, setUrl] = useState(sourceUrl);
    useEffect(() => {
        let active = true;
        setUrl(sourceUrl);
        void resolveThumbnail(cacheKey, sourceUrl).then((value) => active && setUrl(value));
        return () => {
            active = false;
        };
    }, [cacheKey, sourceUrl]);
    return url;
}
