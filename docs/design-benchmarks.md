# Civic operations design benchmark — 2026-10-24

## 2026-10-31 surface hierarchy

Use one enclosing surface for a task group. Inside it, group passive content with headings, spacing and thin dividers. Keep independently saved forms, selectable duplicate candidates, warnings, evidence tiles and actual dialogs visually distinct. Scope flattening to named sections; preserve semantic elements, focus behavior, scrolling containers and map/fullscreen parents.

Applied to map controls/reference data, Overview inset statistics, Administration's redundant outer panels, passive report sections/history and consultation editor groups. See `docs/verification.md` for responsive and interaction checks. The dated reference comparison below remains historical.

This is a comparison of documented product patterns, not a scored usability study. No user testing, comparative performance measurements or claim of being “best” is implied.

## References and application

| Reference | Relevant pattern | Iligan Connect implementation |
| --- | --- | --- |
| [eGovPH App Store listing](https://apps.apple.com/ph/app/egovph/id6447682225) and [Google Play listing](https://play.google.com/store/apps/details?id=egov.app) | A broad public-service catalog benefits from searchable services and grouped, recognizable entry points; recent release notes call out service search and a refreshed home dashboard. | Keep resident home focused on neighborhood reporting with a compact report entry and recognizable issue shortcuts; keep public discovery searchable and map-led. |
| [SeeClickFix mobile report action](https://www.civicplus.help/seeclickfix/docs/report-a-concern-mobile-app-button) | One prominent plus action gives reporting a consistent, easy-to-find starting point. | Preserve the raised Report destination and direct home CTA. |
| [FixMyStreet Pro citizen experience](https://fixmystreet.org/pro-manual/citizens-experience/) | Location search/GPS, a centered map, duplicate suggestions, a review before submission, and offline drafts guide civic reporting. | Keep the report flow visibly staged, give location its own map step, and preserve a final review. Duplicate suggestions and offline drafts remain unimplemented. |
| [SeeClickFix: Map tab](https://www.civicplus.help/seeclickfix/docs/using-the-map-tab) | Spatial filtering and opening a report directly from the map support triage and hotspot assessment. | Retain one permission-scoped map for all staff; give it a prominent dashboard position, adjacent next-step actions, fullscreen control, active-filter count, reset and explicit viewport-limit warning. |
| [SeeClickFix: Requests list](https://www.civicplus.help/seeclickfix/docs/requests-list-overview) | A report queue is an operational workspace; available actions depend on staff responsibility. | Review/active/resolved queues, status/category/barangay/office/date filters, exact result counts, stable sorting and direct case actions. Existing server authorization remains authoritative. |
| [FixMyStreet: Administrator manual](https://fixmystreet.org/running/admin_manual/) | Staff can find a known report by its identifier and inspect report activity. | Full UUID lookup alongside title search; dashboard activity and assigned-work rows open the corresponding report instead of remaining static text. |
| [GOV.UK: Tables](https://design-system.service.gov.uk/components/table/) and [Tags](https://design-system.service.gov.uk/components/tag/) | Comparable tabular data and descriptive, non-interactive status labels. | Semantic report table with explicit headings and mobile card layout; status text accompanies color. Chart data can also be read in tables. |
| [Android: Layout and navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns) | Keep three to five peer destinations in primary navigation and give the most important action clear prominence. | Five resident destinations use a floating bottom bar; report has a distinct raised action. |

## Current visual direction — restored 2026-11-07

Use Iligan Connect's pre-MSU-IIT navy/teal civic identity across resident and staff interfaces. Restore teal primary actions, cool white/mint surfaces, navy text/sidebar, blue/teal report-chart series and the compact staff sign-in layout. Keep functional reporting, location, routing, duplicate-review and accessibility improvements. Do not import another project's research dashboard or university branding into this product. Future of Work is a separate repository and is outside this product's scope.

## Historical MSU-IIT direction — superseded 2026-11-07

Use an MSU-IIT-inspired maroon and gold identity across the resident app and staff workspace. The university's published materials identify maroon and yellow as its refreshed palette, but do not specify interface color values; the app uses accessible adaptations rather than claiming official hex codes. See the [2022 annual report](https://www.msuiit.edu.ph/about/facts/downloads/annual-reports/MSU-IIT_AR2022.pdf) and [official seal description](https://msuiit.edu.ph/about/facts/seal.php).

Maroon leads primary actions, resident navigation, and the staff sidebar. Gold is a restrained focus and identity accent; warm paper surfaces, charcoal text, and quiet borders keep long civic workflows readable. Keep report-category, severity, warning, and status tones semantically distinct. Share the same tokens between native and browser UI, preserve the established hierarchy of one enclosing surface per task group, and keep responsive navigation, controls, maps, and report queues intact. The sign-in experience uses a two-column composition on wide screens and one focused form on narrow screens.

This is an implemented visual direction, not a comparative usability score or a claim of being “best”.

## Historical 2026-11-01 analyst-facing chart palette

Use consistent series encoding across charts: received reports use the brand maroon; verified reports use the darker gold. Keep both series at readable contrast, and distinguish the verified time-series with a dashed line as well as color. Rank categories by received count with a stable alphabetical tie-break, and sort weekly observations chronologically before plotting, tabling or exporting. Do not invent rates, risk scores or population-adjusted interpretations without a valid denominator and method.

Keep chart subtitles and notes explicit about the count measure, submission-week basis, Philippine time, account-visible source records and the fact that verification is current state. Format count axes, tooltips and tables with locale thousands separators. Use readable horizontal category labels, thin time ticks to fit narrow screens, and enough vertical room for category rows. Preserve a keyboard-accessible table containing all chart values as the exact alternative. These choices follow the Government Analysis Function’s guidance on chart titles, labels, data tables, chart simplicity and series encoding, and WCAG’s non-text contrast guidance: [charts](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/) and [W3C 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast).

This is an implemented chart pattern, not a comparative usability study or accessibility certification.

## Original visual direction — restored 2026-11-07

Preserve the established navy/teal civic identity. Use warm neutral surfaces, restrained card borders/shadows, consistent spacing and a system sans-serif stack. Separate Workspace, Community, Management and Account navigation. Keep the jurisdiction visible. A map plus “Where to focus” panel gives the overview a purpose beyond displaying totals. Small status accents distinguish review, progress and resolution without inventing urgency or service-level commitments.

Responsive rules stack the map and attention panel, convert report rows into cards, preserve usable filter controls, and use an existing keyboard-trapped navigation drawer. Loading skeletons respect reduced-motion settings. A skip link reaches the main workspace; error states include recovery actions. These rules are implemented but fresh rendered desktop/tablet/phone QA remains pending because browser access is unavailable.

## Research outputs

- Report export is explicitly the current page, up to 20 authorized reports. It includes operational identifiers and dimensions, not reporter identity, private descriptions or precise coordinates.
- Geographic analysis export contains the current server-aggregated metrics, barangay/category/weekly data, filter context and methodological limitations. Counts are not population-normalized prevalence. Recurrence remains a candidate for human assessment.
- CSV values escape quotes/newlines and neutralize spreadsheet formula prefixes. UTF-8 BOM supports common spreadsheet readers.
- Print brief removes application chrome and includes date, scope and demonstration-data context. Print pagination and charts still need visual verification.

## Resident mobile refinement — 2026-10-24

The native resident UI keeps the navy/teal identity and replaces the generic sign-in stack with a compact brand masthead and focused form panel. Shared fields, buttons and cards use consistent contrast, spacing, rounded surfaces and touch heights. Password visibility is explicit; sign-in, registration and recovery actions now lead back to the correct mode. The password recovery back-action previously opened registration and is fixed.

The resident home groups report types into a compact two-column icon grid and keeps the report entry card short enough to expose more shortcuts above the fold. Redundant Explore/Community home buttons were removed because both destinations already have persistent navigation. The report form uses icon-led category choices with a visible selected state and example placeholders for better reports. Explore keeps the category filter in a compact searchable picker so the map appears sooner. The shared native map no longer renders a stray whitespace text node that crashed React Native maps. The bottom bar highlights the current destination and gives report entry a distinct central action. The scroll view reserves clearance beneath the fixed bar so the final report action remains reachable. These patterns follow Android’s five-destination mobile navigation guidance.

The next visual pass standardized the content/header gutter, tightened card geometry, and made category and choice columns use consistent two-column spacing. Paired pagination and comment actions now share the available row width equally. Home exposes the four most common categories first and adds a large-touch expand/collapse action for the full set; this reduces the shortcut wall while preserving access to every configured category and brings report status closer to the first viewport.

Verified on an Android 16 Pixel 7 emulator with Expo Go: resident home and report-description screens rendered, the native report bundle completed, and the resident typecheck passed. The report form was opened without submitting. Login, keyboard, map/location permission, camera, iOS and tablet flows still need direct interaction coverage.

## Completed gaps in this pass

1. Operational report queues, office/date filters, exact totals, oldest/newest/severity ordering and full-ID lookup.
2. Debounced report and community searches.
3. Clickable dashboard report, assignment, meeting and announcement records.
4. Exclusion of future announcements from the published dashboard preview; scheduled labels in management cards.
5. Report CSV export, aggregate research export, printable assessment brief and chart data tables.
6. Invalid date-range handling, map reset/fullscreen and 1,000-point truncation notice.
7. Publication-time in-app notification delivery through a private idempotent database worker, scheduled each minute.

## Remaining work and dependencies

| Item | Status / required input |
| --- | --- |
| Administrative browser visuals, full keyboard flows, downloads, fullscreen and print layout | Not fully verified: connected browser reports disabled. The resident Android home and report-description screens have visual emulator coverage. |
| Authoritative barangay polygons and normalized geographic comparisons | Requires validated GIS boundaries and population/area denominators. Existing manual barangay assignment and count-based comparisons remain. |
| iOS installation and remote push | Android Pixel emulator and Expo Go are configured locally. iOS still needs a device or simulator; remote push needs project linking, signing and delivery credentials. |
| Production hosting, email/recovery delivery and map tile capacity | Requires chosen deployment services, domains and operational configuration. |
| Server-side image content inspection, retention/erasure rules and production security review | Still outstanding. Existing private storage/RLS and client upload checks remain; they do not establish production content safety or legal compliance. |
| Dependency and Supabase advisory findings | Existing findings remain documented in verification.md. The new private delivery table intentionally has RLS with no client policy and no client grants. |
| Scheduler operations | Delivery runs are visible in `cron.job_run_details`; operational monitoring and log-retention policy still need deployment ownership. |

All original core modules remain connected. This gap register distinguishes implemented code from unverified interactions and external prerequisites; it is not a certification that every production requirement is finished.

### 2026-10-24 resident premium UI follow-up

Community’s three destinations now share a compact segmented selector, with an elevated white active state. Profile notifications now use consistent icon-led rows, bold unread titles, timestamps, unread dots and chevrons. The Home dashboard retains compact report rows, category color cues and a direct report action. These patterns follow Android’s guidance to make navigation roles clear and keep the primary action prominent, with eGovPH as a public-service catalog benchmark.

Android 16 Pixel 7 emulator review verified Community and Profile. Typecheck, all 16 tests, Next.js production build and Expo web export passed. Duplicate identical consultation cards observed in the emulator are repeated synthetic demo records; no live data was changed. See `docs/verification.md` for limits and device coverage.

Home category shortcuts now use aligned horizontal icon-and-label tiles, improving first-screen density while preserving readable labels.

### 2026-10-24 resident layout polish

Applied a tighter mobile spacing rhythm, reduced heading scale, balanced the report photo actions, and made Explore map/list selectable with a shorter branded map. Exact repeated synthetic demo rows are collapsed in resident displays, duplicate demo suffixes are avoided, and one-page disabled pagination is hidden. Community provides a clear meeting-request action when browsing conversations. Profile’s update switch matches the brand teal. The emulator covered each primary resident tab and the report form’s lower actions; implementation and test limits are in `docs/verification.md`.


## Responsive controls and input feedback — 2026-10-31

Apply [Android's 48 dp touch-target guidance](https://developer.android.com/develop/ui/compose/accessibility/api-defaults) to native controls and use 48 CSS pixel controls for the browser's coarse-pointer layouts. Report-title links retain a compact 32 px desktop target. Small resident category descriptions/activity labels now use 12 px text, inputs use at least 16 px, and measured pale helper text/primary button colors were darkened while retaining the navy/teal palette. Intentional multi-line clamping and inline source-license links remain distinct from clipped controls.

Follow [WAI validation guidance](https://www.w3.org/WAI/tutorials/forms/validation/) and [accessible error notifications](https://www.w3.org/WAI/tutorials/forms/notifications/): explain limits before entry, put specific warnings beside fields, preserve accessible hint associations, focus the first invalid field, and clear warnings when corrected. Dependent password/date warnings update when their source value changes. The resident notification preference has one accessible switch target across the entire row, checked state, Space/Enter support and protected focus clearance above the floating navigation.

These are implemented patterns and measured browser checks, not a comparative usability score or a claim that every device/browser is certified. Current evidence and native-device limits are in `verification.md`.


## Balanced text guidance — 2026-10-31

Use the field's purpose to choose its limit. Short moderation/flag/decision reasons allow 500 characters; detailed issue reports and official content keep more room. The limit is a ceiling, not a target. Removed duplicated meeting instructions and empty counters. Existing counters now stay quiet below 80% of their limit, then show the number of characters left; reaching the exact limit is neutral guidance. Invalid input retains the existing accessible red error. Staff moderation uses a multiline field rather than a one-line box for a paragraph-sized reason.

The [GOV.UK character-count guidance](https://design-system.service.gov.uk/components/character-count/) recommends using counts when a limit has a purpose and separating count feedback from instructions/errors. The 80% threshold is this project's design choice. Existing native/browser hard caps remain; the implementation does not adopt GOV.UK's unrestricted-paste behavior. No performance speedup is claimed from reducing short reasons to 500 characters.


## Human-reviewed duplicate suggestions — 2026-10-31

A restrained amber indicator on a report queue row opens the normal report workspace; the page checks its current 20 reports with one independent request. A separate Possible duplicates panel lists match reasons and opens a side-by-side comparison, stacked on phones. Location/time/problem/wording evidence is shown rather than an invented probability. Method details disclose the bounded search. Resolved candidates carry a fresh-incident caution. Choosing an original fills the canonical identifier and focuses the existing action form; a public reason and final save are required. Nothing is rejected automatically. Manual identifier entry remains available.

Loading, empty, failure/retry and view-only states keep the rest of the report usable. No-match copy explicitly avoids asserting uniqueness. Controls keep 48 px targets and the existing typography/palette; descriptions wrap inside keyboard-scrollable regions. Selection respects reduced-motion preferences. Separate recurrence context is preserved. No persistent dismissal of distinct pairs or resident-side submission warning is implemented by this staff review feature.

### Shared palette consistency — 2026-11-01

Finished a cross-platform palette sweep. The staff workspace now reuses shared brand, focus, border, warm-surface, and hover tokens across map filters, selection states, queue tabs, overview scope, evidence, administration, and community controls. The resident app uses the same brand-soft token for navigation, selected options, and map controls; the Home report action uses maroon and gold. Possible-duplicate review cues use amber, while verified/resolved and other workflow statuses keep their semantic green/amber/red colors. Map category and density scales remain data-driven. No records, permissions, or routing changed.
