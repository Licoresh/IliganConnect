# Feature coverage

## Implemented and connected

| Area | Behavior |
| --- | --- |
| Resident accounts | Registration, sign-in, session persistence, email recovery/deep-link handling, profile, barangay and notification preference |
| Reporting | Three-step form, six database categories, GPS/map/manual coordinates, free PostGIS city checks and barangay suggestions, manual barangay selection with a mismatch warning, location confirmation, camera/library image, backend receipt, stable retry identifier |
| Tracking/discovery | Personal pagination, public timelines, assigned office, protected photo links that open full screen, searchable public map/list, follow/unfollow |
| Staff reports | Review/active/resolved queues; debounced title/full-ID search; status/category/barangay/office/date filters; exact counts and stable date/severity sorting; current-page CSV export; review/verify/assign/progress/resolve, reject/reopen/duplicate, automatic possible-duplicate queue indicators with comparison and explicit human confirmation, recurrence review, confirmed duplicate groups with main-report progress, routing guidance, internal notes and evidence |
| Mapping | Real PostGIS viewport query, equal-weight report counts in fixed 250 m cells with clickable hotspots and 1 / 2–3 / 4–7 / 8+ legend, clusters, Map/Terrain/Satellite backgrounds, category/status/date/barangay/office/verification/unresolved/recurrence filters, fit/reset, report details, full-coverage permission-scoped barangay counts independent of viewport |
| Analytics | Weekly cohorts and accessible data tables, category charts, verified/received distinctions, aggregate CSV export with scope/methodology, printable brief, sortable weighted prioritization, factor display, human assessments, barangay drill-down and coordination links |
| Consultations | Draft/open/closed/archive, dates, report link, search/filter/pagination, threaded replies, server-derived official badge, follows, flags, hiding/restoration with reasons, outcomes |
| Meetings | Resident request/support/withdraw, category/report links, approve/decline with reasons, scheduled/completed derived display, participants, minutes, office-assigned actions and completion |
| Announcements | Draft/edit/publish/schedule/archive, scheduled status display, type/audience, private images, administrator revision review, resident feed and detail reader; immediate and scheduled in-app publication notifications delivered once |
| Administration | Email invitations for barangay/office stakeholders, required barangay or organization scope, pending approval, existing-account role/jurisdiction/membership management, last-admin protection, organizations, six category toggles, routing matrix, weights and audit records |
| Notifications | Private in-app records for report changes, official consultation replies, meeting decisions/schedules and immediate announcement publication; preference respected. Staff history pagination, unread filtering, total unread badge, mark-all-read and direct record navigation |
| Demo | Four random-password role accounts, 24 repeatable synthetic map fixtures, acceptance scenario records, all labelled DEMO |

Administrator settings have one sidebar destination, **Administration**, with Accounts, Organizations, Routing, Permissions, Configuration and Audit trail tabs. Legacy Organizations page links open Administration; there is no separate duplicate Organizations menu. Personal Settings stays under Account.

## Administrative RBAC refinement

One login now derives dashboard identity and navigation from approved account status, functional role, memberships and enabled category/jurisdiction rules. Every administrative role gets the shared heatmap and overview map preview. Independent report action permissions, community publication controls, matching referral targets, office work notifications and immediate backend revocation are implemented. The administration screen manages these settings and approval status. See `rbac.md` for 107 executed role-specific checks, 41 regression checks and the unverified browser matrix.

Community detail dialogs load the selected record and its current management permission independently of list pagination. Saved outcomes and meeting decisions refresh the open record through query invalidation; open records refresh every 30 seconds. The notification/detail follow-up passed 98 live API checks; its screen interactions remain unverified. See `verification.md` for coverage and browser limitations.

## Deployment-dependent limits

- Pin verification uses the authenticated `resolve_report_location` RPC with imported indicative barangay and OpenStreetMap city polygons. No paid geocoding API is required. Missing or overlapping barangay coverage requires manual selection; an explicit suggestion can be corrected with confirmation. See `data/README.md` and `setup.md`.
- Resident map cells aggregate all available public report points (latest 500 maximum) instead of only the visible report-feed page; public coordinates are rounded to three decimals for privacy. Cell counts use those approximate points. Staff map counts use the permission-scoped viewport results (maximum 1,000). Staff barangay totals are exact recorded-assignment counts. Neither view is area/population-normalized, and no choropleth is drawn until current validated boundary polygons are supplied.
- Remote push delivery and platform signing are unconfigured. Scheduled in-app announcement delivery is implemented with a private worker and an active once-per-minute database job; it respects audience, active-account status and notification preferences.
- Authenticated API/storage scenarios passed; full visual workflow testing stopped when browser control was disabled. No Android device or emulator was connected, and no APK/iOS binary has been generated.
- Map queries cap at 1,000 points per viewport; users must zoom/filter. Lists paginate. Charts aggregate in PostgreSQL without the client list cap.
- Photo clients resize/re-encode mobile evidence; direct uploads still require server-side content inspection and institutional retention procedures for a public operational rollout.
- Dependency audit and Auth configuration findings are recorded in verification.md. The implementation is a working demonstration system, not a certified production deployment.

See [design benchmarks and remaining gaps](design-benchmarks.md) for the research-informed interface changes, tested implementation boundaries and external prerequisites.


Confirmed duplicate submissions appear under **Linked duplicate reports** on the main staff report. Child progress and office follow the main report in staff and resident tracking, while original child evidence/history stays separate. Closed linked lists pause polling and refresh stale content when opened; pagination keeps rows and focus while loading. Suggestions use **main report** wording, require a reason and an explicit save, and block self-links before a request. Confirmed duplicate and rejected sources do not request suggestions. Barangay GIS shares Map/Terrain/Satellite controls with the issue map inside the canvas, including fullscreen; background changes preserve selected barangay and filter-derived counts.
