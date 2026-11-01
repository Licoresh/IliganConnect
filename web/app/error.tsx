"use client";

import { Compass, RefreshCw } from "lucide-react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="route-error">
      <section className="panel" aria-labelledby="error-title">
        <span className="error-mark"><Compass size={24} /></span>
        <p className="eyebrow">ILIGAN CONNECT · COMMUNITY OPERATIONS</p>
        <h1 id="error-title">We hit a snag</h1>
        <p className="muted" role="alert">The page did not finish loading. Check the status of your last action before repeating it.</p>
        {error.digest && <small className="muted">Reference: {error.digest}</small>}
        <div className="inline-actions">
          <button onClick={retry}><RefreshCw size={16} /> Try again</button>
          <button className="secondary" onClick={() => window.location.reload()}>Reload workspace</button>
        </div>
      </section>
    </main>
  );
}
