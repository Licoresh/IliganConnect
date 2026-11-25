import { properCaseTitle } from "@community/shared";

/** Report titles are shown in Proper Case everywhere; stored text is unchanged. */
export const withTitle = <T extends { title?: string | null }>(row: T): T => ({ ...row, title: properCaseTitle(row.title) });
export const withTitles = <T extends { title?: string | null }>(rows: T[] | null | undefined): T[] => (rows ?? []).map(withTitle);
