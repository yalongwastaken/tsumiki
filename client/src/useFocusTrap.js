// useFocusTrap.js — keyboard accessibility for modal dialogs: traps Tab focus
// inside the panel, closes on Escape, and restores focus to the trigger on close.
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * @param {boolean} active - whether the modal is open
 * @param {Function} [onEscape] - called when Escape is pressed
 * @returns {React.RefObject} ref to attach to the modal panel
 */
export function useFocusTrap(active, onEscape) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) {
      return;
    }
    const node = ref.current;
    const restoreTo = document.activeElement; // remember the trigger to restore later
    const visible = () =>
      Array.from(node?.querySelectorAll(FOCUSABLE) || []).filter((el) => el.offsetParent !== null);

    function onKey(e) {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }
      if (e.key !== "Tab") {
        return;
      }
      const f = visible();
      if (!f.length) {
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      // wrap focus at the edges so Tab never escapes the dialog
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      // restore focus to whatever opened the modal (if it's still around)
      if (restoreTo && typeof restoreTo.focus === "function") {
        restoreTo.focus();
      }
    };
  }, [active, onEscape]);
  return ref;
}
