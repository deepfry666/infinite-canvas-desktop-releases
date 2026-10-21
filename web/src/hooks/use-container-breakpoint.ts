import { useLayoutEffect, useRef, useState } from "react";

export function useContainerBreakpoint<T extends HTMLElement>(maxWidth: number) {
    const ref = useRef<T>(null);
    const [matches, setMatches] = useState(false);

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => setMatches((value) => {
            const nextValue = element.clientWidth <= maxWidth;
            return value === nextValue ? value : nextValue;
        });
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [maxWidth]);

    return [ref, matches] as const;
}
