# Location boundary sources

Retrieved 2026-10-25. These are indicative geographic datasets, not certified legal boundaries.

- `../app/assets/iligan-barangays.json`: 44 barangays from [philippines-json-maps, 2023 PSGC snapshot](https://github.com/faeldon/philippines-json-maps), file `2023/geojson/municities/hires/bgysubmuns-municity-1030900000.0.1.json`. MIT license retained in `BOUNDARIES-LICENSE`. The resident Explore choropleth uses these polygons; they are mapped boundary data, not a certified legal survey.
- `iligan-city-osm.json`: saved Nominatim response containing [OpenStreetMap relation 3818838](https://www.openstreetmap.org/relation/3818838). © OpenStreetMap contributors, [ODbL attribution and license](https://www.openstreetmap.org/copyright). Nominatim was used once to retrieve the source, not as an application geocoding backend.

The older barangay snapshot misses some outer-city coverage. The resolver accepts city membership covered by either dataset, but suggests a barangay only where exactly one barangay polygon matches. It never assigns the nearest barangay as a substitute for missing coverage. Residents can manually confirm or correct the suggestion. A 25-metre band outside the city polygon returns an uncertain city result.

Migrations `20261025070746_free_boundary_location.sql` and `20261025071356_city_boundary_coverage.sql` store these geometries in PostGIS; the intervening migration removes the superseded city check. Runtime checks happen in Supabase without a paid geocoding API. Camera bounds only constrain navigation; the RPC and report trigger perform geographic checks.

When updating sources, retain provenance and licenses, validate geometry and regression locations, and review disagreements before changing the live boundaries. `npm run test:location` checks representative locations and access restrictions; it does not establish accuracy at every boundary.
