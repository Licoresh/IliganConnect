# Staff Operations Portal

## Product

Iligan Connect helps city administrators, barangay staff, and city office staff review local reports, coordinate community work, and keep decisions accountable. This brief covers only the staff workspace in `web/`; Resident Portal screens and behavior are out of scope.

## Users and jobs

- **Barangay staff** review concerns assigned to their barangay, record walk-in reports, coordinate meetings and consultations, and check residents and local patterns.
- **Office staff** act on reports assigned to their organization, review reports in approved category and geographic coverage, and follow office responsibilities.
- **Administrators** oversee citywide reports, accounts, memberships, access rules, organizations, routing, and audit activity.

Staff access, data scope, enabled actions, and available pages come from the authenticated server context and existing database permissions. A layout change must not broaden access or replace existing workflows.

## Product behavior

- The current workspace is a client-rendered Next.js staff shell with existing role-filtered navigation and shared report, mapping, analytics, community, administration, and settings modules.
- Preserve routes and deep links, query behavior, role permissions, data fetching, and desktop presentation.
- On phones, prioritize one-handed access to the role's most frequent tasks and place secondary destinations in a clearly labeled More menu.
- On tablets, use a compact, labeled navigation rail and a content layout that uses the available width without becoming a phone layout stretched across the screen.
- Keep report and meeting details, filters, forms, maps, and management actions usable on touchscreens.

## Visual direction

Keep the existing civic operations identity: deep teal navigation, teal action color, cool off-white ground, dark navy text, restrained borders, and existing status colors. Prefer clear task lists, grouped controls, and compact information over nested cards or decorative dashboard tiles. Use color to distinguish role context, active work, and meaningful status only.

## Guardrails

- Do not change Resident Portal components, native app screens, shared resident functionality, or backend/database behavior.
- Do not change the desktop composition at 1024px and wider.
- Keep production data live and authorization-scoped; visual-only reference screens must be labeled illustrative.
- Do not introduce role-specific features that the existing application does not support.
