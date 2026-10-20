/* Shared by customer and admin pages. Retry transient image delivery failures. */
(() => {
    const states = new WeakMap();
    const failed = new Set();
    const delays = [800, 2400];
    const placeholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#f3f4f6"/><text x="160" y="120" text-anchor="middle" fill="#667085" font-family="sans-serif" font-size="16">Fotoğraf yüklenemedi</text></svg>'
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
            state = { original: source, current: source, attempts: 0, timer: null };
            states.set(img, state);
            failed.delete(img);
        }
        if (state.timer) return;
        if (state.attempts >= delays.length) {
            for (const previous of failed) if (!previous.isConnected) failed.delete(previous);
            failed.add(img);
            state.current = placeholder;
            img.src = placeholder;
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
            const state = states.get(img);
            failed.delete(img);
            if (!img.isConnected || !state || img.getAttribute('src') !== placeholder) continue;
            states.delete(img);
            img.src = state.original;
        }
    });
})();
