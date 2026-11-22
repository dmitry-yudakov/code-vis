export function hasVisibleKeyboardOverlay(except?: Element | null): boolean {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], .desktop-picker-paper')]
    .some(element => element !== except && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden');
}
