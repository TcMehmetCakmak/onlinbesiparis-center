// Keep product controls outside the scrollable list on customer and admin pages.
(() => {
    const list = document.getElementById('productList');
    if (!list) return;
    function resizeList() {
        if (!list.getClientRects().length) return;
        const top = list.getBoundingClientRect().top;
        const height = Math.max(160, Math.floor(window.innerHeight - top - 20));
        const value = `${height}px`;
        if (list.style.maxHeight !== value) list.style.maxHeight = value;
        list.style.overflowY = 'auto';
        list.style.overscrollBehaviorY = 'contain';
        list.style.alignContent = 'start';
        list.style.scrollbarGutter = 'stable';
    }
    window.addEventListener('resize', resizeList);
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(resizeList);
        observer.observe(document.body);
        if (list.parentElement) observer.observe(list.parentElement);
    }
    resizeList();
})();
