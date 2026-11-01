import { CarFront, Droplet, Lightbulb, Signpost, Trash2, TriangleAlert, Zap, type LucideIcon } from "lucide-react";

export type CategoryKey = "streetlights" | "roads" | "drainage" | "garbage" | "wires" | "signs" | "other";
export type CategoryPresentation = { key: CategoryKey; label: string; Icon: LucideIcon; background: string; foreground: string; glyph: string };

const categories: Array<CategoryPresentation & { matches: (value: string) => boolean }> = [
  { key: "streetlights", label: "Streetlights", Icon: Lightbulb, background: "#fff3d8", foreground: "#8a5d00", glyph: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>', matches: (value) => value.includes("streetlight") || value.includes("streetlamp") || value.includes("lighting") },
  { key: "signs", label: "Road signs", Icon: Signpost, background: "#eeeffa", foreground: "#545d98", glyph: '<path d="M12 13v8"/><path d="M12 3v3"/><path d="M18 6a2 2 0 0 1 1.387.56l2.307 2.22a1 1 0 0 1 0 1.44l-2.307 2.22A2 2 0 0 1 18 13H6a2 2 0 0 1-1.387-.56l-2.306-2.22a1 1 0 0 1 0-1.44l2.306-2.22A2 2 0 0 1 6 6z"/>', matches: (value) => value.includes("sign") || value.includes("marking") || value.includes("signage") },
  { key: "roads", label: "Roads", Icon: CarFront, background: "#e6f3fc", foreground: "#226b98", glyph: '<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>', matches: (value) => value.includes("road") || value.includes("pothole") },
  { key: "drainage", label: "Drainage", Icon: Droplet, background: "#e5f5fa", foreground: "#08728b", glyph: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>', matches: (value) => value.includes("drain") || value.includes("flood") },
  { key: "garbage", label: "Garbage", Icon: Trash2, background: "#edf3e8", foreground: "#527239", glyph: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>', matches: (value) => value.includes("garbage") || value.includes("waste") || value.includes("dumping") },
  { key: "wires", label: "Wires", Icon: Zap, background: "#fff0e2", foreground: "#995219", glyph: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>', matches: (value) => value.includes("wire") || value.includes("electrical") || value.includes("power line") },
];

const otherCategory: CategoryPresentation = { key: "other", label: "Other", Icon: TriangleAlert, background: "#e9f1f4", foreground: "#416371", glyph: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>' };

export function reportCategoryPresentation(name = ""): CategoryPresentation {
  const value = name.toLowerCase();
  const category = categories.find((entry) => entry.matches(value));
  return category || { ...otherCategory, label: name || otherCategory.label };
}

export function reportCategoryPresentationForKey(key: CategoryKey): CategoryPresentation {
  return categories.find((category) => category.key === key) || otherCategory;
}

export function ReportCategoryLabel({ name, className = "", compact = false }: { name?: string; className?: string; compact?: boolean }) {
  const category = reportCategoryPresentation(name);
  return <span className={`report-category-label${compact ? " is-compact" : ""} ${className}`.trim()} title={name || category.label}>
    <span className="report-category-label-icon" aria-hidden="true" style={{ background: category.background, color: category.foreground }}><category.Icon size={compact ? 11 : 13} strokeWidth={2.1} /></span>
    <span>{category.label}</span>
  </span>;
}
