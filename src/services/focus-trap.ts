/**
 * Keyboard focus for dialogs.
 *
 * Opening a dialog should move focus into it and hold it there until it
 * closes; closing it should hand focus back to whatever opened it. Without
 * this a keyboard reader tabs off into the page behind the overlay, and when
 * the dialog closes they are somewhere else entirely.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export class FocusTrap {
  private readonly container: HTMLElement;
  private returnTo: HTMLElement | null = null;
  private engaged = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Move focus into the dialog and begin holding it there. */
  activate(prefer?: HTMLElement | null): void {
    // Skimming from one dialog to the next re-activates the same trap: keep
    // the original opener so closing still returns to it, and just move the
    // cursor into the new dialog.
    if (!this.engaged) {
      const active = document.activeElement;
      this.returnTo = active instanceof HTMLElement ? active : null;
      document.addEventListener("keydown", this.onKeyDown, true);
      this.engaged = true;
    }
    this.container.setAttribute("tabindex", "-1");
    (prefer || this.first() || this.container).focus();
  }

  /** Release the dialog and give focus back to whatever opened it. */
  deactivate(): void {
    if (!this.engaged) return;
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.engaged = false;
    const back = this.returnTo;
    this.returnTo = null;
    if (back && back.isConnected) back.focus();
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      // getClientRects() is empty for a hidden element, unlike offsetParent,
      // which is null for anything position:fixed — and dialogs are fixed.
      (el) => el.getClientRects().length > 0,
    );
  }

  private first(): HTMLElement | null {
    return this.focusable()[0] || null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const items = this.focusable();
    if (!items.length) {
      event.preventDefault();
      this.container.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement as HTMLElement | null;
    if (!current || !this.container.contains(current)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

/**
 * Roving focus for `role="menu"` lists: ↑/↓ and Home/End walk the items, so a
 * menu can be driven from the keyboard the way its role promises.
 */
export function attachMenuKeys(menu: HTMLElement): void {
  menu.addEventListener("keydown", (event) => {
    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(".sl-menu-item:not([disabled])"),
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (key === "End") next = items.length - 1;
    else if (key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    items[next].focus();
  });
}
