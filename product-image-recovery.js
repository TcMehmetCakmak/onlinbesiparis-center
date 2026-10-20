/* Shared by customer and admin pages. Retry transient image delivery failures. */
(() => {
    const states = new WeakMap();
    const failed = new Set();
    const cooldowns = [15000, 45000, 120000];
    const delays = [800, 2400];
    const placeholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#f3f4f6"/><text x="160" y="112" text-anchor="middle" fill="#667085" font-family="sans-serif" font-size="16">Fotoğraf yüklenemedi</text><text x="160" y="140" text-anchor="middle" fill="#667085" font-family="sans-serif" font-size="13">Tekrar denemek için dokunun</text></svg>'
    );
    function isProductPhoto(source) {
        try {
            const url = new URL(source, document.baseURI);
            return ['image-uploader.tc-mehmetcakmak.workers.dev', 'pub-c51be861a66041fd8d2f5f27349b59ee.r2.dev'].includes(url.hostname)
                || url.pathname.includes('/storage/v1/object/public/product-images/');
        } catch { return false; }
    }
    function recover(img) {
        if (!(img instanceof HTMLImageElement)) return;
        const source = img.getAttribute('src');
        if (!isProductPhoto(source)) return;
        let state = states.get(img);
        if (!state || state.current !== source) {
            state = { original: source, current: source, attempts: 0, rounds: 0, timer: null };
            states.set(img, state);
            failed.delete(img);
        }
        if (state.timer) return;
        if (state.attempts >= delays.length) {
            for (const previous of failed) if (!previous.isConnected) failed.delete(previous);
            failed.add(img);
            state.current = placeholder;
            img.src = placeholder;
            if (state.rounds < cooldowns.length) {
                const delay = cooldowns[state.rounds++];
                state.timer = setTimeout(() => {
                    state.timer = null;
                    retryFailed(img);
                }, delay + Math.floor(Math.random() * 3000));
            }
            console.warn('Ürün fotoğrafı yeniden denemelere rağmen yüklenemedi:', new URL(state.original, document.baseURI).pathname);
            return;
        }
        const delay = delays[state.attempts++];
        state.timer = setTimeout(() => {
            state.timer = null;
            if (!img.isConnected || img.getAttribute('src') !== state.current) return;
            const url = new URL(state.original, document.baseURI);
            url.searchParams.set('_image_retry', `${Date.now()}-${state.attempts}`);
            state.current = url.href;
            img.src = state.current;
        }, delay);
    }
    function retryFailed(img, manual = false) {
        const state = states.get(img);
        if (!state || !failed.has(img)) return;
        if (!img.isConnected || img.getAttribute('src') !== placeholder) {
            if (state.timer) clearTimeout(state.timer);
            failed.delete(img);
            return;
        }
        if (document.visibilityState === 'hidden' && !manual) return;
        const rect = img.getBoundingClientRect();
        if (!manual && (rect.bottom <= 0 || rect.top >= window.innerHeight)) return;
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
        state.attempts = 0;
        if (manual) state.rounds = 0;
        const url = new URL(state.original, document.baseURI);
        url.searchParams.set('_image_retry', String(Date.now()));
        state.current = url.href;
        failed.delete(img);
        img.src = state.current;
    }
    document.addEventListener('click', event => {
        if (!failed.has(event.target)) return;
        // Retrying a placeholder should not also open the product or gallery.
        event.preventDefault();
        event.stopImmediatePropagation();
        retryFailed(event.target, true);
    }, true);
    function resumeVisible() {
        for (const img of failed) {
            const state = states.get(img);
            if (state && !state.timer && state.rounds < cooldowns.length) retryFailed(img);
        }
    }
    document.addEventListener('visibilitychange', resumeVisible);
    document.addEventListener('scroll', resumeVisible, {capture:true, passive:true});
    document.addEventListener('error', event => recover(event.target), true);
    document.addEventListener('load', event => {
        const img = event.target;
        const state = states.get(img);
        if (state && img.getAttribute('src') !== placeholder) {
            if (state.timer) clearTimeout(state.timer);
            states.delete(img);
            failed.delete(img);
        }
    }, true);
    window.addEventListener('online', () => {
        for (const img of failed) {
            retryFailed(img, true);
        }
    });
})();
