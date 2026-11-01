export function csvText(rows: readonly (readonly unknown[])[]): string {
  return "\uFEFF" + rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    // Prevent spreadsheet applications from interpreting untrusted text as formulas.
    const safe = /^[\s\uFEFF]*[=+@-]/.test(text) && typeof value !== "number" ? "'" + text : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}

export function downloadCsv(name: string, rows: readonly (readonly unknown[])[]) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function philippineDateBoundary(date: string, nextDay = false): string | null {
  if (!date) return null;
  return new Date(new Date(`${date}T00:00:00+08:00`).getTime() + (nextDay ? 86400000 : 0)).toISOString();
}
