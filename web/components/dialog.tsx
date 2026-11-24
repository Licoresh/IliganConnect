"use client";
import { useEffect, useRef, useState, ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";

// Typed edits that would be lost on an accidental Escape or close click. Search boxes, checkboxes and filters are not tracked.
const editableField = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement &&
    !["search", "checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color"].includes(target.type) &&
    !target.closest(".search-field, [role='search'], [data-dialog-ignore-dirty]"));

export function Dialog({
  title,
  close,
  children,
  className,
  description,
  descriptionMeta,
  icon,
  headerMeta,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
  description?: string;
  descriptionMeta?: ReactNode;
  icon?: ReactNode;
  headerMeta?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect(() => { if (confirmDiscard) keepEditing.current?.focus(); }, [confirmDiscard]);
  const requestClose = () => {
    if (confirmDiscard) setConfirmDiscard(false);
    else if (dirty.current) setConfirmDiscard(true);
    else close();
  };
  return (
    <dialog ref={ref} className={`modal${className ? ` ${className}` : ""}`} aria-label={title}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onInput={(event) => { if (editableField(event.target)) dirty.current = true; }}
      onSubmit={() => { dirty.current = false; }}>
      {description || icon ? (
        <>
          <div className="community-dialog-heading">
            <span className="community-dialog-icon" aria-hidden="true">{icon}</span>
            <div className="community-dialog-title">
              <h2>{title}</h2>
              <p>{description}{descriptionMeta && <span className="community-dialog-description-meta"><span aria-hidden="true">·</span>{descriptionMeta}</span>}</p>
            </div>
            {headerMeta && <div className="community-dialog-header-meta">{headerMeta}</div>}
            <button type="button" className="secondary community-dialog-close" aria-label="Close dialog" onClick={requestClose}><X size={19} /></button>
          </div>
          <div className="community-dialog-body">{children}</div>
        </>
      ) : (
        <>
          <div className="panel-heading">
            <h2>{title}</h2>
            <button className="secondary" onClick={requestClose}>Close</button>
          </div>
          {children}
        </>
      )}
      {confirmDiscard && <div className="dialog-discard" role="alertdialog" aria-modal="true" aria-labelledby="dialog-discard-title" aria-describedby="dialog-discard-text">
        <div className="dialog-discard-card">
          <span className="dialog-discard-icon" aria-hidden="true"><TriangleAlert size={20} /></span>
          <h3 id="dialog-discard-title">Discard unsaved changes?</h3>
          <p id="dialog-discard-text">What you entered in this form has not been saved and will be lost.</p>
          <div className="dialog-discard-actions">
            <button ref={keepEditing} type="button" className="secondary" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
            <button type="button" className="danger" onClick={() => { dirty.current = false; setConfirmDiscard(false); close(); }}>Discard changes</button>
          </div>
        </div>
      </div>}
    </dialog>
  );
}
