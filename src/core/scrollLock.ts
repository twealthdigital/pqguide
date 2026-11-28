/**
 * Locks page scrolling while a dialog, sheet or drawer is open.
 *
 * Only `html` is ever set to overflow hidden. Never set overflow on `body`
 * as well: once `html` has a non visible overflow, `body` stops handing its
 * overflow to the viewport and becomes a scroll container itself, which breaks
 * `position: sticky` and makes the desktop side panel jump up the page.
 *
 * Locks are counted, so stacked overlays (a drawer plus a dialog) release the
 * page only when the last one closes.
 */
let lockCount = 0;
let saved: { htmlOverflow: string; bodyPaddingRight: string } | null = null;

export function lockPageScroll(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  const html = document.documentElement;
  const body = document.body;

  if (lockCount === 0) {
    saved = {
      htmlOverflow: html.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };
    // Keep the layout from shifting when the page scrollbar disappears
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && saved) {
      html.style.overflow = saved.htmlOverflow;
      body.style.paddingRight = saved.bodyPaddingRight;
      saved = null;
    }
  };
}
