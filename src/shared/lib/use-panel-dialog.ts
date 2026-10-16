import { useEffect, useRef, type RefObject } from 'react';

/** Keep the panel mounted so opening and closing it never discards author drafts. */
export function usePanelDialog(
  panel: RefObject<HTMLElement>,
  active: boolean,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = panel.current;
    if (!active || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const outside: { element: HTMLElement; inert: boolean; hidden: string | null }[] = [];
    for (
      let branch: HTMLElement | null = element;
      branch?.parentElement;
      branch = branch.parentElement
    ) {
      for (const sibling of branch.parentElement.children) {
        if (
          !(sibling instanceof HTMLElement) ||
          sibling === branch ||
          sibling.hasAttribute('data-panel-backdrop')
        )
          continue;
        outside.push({
          element: sibling,
          inert: sibling.inert,
          hidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (branch.parentElement === document.body) break;
    }
    const controls = () =>
      [
        ...element.querySelectorAll<HTMLElement>(
          'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        (node) =>
          !node.matches(':disabled') &&
          !node.closest('[hidden], [inert]') &&
          node.getClientRects().length > 0,
      );
    const focusFirst = () => (controls()[0] ?? element).focus();
    const onKey = (event: KeyboardEvent) => {
      // A confirmation dialog above this drawer owns its own keyboard handling.
      if (!element.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      } else if (event.key === 'Tab') {
        const nodes = controls();
        const first = nodes[0] ?? element;
        const last = nodes.at(-1) ?? element;
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === element)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === element)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]') !== element &&
        event.target.closest('[role="dialog"]')
      )
        return;
      if (event.target instanceof Node && !element.contains(event.target)) focusFirst();
    };
    focusFirst();
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      outside.forEach(({ element: node, inert, hidden }) => {
        node.inert = inert;
        if (hidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', hidden);
      });
      if (previous?.isConnected) previous.focus();
    };
  }, [active, panel]);
}
