/* Incremental card rendering; keeps existing cards and their event handlers. */
(() => {
    function createProductListPager({list, items, renderItem, initialSize = 12, pageSize = 6}) {
        let rendered = 0;
        let active = true;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'product-pagination-more';
        more.textContent = 'Daha fazla ürün göster';
        const observer = typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) loadMore();
            }, {root: list, rootMargin: '0px 0px 80px 0px'})
            : null;
        function append(count) {
            if (!active) return;
            observer?.unobserve(more);
            const end = Math.min(rendered + count, items.length);
            while (rendered < end) {
                list.insertBefore(renderItem(items[rendered]), more.parentNode === list ? more : null);
                rendered++;
            }
            if (rendered < items.length) {
                list.appendChild(more);
                observer?.observe(more);
            } else {
                more.remove();
                observer?.disconnect();
            }
        }
        function loadMore() { append(pageSize); }
        function onScroll() {
            if (list.scrollTop > 0 && list.scrollHeight - list.scrollTop - list.clientHeight <= 80) loadMore();
        }
        more.addEventListener('click', loadMore);
        if (!observer) list.addEventListener('scroll', onScroll, {passive:true});
        append(initialSize);
        return {
            get renderedCount() { return rendered; },
            loadMore,
            destroy() {
                active = false;
                observer?.disconnect();
                list.removeEventListener('scroll', onScroll);
                more.removeEventListener('click', loadMore);
                more.remove();
            }
        };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = {createProductListPager};
    else window.createProductListPager = createProductListPager;
})();
