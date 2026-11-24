"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db, result } from "../lib/client";
import { reportCategoryPresentation } from "./report-category";

/** First resident photo (and photo count) for each report, signed in one batch. */
export function useReportListPhotos(ids: string[]) {
  return useQuery({
    queryKey: ["report-list-photos", ids],
    enabled: ids.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const files = await result<{ report_id: string; path: string }[]>(db!.from("report_attachments").select("report_id,path")
        .in("report_id", ids).is("action_id", null).order("created_at", { ascending: true }));
      const first = new Map<string, string>();
      const counts = new Map<string, number>();
      for (const file of files) {
        counts.set(file.report_id, (counts.get(file.report_id) ?? 0) + 1);
        if (!first.has(file.report_id)) first.set(file.report_id, file.path);
      }
      const signed = new Map<string, string>();
      if (first.size) {
        const { data } = await db!.storage.from("report-evidence").createSignedUrls([...first.values()], 3600);
        data?.forEach((item) => { if (item.signedUrl && item.path) signed.set(item.path, item.signedUrl); });
      }
      return { counts, urls: new Map([...first].map(([id, path]) => [id, signed.get(path) || ""])) };
    },
  });
}

/** Report photo, or the category icon on its colour when there is no photo or it fails to load. */
export function ReportThumb({ url, categoryName, className, children }: { url?: string; categoryName: string; className: string; children?: React.ReactNode }) {
  const [failed, setFailed] = useState("");
  const presentation = reportCategoryPresentation(categoryName);
  const photo = url && failed !== url ? url : "";
  return <span className={className} style={photo ? undefined : { background: presentation.background, color: presentation.foreground }} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL */}
    {photo ? <img src={photo} alt="" loading="lazy" onError={() => setFailed(photo)} /> : <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: presentation.glyph }} />}
    {children}
  </span>;
}
