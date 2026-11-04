/**
 * Publishes how much of the bottom of the window the keyboard covers (the
 * on-screen keyboard, or the shortcut bar of a hardware keyboard) as
 * `--ipad-keyboard-inset`, so chrome docked to the bottom can sit above it.
 * The layout viewport does not shrink for the keyboard; only the visual
 * viewport does.
 */
export function trackKeyboardInset(): void {
  const visual = window.visualViewport;
  if (!visual) return;
  const root = document.documentElement;
  const sync = (): void => {
    const covered = Math.max(0, window.innerHeight - (visual.offsetTop + visual.height));
    root.style.setProperty("--ipad-keyboard-inset", `${Math.round(covered)}px`);
  };
  sync();
  visual.addEventListener("resize", sync);
  visual.addEventListener("scroll", sync);
}
