/**
 * Creates a debounced version of a function that delays execution until after
 * the specified wait time has elapsed since the last invocation.
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return function (...args: Parameters<T>) {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            func(...args);
            timeoutId = null;
        }, wait);
    };
}

/**
 * Clears a timeout if it exists
 */
export function clearDebounce(timeoutId: ReturnType<typeof setTimeout> | null) {
    if (timeoutId !== null) {
        clearTimeout(timeoutId);
    }
}
