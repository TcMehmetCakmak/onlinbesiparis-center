/* Shared by customer and admin pages. Retry transient image delivery failures. */
(() => {
    const states = new WeakMap();
    const failed = new Set();
    const cooldowns = [15000, 45000, 120000];
    const delays = [1500, 4000, 9000];
    const placeholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#f3f4f6"/><text x="160" y="112" text-anchor="middle" fill="#667085" font-family="sans-serif" font-size="16">Fotoğraf yüklenemedi</text><text x="160" y="140" text-anchor="middle" fill="#667085" font-family="sans-serif" font-size="13">Tekrar denemek için dokunun</text></svg>'
    );
    const loadingPlaceholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#f3f4f6"/><text x="160" y="120" text-anchor="middle" fill="#667085" font-family="sans-serif" font-size="15">Fotoğraf yükleniyor…</text></svg>'
    );
    function sourceFor(state) {
        const url = new URL(state.original, document.baseURI);
        if (state.fallback) url.hostname = 'pub-c51be861a66041fd8d2f5f27349b59ee.r2.dev';
        return url;
    }
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
            if (state?.timer) clearTimeout(state.timer);
            state = { original: source, current: source, attempts: 0, rounds: 0, fallback: false, timer: null };
            states.set(img, state);
            failed.delete(img);
        }
        if (state.timer) return;
        // Public R2 and the worker serve the same object path. Try the alternate
        // endpoint once before spending the longer cooldown budget.
        if (state.attempts >= delays.length && !state.fallback && new URL(state.original, document.baseURI).hostname === 'image-uploader.tc-mehmetcakmak.workers.dev') {
            state.fallback = true;
            state.attempts = 0;
            state.current = sourceFor(state).href;
            img.src = state.current;
            return;
        }
        if (state.attempts >= delays.length) {
            for (const previous of failed) if (!previous.isConnected) failed.delete(previous);
            failed.add(img);
            state.current = state.rounds < cooldowns.length ? loadingPlaceholder : placeholder;
            img.src = state.current;
            if (state.rounds < cooldowns.length) {
                const delay = cooldowns[state.rounds];
                state.timer = setTimeout(() => {
                    state.timer = null;
                    retryFailed(img);
                }, delay + Math.floor(Math.random() * 3000));
            }
            if (state.current === placeholder) console.warn('Ürün fotoğrafı yeniden denemelere rağmen yüklenemedi:', new URL(state.original, document.baseURI).pathname);
            return;
        }
        const delay = delays[state.attempts++];
        state.timer = setTimeout(() => {
            state.timer = null;
            if (!img.isConnected || img.getAttribute('src') !== state.current) return;
            const url = sourceFor(state);
            url.searchParams.set('_image_retry', `${Date.now()}-${state.attempts}`);
            state.current = url.href;
            img.src = state.current;
        }, delay);
    }
    function retryFailed(img, manual = false) {
        const state = states.get(img);
        if (!state || !failed.has(img)) return;
        if (!img.isConnected || img.getAttribute('src') !== state.current || ![placeholder, loadingPlaceholder].includes(state.current)) {
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
        else state.rounds++;
        state.fallback = false;
        const url = sourceFor(state);
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
        if (state && ![placeholder, loadingPlaceholder].includes(img.getAttribute('src'))) {
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
