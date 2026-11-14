# Iligan Connect SRS — Sections 10–27

**Status:** Draft continuation for the current paper. It uses the supplied Sections 6–9 and the current project documentation. “Shall” statements are proposed requirements unless described as existing behavior. Proposed targets below are not claims of verified performance or production readiness.

## 10. Look and Feel Requirements

### 10a. Appearance Requirements

- **LF-AP-01:** The resident application and staff workspace shall present Iligan Connect as one product while making the active user role and permitted workspace clear.
- **LF-AP-02:** The interfaces shall retain the established navy and teal identity, mint accents, cool neutral surfaces, and compact staff sign-in layout. Components shall use consistent spacing, typography, borders, and status presentation across screens.
- **LF-AP-03:** The resident reporting flow shall keep category, description, location confirmation, and optional photo steps visually distinct. Required and optional fields shall be identified.
- **LF-AP-04:** Staff views shall distinguish submitted, under-review, verified, assigned, in-progress, resolved, rejected, and duplicate states using text and consistent visual cues. Color shall not be the only status indicator.
- **LF-AP-05:** Maps, charts, and report lists shall identify their scope and limitations. Approximate public locations, filtered results, capped map results, and non-normalized counts shall not be presented as exact citywide prevalence.
- **LF-AP-06:** Private report details, precise locations, staff-only notes, and attachments shall not appear in resident-facing screens unless the corresponding access rule permits them.
- **LF-AP-07:** The resident and staff interfaces shall adapt to supported phone, tablet, and desktop widths without horizontal scrolling for ordinary tasks.

### 10b. Style Requirements

- **LF-ST-01:** Interface text shall use direct, respectful language and consistent terms for reports, assignments, referrals, status, and resolution.
- **LF-ST-02:** Buttons, form fields, dialogs, notifications, loading states, and error messages shall follow shared product patterns.
- **LF-ST-03:** Status styling shall communicate the recorded state without implying urgency, official endorsement, or a guaranteed response time.
- **LF-ST-04:** Demonstration records, when enabled, shall be identified in project materials as fictional. They shall not be described as verified Iligan incidents.
- **LF-ST-05:** Charts shall include titles, units, time basis, scope notes, and a text or tabular alternative when values are plotted.

## 11. Usability and Humanity Requirements

### 11a. Ease of Use Requirements

- **UX-EU-01:** A resident shall be able to create a report through a guided flow that identifies the category, description, confirmed map location and barangay, with photo and supplementary location details clearly optional.
- **UX-EU-02:** GPS shall be optional. Residents shall be able to place or adjust a map pin or enter coordinates manually, then confirm the displayed location before submission.
- **UX-EU-03:** The application shall show a report identifier and submission confirmation only after the server confirms receipt. If a request fails or its result is uncertain, the interface shall explain how to retry without implying that an unsaved report was received.
- **UX-EU-04:** Residents shall be able to find the status and visible history of their own reports without access to another resident’s private report or staff-only notes.
- **UX-EU-05:** Staff queues shall provide the filters and record details permitted for the user’s role, organization, category, barangay, and assignment.
- **UX-EU-06:** Authorized barangay personnel shall be able to enter a concern received through an existing channel when staff-assisted reporting is enabled. The record shall identify that it was entered by staff and preserve the source details available to staff.
- **UX-EU-07:** Validation messages shall identify the field or action requiring attention and provide a clear correction path.
- **UX-EU-08:** Destructive, irreversible, or externally visible actions shall require a clear confirmation and record a reason where the workflow requires one.

### 11b. Personalization and Internationalization Requirements

- **UX-PI-01:** Report descriptions shall accept Unicode text, including Cebuano, Filipino, English, and Maranao. Reports shall not be rejected solely because they are not written in English.
- **UX-PI-02:** The application shall not claim to translate user-submitted descriptions automatically. Any translated interface labels or help content shall be reviewed by fluent speakers before release.
- **UX-PI-03:** Residents shall be able to maintain their profile barangay and notification preference. Optional location methods shall remain user-controlled.
- **UX-PI-04:** Staff filters and map settings may be adjusted for the current task, but must not expand the records the account is authorized to access.
- **UX-PI-05:** Interface language selection beyond the currently supported text shall be treated as a planned localization task until translations are implemented and reviewed.

### 11c. Learning Requirements

- **UX-LRN-01:** The report form shall provide short instructions and examples for category, description, and location entry.
- **UX-LRN-02:** First-time residents shall be able to complete ordinary report submission using on-screen guidance without administrator assistance.
- **UX-LRN-03:** Staff guidance shall explain status meanings, assignment and referral rules, required reasons, and the difference between recording a status and verifying physical work.
- **UX-LRN-04:** Administrators shall receive instructions for invitations, account approval, organization membership, access rules, categories, routing, and audit review.
- **UX-LRN-05:** Help materials shall be updated when a workflow or status definition changes.

### 11d. Understandability and Politeness Requirements

- **UX-UP-01:** The interface shall distinguish clearly among submitted, under review, verified, assigned, in progress, resolved, rejected, and duplicate reports.
- **UX-UP-02:** User-facing status text shall describe the recorded action and shall not imply that Iligan Connect has dispatched a crew, authorized work, or independently confirmed a repair.
- **UX-UP-03:** Error, rejection, pending, and referral messages shall be factual, respectful, and free of blame. Where the workflow requires a reason, the authorized staff member shall be able to record it.
- **UX-UP-04:** Reporting guidance shall discourage unsafe behavior, including approaching a hazard to take a photograph.
- **UX-UP-05:** The system shall avoid exposing a resident’s identity, private notes, or precise location in public summaries or notification previews.

### 11e. Accessibility Requirements

- **UX-AX-01:** Web interfaces shall target WCAG 2.2 Level AA. Native interfaces shall provide equivalent accessible names, focus order, state announcements, and task completion paths.
- **UX-AX-02:** Interactive controls shall be operable by keyboard where applicable, expose visible focus, and provide meaningful labels and state to assistive technology.
- **UX-AX-03:** Text and essential graphics shall meet applicable contrast requirements. Color shall not be the sole means of conveying status, selection, or error.
- **UX-AX-04:** Primary touch controls shall target at least 48 dp where platform layout permits. Text scaling and narrow-screen layouts shall not hide required actions.
- **UX-AX-05:** Map-based information shall have an equivalent list, search, or text description where feasible. Charts shall retain their underlying values in an accessible table or equivalent.
- **UX-AX-06:** Motion shall respect the user’s reduced-motion preference. Dialogs shall retain predictable focus and keyboard dismissal behavior.
- **UX-AX-07:** Accessibility conformance shall be assessed on the web and on supported Android/iOS devices before operational release. Current implementation checks do not constitute a complete accessibility audit.

## 12. Performance Requirements

### 12a. Speed and Latency Requirements

The following are proposed acceptance targets, not measured guarantees:

- **PERF-SL-01:** Under the documented acceptance-test dataset and network conditions, the 95th-percentile response for routine report lists, staff queues, and summary views should be no more than 3 seconds, excluding initial application download and external map-tile loading.
- **PERF-SL-02:** The 95th-percentile response for a server-side report or status write should be no more than 5 seconds, excluding photo-transfer time.
- **PERF-SL-03:** Photo transfer shall provide a clear success or failure result. A failed attachment shall not be represented as successfully stored.
- **PERF-SL-04:** Acceptance results shall record the device, browser, dataset size, concurrency, network conditions, backend plan, and test date. The target shall be reviewed if those conditions change.

### 12b. Safety-Critical Requirements

- **PERF-SC-01:** Iligan Connect is not an emergency dispatch, flood-warning, or emergency-response system. The application shall not promise immediate review, dispatch, repair, or a response deadline.
- **PERF-SC-02:** Report guidance shall direct users to contact the appropriate emergency service or responsible authority for immediate threats. The application shall not be presented as the only way to report an urgent danger.
- **PERF-SC-03:** Optional photographs shall not be required to submit a report. Instructions shall tell residents not to approach a dangerous condition to obtain evidence.
- **PERF-SC-04:** Severity, duplicate, and resolution decisions shall remain subject to authorized human review. The system shall not automatically reject, merge, or declare a physical condition repaired.

### 12c. Precision or Accuracy Requirements

- **PERF-PA-01:** Each new report shall have a confirmed map location and barangay. GPS is optional; a resident may place or adjust the pin or enter coordinates manually.
- **PERF-PA-02:** When GPS is used and an accuracy value is available, the system shall retain that value with the location source. It shall not represent manually entered coordinates as GPS measurements.
- **PERF-PA-03:** Imported city and barangay boundaries shall be described as indicative unless their authoritative status is established. The system shall not describe them as legal surveys.
- **PERF-PA-04:** Public report projections shall use the approved approximate location and exclude private identity, attachment, and staff-note fields.
- **PERF-PA-05:** Report counts shall be described as records visible within the stated filters and permissions, not as a complete measure of actual problem prevalence. Verification and resolution remain human-entered states.

### 12d. Reliability and Availability Requirements

- **PERF-RA-01:** The server shall assign a stable report identifier and process repeat submission attempts idempotently so an ambiguous network retry does not create an unintended duplicate.
- **PERF-RA-02:** The interface shall distinguish a confirmed save from a pending, failed, or unknown result. It shall not display a success state before server confirmation.
- **PERF-RA-03:** A production availability objective, planned maintenance window, backup policy, recovery-point objective, and recovery-time objective shall be approved before operational release. These values are not currently established.
- **PERF-RA-04:** Backup restoration shall be rehearsed in a non-production environment before production data is accepted. Backup and recovery capability is not claimed by this SRS until verified for the selected hosting plan.

### 12e. Robustness or Fault-Tolerance Requirements

- **PERF-RF-01:** The system shall validate required fields, status transitions, account scope, coordinates, and attachment constraints on the server as well as in the client.
- **PERF-RF-02:** A failed status transaction shall not leave an unrecorded partial assignment or misleading success message. Status history, assignment history, and audit entries shall be committed consistently.
- **PERF-RF-03:** Network and service errors shall produce a recoverable message without exposing secrets, raw SQL, or private data.
- **PERF-RF-04:** Report lists and maps shall indicate pagination, filtering, or result caps. The current implementation paginates lists and caps staff viewport results at 1,000 points.
- **PERF-RF-05:** The system shall reject unsupported or oversized attachment uploads and preserve the report’s private access rules.

### 12f. Capacity Requirements

- **PERF-C-01:** The initial product scope is one city, 44 barangay reference areas, and six report categories.
- **PERF-C-02:** Staff report lists shall paginate rather than require the full report dataset to load into the client. The current staff list page size is 20.
- **PERF-C-03:** Staff map requests shall apply the current 1,000-point viewport cap and notify users when the result is limited.
- **PERF-C-04:** The current documentation does not establish a supported number of simultaneous users, total reports, or retained attachment volume. These limits shall be set from a pilot estimate and checked against the selected hosting and storage plan.
- **PERF-C-05:** Each report, announcement, or profile image shall comply with the configured private-storage rules and the current 5 MB JPEG/PNG/WebP limit.

### 12g. Scalability or Extensibility Requirements

- **PERF-SE-01:** New categories and routing destinations shall be introduced through reviewed reference data and access rules, not by granting permissions solely because of an organization’s name.
- **PERF-SE-02:** A change to a category, role, jurisdiction, or status transition shall include corresponding authorization and regression checks.
- **PERF-SE-03:** Multi-city deployment, large-scale public integration, and cross-jurisdiction reporting are outside the initial scope and shall require a separate design and capacity review.

### 12h. Longevity Requirements

- **PERF-L-01:** The project shall maintain versioned database migrations, setup instructions, dependency manifests, and release notes.
- **PERF-L-02:** The product owner shall identify a maintainer responsible for dependency updates, security review, database migrations, and service-plan renewal before operational handover.
- **PERF-L-03:** A data-retention and deletion schedule shall be approved before real operational records are retained beyond the academic evaluation period.
- **PERF-L-04:** The implementation shall avoid undocumented dependence on a single developer’s local environment or credentials.

## 13. Operational and Environmental Requirements

### 13a. Expected Physical Environment

- **OP-PE-01:** Residents shall use the Expo application on supported Android or iOS phones. Camera access is optional; location permission is requested only when the resident chooses GPS.
- **OP-PE-02:** Residents shall have an alternative map-pin or coordinate-entry path when GPS is denied or unavailable.
- **OP-PE-03:** Operational staff shall use the Next.js web workspace in a supported browser on a phone, tablet, or computer with network access.
- **OP-PE-04:** The product shall display a clear unavailable or retry state when the device cannot reach the backend or map service.
- **OP-PE-05:** Physical-device, iOS, and production-network coverage shall be documented separately from emulator or browser-preview results.

### 13b. Requirements for Interfacing with Adjacent Systems

- **OP-IS-01:** The resident and staff clients shall use Supabase Auth, PostgreSQL/PostGIS, row-level security, private Storage, and trusted workflow functions through authenticated interfaces.
- **OP-IS-02:** The product shall use device location only after an explicit user request and permission. It shall not use continuous background tracking.
- **OP-IS-03:** Map display shall use the configured native map provider on mobile and MapLibre for the resident browser preview or staff web maps, as applicable to the current client.
- **OP-IS-04:** Email confirmation, recovery, and staff invitation depend on configured authentication email delivery. A deliverable production account and SMTP configuration are required before these flows are accepted for release.
- **OP-IS-05:** Remote push delivery and automatic integration with government or utility platforms are not part of the current implementation. They shall require separate approval, interface specifications, security review, and cross-platform testing.
- **OP-IS-06:** Map, boundary, and photo assets shall retain required source and license attribution. The application shall not send report descriptions or reporter identity to map services.

### 13c. Productization Requirements

- **OP-PR-01:** Development, test, and production environments shall use separate credentials and data. Client bundles shall not contain a Supabase service-role key or other privileged secret.
- **OP-PR-02:** Production endpoints shall use HTTPS and explicit redirect allowlists. Production account recovery and confirmation shall be tested with deliverable email accounts.
- **OP-PR-03:** Database migrations shall be reviewed and applied in order. Destructive data changes shall have a tested backup and rollback or recovery procedure.
- **OP-PR-04:** Demonstration data shall remain distinguishable from operational data in storage and documentation. Fictional cases shall not be used as evidence of actual incidents or completed repairs.
- **OP-PR-05:** Public release requires approved app signing, provider configuration, usage limits, privacy notices, support ownership, and release documentation. The current export task produces client bundles; it does not by itself produce a signed Android APK or iOS release.

### 13d. Release Requirements

A release candidate shall not be described as operationally ready until the following are complete:

1. Scope, participating organizations, routing rules, and account approvers are confirmed.
2. Server-side authorization, privacy projections, attachment access, and administrative controls pass the release security review.
3. Production email delivery, map configuration, backups, recovery, monitoring, and service limits are configured and verified.
4. Accessibility and responsive workflows are checked on supported browsers and physical Android/iOS devices.
5. User guides, staff procedures, administrator instructions, privacy notices, and support contacts are available.
6. Known security findings and deployment-dependent limitations in the project verification record are reviewed and resolved or formally accepted.

## 14. Maintainability and Support Requirements

### 14a. Maintenance Requirements

- **MS-M-01:** Source code, database migrations, and configuration examples shall be version-controlled. Secrets and local account files shall remain outside source control.
- **MS-M-02:** Each release shall record application version, migration versions, dependency changes, and known limitations.
- **MS-M-03:** Maintenance changes to authorization, status transitions, routing, storage, or public projections shall include focused regression checks.
- **MS-M-04:** Dependencies and authentication settings shall be reviewed before each operational release and periodically during service.
- **MS-M-05:** System administrators shall not change live routing or category configuration without an approval record and a reviewed change procedure.

### 14b. Supportability Requirements

- **MS-S-01:** Resident, staff, and administrator guidance shall include a support contact or escalation path before any external pilot.
- **MS-S-02:** Support personnel shall be able to diagnose a failed submission, upload, invitation, or status update using a report identifier and non-sensitive operational logs.
- **MS-S-03:** Logs and error reports shall not expose passwords, service keys, private report descriptions, precise locations, or signed attachment URLs.
- **MS-S-04:** The operating organization shall define who handles access requests, account recovery, suspected misuse, privacy complaints, and service outages.

### 14c. Adaptability Requirements

- **MS-A-01:** Authorized administrators shall be able to maintain approved categories, organization memberships, routing rules, and access scopes through configuration where supported.
- **MS-A-02:** New categories, jurisdictions, and workflow actions shall be reviewed for data, permissions, user guidance, reporting, and audit effects before activation.
- **MS-A-03:** Additional language support shall use a reviewed localization catalog rather than scattered hard-coded text.
- **MS-A-04:** New external integrations shall be isolated behind documented interfaces and shall not bypass existing access rules.

## 15. Security Requirements

### 15a. Access Requirements

- **SEC-AC-01:** Every private report, attachment, status history, internal note, and staff workspace request shall be authorized by the backend.
- **SEC-AC-02:** Client-side role checks shall control navigation only; PostgreSQL row-level security and trusted functions shall enforce access to data and actions.
- **SEC-AC-03:** The system shall distinguish resident, barangay staff, office staff, and administrator roles. Staff access shall also be limited by active account status, membership, category, barangay, assignment, and action permission.
- **SEC-AC-04:** New staff shall be invited and approved by an administrator before staff access is activated. Role or jurisdiction changes shall require separate approval.
- **SEC-AC-05:** Residents shall access their own private reports and permitted public projections, not other residents’ private records.
- **SEC-AC-06:** Disabling an account, membership, organization, or access rule shall revoke subsequent backend access promptly.
- **SEC-AC-07:** The last active administrator shall not be removable through ordinary account-management actions.

### 15b. Integrity Requirements

- **SEC-IN-01:** The server shall validate report fields, allowed status transitions, assignment destinations, reasons, coordinates, and ownership before committing changes.
- **SEC-IN-02:** Clients shall not directly overwrite report status or audit records. Trusted server workflows shall write the corresponding history and assignment events consistently.
- **SEC-IN-03:** Report submissions shall use a stable identifier so ambiguous retries can be processed idempotently.
- **SEC-IN-04:** Possible duplicate matching shall be advisory. A staff member shall confirm a duplicate decision; the system shall not merge reports automatically.
- **SEC-IN-05:** Data correction or moderation shall preserve the original audit trail and record the responsible actor and time.
- **SEC-IN-06:** Imported or manually entered locations shall not receive fabricated coordinates or inferred barangays. Uncertain assignments shall remain reviewable.

### 15c. Privacy Requirements

- **SEC-PR-01:** The product shall collect only information needed to submit, route, review, and track a concern.
- **SEC-PR-02:** Precise report locations, reporter identity, private notes, and attachments shall remain access-controlled. Public summaries shall omit identity and attachment fields and use only the approved approximate location.
- **SEC-PR-03:** Location permission shall be requested only when the user chooses GPS. The product shall not perform background tracking.
- **SEC-PR-04:** Photo uploads shall use private storage. Access links shall be issued only after authorization and shall expire.
- **SEC-PR-05:** Notification text shall be generic and shall not expose sensitive report content on a locked screen.
- **SEC-PR-06:** Research interview records shall be kept separate from operational report data and handled under the approved research protocol.
- **SEC-PR-07:** A privacy notice shall identify the data controller, purposes, recipients, retention period, user rights, and contact for privacy requests before real operational data is collected.
- **SEC-PR-08:** The organization responsible for records shall approve retention, correction, export, and deletion procedures before a production pilot.

### 15d. Audit Requirements

- **SEC-AU-01:** The system shall record significant account, configuration, assignment, referral, moderation, and status actions with the authenticated actor, action, target, and timestamp.
- **SEC-AU-02:** Audit entries shall be written by trusted server/database processes and shall not be editable through ordinary client access.
- **SEC-AU-03:** Audit history shall be readable only by permitted administrators or other explicitly authorized reviewers.
- **SEC-AU-04:** The operating organization shall define audit retention, review frequency, incident escalation, and export procedures before operational deployment.

### 15e. Immunity Requirements

- **SEC-IM-01:** The system shall validate and bound user input on both client and server and shall safely render user-supplied text.
- **SEC-IM-02:** Uploads shall be restricted to the approved image formats and size limits and stored in private buckets. Upload verification shall reject unsupported content.
- **SEC-IM-03:** Production clients shall use publishable keys only. Privileged service credentials shall remain in trusted server environments.
- **SEC-IM-04:** Authorization and storage tests shall cover anonymous access, cross-resident access, unauthorized staff scope, direct status writes, and private-file access.
- **SEC-IM-05:** Before a public operational release, server-side image-content inspection shall be implemented or an equivalent protective control documented. The current project records this as a deployment gap.
- **SEC-IM-06:** Before release, the operator shall review unresolved authentication configuration, dependency advisories, database security findings, and service rate limits.

## 16. Cultural Requirements

### 16a. Cultural Requirements

Iligan Connect is intended for residents of Iligan City, where people have different cultural, linguistic, and social backgrounds. The product shall support reporting without discriminatory treatment or unnecessary communication barriers.

- **CR-01 — Language inclusivity:** Report descriptions shall accept Cebuano, Filipino, English, and Maranao text. Residents shall not be required to write exclusively in English. Interface translation and automatic translation are separate features and shall not be implied unless implemented and reviewed.
- **CR-02 — Cultural sensitivity:** Interface text, instructions, notifications, and status messages shall be respectful and neutral. The product shall avoid content that demeans or discriminates against cultural, religious, or social groups.
- **CR-03 — Community practices:** Reporting and referral workflows shall recognize barangay personnel’s role while allowing approved differences in category, jurisdiction, and referral rules. The system shall not assume that all barangays follow identical procedures.
- **CR-04 — Equal access and treatment:** Registered residents shall have the same reporting features regardless of cultural background, religion, language, or social status. Report assessment shall use documented operational criteria and shall not use a reporter’s personal background.
- **CR-05 — Respectful community interaction:** Reporting guidance shall encourage accurate, respectful descriptions. Authorized personnel shall be able to review and moderate inappropriate community content and record the reason, subject to role permissions.
- **CR-06 — Cultural adaptability:** Changes to language, terminology, and guidance shall be based on documented feedback and reviewed with appropriate community representatives. Interview findings from selected barangays shall not be presented as representing every Iligan community.

## 17. Legal Requirements

### 17a. Compliance Requirements

- **LEG-CR-01:** Before real operational data is collected, the responsible organization shall identify the personal information controller and any personal information processors, establish the lawful purpose and basis for processing, and provide an appropriate privacy notice.
- **LEG-CR-02:** The responsible organization shall review the product against the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and Regulations. The review shall cover transparency, legitimate purpose, proportionality, data-subject rights, security safeguards, retention, processor arrangements, and breach handling. This SRS does not claim legal compliance or certification.
- **LEG-CR-03:** A privacy impact assessment and any required National Privacy Commission registration or notification shall be completed when applicable to the responsible organization and processing activity.
- **LEG-CR-04:** Interview data used for requirements analysis shall be collected, stored, quoted, and retained under the approved research protocol and participant consent. It shall not be copied into operational report records.
- **LEG-CR-05:** Photos, map tiles, barangay boundaries, and other third-party materials shall be used according to their licenses and attribution requirements.
- **LEG-CR-06:** The institution and participating organizations shall review applicable records-retention, public-records, accessibility, and procurement obligations before operational deployment.

The applicable privacy law and NPC-issued implementing rules are available from the [Data Privacy Act of 2012](https://lawphil.net/statutes/repacts/ra2012/ra_10173_2012.html) and the [National Privacy Commission’s implementing rules](https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf).

### 17b. Standards Requirements

- **LEG-ST-01:** Web interfaces shall use WCAG 2.2 Level AA as their accessibility target. Native applications shall implement equivalent platform accessibility behavior. The project shall not claim conformance until it has completed and documented the relevant checks.
- **LEG-ST-02:** Production client-to-service communication shall use HTTPS. Privileged operations shall remain on trusted server/database functions.
- **LEG-ST-03:** Timestamps shall be stored and exchanged in a consistent machine-readable format and displayed in the user’s configured local time context.
- **LEG-ST-04:** Third-party libraries, map services, open datasets, fonts, and images shall be recorded with their license and attribution requirements.

WCAG 2.2 is a W3C Recommendation; the project uses it as a target, not as a statement of certification: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## 18. Project Issues

### 18a. Open Issues

| ID | Decision required | Why it remains open |
|---|---|---|
| OI-01 | Confirm which offices and service providers will participate and approve each routing scope. | Organization profiles and sample permissions do not prove formal participation. |
| OI-02 | Confirm the responsible data controller, privacy contact, lawful basis, retention schedule, and data-subject request procedure. | These operational governance decisions are not established by the prototype. |
| OI-03 | Confirm production availability, backup frequency, recovery objectives, and outage ownership. | The current project has no verified production service-level commitment. |
| OI-04 | Estimate peak users, report volume, attachment growth, and retention period. | No approved capacity estimate has been supplied. |
| OI-05 | Confirm the interface languages required for the first release. | Multilingual report text is required; translated interface content is not established. |
| OI-06 | Decide whether remote push delivery is approved and fundable. | Push delivery is optional and currently unconfigured. |
| OI-07 | Confirm the target browsers, physical Android/iOS devices, app-signing accounts, and release channel. | Current exports and emulator checks do not establish a signed public release. |
| OI-08 | Reconcile PUC-07 wording across Sections 8b and 9a. | The paper currently uses “Moderate a report,” while the revised diagram describes human review of potentially invalid or repeated reports. |
| OI-09 | Confirm whether consultations, meeting requests/actions, and announcements are core scope or optional scope, then align the BUC and PUC tables. | The current eight-row BUC mapping focuses on account access, reporting, status, monitoring, moderation, and administration. |
| OI-10 | Confirm whether purok/zone representatives have their own account role or submit through a resident or staff-assisted workflow. | The interviews describe participation, but the current authorization model has no distinct representative role. |
| OI-11 | Approve the performance test dataset, concurrency, network conditions, and acceptance thresholds. | Proposed latency targets have not been load-tested. |
| OI-12 | Confirm the approved map, boundary, photo, and third-party service licenses and production quotas. | Prototype availability does not establish a production license or quota. |

## 19. Off-the-Shelf Solutions

### 19a. Ready-Made Products

- Supabase provides managed authentication, PostgreSQL/PostGIS, private object storage, and trusted database functions.
- React Native and Expo provide the resident application runtime and build tooling.
- Next.js provides the staff web workspace.
- MapLibre and native map libraries provide map display. Device location is provided by the operating system after permission.
- No ready-made civic-reporting product is currently adopted as the Iligan Connect system of record. Replacing the product with a third-party platform would require a separate procurement, privacy, data-export, and integration review.

### 19b. Reusable Components

- The existing report forms, category lookup, shared domain types, staff authorization context, routing rules, status-transition functions, audit controls, notification records, and map components may be reused within this project.
- Reuse shall preserve server-side authorization, private storage rules, and existing audit behavior.
- Open-source components may be reused only under their applicable licenses and with required notices.

### 19c. Products That Can Be Copied

- No proprietary civic-reporting workflow, brand, or interface is designated for copying.
- Project code and assets may be reused only where ownership and license permit it.
- Map tiles, barangay boundaries, photographs, icons, and reference datasets shall not be copied into a release without confirming their license, attribution, and permitted purpose.

## 20. New Problems

### 20a. Effects on the Current Environment

The system adds a digital reporting channel alongside existing barangay channels. Residents may submit a concern through the application and also report it in person or by telephone, which can create duplicate records. Participating personnel will need clear procedures for reconciling duplicates and keeping residents informed without implying that an online submission guarantees work.

### 20b. Effects on the Installed Systems

The current product does not automatically exchange records with barangay, city, national-agency, utility, or emergency systems. Staff referrals and acknowledgments therefore depend on approved routing procedures and any existing communication channels. The product shall not overwrite or claim synchronization with an external system.

### 20c. Potential User Problems

- Residents may interpret “submitted,” “verified,” or “resolved” as a guarantee of immediate action. Guidance must explain what each status records.
- GPS, manually entered coordinates, or indicative boundaries may place a report inaccurately. The reporter must be able to inspect and correct the pin.
- Public or shared devices may expose account sessions or report details if users fail to sign out.
- Photos and descriptions may include faces, vehicle plates, private property, or other unnecessary personal information.
- Residents without smartphones, stable connectivity, or confidence using maps may need to use existing barangay reporting channels.
- Differences in terminology, literacy, or language may cause incomplete or misunderstood reports.
- Report moderation and duplicate review may be disputed; staff decisions need a recorded reason and correction path.

### 20d. Limitations in the Anticipated Implementation Environment That May Inhibit the New Product

- Report submission requires an active connection to the backend; offline submission is not part of the current baseline.
- GPS accuracy, indoor reception, device hardware, map coverage, and mobile data quality vary.
- Standalone Android builds require a restricted map API key; hosted map and storage quotas depend on the selected provider plan.
- Production email delivery, app signing, public hosting, database backups, and operational monitoring require separate configuration.
- Map queries are capped and lists are paginated to control response size; staff may need to narrow a large view by area or filter.
- Current native-device, iOS, and public-hosting verification is incomplete.

### 20e. Follow-Up Problems

Before a pilot, the project team shall resolve data ownership, office approvals, routing rules, retention, privacy contacts, support responsibilities, outage procedures, capacity targets, and language requirements. After a pilot, the owner shall review incorrect locations, duplicate handling, pending reports, user support requests, and permission changes. Findings shall be recorded and used to update the SRS and operating procedures.

## 21. Tasks

### 21a. Project Planning

The project plan shall assign an owner, output, dependency, and completion evidence for each task.

1. Baseline the agreed product scope and reconcile Sections 6c, 8a, 8b, and 9a.
2. Confirm interview-based findings, approved participants, representative terminology, and research-data handling.
3. Approve role definitions, office participation, routing rules, and staff account approvers.
4. Finalize privacy, retention, accessibility, language, security, capacity, and availability requirements.
5. Complete resident and staff interface updates, including any approved gap-analysis enhancements.
6. Configure the target backend, email delivery, map provider, environment variables, and database migrations.
7. Verify functional workflows, role isolation, location behavior, attachment privacy, error handling, and audit history.
8. Conduct accessibility, performance, security, and physical-device checks against the acceptance plan.
9. Prepare user documentation, training materials, support procedures, and release notes.
10. Obtain institutional and operational approval before any real-data pilot.

### 21b. Planning of the Development Phases

| Phase | Main work | Exit evidence |
|---|---|---|
| 1. Requirements baseline | Reconcile current paper, interview findings, BUC/PUC mapping, optional features, and open issues. | Approved scope and requirements traceability table. |
| 2. Design and review | Confirm roles, screens, location handling, language, privacy, and access boundaries. | Reviewed diagrams, workflows, and acceptance criteria. |
| 3. Implementation and configuration | Complete approved client, backend, routing, notification, and administration work. | Versioned source, migrations, environment checklist, and review records. |
| 4. Verification | Run functional, RBAC, security, accessibility, performance, and device checks. | Results with environment, dataset, limitations, and defects. |
| 5. Controlled release or academic demonstration | Configure approved environment, use clearly identified demonstration data, train intended users, and monitor issues. | Release approval, guide set, support owner, and rollback/recovery plan. |
| 6. Handover and maintenance | Transfer credentials through approved channels, document ownership, and plan updates. | Maintainer acceptance, operating guide, and review schedule. |

## 22. Migration to the New Product

### 22a. Requirements for Migration to the New Product

- **MIG-01:** No operational legacy-report dataset is approved for migration by this SRS. Real records shall not be imported until the data owner, lawful basis, source permissions, and mapping are approved.
- **MIG-02:** Barangay and category reference data shall be checked against the target project before use. Imported boundary data shall retain provenance and limitations.
- **MIG-03:** Any pilot migration shall be rehearsed in a non-production environment using a documented mapping and reconciliation report.
- **MIG-04:** The migration shall record source totals, rejected rows, transformed rows, attachment totals, and final target totals. The project owner shall approve the reconciliation before cutover.
- **MIG-05:** A rollback or restoration plan shall be tested before a migration that changes operational data.
- **MIG-06:** Fictional presentation records shall remain identified as synthetic and shall not be migrated as real incidents.

### 22b. Data That Has to Be Modified or Translated for the New System

| Source data | Target handling |
|---|---|
| Category text | Map only to one of the six approved category records. Unmatched values require review; do not guess. |
| Barangay name | Map to the canonical barangay identifier. Preserve the source value where reconciliation is uncertain. |
| Location | Store confirmed coordinates and source/accuracy where available. Do not manufacture coordinates for address-only records. Preserve unresolved locations for review. |
| Report status | Map to an allowed status and preserve each known status event, actor, reason, and timestamp where available. Do not migrate only the latest status if history exists. |
| Reporter identity | Link only to a verified account under an approved process. Do not migrate passwords or create accounts from unverified names or email addresses. |
| Photo or attachment | Verify ownership, license, file type, size, privacy, and report linkage before transfer to private storage. |
| Assignment and referral | Map only to an approved organization, jurisdiction, and category rule. Unconfirmed destinations remain unresolved for administrator review. |
| Assessment or internal note | Keep staff-only data private and preserve its source and author where available. Do not publish private notes as resident-visible history. |
| Consultation, meeting, or announcement data | Migrate only if these functions remain in scope and their participants, visibility, permissions, and retention have been approved. |

## 23. Risks

| Risk | Potential effect | Mitigation |
|---|---|---|
| Unauthorized access to reports, precise locations, or photos | Privacy harm and loss of trust | Enforce backend RLS and private storage, test cross-role denial, minimize public projections, and review audit activity. |
| Unapproved office participation or routing | Cases reach the wrong organization or imply endorsement | Obtain written scope approval; keep profiles provisional until approved; review each category and jurisdiction rule. |
| Incorrect location or boundary interpretation | Delayed or misdirected response | Require pin confirmation, let residents correct locations, label boundaries as indicative, and provide staff correction procedures. |
| Duplicate, misleading, or abusive submissions | Staff workload and unfair treatment | Keep duplicate detection advisory, require human decisions and reasons, and provide correction and moderation paths. |
| Users expect emergency response or guaranteed repair | Safety risk and complaints | State limits at report entry and in status guidance; direct immediate threats to appropriate emergency channels. |
| Exposure through photos, notifications, or public views | Personal information disclosure | Use private storage, short-lived authorized links, generic notifications, and limited public summaries. |
| Network or provider outage | Reports or staff actions are delayed | Show service state, use idempotent writes, document outage procedures, and establish production recovery targets. |
| Unresolved hosting, security, or maintenance costs | Service interruption or insecure deployment | Select a production plan, review current findings, assign an operator, and estimate recurring costs before release. |
| Limited language, device, or connectivity access | Unequal participation | Retain existing barangay channels, provide clear guidance, test with intended communities, and prioritize approved localization. |

## 24. Costs

No project budget or production vendor quote is established in the current paper. The project shall estimate costs before an operational pilot.

| Cost area | Items to estimate |
|---|---|
| Hosting and database | Supabase plan, database capacity, backups, compute, storage, and egress. |
| Maps and location | Map tile usage, provider quotas, Android map key restrictions, and any paid provider agreement. |
| Email and authentication | SMTP delivery, domain, account recovery, and invitation email operations. |
| App release | Expo/EAS services if used, Android signing, Apple developer membership, store fees, and release maintenance. |
| Security and privacy | Privacy assessment, security review, incident response, and external technical review if required. |
| Operations | Staff time for routing, report review, referrals, moderation, account approval, and system administration. |
| Training and support | User guides, accessible materials, orientation, support contact, and ongoing maintenance. |
| Data migration | Source cleanup, mapping, attachment review, rehearsal, reconciliation, and rollback preparation. |

The current academic implementation has not enabled paid geocoding or remote push delivery. Provider prices and quotas shall be checked for the selected deployment rather than assumed from the development environment.

## 25. User Documentation and Training

### 25a. User Documentation Requirements

The project shall prepare:

1. A resident quick-start guide for account creation, safe reporting, category selection, location confirmation, optional photos, status tracking, and privacy.
2. A staff guide for permitted queues, review, verification, assignment, referrals, status reasons, duplicate review, evidence, and escalation.
3. An administrator guide for staff invitations and approvals, memberships, category and routing rules, audit review, account disablement, and configuration changes.
4. A concise status glossary explaining submitted, under review, verified, assigned, in progress, resolved, rejected, and duplicate.
5. A troubleshooting guide for location permissions, map display, failed uploads, lost connectivity, account recovery, and unavailable services.
6. A privacy and safety notice describing the limits of the system, data visibility, photo guidance, and urgent-reporting limitations.

Documentation shall match the released version, avoid implying official adoption, and identify any demonstration data as fictional.

### 25b. Training Requirements

- Residents shall receive a short demonstration or guide focused on safe report submission, location confirmation, and status interpretation.
- Authorized staff shall receive role-specific training for review, routing, status updates, privacy, moderation, and correction of inaccurate records.
- Administrators shall be trained in invitation and approval, least-privilege configuration, audit review, and incident escalation.
- Training shall use synthetic accounts and records until an approved operational environment is available.
- Training attendance, materials, and unresolved questions shall be recorded before a pilot.

## 26. Waiting Room

The following items are not part of the committed core baseline unless they are explicitly approved in Section 8b and assigned corresponding requirements:

| Candidate capability | Reason to defer | Condition for reconsideration |
|---|---|---|
| Remote push notifications | Provider delivery, user consent, credentials, lock-screen privacy, and cross-platform testing are not complete. | Approved notification policy, provider setup, privacy review, and Android/iOS verification. |
| Offline report queue | Offline storage raises conflict, privacy, retry, and duplicate-handling requirements. | Defined retention and synchronization behavior plus security testing. |
| Full interface localization | Translations require reviewed strings and consistent terminology across resident and staff clients. | Validated translation and maintenance owner for each supported language. |
| Automatic integration with government or utility systems | No approved interface agreements or data-sharing rules are established. | Written approval, data contract, security review, and integration test environment. |
| Multi-city or regional deployment | Current scope and reference data are Iligan City-specific. | Separate jurisdiction model, data ownership, capacity, and governance approval. |
| Automated urgency or AI classification | The system must not make unvalidated decisions about safety, responsibility, or resolution. | Separate evidence-based requirements, human oversight, impact review, and acceptance tests. |
| Historical report migration | Source ownership, accuracy, privacy, and field mapping are not established. | Approved source inventory, lawful basis, tested mapping, and reconciliation plan. |

## 27. Ideas for Solutions

These are options for resolving open issues; they are not approved requirements until accepted in the relevant SRS section.

- **Language support:** Store interface text in a localization catalog and ask fluent community reviewers to validate Cebuano, Filipino, and Maranao terminology. Keep original user-submitted text unchanged.
- **Routing approval:** Maintain a signed responsibility matrix that maps category, barangay, organization, allowed actions, and escalation contact. Translate approved entries into backend rules and test both allowed and denied cases.
- **Availability and recovery:** Select a hosting plan with documented backup capability, define recovery objectives, and conduct a restoration rehearsal before accepting operational records.
- **Capacity planning:** Estimate expected accounts, peak concurrent users, reports per month, photo volume, and retention; run a representative load test on the chosen production plan.
- **External integration:** Begin with an authorized, privacy-reviewed export or referral acknowledgment workflow. Add an automated API only after both organizations approve a data contract and security model.
- **Location uncertainty:** Keep GPS optional, require resident confirmation, show boundary uncertainty honestly, and preserve a staff correction path without inventing coordinates.
- **Release readiness:** Use a staged checklist for privacy, permissions, email delivery, map configuration, security findings, accessibility, signed builds, training, support, and rollback.

## Project Source References

The requirements above were cross-checked against the current paper supplied by the project team and the repository’s [feature coverage](features.md), [architecture](architecture.md), [role and access rules](rbac.md), [environment setup](setup.md), [verification record](verification.md), [design benchmarks](design-benchmarks.md), and [data provenance](../data/README.md).
