# Administrative access — 2026-10-24

One Next.js application, one Supabase login, one reusable heatmap. The resident application was not rebuilt for this milestone.

## Authentication and authorization

`staff_context()` retrieves the signed-in user's profile, account status, active organizations and enabled access rules. It accepts no user identifier or client-selected role. The web app derives its dashboard title, organization identity, navigation and available actions from that result. Supabase validates the bearer token on database requests. User-editable Auth metadata does not control authorization.

Existing role identifiers are preserved for compatibility:

| Database role | Web label | Access |
| --- | --- | --- |
| `admin` | System administrator | Citywide records and administrative configuration |
| `barangay` | Barangay staff | All six categories within the assigned barangay |
| `office` | Office staff | Union of enabled category/jurisdiction rules for active memberships |
| `resident` | Resident | Resident workflows; administrative workspace denied |

`account_status` is `pending`, `active` or `disabled`. Existing accounts retain their previous active access. A changed staff role becomes pending and requires a separate administrator approval. Barangay approval requires a jurisdiction; office approval requires an active organization membership. An approved office without any enabled rules may enter the workspace and heatmap but receives no private report records. The last active administrator cannot be disabled or demoted.

System administrators can invite a new stakeholder by email. The invite flow supports barangay staff (one required barangay assignment) and office/service-provider staff (one required active organization membership). New staff remain pending until an administrator approves them. City Engineer, CENRO, CDRRMO, DPWH, utility providers and City Traffic are organization memberships under the existing `office` role, not separate authorization roles. Membership identifies the stakeholder; enabled category, barangay and assignment rules determine its report access.

The backend checks current database state on every request. Disabling an account, removing a membership, deactivating an organization or disabling its access rule immediately affects subsequent requests, including sessions with unexpired access tokens. The web refreshes access context every 30 seconds, on focus and token refresh; it clears cached application data when identity or permissions change.

Supabase persists and refreshes sessions. Sign-out clears local state and revokes refresh access. An already issued access token can remain valid until its expiration; disabling the account is the supported immediate administrative revocation path. Existing signed storage URLs remain usable until their short expiry; new URL creation checks current permissions.

## Office responsibilities

Organization names grant no permissions. Administration → Office responsibilities & permissions configures:

- Category and optional barangay coverage.
- Assignment-only access or access to all matching reports in that coverage.
- Review/verification/rejection/reopening, progress/resolution and referral permissions independently.
- Enabled/draft state and approval notes.
- Consultation management/official responses, meeting coordination and announcement publication capabilities.

All matching dimensions must hold in the same rule. Multiple memberships combine only their explicitly permitted scopes. Assignment does not bypass a category or barangay restriction. Referrals require permission on the current report and an active destination with an enabled matching rule. The UI retrieves approved referral options from the backend.

Engineering assessment team and Environment assessment team were completely deleted on 31 October 2026 after the owner clarified that inactive retention was insufficient. Remaining organization references were consolidated into City Engineer/CENRO; 12 legacy rules and the obsolete membership were removed. Progress/completion, actors/timestamps and audit evidence remain. No broad permissions or account memberships were copied to the receiving offices. The unaffiliated setup office account has no staff/private or published-report access. Six organizations remain, all active; the two identities cannot be reactivated from the directory.

DPWH examples use assignment-only road access with a geographic restriction. National-road/bridge ownership must be confirmed through the approved referral workflow; no road-ownership dataset or fabricated infrastructure boundaries are claimed. The six resident categories remain unchanged.

Community publication and management additionally require organization capability and geographic coverage. Meeting decisions require review authority on the request category or its linked report. Linked reports must be accessible and in the same barangay. Barangay assessments remain restricted to the assigned barangay staff and administrators.

## Shared dashboard and heatmap

Every approved administrative role receives **Issue Mapping & Heatmap** in navigation and an embedded heatmap on Overview. The same component provides density, clustered markers, list and barangay summary modes, with category/barangay/office/status/date/verified/unresolved/recurrence filters. Filter inputs can narrow results; they cannot enlarge database permissions.

Report RLS uses `private.report_access`; private evidence and history use the same report authorization. `map_reports`, `geographic_analytics`, `dashboard_counts`, `barangay_summary` and recurrence queries execute with caller RLS. Administrative aggregates reject resident participation through a staff predicate. Received/unverified records, verified issues, recurrence candidates and excluded duplicate/rejected records are identified separately. Map density caps at 1,000 records per viewport; analytics aggregate in PostgreSQL.

Dashboard statistics, charts, recent reports and assigned work use permitted records. The header includes organization/jurisdiction, profile menu and notification center. Assignment changes notify eligible office members. Administration manages accounts, approval, organizations, memberships, access rules, routing, category configuration and audit history. Role, membership, rule and organization changes are audited.

## Executed stakeholder matrix

All rows below passed actual Supabase Auth and API tests. “Heatmap” means its database query and access rules were tested; it does not claim browser interaction coverage.

| Demo stakeholder | Configured scope | Login/context | Private reports, heatmap and aggregates | Denial checks |
| --- | --- | --- | --- | --- |
| System administrator | Citywide, six categories | Passed | Passed | Last active administrator protected |
| Barangay Poblacion | Poblacion, six categories | Passed | Passed | Cross-barangay read and self-jurisdiction changes denied |
| Barangay Tibanga | Tibanga, six categories | Passed | Passed | Cross-barangay publication/read denied |
| City Engineer | Road and drainage, all barangays | Passed | Passed | Unrelated category referrals and publication denied |
| CENRO | Waste, all barangays; publication enabled | Passed | Passed | Road queries, privilege escalation and unauthorized configuration denied |
| CDRRMO | Drainage, read-only | Passed | Passed | Report updates denied |
| DPWH | Assigned roads in Tibanga | Passed | Passed | Assigned road outside geographic scope denied |
| Utility provider | Assigned wires and streetlights | Passed | Passed | Unrelated government report access, review and referral denied |
| City Traffic | Signs/markings, all barangays | Passed | Passed | Membership/category boundary validated |
| Pending and disabled staff | No administrative access | Auth succeeds; workspace denied | No private records/counts | Direct report, map and community requests denied |
| Resident | Resident ownership/public projection | Auth succeeds; workspace denied | No administrative map records | Administrative role changes denied |

These are labelled synthetic access profiles, not verified government arrangements. Credentials are in local gitignored `.env.demo.json` and `.env.rbac-demo.json`. Do not ship or publish those files. For a fresh disposable project, run `scripts/prepare-rbac-demo.mjs`, execute its generated `.env.rbac-demo.sql` through a trusted database connection, then apply `supabase/rbac-demo.sql`. Do not provision demo accounts into an operational deployment.

## Verification and limitations

- `npm run test:rbac`: **107 checks passed**; names and execution time are recorded in `rbac-test-results.json`.
- `npm run test:acceptance`: **41 original workflow checks passed** after the backend changes.
- `npm test`: **13 tests passed**, including universal staff heatmap navigation, display-permission mapping and stable authorization-cache fingerprints.
- `npm run typecheck`: both applications passed. `npm run build`: Next.js production build passed.
- Rollback-wrapped `supabase/tests/security.sql` passed after both RBAC migrations.
- Session persistence, refresh, sign-out, revoked refresh denial, manipulated JWT rejection and immediate administrative revocation passed. Expiration recovery was exercised by setting stored session expiry metadata into the past; a real signed JWT was not held until wall-clock expiry.
- The connected Codex browser returned “Local browser use is disabled in Work settings.” A later isolated Chrome check visually rendered login, citywide, Tibanga and CENRO dashboards and the shared heatmap at desktop and mobile widths; 320 px and 390 px login and 390 px authenticated pages had no horizontal overflow. Mobile filters start collapsed and reopen from their summary. Full keyboard traversal and every stakeholder's screen interactions remain unverified; see `verification.md`.
- Supabase advisor flags the seven intentionally exposed guarded SECURITY DEFINER entry points and disabled leaked-password protection. No missing-RLS warning was returned. [Function access guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- The previously recorded dependency findings, map-provider/authoritative-boundary constraints and production deployment requirements remain. See `verification.md`.

The frontend follow-up adds linked-record notification navigation, session initialization guards and map container resizing. Its 109 targeted live linked-record checks, build and typechecks passed; see `verification.md` for exact coverage and browser limitations. The 107-check RBAC and 41-check workflow results above are from the preceding backend milestone.

## Graphify

Source-derived navigation graph: `C:/Users/User/OneDrive/Desktop/CodexObsidian/codex/CodexKnowledge/Graphs/Iligan Connect/graphify-out/graph.json`. Generated HTML/report sit beside it. Code-only extraction excludes credentials, dependencies and build output. Query with `--graph` using that exact path.

The updated graph contains 605 nodes and 1,037 edges. Diagnostics at the previous RBAC milestone found zero missing/dangling endpoints or collapsed edge pairs, and three self-loops. SQL function symbols are extracted, but the graph does not fully represent policy/function-body authorization relationships. Source SQL and executed tests remain authoritative; graph relationships must not be treated as security proof.


## 2026-10-24 design and delivery regression

The refreshed interface, report queues/research exports and scheduled announcement delivery passed the full 107-check RBAC suite and 41 workflow checks again. Another 127 live navigation/report-query checks, 16 unit tests, both typechecks and the production build passed. The scheduler's functions/table are private and unavailable to authenticated/anonymous clients. No role or jurisdiction permissions were broadened. Updated screen interactions remain unverified because browser control is unavailable; see `verification.md` and `design-benchmarks.md`.
