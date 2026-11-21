# Resident visual system

## Direction

Keep the established Iligan Connect civic identity: deep teal and navy, cool off-white surfaces, mint accents, legible high-contrast text, thin cool borders, and restrained elevation. Keep the interface calm, direct, and useful for community reporting. Reference images are in [the responsive reference page](../docs/design/responsive-reference.md).

## Existing tokens

- Deep teal/navy: `#12343d`
- Brand teal: `#08756b`
- Soft mint: `#e5f6f2`
- Page surface: `#f3f7f5`
- Warm input surface: `#fbfcfb`
- Muted text: `#5d7378`
- Border: `#d8e4e0`

The implementation source of these values is `app/components/ui.tsx`.

## Responsive composition

- Phone web and native mobile: compact branded header, one-column content, fixed five-item bottom navigation, thumb-sized controls.
- Tablet web (768–1199 CSS px): centered, width-capped content with compact gutters and horizontal top navigation. Narrow tablets stay single-column; wide tablets use the home dashboard split only when there is room. Short landscape viewports reduce vertical gaps and hero sizes, while map height adapts to both width and height.
- Desktop web (1200 CSS px and up): a compact light resident sidebar, page title and action toolbar, cool off-white canvas, and page-specific workspace layouts. Home uses a weighted dashboard grid; Explore pairs filters and selectable reports with a large map; Community uses a compact tab and filter toolbar with two-column conversation and meeting results; Report places a connected horizontal stepper above a readable form; Profile uses tabs for details, settings, and help, with personal information and activity shown in its details view.
- The desktop shell and compositions are gated to the desktop web breakpoint. Tablet, phone, and native mobile keep their existing navigation and page compositions.
- Keep desktop resident pages on one centered 1360 px content measure with the same title, description, and action row, then divide each page into clearly titled sections. Put notifications before Sign out at the right end of the desktop header and require confirmation; keep the app version in the sidebar footer. On Profile, group Personal details, My activity, Settings, and Help & support as distinct sections. These shell and section changes apply only to desktop web.
- Desktop sidebar items share a neutral idle treatment. Use the Report item's former teal-and-white styling for the selected, hovered, and keyboard-focused navigation states across all sidebar items; leave tablet and mobile navigation states unchanged.
- Forms and maps remain usable at every width; content, data, and available actions remain live and consistent across platforms.

## Desktop selections

- Explore's Map, Barangays, and List views and Profile's Profile details, Settings, and Help center use the same flat horizontal tab row as Community, with a teal underline for the selected view. Keep the existing segmented controls and profile navigation on tablet and mobile.
- On desktop, the notification bell opens a centered, scrollable notifications modal over the current page. Notification links still navigate to their related content; phone and tablet retain the dedicated notifications page.
- Category, barangay, status, and other choice fields open a compact searchable dropdown anchored to the field. Selecting an option applies it immediately; clicking outside or pressing Escape closes the list.
- Phone and tablet keep the existing bottom-sheet picker and touch-sized rows.
- Dropdown lists keep the current category icons, barangay priority, loading and error states, and keyboard access without dimming or blocking the full page.

## Resident sign-in

On desktop, keep sign-in minimalist: a white split composition with the existing Iligan logo and story copy on the left, a fine vertical divider, and a focused form on the right. Use the brand teal for the primary action and a light outline for account creation. Desktop signup hides the story panel and centers a single form card, with fields in paired rows for first/last name, middle name/age, contact/barangay, and password/confirmation; keep email full-width. Tablet and phone retain the existing stacked auth layout.

## Surface rules

- Use spacing for hierarchy before adding borders or decorative panels.
- Cards use a 12–16 px radius and either a fine border or soft elevation, not both heavily.
- Keep labels, focus states, and controls readable and keyboard/touch accessible.
- Preserve real report, announcement, and map data. The generated references contain illustrative sample content and are visual guidance only.

## Desktop layout references

- Linear's display options informed the consistent page controls and view switching: [Linear Display options](https://linear.app/docs/display-options).
- Linear's issue view informed the readable content measure on wide screens: [Linear issue view layout](https://linear.app/changelog/2021-06-03-issue-view-layout).
- Google Maps' desktop search panel informed the Explore results-and-map split: [Google Maps desktop search](https://support.google.com/maps/answer/3092445?hl=en).
- Keep the existing category icons and report map pins. The desktop work changes placement and spacing, not their visual identity or behavior.
