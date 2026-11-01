"use client";
import { useEffect, useRef, ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  close,
  children,
  className,
  description,
  icon,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
  description?: string;
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
  return (
    <dialog ref={ref} className={`modal${className ? ` ${className}` : ""}`} onCancel={(event) => { event.preventDefault(); close(); }} aria-label={title}>
      {description || icon ? (
        <>
          <div className="community-dialog-heading">
            <span className="community-dialog-icon" aria-hidden="true">{icon}</span>
            <div className="community-dialog-title">
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
            <button type="button" className="secondary community-dialog-close" aria-label="Close dialog" onClick={close}><X size={19} /></button>
          </div>
          <div className="community-dialog-body">{children}</div>
        </>
      ) : (
        <>
          <div className="panel-heading">
            <h2>{title}</h2>
            <button className="secondary" onClick={close}>Close</button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
