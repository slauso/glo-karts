const STYLE_ID = 'gk-page-transition-style';
const NAV_DURATION_MS = 220;

let linkHandlerInstalled = false;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ensureTransitionStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.gk-preload body {
      opacity: 0;
    }

    body.gk-page-shell {
      opacity: 0;
      transform: translateY(10px) scale(0.996);
      transition:
        opacity 220ms ease,
        transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    body.gk-page-shell::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      opacity: 1;
      background:
        radial-gradient(circle at 50% 20%, rgba(255, 0, 128, 0.08), transparent 42%),
        linear-gradient(180deg, rgba(5, 5, 10, 0.18), rgba(5, 5, 10, 0.34));
      transition: opacity 220ms ease;
    }

    body.gk-page-shell.gk-page-ready {
      opacity: 1;
      transform: none;
    }

    body.gk-page-shell.gk-page-ready::before {
      opacity: 0;
    }

    body.gk-page-shell.gk-page-exiting {
      opacity: 0;
      transform: translateY(8px) scale(0.995);
      pointer-events: none;
    }

    body.gk-page-shell.gk-page-exiting::before {
      opacity: 1;
    }

    @media (prefers-reduced-motion: reduce) {
      body.gk-page-shell,
      body.gk-page-shell::before {
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function isTransitionableAnchor(anchor) {
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
  if (anchor.hasAttribute('data-no-transition')) return false;

  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.href === window.location.href) return false;
  return true;
}

function installGlobalLinkTransitions() {
  if (linkHandlerInstalled || typeof document === 'undefined') return;

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest('a[href]');
    if (!isTransitionableAnchor(anchor)) return;

    event.preventDefault();
    navigateWithTransition(anchor.href);
  }, true);

  linkHandlerInstalled = true;
}

export function navigateWithTransition(url, options = {}) {
  const { replace = false, immediate = false, durationMs = NAV_DURATION_MS } = options;
  const targetHref = new URL(url, window.location.href).href;

  if (immediate || prefersReducedMotion()) {
    if (replace) window.location.replace(targetHref);
    else window.location.href = targetHref;
    return Promise.resolve();
  }

  const body = document.body;
  if (!body) {
    if (replace) window.location.replace(targetHref);
    else window.location.href = targetHref;
    return Promise.resolve();
  }

  if (body.dataset.gkNavigating === '1') {
    return Promise.resolve();
  }

  body.dataset.gkNavigating = '1';
  body.classList.add('gk-page-shell', 'gk-page-exiting');
  body.classList.remove('gk-page-ready');

  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (replace) window.location.replace(targetHref);
      else window.location.href = targetHref;
      resolve();
    }, durationMs);
  });
}

export function initPageTransitions(options = {}) {
  const { waitForReady = false } = options;

  if (typeof document === 'undefined') {
    return { markReady() {} };
  }

  ensureTransitionStyles();
  installGlobalLinkTransitions();

  const html = document.documentElement;
  let readyRequested = !waitForReady;
  let pageShowInstalled = false;

  const applyBodyState = () => {
    const body = document.body;
    if (!body) return false;

    body.classList.add('gk-page-shell');

    if (!pageShowInstalled) {
      window.addEventListener('pageshow', () => {
        body.dataset.gkNavigating = '0';
        if (readyRequested) {
          body.classList.remove('gk-page-exiting');
          body.classList.add('gk-page-ready');
          html.classList.remove('gk-preload');
        }
      }, { once: true });
      pageShowInstalled = true;
    }

    return true;
  };

  const markReady = () => {
    readyRequested = true;
    const body = document.body;
    if (!body) return;
    body.classList.remove('gk-page-exiting');
    body.classList.add('gk-page-ready');
    body.dataset.gkNavigating = '0';
    html.classList.remove('gk-preload');
  };

  const boot = () => {
    if (!applyBodyState()) return;
    if (readyRequested) {
      requestAnimationFrame(() => {
        requestAnimationFrame(markReady);
      });
    }
  };

  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }

  return { markReady };
}
