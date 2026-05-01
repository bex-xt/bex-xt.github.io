/**
 * Custom Cursor System
 * Matches the dark premium aesthetic of the portfolio.
 * Desktop only — preserves native cursor on touch/mobile devices.
 *
 * Performance architecture:
 *   Dot  → follows mouse DIRECTLY in mousemove handler (zero-frame delay)
 *   Halo → trails with smooth easing in a single rAF loop (premium feel)
 *   Both are independent fixed elements with their own transforms.
 */
(function () {
  "use strict";

  /* ── Guard: skip on touch / small screens ── */
  const isTouchDevice =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches;
  if (isTouchDevice || window.innerWidth < 768) return;

  /* ── Config ── */
  const CFG = {
    dotSize: 6,
    haloSize: 32,
    haloEasing: 0.12,
    hoverScale: 1.5,
    haloHoverScale: 1.6,
    rippleDuration: 750,
    ripple2Delay: 100,
    ripple2Duration: 950,
    accentColor: "139, 181, 150", // #8bb596 as RGB
  };

  const HALF_DOT = CFG.dotSize / 2;
  const HALF_HALO = CFG.haloSize / 2;

  /* ── State ── */
  let mx = -100,
    my = -100; // raw mouse position
  let hx = -100,
    hy = -100; // halo eased position
  let hovering = false;
  let cursorVisible = true;
  let raf;

  /* ── Create DOM: dot and halo as independent fixed elements ── */
  const dotEl = document.createElement("div");
  dotEl.className = "cc-dot-wrap";

  const dotInner = document.createElement("div");
  dotInner.className = "cc-dot";
  dotEl.appendChild(dotInner);

  const haloEl = document.createElement("div");
  haloEl.className = "cc-halo-wrap";

  const haloInner = document.createElement("div");
  haloInner.className = "cc-halo";
  haloEl.appendChild(haloInner);

  document.body.appendChild(haloEl);
  document.body.appendChild(dotEl);

  /* ── Ripple container ── */
  const rippleLayer = document.createElement("div");
  rippleLayer.className = "cc-ripple-layer";
  document.body.appendChild(rippleLayer);

  /* ── Inject styles ── */
  const style = document.createElement("style");
  style.textContent = `
    /* Hide default cursor on non-input elements */
    html.cc-active,
    html.cc-active a,
    html.cc-active button,
    html.cc-active [role="button"],
    html.cc-active article,
    html.cc-active nav,
    html.cc-active header,
    html.cc-active section,
    html.cc-active div,
    html.cc-active span,
    html.cc-active p,
    html.cc-active h1, html.cc-active h2, html.cc-active h3 {
      cursor: none !important;
    }
    /* Preserve native cursor for inputs */
    html.cc-active input,
    html.cc-active textarea,
    html.cc-active select,
    html.cc-active [contenteditable="true"] {
      cursor: auto !important;
    }

    /* Shared wrapper style for both dot and halo */
    .cc-dot-wrap,
    .cc-halo-wrap {
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 99999;
      will-change: transform;
    }

    .cc-dot {
      position: relative;
      width: ${CFG.dotSize}px;
      height: ${CFG.dotSize}px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,252,245,0.95) 0%, rgba(255,248,235,0.7) 100%);
      box-shadow: 0 0 4px 1px rgba(255,250,240,0.35);
      transform: translate(-50%, -50%);
      transition: width 0.3s cubic-bezier(.25,.8,.25,1),
                  height 0.3s cubic-bezier(.25,.8,.25,1),
                  box-shadow 0.3s ease;
    }

    .cc-dot.hover {
      width: ${CFG.dotSize * CFG.hoverScale}px;
      height: ${CFG.dotSize * CFG.hoverScale}px;
      box-shadow: 0 0 8px 2px rgba(255,250,240,0.5);
    }

    .cc-halo {
      position: relative;
      width: ${CFG.haloSize}px;
      height: ${CFG.haloSize}px;
      border-radius: 50%;
      background: radial-gradient(circle,
        rgba(${CFG.accentColor}, 0.06) 0%,
        rgba(${CFG.accentColor}, 0.03) 40%,
        transparent 70%
      );
      border: 1px solid rgba(${CFG.accentColor}, 0.06);
      transform: translate(-50%, -50%);
      transition: width 0.35s cubic-bezier(.25,.8,.25,1),
                  height 0.35s cubic-bezier(.25,.8,.25,1),
                  background 0.35s ease,
                  border-color 0.35s ease;
    }

    .cc-halo.hover {
      width: ${CFG.haloSize * CFG.haloHoverScale}px;
      height: ${CFG.haloSize * CFG.haloHoverScale}px;
      background: radial-gradient(circle,
        rgba(${CFG.accentColor}, 0.12) 0%,
        rgba(${CFG.accentColor}, 0.05) 40%,
        transparent 70%
      );
      border-color: rgba(${CFG.accentColor}, 0.14);
    }

    /* ── Ripple layer ── */
    .cc-ripple-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 99998;
      overflow: hidden;
    }

    .cc-ripple {
      position: absolute;
      border-radius: 50%;
      border: 1.5px solid rgba(255, 252, 245, 0.45);
      background: radial-gradient(circle,
        rgba(${CFG.accentColor}, 0.12) 0%,
        rgba(${CFG.accentColor}, 0.06) 40%,
        transparent 70%
      );
      box-shadow: 0 0 18px 4px rgba(${CFG.accentColor}, 0.22),
                  inset 0 0 10px rgba(${CFG.accentColor}, 0.10);
      transform: translate(-50%, -50%) scale(0);
      opacity: 1;
      pointer-events: none;
    }

    .cc-ripple.animate {
      animation: cc-ripple-expand var(--duration) cubic-bezier(.22,.61,.36,1) forwards;
    }

    .cc-ripple.secondary {
      border-color: rgba(${CFG.accentColor}, 0.35);
      background: radial-gradient(circle,
        rgba(${CFG.accentColor}, 0.08) 0%,
        rgba(${CFG.accentColor}, 0.03) 50%,
        transparent 70%
      );
      box-shadow: 0 0 24px 6px rgba(${CFG.accentColor}, 0.16);
    }

    @keyframes cc-ripple-expand {
      0% {
        transform: translate(-50%, -50%) scale(0);
        opacity: 1;
      }
      30% {
        opacity: 0.7;
      }
      60% {
        opacity: 0.35;
      }
      100% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);

  /* ── Activate ── */
  document.documentElement.classList.add("cc-active");

  /* ── Hover detection ── */
  const interactiveSelector =
    'a, button, [role="button"], nav a, .glass-panel, article, [onclick], input[type="submit"], .section-shell a';

  function onMouseOver(e) {
    if (e.target.closest(interactiveSelector)) {
      hovering = true;
      dotInner.classList.add("hover");
      haloInner.classList.add("hover");
    }
  }
  function onMouseOut(e) {
    if (e.target.closest(interactiveSelector)) {
      hovering = false;
      dotInner.classList.remove("hover");
      haloInner.classList.remove("hover");
    }
  }
  document.addEventListener("mouseover", onMouseOver, { passive: true });
  document.addEventListener("mouseout", onMouseOut, { passive: true });

  /* ── Hide custom cursor when over inputs ── */
  const inputSelector = 'input, textarea, select, [contenteditable="true"]';
  document.addEventListener(
    "mouseover",
    (e) => {
      if (e.target.closest(inputSelector)) {
        cursorVisible = false;
        dotEl.style.opacity = "0";
        haloEl.style.opacity = "0";
      }
    },
    { passive: true }
  );
  document.addEventListener(
    "mouseout",
    (e) => {
      if (e.target.closest(inputSelector)) {
        cursorVisible = true;
        dotEl.style.opacity = "1";
        haloEl.style.opacity = "1";
      }
    },
    { passive: true }
  );

  /* ── Mouse tracking: dot updates IMMEDIATELY in the event handler ── */
  document.addEventListener(
    "mousemove",
    (e) => {
      mx = e.clientX;
      my = e.clientY;
      // Dot follows mouse with zero delay — written directly in the input event
      dotEl.style.transform = `translate3d(${mx}px,${my}px,0)`;
    },
    { passive: true }
  );

  /* ── rAF loop: only for halo easing (single loop, lightweight) ── */
  function render() {
    hx += (mx - hx) * CFG.haloEasing;
    hy += (my - hy) * CFG.haloEasing;
    haloEl.style.transform = `translate3d(${hx}px,${hy}px,0)`;
    raf = requestAnimationFrame(render);
  }
  raf = requestAnimationFrame(render);

  /* ── Click ripple ── */
  function spawnRipple(x, y, size, duration, delay, secondary) {
    const el = document.createElement("div");
    el.className = "cc-ripple" + (secondary ? " secondary" : "");
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.setProperty("--duration", duration + "ms");

    if (delay) {
      setTimeout(() => {
        rippleLayer.appendChild(el);
        requestAnimationFrame(() => el.classList.add("animate"));
        setTimeout(() => el.remove(), duration + 50);
      }, delay);
    } else {
      rippleLayer.appendChild(el);
      requestAnimationFrame(() => el.classList.add("animate"));
      setTimeout(() => el.remove(), duration + 50);
    }

    /* ── Subtle card border glow on click ── */
    const target = document.elementFromPoint(x, y);
    if (target) {
      const card = target.closest(".glass-panel, .section-shell");
      if (card) {
        card.style.transition = "border-color 0.2s ease, box-shadow 0.2s ease";
        card.style.borderColor = `rgba(${CFG.accentColor}, 0.25)`;
        card.style.boxShadow = `0 0 20px 4px rgba(${CFG.accentColor}, 0.06), ${getComputedStyle(card).boxShadow}`;
        setTimeout(() => {
          card.style.borderColor = "";
          card.style.boxShadow = "";
          setTimeout(() => (card.style.transition = ""), 400);
        }, 500);
      }
    }
  }

  document.addEventListener("click", (e) => {
    const x = e.clientX;
    const y = e.clientY;

    /* Primary ripple */
    spawnRipple(x, y, 90, CFG.rippleDuration, 0, false);

    /* Secondary softer ripple */
    spawnRipple(x, y, 140, CFG.ripple2Duration, CFG.ripple2Delay, true);
  });

  /* ── Cleanup on page hide ── */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(render);
  });
})();
