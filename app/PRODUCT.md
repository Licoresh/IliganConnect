# Iligan Connect resident product

## Product

Iligan Connect helps Iligan City residents report local concerns, follow progress, explore public reports and maps, and coordinate through barangay community features.

## Resident surface

The `app` workspace is the resident client. It is an Expo app for Android and iOS and can also be exported for the web with Expo Router and React Native Web. The resident web experience should reuse the same screens, Supabase client, authentication, validation, navigation, and data operations as the native app.

Primary areas are Home, Explore, Report, Community, Profile, Notifications, Announcements, and report tracking. Residents need a confirmed map pin and barangay to submit a report; GPS is optional, and Purok, Zone, and directions are optional supplements.

## Constraints

- Preserve existing authentication, authorization, Supabase calls, validation, routes, role rules, and reporting/community workflows.
- Do not substitute mock data or static controls for live resident functionality.
- Support mobile touch layouts and responsive web widths from phone through desktop.
- The `web` workspace is the separate staff workspace; resident and staff surfaces must retain their role boundary.
