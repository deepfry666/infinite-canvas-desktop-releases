export function createDebouncedWriter<T>(write: (value: T) => Promise<void>, delay = 400) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let pending: { generation: number; value: T } | undefined;
    let queue = Promise.resolve();

    const clearTimer = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
    };

    const writePending = () => {
        if (pending === undefined) return queue;
        const scheduled = pending;
        pending = undefined;
        const operation = queue.then(() => write(scheduled.value));
        queue = operation.then(() => undefined, () => undefined);
        return operation.catch((error) => {
            if (pending === undefined && generation === scheduled.generation) pending = scheduled;
            throw error;
        });
    };

    const flush = async (): Promise<void> => {
        clearTimer();
        while (pending !== undefined) {
            await writePending();
            clearTimer();
        }
        await queue;
        if (pending !== undefined) await flush();
    };

    return {
        schedule(value: T) {
            pending = { generation: ++generation, value };
            clearTimer();
            timer = setTimeout(() => {
                timer = undefined;
                void flush().catch(() => undefined);
            }, delay);
        },
        flush,
    };
}
