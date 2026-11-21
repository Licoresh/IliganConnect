"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { SAVE_FEEDBACK_EVENT, type SaveFeedback } from "../lib/save-feedback";

export function SaveToast() {
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const next = (event as CustomEvent<SaveFeedback>).detail;
      setFeedback(next);
      clearTimeout(timer);
      timer = setTimeout(() => setFeedback(null), next.kind === "error" ? 6000 : 3600);
    };
    window.addEventListener(SAVE_FEEDBACK_EVENT, receive);
    return () => { clearTimeout(timer); window.removeEventListener(SAVE_FEEDBACK_EVENT, receive); };
  }, []);
  if (!feedback) return null;
  const Icon = feedback.kind === "success" ? CheckCircle2 : CircleAlert;
  return <div className="save-toast-region" aria-live="polite" aria-atomic="true">
    <div className={`save-toast ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
      <Icon size={19} aria-hidden="true" />
      <span>{feedback.message}</span>
      <button type="button" aria-label="Dismiss message" onClick={() => setFeedback(null)}><X size={17} aria-hidden="true" /></button>
    </div>
  </div>;
}
