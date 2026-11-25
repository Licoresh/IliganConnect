"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

type Option = { value: string; label: string; disabled: boolean };
const PHONE = "(max-width: 767px)";

function labelFor(select: HTMLSelectElement) {
  const aria = select.getAttribute("aria-label");
  if (aria) return aria;
  const label = select.closest("label") || (select.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`) : null);
  if (!label) return "Choose an option";
  const clone = label.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("select, svg").forEach((node) => node.remove());
  return clone.textContent?.replace(/\s*\*\s*$/, "").trim() || "Choose an option";
}

/** On staff phones, single-choice <select> elements open as a resident-style bottom sheet. */
export function MobileSelectSheet() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<HTMLSelectElement | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const open = (event: Event) => {
      const select = (event.target as Element | null)?.closest?.("select");
      if (!(select instanceof HTMLSelectElement) || select.multiple || select.size > 1 || select.disabled) return;
      if (!window.matchMedia(PHONE).matches || !select.closest(".shell[data-role]")) return;
      event.preventDefault();
      setOptions([...select.options].map((option) => ({ value: option.value, label: option.text, disabled: option.disabled })));
      setTitle(labelFor(select));
      setQuery("");
      setTarget(select);
    };
    // Pointer/touch only: keyboard users keep the native picker.
    document.addEventListener("mousedown", open, true);
    document.addEventListener("touchend", open, { capture: true, passive: false });
    return () => {
      document.removeEventListener("mousedown", open, true);
      document.removeEventListener("touchend", open, { capture: true });
    };
  }, []);

  useEffect(() => {
    const node = dialog.current;
    if (target && node && !node.open) node.showModal();
  }, [target]);

  const close = () => { dialog.current?.close(); };
  const choose = (value: string) => {
    if (!target) return;
    if (target.value !== value) {
      // Native setter + bubbling change event so React's onChange runs.
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(target, value);
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
  };
  const visible = query ? options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())) : options;

  return <dialog ref={dialog} className="mobile-select-sheet" aria-labelledby="mobile-select-title"
    onClose={() => { const select = target; setTarget(null); select?.focus({ preventScroll: true }); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    {target && <div className="mobile-select-panel">
      <span className="mobile-select-grabber" aria-hidden="true" />
      <header><h2 id="mobile-select-title">{title}</h2><button type="button" className="mobile-select-close" aria-label="Close" onClick={close}><X size={20} aria-hidden="true" /></button></header>
      {options.length > 8 && <label className="mobile-select-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search options</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} /></label>}
      <div className="mobile-select-options" role="listbox" aria-label={title}>
        {visible.map((option) => {
          const selected = option.value === target.value;
          return <button key={`${option.value}-${option.label}`} type="button" role="option" aria-selected={selected} disabled={option.disabled} className={selected ? "is-selected" : ""} onClick={() => choose(option.value)}>
            <span>{option.label}</span>{selected && <Check size={18} aria-hidden="true" />}
          </button>;
        })}
        {!visible.length && <p className="mobile-select-empty">No matching options</p>}
      </div>
    </div>}
  </dialog>;
}
