# Database

## Official severity and urgency — 2026-11-07

Migration `20261106171215_report_severity_urgency` adds nullable integer `reports.urgency` (1–5) and append-only `report_assessments` with report, authenticated staff actor, both ratings, rationale and timestamp. Existing severity is retained; historical urgency stays NULL. Severity describes impact (Minor through Severe); urgency describes time sensitivity (Routine through Immediate review). These are human review ratings, not guaranteed response deadlines. The count/severity/age prioritization formula is unchanged.

Verification through `change_report` requires explicit severity and urgency and atomically saves the status/history/assessment. Its eighth, trailing `p_urgency` parameter defaults to NULL so other status actions retain compatibility. Ratings are rejected on non-verification status calls. `record_report_assessment` records or revises ratings without changing progress, only for `under_review`, `verified`, `assigned` or `in_progress` reports. Both inputs must be integers 1–5 and the rationale must satisfy the existing 5–4,000-character text rules.

Assessment writes require the report's existing review permission, active staff status, jurisdiction/category scope and sample visibility; progress-only staff cannot assess. The public RPC is SECURITY INVOKER with a guarded private function. History SELECT is protected by RLS using active staff, report access and sample visibility; authenticated users have no direct history mutation grants. Resident report INSERT rejects supplied official ratings. Public/linked report projections remain restricted. No historical ratings or new presentation incidents are fabricated. Verified-case fixture preparation requires explicitly supplied urgency before generating new seed SQL.

Tests: `supabase/tests/report_assessments.sql` uses rollback-only fixtures; `npm run test:assessments` performs authenticated REST reads and rejection-only probes and compares reports/history before and after.

## Mandatory report pin — 2026-11-07

Migration `20261106163424_mandatory_report_pin` supersedes the address-only option: every new report must include valid latitude/longitude within the mapped Iligan area, whether submitted through the RPC or direct INSERT. Purok, Zone and additional directions are optional supplements. The existing city-boundary trigger rejects missing, partial, non-finite, out-of-range or outside-city points and coordinate edits that remove a pin. The earlier manual-address-details constraint is removed.

Historical NULL-coordinate records remain readable without fabricated backfills; their status-only workflow updates do not invoke the coordinate-edit trigger. Columns remain nullable for that compatibility, while the trigger enforces all new submissions. The report RPC signature, RLS, private-address projection and legacy coordinate-client calls remain unchanged. Current tests: `supabase/tests/mandatory_pin.sql` and the revised `supabase/tests/detailed_location.sql`.

## Detailed report locations — historical address-only policy, superseded 2026-11-07

Migration `20261106160608_detailed_report_location` adds private `purok` and `zone` fields (80 characters each), detected `location_address` (500 characters), `location_source` (`manual`, `gps`, `pin`, or `coordinates`; legacy rows remain NULL), and nullable device `location_accuracy` in metres. Existing `landmark` remains the resident's additional directions (240 characters). No historical address or GPS precision is invented. Device geocoding does not infer Purok/Zone; residents supply those fields when known.

Latitude and longitude may both be NULL only for a manual location that includes at least one of Purok, Zone or additional directions and a valid barangay. Partial pairs, invalid ranges, oversized/invisible-only text, and non-finite/negative GPS accuracy fail database constraints. GPS accuracy is accepted only for the GPS source. When coordinates exist, the existing mapped-city boundary trigger still checks them. A manual address has a NULL generated geography and no synthetic map pin. Barangay counts retain it; `map_reports` includes it in the authorized report list regardless of viewport, subject to the same category, date, barangay, office and status filters. Distance-based recurrence/duplicate detection cannot locate a report without coordinates.

`submit_report` has one extended signature with five trailing optional arguments: `p_purok`, `p_zone`, `p_location_source`, `p_location_accuracy`, and `p_location_address`. Existing coordinate-based calls remain compatible. The SECURITY INVOKER function retains the existing RLS, resident ownership, rate limiting and idempotent report-ID retry behavior. Existing grants restrict location updates; no new client update or staff-read policy is added.

Public report RPCs retain their explicit privacy projection: rounded coordinates when present, NULL when absent, and no Purok, Zone, landmark, detected address, source or accuracy. Full location details remain accessible only through authorized private-report access. Verification fixtures are in `supabase/tests/detailed_location.sql`, and shared input/map-guard regressions in `tests/detailed-location.test.ts`.

Migrations are the authoritative schema. Reference tables hold barangays, six report categories, organizations, routing rules and configurable analysis weights. Category labels are loaded from PostgreSQL in both apps.

Profiles reference Auth users. Organization memberships use a composite key. Reports reference residents, barangays, categories and an optional office. Geography is generated from constrained latitude/longitude and indexed with GiST. Imported indicative barangay polygons and a private OpenStreetMap city polygon support authenticated location checks; source provenance is recorded in `data/README.md`.

Report histories and assignments are written by the trusted workflow function. Duplicate links enforce a single canonical reference, reject self-links and prevent chains at transition time. Followers and supporters have composite primary keys that prevent multiple endorsements from one account. Attachments belong to an authorized report and uploader-owned private storage path; both the report owner and scoped staff can attach evidence. Staff-only notes have their own RLS-protected table.

Consultations link optional reports; comments support parent references and hidden content with moderation reasons. Meeting requests have decisions, meetings have schedules/outcomes, and action items carry organization/due/completion fields. Announcements use a nullable barangay for citywide coverage and a publication timestamp. Audit triggers retain old/new values and actual JWT actors. Audits are administrator-readable only and have no client write policy.

All public tables enable RLS. Authorization helpers with definer rights live in the non-exposed `private` schema, use an empty search path, and have qualified table references. Authenticated column grants omit staff/author UUIDs and moderation reasons from resident status, comment and meeting reads. Assignments and duplicate links are staff-only. Analytics are security-invoker functions to retain report visibility policies. Public summaries are explicitly projected through a definer RPC.

Retention, erasure requests and administrative export procedures need institutional decisions before production. No legal-compliance certification is implied.

Meeting participants reference organizations. Comment official badges are derived by a trigger, ignoring client claims. Community notifications link the source consultation, request or announcement. Engagement exposes aggregate follow/endorsement counts only after report access/public visibility is checked. New migrations are additive and recorded in the connected migration ledger.


## Administrative access refinement

Profiles add `account_status` (pending/active/disabled). Organizations add responsibility text and consultation/coordination/publication capabilities. `organization_access_rules` configures enabled category, optional barangay, assignment-only access and independent review/update/referral permissions. No permission follows from an organization name. `private.report_access` drives private report RLS; private storage, history, notes and report transitions use matching permissions. Aggregate/map RPCs retain invoker RLS and a staff guard. New guarded RPCs provide staff context, report/community permissions, approved referral options and administrator account-status changes. Last-active-admin protection is transactional. See `rbac.md` for the tested matrix and limitations.


## Scheduled announcement delivery

Migration `20261024045513_scheduled_announcement_delivery` adds `private.announcement_deliveries`, an owner-only ledger with RLS and no client grants/policies. Immediate publication calls `private.deliver_announcement`; the once-per-minute `iligan-announcement-publication` job calls `private.deliver_due_announcements` for up to 100 due published records. Qualified references, empty search paths, revoked client execution, row locks and the ledger primary key enforce isolation and retry safety. Notification insertion and ledger claiming are transactional.

Delivery targets active opted-in profiles in the current barangay audience (or all active opted-in profiles for citywide announcements). Drafts, archived and future publications do not deliver. Existing published history is marked delivered when migrating. Later edits or republication of the same announcement do not resend; a new announcement is needed for a new publication notice. No remote push or scheduled publishing credentials are involved. Monitor job execution and configure operational log retention. Tests: `supabase/tests/announcement_delivery.sql`.


## Bounded user input — 2026-10-31

Migration `20261031081501_bounded_user_inputs` adds CHECK constraints to user-authored text, schedules and analysis weights. Report titles require 8–160 characters and descriptions 20–4000; landmarks allow 240, profile names 100, comments 2000, and consultation/announcement bodies 10000. Other notes/reasons keep their form-specific limits. Optional nullable fields remain optional. Unsupported control characters and common invisible-only values are rejected; ordinary Unicode, punctuation, multiline text and literal markup remain text. Passwords are handled by Auth and are never trimmed by the new client preflight.

The private immutable helper reads no tables and has no definer privileges. Date fields reject infinity and years outside 0001–9999; configured analysis weights remain between 0 and 1000. Existing workflow, role, UUID, finite-coordinate and relationship validation still applies. All current records passed the new constraints when applied. `supabase/tests/input_validation.sql` exercises 33 rejected mutations, a valid authenticated submission/name update and preserved Unicode/literal markup, then rolls back every fixture.

Browser image validation checks MIME/signature, a 5 MB limit and actual decoding before an upload. Storage continues to enforce its existing private access, MIME and size rules; server-side byte inspection is still separate deployment work.


Migration `20261031093305_balanced_short_reasons` lowers comment-flag, moderation and meeting-decision reasons to 500 characters. Client reason fields use the shared SHORT_REASON_LIMIT; native comment-flag preflight now matches its existing 500-character input. The stored optional decision reason remains nullable/optional, while the decision form requires an explanation. No existing value exceeded the new cap, so no record needed rewriting or truncation. Rollback tests accept exactly 500 characters for all three reasons and reject 501. Longer report descriptions, consultation/announcement bodies, comments and operational notes retain their purpose-specific limits; 1,000 characters is not treated as a database performance threshold.


## Possible duplicate review — 2026-10-31

Migration `20261031100725_duplicate_review` adds staff-only SECURITY INVOKER RPCs `report_duplicate_candidates(p_id uuid)` and `report_duplicate_summary(p_ids uuid[])`. Existing report/child RLS applies to every source and candidate; inactive accounts, residents and anonymous callers cannot use detection. Actual and prepared cohorts never mix. Summary checks at most 20 visible source IDs per call; missing or hidden IDs are not returned.

Candidates share a category and are within 150 geography metres and 30 days in either direction of the source's submission time. Different known specific problem types, rejected/duplicate targets, existing duplicate children and sources already serving as a canonical original are excluded. The nearest 100 eligible rows are screened; a shared known problem within 50 m or meaningful title/custom-problem token overlap of at least 0.35 qualifies. Wording uses built-in simple-configuration lexemes, neutral stop-word removal and Jaccard overlap; at least two words must overlap, except one identical token of eight or more characters. No semantic model or image matching is claimed. A closer match means within seven days and either the same problem within 25 m or wording overlap at least 0.65 within 50 m. Top eight are ordered deterministically. Descriptions are returned only for authorized comparison and are not used to inflate wording similarity.

These bounds separate possible duplicates from the existing, broader recurrence list. They are review heuristics rather than proof that two physical defects are identical. A resolved candidate may be a fresh recurrence. False positives and misses remain possible. Related but distinct pairs are not persistently dismissed in this version; no completed-distinct-review ledger is implied.

Detection writes no flags, statuses, history or notifications. The existing `change_report` RPC remains the only confirmation path, requiring review authority, an allowed status transition and a public reason. Its confirmation rechecks current source/target access, sample visibility, matching cohorts, non-rejected/non-duplicate canonical eligibility and chain prevention. Duplicate-link changes acquire a transaction advisory lock before deterministically ordered source/target row locks; the source/canonical authorization check occurs before these locks and is rechecked afterward. Existing privileges and transactional history/notification writes are preserved. This serializes conflicting duplicate decisions; a concurrent-session stress test was not performed.

Implementation uses existing PostGIS geography/GiST support and PostgreSQL text search, with no added package, extension or paid service. References: [PostGIS distance filtering](https://postgis.net/docs/ST_DWithin.html), [PostgreSQL text parsing](https://www.postgresql.org/docs/current/textsearch-controls.html). Tests: `supabase/tests/duplicate_candidates.sql`, plus the existing connected/security/sample/input rollback suites.


## Linked duplicate groups and live progress — 2026-10-31

Migration `20261031102458_linked_duplicate_progress` adds `report_linked_duplicates(p_id,p_offset)` for staff dropdowns. It executes as the caller, requires source access and applies existing child/link RLS. Counts include only visible confirmed duplicates; pages are bounded to 20, deterministically ordered, with no hidden cross-scope totals. Sources with no links have no dropdown content.

`report_duplicate_progress(p_id)` intentionally provides a restricted SECURITY DEFINER projection: an active, currently authorized reader of a visible duplicate can retrieve its main report's live status, assigned office and latest 100 status/time events even when another resident's original submission is private. It never includes the main's description, landmark, coordinates, reporter identifiers or free-text history notes. A title is included only when the main itself is readable, or its moderated public summary is available; `can_open_main` follows those same conditions. Both records must share their internal data cohort, sample mode must permit them, and the source must remain a confirmed duplicate. Missing, hidden or rejected/duplicate main targets yield unavailable progress rather than fabricated fallback status. There is no new direct report, history, file or child-list policy for residents.

The child's stored Duplicate classification and original submission/history remain intact; clients display canonical progress separately and poll while open every 30 seconds. Reopening the child through the existing workflow removes its link and restores independent progress. A private trigger sends opted-in active duplicate owners/followers a generic update notification pointing to an accessible child whenever the main's status or assignment changes. It avoids another copy when that recipient already receives direct main-owner/follower updates. No main private note is copied into these notifications. Disabling prepared-record visibility suppresses this fan-out for prepared links.

The new projection produces one expected additional guarded SECURITY DEFINER advisor warning (13 total); it is documented and tested rather than opening general access. `supabase/tests/linked_duplicates.sql` exercises owner/other-resident/office-jurisdiction denial, private projections, main assignment/progress/resolution, notification delivery, stored child classification, sample mode, disabled/anonymous denial and 23-child pagination within rollback transactions.
