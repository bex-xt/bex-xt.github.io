/**
 * Premium Custom Scrollbar
 * Designed as a native extension of the dark portfolio design system.
 * Matches: #060807 background, #8bb596 accent, glass-panel language, 80px grid.
 * Desktop-only — falls back to native on touch devices.
 *
 * Performance architecture:
 *   PRIMARY: CSS Scroll-Driven Animation (animation-timeline: scroll())
 *     → Thumb position is computed on the COMPOSITOR THREAD, identical to how
 *       native browser scrollbars work. Zero main-thread involvement during scroll.
 *   FALLBACK: Direct scroll-event positioning for older browsers.
 *   Layout metrics are cached via ResizeObserver. JS only handles state classes
 *   (show/hide/scrolling glow) — never position when compositor mode is active.
 */
(function () {
  "use strict";

  /* ── Guard: skip on touch / very small screens ── */
  const isTouchDevice =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches;
  if (isTouchDevice || window.innerWidth < 768) return;

  /* ── Feature detect: CSS Scroll-Driven Animations ── */
  const useCompositor =
    CSS.supports && CSS.supports("animation-timeline: scroll()");

  /* ── Design tokens (pulled from the site CSS variables) ── */
  const TOKENS = {
    bg: "6, 8, 7",
    accent: "139, 181, 150",
    line: "150, 185, 162",
    glow: "72, 122, 93",
  };

  /* ── Config ── */
  const CFG = {
    trackWidth: 6,
    trackWidthHover: 10,
    thumbMinHeight: 36,
    thumbBorderRadius: 20,
    fadeDelay: 1200,
    fadeDuration: 600,
    scrollEndDelay: 150,
    rightOffset: 3,
    topOffset: 4,
    bottomOffset: 4,
  };

  /* ── State ── */
  let scrollTimeout = null;
  let fadeTimeout = null;
  let isScrolling = false;
  let isHovering = false;
  let isDragging = false;
  let dragStartY = 0;
  let dragStartScrollTop = 0;

  /* Cached layout values — updated on resize only */
  let cachedScrollHeight = 0;
  let cachedClientHeight = 0;
  let cachedTrackHeight = 0;
  let cachedThumbHeight = 0;
  let cachedMaxScroll = 0;
  let cachedMaxThumbTop = 0;

  /* ── Create scrollbar DOM ── */
  const track = document.createElement("div");
  track.className = "cs-track";
  track.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("div");
  thumb.className = "cs-thumb";

  const thumbGlow = document.createElement("div");
  thumbGlow.className = "cs-thumb-glow";

  thumb.appendChild(thumbGlow);
  track.appendChild(thumb);
  document.body.appendChild(track);

  /* ── Inject styles ── */
  const style = document.createElement("style");
  style.textContent = `
    /* ── Hide native scrollbar ── */
    html {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    main::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    /* ── Scroll-driven animation keyframes ── */
    @keyframes cs-scroll-pos {
      from { transform: translate3d(0, 0, 0); }
      to   { transform: translate3d(0, var(--cs-max-offset, 0px), 0); }
    }

    /* ── Track ── */
    .cs-track {
      position: fixed;
      top: ${CFG.topOffset}px;
      right: ${CFG.rightOffset}px;
      bottom: ${CFG.bottomOffset}px;
      width: ${CFG.trackWidth}px;
      z-index: 99997;
      pointer-events: auto;
      opacity: 0;
      transition:
        width ${CFG.fadeDuration * 0.5}ms cubic-bezier(.25, .8, .25, 1),
        opacity ${CFG.fadeDuration}ms cubic-bezier(.4, 0, .2, 1);
      will-change: opacity;
      background: linear-gradient(
        180deg,
        rgba(${TOKENS.line}, 0.0) 0%,
        rgba(${TOKENS.line}, 0.03) 12%,
        rgba(${TOKENS.line}, 0.03) 88%,
        rgba(${TOKENS.line}, 0.0) 100%
      );
      border-radius: ${CFG.thumbBorderRadius}px;
    }

    .cs-track.visible {
      opacity: 1;
    }

    .cs-track.hovering {
      width: ${CFG.trackWidthHover}px;
      background: linear-gradient(
        180deg,
        rgba(${TOKENS.line}, 0.0) 0%,
        rgba(${TOKENS.line}, 0.06) 12%,
        rgba(${TOKENS.line}, 0.06) 88%,
        rgba(${TOKENS.line}, 0.0) 100%
      );
    }

    .cs-track.dragging {
      width: ${CFG.trackWidthHover}px;
    }

    /* ── Thumb ── */
    .cs-thumb {
      position: absolute;
      top: 0;
      right: 0;
      width: 100%;
      min-height: ${CFG.thumbMinHeight}px;
      border-radius: ${CFG.thumbBorderRadius}px;
      cursor: grab;
      transition:
        opacity 0.3s cubic-bezier(.25, .8, .25, 1),
        box-shadow 0.4s cubic-bezier(.25, .8, .25, 1),
        background 0.3s ease,
        border-color 0.3s ease;
      will-change: transform;

      background:
        linear-gradient(
          180deg,
          rgba(${TOKENS.line}, 0.18) 0%,
          rgba(${TOKENS.bg}, 0.7) 40%,
          rgba(${TOKENS.line}, 0.12) 100%
        );
      border: 1px solid rgba(${TOKENS.line}, 0.12);
      box-shadow:
        0 0 0 0 rgba(${TOKENS.accent}, 0),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    /* ── Compositor-driven positioning (runs on GPU thread like native scrollbar) ── */
    .cs-thumb.cs-compositor {
      animation-name: cs-scroll-pos;
      animation-timing-function: linear;
      animation-fill-mode: both;
      animation-timeline: scroll(root);
    }

    .cs-thumb:active {
      cursor: grabbing;
    }

    .cs-thumb-glow {
      position: absolute;
      inset: 1px;
      border-radius: ${CFG.thumbBorderRadius - 1}px;
      background: radial-gradient(
        ellipse at 50% 30%,
        rgba(${TOKENS.accent}, 0.0) 0%,
        transparent 70%
      );
      transition: background 0.5s cubic-bezier(.25, .8, .25, 1);
      pointer-events: none;
    }

    /* ── Hover state ── */
    .cs-track.hovering .cs-thumb,
    .cs-track.dragging .cs-thumb {
      background:
        linear-gradient(
          180deg,
          rgba(${TOKENS.line}, 0.28) 0%,
          rgba(${TOKENS.bg}, 0.65) 40%,
          rgba(${TOKENS.line}, 0.2) 100%
        );
      border-color: rgba(${TOKENS.line}, 0.22);
      box-shadow:
        0 0 12px 2px rgba(${TOKENS.accent}, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    .cs-track.hovering .cs-thumb-glow,
    .cs-track.dragging .cs-thumb-glow {
      background: radial-gradient(
        ellipse at 50% 30%,
        rgba(${TOKENS.accent}, 0.14) 0%,
        rgba(255, 255, 255, 0.02) 40%,
        transparent 70%
      );
    }

    /* ── Scrolling (active) state ── */
    .cs-track.scrolling .cs-thumb {
      background:
        linear-gradient(
          180deg,
          rgba(${TOKENS.accent}, 0.22) 0%,
          rgba(${TOKENS.bg}, 0.6) 40%,
          rgba(${TOKENS.accent}, 0.14) 100%
        );
      border-color: rgba(${TOKENS.accent}, 0.18);
      box-shadow:
        0 0 16px 3px rgba(${TOKENS.accent}, 0.12),
        0 0 4px 1px rgba(${TOKENS.accent}, 0.06),
        inset 0 1px 0 rgba(255, 255, 255, 0.07);
    }

    .cs-track.scrolling .cs-thumb-glow {
      background: radial-gradient(
        ellipse at 50% 30%,
        rgba(${TOKENS.accent}, 0.2) 0%,
        rgba(255, 255, 255, 0.03) 40%,
        transparent 70%
      );
    }

    /* ── Idle / subtle state ── */
    .cs-track.idle {
      opacity: 0.45;
    }

    .cs-track.idle .cs-thumb {
      box-shadow:
        0 0 0 0 rgba(${TOKENS.accent}, 0),
        inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .cs-track.idle .cs-thumb-glow {
      background: radial-gradient(
        ellipse at 50% 30%,
        rgba(${TOKENS.accent}, 0.0) 0%,
        transparent 70%
      );
    }
  `;
  document.head.appendChild(style);

  /* ── Cache layout values (called on resize / init only) ── */
  function cacheLayout() {
    cachedScrollHeight = document.documentElement.scrollHeight;
    cachedClientHeight = document.documentElement.clientHeight;
    cachedTrackHeight = track.clientHeight;

    const ratio = cachedClientHeight / cachedScrollHeight;
    cachedThumbHeight = Math.max(CFG.thumbMinHeight, cachedTrackHeight * ratio);
    cachedMaxScroll = cachedScrollHeight - cachedClientHeight;
    cachedMaxThumbTop = cachedTrackHeight - cachedThumbHeight;

    thumb.style.height = cachedThumbHeight + "px";

    if (useCompositor) {
      // Set the CSS custom property for the scroll-driven animation endpoint
      track.style.setProperty("--cs-max-offset", cachedMaxThumbTop + "px");
      // Restart animation so it picks up the new --cs-max-offset value
      thumb.style.animationName = "none";
      requestAnimationFrame(() => {
        thumb.style.animationName = "";
      });
    } else {
      syncThumbPosition();
    }
  }

  /* ── JS fallback: direct thumb position sync ── */
  function syncThumbPosition() {
    if (cachedMaxScroll <= 0) return;
    const progress = window.scrollY / cachedMaxScroll;
    const thumbTop = progress * cachedMaxThumbTop;
    thumb.style.transform = `translate3d(0,${thumbTop}px,0)`;
  }

  /* ── Visibility management ── */
  function showScrollbar(activeState) {
    clearTimeout(fadeTimeout);
    track.classList.add("visible");
    track.classList.remove("idle");
    if (activeState === "scrolling") {
      track.classList.add("scrolling");
    }
  }

  function scheduleHide() {
    clearTimeout(fadeTimeout);
    if (isHovering || isDragging) return;

    fadeTimeout = setTimeout(() => {
      track.classList.remove("scrolling");
      track.classList.add("idle");

      fadeTimeout = setTimeout(() => {
        if (!isHovering && !isDragging && !isScrolling) {
          track.classList.remove("visible", "idle");
        }
      }, CFG.fadeDuration + 200);
    }, CFG.fadeDelay);
  }

  /* ── Scroll handler: state management + fallback positioning ── */
  function onScroll() {
    // JS fallback: position thumb directly (only when compositor mode unavailable)
    if (!useCompositor) {
      syncThumbPosition();
    }

    // State management (always needed regardless of positioning method)
    if (!isScrolling) {
      isScrolling = true;
      showScrollbar("scrolling");
    }

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      track.classList.remove("scrolling");
      scheduleHide();
    }, CFG.scrollEndDelay);
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  /* ── Track hover ── */
  track.addEventListener("mouseenter", () => {
    isHovering = true;
    showScrollbar();
    track.classList.add("hovering");
  });

  track.addEventListener("mouseleave", () => {
    isHovering = false;
    if (!isDragging) {
      track.classList.remove("hovering");
      scheduleHide();
    }
  });

  /* ── Click on track to jump ── */
  track.addEventListener("mousedown", (e) => {
    if (e.target === thumb || thumb.contains(e.target)) {
      startDrag(e);
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const clickY = e.clientY - trackRect.top;
    const ratio = clickY / cachedTrackHeight;

    window.scrollTo({
      top: ratio * cachedMaxScroll,
      behavior: "smooth",
    });
  });

  /* ── Thumb drag ── */
  function startDrag(e) {
    e.preventDefault();
    isDragging = true;
    dragStartY = e.clientY;
    dragStartScrollTop = window.scrollY;

    track.classList.add("dragging");
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging) return;

    const deltaY = e.clientY - dragStartY;
    const scrollDelta = cachedMaxThumbTop > 0
      ? (deltaY / cachedMaxThumbTop) * cachedMaxScroll
      : 0;

    window.scrollTo(0, dragStartScrollTop + scrollDelta);
  }

  function onDragEnd() {
    isDragging = false;
    track.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";

    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);

    if (!isHovering) {
      track.classList.remove("hovering");
      scheduleHide();
    }
  }

  thumb.addEventListener("mousedown", startDrag);

  /* ── Resize handling — recache layout ── */
  const resizeObserver = new ResizeObserver(() => {
    cacheLayout();
  });
  resizeObserver.observe(document.documentElement);

  /* ── Initialize ── */
  requestAnimationFrame(() => {
    cacheLayout();

    // Activate compositor-driven positioning if supported
    if (useCompositor) {
      thumb.classList.add("cs-compositor");
    }

    // Brief reveal on load
    showScrollbar();
    setTimeout(() => {
      scheduleHide();
    }, 800);
  });

  /* ── Fullscreen support ── */
  document.addEventListener("fullscreenchange", () => {
    requestAnimationFrame(cacheLayout);
  });

  /* ── Cleanup on page hide ── */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(scrollTimeout);
      clearTimeout(fadeTimeout);
    } else {
      cacheLayout();
    }
  });
})();
