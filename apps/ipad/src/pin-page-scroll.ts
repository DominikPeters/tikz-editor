/**
 * The iPad shell's layout never scrolls: panels and the canvas scroll inside
 * a fixed root. iOS still scrolls the page to reveal a focused field when the
 * on-screen keyboard appears after the field took focus (e.g. from the
 * keyboard button on the hardware-keyboard shortcut bar), which slides the
 * whole app, nav bar included, up under the status bar. Put it back.
 */
export function pinPageScroll(): void {
  const pin = (): void => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  };
  window.addEventListener("scroll", pin, { passive: true });
  window.visualViewport?.addEventListener("scroll", pin);
  window.visualViewport?.addEventListener("resize", pin);
}
