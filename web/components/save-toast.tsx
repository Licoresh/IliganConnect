"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { SAVE_FEEDBACK_EVENT, type SaveFeedback } from "../lib/save-feedback";

export function SaveToast() {
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const next = (event as CustomEvent<SaveFeedback>).detail;
      setFeedback(next);
      clearTimeout(timer);
      // Errors stay until dismissed so a failed save is never missed.
      if (next.kind !== "error") timer = setTimeout(() => setFeedback(null), 4000);
    };
    window.addEventListener(SAVE_FEEDBACK_EVENT, receive);
    return () => { clearTimeout(timer); window.removeEventListener(SAVE_FEEDBACK_EVENT, receive); };
  }, []);
  useEffect(() => {
    const updateTarget = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      setTarget(dialogs.item(dialogs.length - 1) || document.body);
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  if (!feedback || !target) return null;
  const Icon = feedback.kind === "success" ? CheckCircle2 : CircleAlert;
  return createPortal(<div className={`save-toast-region${target instanceof HTMLDialogElement ? " is-modal-save-toast" : ""}`} aria-live="polite" aria-atomic="true">
    <div className={`save-toast ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
      <Icon size={19} aria-hidden="true" />
      <span>{feedback.message}</span>
      <button type="button" aria-label="Dismiss message" onClick={() => setFeedback(null)}><X size={17} aria-hidden="true" /></button>
    </div>
  </div>, target);
}
