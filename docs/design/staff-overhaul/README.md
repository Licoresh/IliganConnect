# Staff mobile and tablet overhaul

This work covers only the Office, Barangay, and Admin staff portals. Resident screens and the desktop composition at 1024px and wider remain out of scope.

## Visual artifacts

- [`references.html`](references.html) is the static visual reference for each staff role. Its names and counts are illustrative; they are not production data.
- [`screenshots/before/`](screenshots/before/) renders the existing role-specific mobile reference artwork in `docs/design/references/`; it is a source-based baseline, not a screenshot of authenticated production pages.
- [`screenshots/reference/`](screenshots/reference/) captures the proposed role-specific presentation at 320 × 568, 360 × 800, 375 × 812, 390 × 844, 412 × 915, 430 × 932, 768 × 1024, 820 × 1180, 1024 × 768, and 1440 × 900.
- `screenshots/after/` is not populated yet. An authenticated Barangay session was available, but authorized Office and Admin sessions were not; no test credentials or mock production sign-ins were used. Capture the implemented pages after those role sessions are available.

The production browser exposed resident directory details during inspection. No names, contact values, or other resident-identifying data were saved in the artifacts.

## Implementation

The staff workspace now derives phone navigation from each role's existing allowed sections. Phones use four primary destinations plus a More sheet; tablets retain all allowed sections in a labeled navigation rail. All navigation still calls the existing section router and permission checks. Mobile overview ordering brings the review queue ahead of map and secondary reporting panels. Existing responsive forms, report cards, maps, meeting pages, analytics, and administration pages continue to use their current data and action logic.
