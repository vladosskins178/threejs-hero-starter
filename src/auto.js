// Tiny entry point with no three.js import. three.js and the model are only
// fetched once a hero is about to scroll into view and the browser is idle.

function saveDataOn() {
  return Boolean(navigator.connection && navigator.connection.saveData);
}

export function autoMount(selector = '.hero-3d') {
  for (const el of document.querySelectorAll(selector)) {
    // Save-Data: keep the poster and skip the 3D download entirely.
    if (saveDataOn()) {
      el.dataset.tier = 'off';
      el.dataset.state = 'fallback';
      continue;
    }
    const start = () => {
      const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
      idle(
        async () => {
          try {
            const { mountHero } = await import('./hero.js');
            await mountHero(el);
          } catch (err) {
            console.warn('[hero] 3D could not start, keeping the poster.', err);
            el.dataset.state = 'fallback';
          }
        },
        { timeout: 1500 },
      );
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
  }
}
