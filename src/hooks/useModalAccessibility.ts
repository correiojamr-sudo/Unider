import { useLayoutEffect, useRef, type RefObject } from 'react';

type Modal = { overlay: HTMLElement; dialog: HTMLElement; previous: Element | null };
const stack: Modal[] = [];
const originalInert = new Map<HTMLElement, boolean>();
const selector = 'button, a[href], input, textarea, select, [tabindex]';

function focusable(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(selector)].filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0);
}

function updateBackground() {
  const active = stack.at(-1);
  if (!active) {
    originalInert.forEach((value, element) => { element.inert = value; });
    originalInert.clear();
    return;
  }
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (!originalInert.has(child)) originalInert.set(child, child.inert);
    child.inert = child !== active.overlay || originalInert.get(child) === true;
  }
}

export function useModalAccessibility(overlayRef: RefObject<HTMLDivElement | null>,
  dialogRef: RefObject<HTMLDivElement | null>, onDismiss?: () => void) {
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => { dismiss.current = onDismiss; });
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;
    const modal = { overlay, dialog, previous: document.activeElement };
    stack.push(modal);
    updateBackground();
    const initial = () => (dialog.querySelector<HTMLElement>('[data-modal-initial-focus]') || focusable(dialog)[0] || dialog).focus();
    initial();
    const keydown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== modal) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        dismiss.current?.();
      } else if (event.key === 'Tab') {
        const elements = focusable(dialog);
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (!elements.length) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
        else if (!event.shiftKey && (index < 0 || index === elements.length - 1)) { event.preventDefault(); elements[0].focus(); }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (stack.at(-1) === modal && !dialog.contains(event.target as Node)) initial();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    // Also protect body children introduced while the dialog is open.
    const observer = new MutationObserver(() => {
      updateBackground();
      if (stack.at(-1) === modal && !dialog.contains(document.activeElement)) initial();
    });
    observer.observe(document.body, { childList: true });
    observer.observe(dialog, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      const wasTop = stack.at(-1) === modal;
      stack.splice(stack.indexOf(modal), 1);
      updateBackground();
      if (wasTop) {
        const previous = modal.previous;
        if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]') && !previous.matches(':disabled')) previous.focus();
        else stack.at(-1)?.dialog.focus();
      }
    };
  }, [overlayRef, dialogRef]);
}
