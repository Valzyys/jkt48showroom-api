export function debounce(fn, cooldownMs) {
    let lastCall = 0;
    let timeout = null;
    return (...args)=>{
        const now = Date.now();
        const remaining = cooldownMs - (now - lastCall);
        if (remaining <= 0) {
            lastCall = now;
            fn(...args);
        } else {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(()=>{
                lastCall = Date.now();
                fn(...args);
            }, remaining);
        }
    };
}
