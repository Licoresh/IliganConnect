export function reportLocalAddress(report: { purok?: string | null; zone?: string | null }) {
  return [report.purok && `Purok: ${report.purok}`, report.zone && `Zone: ${report.zone}`].filter(Boolean).join(" · ");
}
