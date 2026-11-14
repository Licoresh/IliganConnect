import type { MouseEvent } from "react";

const interactiveTarget = "a, button, input, select, textarea, [role='button'], [contenteditable='true']";

export function openReportFromRow(event: MouseEvent<HTMLTableRowElement>, open: () => void) {
  if (event.defaultPrevented) return;
  const target = event.target as Element | null;
  if (target && typeof target.closest === "function" && target.closest(interactiveTarget)) return;
  if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
  open();
}
