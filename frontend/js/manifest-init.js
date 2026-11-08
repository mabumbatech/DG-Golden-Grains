(function() {
    // Base folder of the current page (e.g. https://site.com/frontend/)
    var base = document.baseURI.replace(/[^/]*$/, '');

    var manifest = {
        name: 'GOLDEN GRAINS - Business Manager',
        short_name: 'GOLDEN GRAINS',
        description: 'Track stock, sales, expenses, damages and reports for GOLDEN GRAINS.',
        start_url: base + 'index.html',
        scope: base,
        display: 'standalone',
        background_color: '#062E1A',
        theme_color: '#062E1A',
        orientation: 'portrait-primary',
        icons: [
            { src: base + 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: base + 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: base + 'assets/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    };

    try {
        var blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('link');
        link.rel = 'manifest';
        link.href = url;
        document.head.appendChild(link);
    } catch (e) {
        // Fallback: if Blob creation somehow fails, still try the static file.
        var fallback = document.createElement('link');
        fallback.rel = 'manifest';
        fallback.href = 'manifest.json';
        document.head.appendChild(fallback);
    }
})();