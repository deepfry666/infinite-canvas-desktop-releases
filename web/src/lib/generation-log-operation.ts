let queue = Promise.resolve();

export function runGenerationLogOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}
