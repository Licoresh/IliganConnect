# Connected sample workspace

This is a prepared presentation dataset, not a register of actual Iligan incidents. At the owner's request, screens use natural titles, names and workflow copy without repeated sample/demo badges or banners; the presenter explains the data's origin separately. Database `is_demo`/`is_sample` flags, exact UUIDs and private photo provenance remain intact. It contains 36 fictional cases: six categories, each with a submitted, under-review, verified, assigned, in-progress and resolved case. It also links three consultations, three meeting requests, two meetings, comments, follow-up actions and four announcements. Stored records drive the maps, counts, queues and charts.

The coordinates are distinct illustrative positions checked inside six stored barangay polygons. They are not surveyed incident locations or verified road points. The boundary datasets are indicative; see [geographic provenance](../data/README.md). Website photographs come from other or unspecified locations. Each uploaded illustration retains its source, creator, license and description; see [photo sources](sample-images.md) and `data/sample-workspace/photos.json`. Neither a photo nor a resolved sample status establishes that an actual defect or repair occurred.

Office scopes remain provisional even though their display names omit the temporary suffix. CDRRMO remains read-only. DPWH road assignments stay inside Tibanga. Utility, engineering, waste and traffic accounts retain their configured permissions. The owner's real admin and real submissions are separate from these internally flagged records. Do not infer institutional approval from the presentation names.

On 31 October 2026 the owner first retired, then explicitly requested complete deletion of the two assessment-team offices. All remaining engineering organization references now use City Engineer; environmental references use CENRO. Report progress, action completion, original actors/timestamps and audit history remain. Six total offices remain, all active; the two identities, 12 old rules and obsolete membership are deleted. The old setup account has no staff authorization. Prepared source and manifest organization references use the surviving offices only. This does not expand destination category permissions; a complete fresh seed of past scenarios still requires separate routing review.

`data/office-retirement.json` records the approved final deletion scope. `node scripts/prepare-office-removal.mjs` prepares guarded SQL and a rollback rehearsal without applying them; the reviewed transaction was rehearsed, committed and idempotence checked. The older retirement-only preparer refuses this final plan. `node scripts/verify-office-retirement.mjs` now performs 39 read-only removal/reference/access checks. See [verification](verification.md) for the applied outcome and limits. Audit entries remain as historical evidence, not reactivatable office records.

## Prepare and load

Run from the repository root with the existing ignored local account and Supabase configuration files. No service-role credential is used by the file scripts.

```powershell
node scripts/prepare-sample-workspace.mjs
```

This prepares `artifacts/sample-workspace.sql` and the exact UUID manifest only. Review the SQL, then execute it explicitly through the authenticated Supabase database-owner connection. It enables sample mode, validates reference data and polygon coverage, refuses UUID collisions, and uses the normal status-transition function to produce connected histories and notifications. Existing matching sample cases are preserved on rerun; it does not reset user edits. The fixed simulated timeline is anchored to 31 October 2026 in Manila.

## Location and urgency enrichment — 2026-11-07

All 40 prepared reports now include illustrative Purok and Zone values and the entered-coordinates source. The four duplicate submissions share their main report’s location. These address labels are scenario details, not surveyed boundaries or address matches for the saved pins. No detected address or GPS accuracy is supplied.

The 24 cases that reached verification now have an explicit urgency rating and rationale in private assessment history. The six submitted, six under-review and four duplicate cases remain unassessed. The existing cases, progress, severity, pins, attachments and duplicate links were preserved. Assessment entries for this enrichment are dated when the data was updated. Fresh seeds use their simulated verification dates.

`node scripts/prepare-sample-report-enrichment.mjs` prepares guarded apply and rollback SQL for the 40 exact fixture IDs. The transaction checks origin, owner, title, category, barangay, status, coordinates, severity, duplicate links and existing assessment values before writing. It refuses conflicting edits. The rollback rehearsal and live apply succeeded. The base and linked verifiers passed 411 and 29 read-only checks, respectively. The cleanup generator accounts for the new assessment foreign key.

## Load and verify images

After the reviewed seed transaction succeeds:

```powershell
node scripts/load-sample-media.mjs --load-samples
node scripts/verify-sample-workspace.mjs
```

The loader checks exact manifest identities, internal origin flags and original-image hashes, uploads 36 report images and four announcement images through private Storage, and preserves attribution metadata without adding credit text to announcement bodies. It reuses matching files and refuses to overwrite different content. To remove legacy embedded photo credits from the four prepared announcements without changing images or provenance, run `node scripts/load-sample-media.mjs --remove-photo-captions`. Visibility is controlled by **Administration → Configuration → Include presentation records** (`analytics_settings.include_samples`); disabling it hides the prepared records while retaining their rows and files. Real records remain available according to normal permissions. Safety checks use flags, owners and exact manifest identity rather than a visible title prefix.

## Remove this sample workspace

Preparation is read-only:

```powershell
node scripts/prepare-sample-cleanup.mjs
```

Review `artifacts/remove-sample-workspace.sql`. It targets only the exact manifest UUIDs and their dependent data. It refuses mismatched/real roots, references from other roots and remaining associated Storage files. It preserves accounts, office configuration, reference data and real records.

When removal is intended, leave sample mode enabled and explicitly remove the 40 known file paths first:

```powershell
node scripts/prepare-sample-cleanup.mjs --remove-files
```

This authenticates the ignored resident/admin setup accounts and calls the Storage API for the exact reviewed paths. It verifies file absence and leaves database records intact. A failure may leave partial file removal; it reports that failure and never claims the database was cleared. Unrecognized extra files are not removed; the guarded SQL will refuse to delete their pointers until they are reviewed separately. Never delete `storage.objects` with SQL.

After successful file removal, execute the reviewed cleanup SQL explicitly through the database-owner connection. It removes linked notifications, attachments, history, assignments, discussions, meetings, community roots and their sample audit entries in one transaction. It disables sample mode only if no other sample roots remain. Recheck row and Storage counts afterward. Keep the manifest until removal has been verified.


## Linked duplicate presentation example — 2026-10-31

The owner approved four additional prepared submissions attached to the existing in-progress Tubod drainage case, **Blocked channel under engineering review - Tubod**. These are saved database records, not verified real-world reports. Natural presentation copy is retained with internal origin flags. Their coordinates intentionally match the main case because they illustrate one incident; the original 36 distinct scenario positions remain unchanged. Each child has a separately stored copy of the existing licensed drainage illustration and preserved attribution. Total inventory is now 40 reports and 44 private image files (40 report images plus four announcement images), with four confirmed duplicate links.

`data/sample-workspace/linked-duplicates.json` records exact child/main identities. `node scripts/prepare-linked-duplicate-examples.mjs` writes guarded SQL to `artifacts/linked-duplicate-examples.sql`; review and execute it explicitly with the database-owner connection. It verifies the prepared main's owner/title/status, uses ordinary submission/confirmation functions, refuses edited UUID collisions, and preserves matching records on rerun. It does not reset an edited or progressed main report. The seed was first tested with rollback and then applied; its second run preserved the same four links.

After the reviewed transaction:

```powershell
node scripts/load-linked-duplicate-media.mjs --load-linked-examples
node scripts/verify-linked-duplicates.mjs
```

The loader checks internal origins/ownership, the live main link, exact titles and image hashes; matching files are reused, different content is never overwritten. Verification reads all four records and progress projections, compares the main's live status/office and downloads all four illustrations to check their hashes. The original 267-check workspace verifier still covers its exact 36-case manifest; the linked verifier adds 21 checks. These four records remain separate from the original six-per-status manifest so that rerunning the base seed does not overwrite reviewed links.

The existing cleanup preparer now includes these exact linked identities and their `linked-duplicates-v1` file paths when the extension manifest is present. Default execution only prepares SQL; no removal was performed. Its existing owner/origin/title, external-dependency and stored-file safeguards remain. Presentation mode hides these children, main progress and new evidence access just as it hides the original prepared reports.
