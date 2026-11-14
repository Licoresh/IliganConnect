import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleLocation } from "../shared/index";
import { barangayAreaKm2, barangayDensity, iliganBarangayBoundaries } from "../app/lib/barangay-map";
import { pointInPolygon } from "../web/lib/map-geometry";

const barangays = [{ id: "palao", name: "Palao" }, { id: "san-roque", name: "San Roque" }];

test("Google address parts recognize Iligan and match its barangay despite punctuation differences", () => {
  const result = resolveGoogleLocation([{
    formatted_address: "Pala-o, Iligan City, Philippines",
    address_components: [
      { long_name: "Iligan City", types: ["locality", "political"] },
      { long_name: "Pala-o", types: ["administrative_area_level_4", "political"] },
    ],
  }], barangays);
  assert.deepEqual(result, { city: "inside", barangay: "Palao", address: "Pala-o, Iligan City, Philippines" });
});

test("Google identifies Iligan when the city is in its administrative-level component", () => {
  const result = resolveGoogleLocation([{
    address_components: [
      { long_name: "Iligan City", types: ["administrative_area_level_2", "political"] },
      { long_name: "Palao", types: ["administrative_area_level_4", "political"] },
    ],
  }], barangays);
  assert.equal(result.city, "inside");
  assert.equal(result.barangay, "Palao");
});

test("an explicit Google locality outside Iligan is not overridden by a same-named barangay", () => {
  const result = resolveGoogleLocation([{
    formatted_address: "San Roque, Cagayan de Oro City, Philippines",
    address_components: [
      { long_name: "Cagayan de Oro City", types: ["locality", "political"] },
      { long_name: "San Roque", types: ["administrative_area_level_4", "political"] },
    ],
  }], barangays);
  assert.equal(result.city, "outside");
});

test("a locality label matching an Iligan barangay is not mistaken for another city", () => {
  const result = resolveGoogleLocation([{
    address_components: [
      { long_name: "Pala-o", types: ["locality", "political"] },
      { long_name: "Pala-o", types: ["administrative_area_level_4", "political"] },
    ],
  }], barangays);
  assert.equal(result.city, "unknown");
  assert.equal(result.barangay, "Palao");
});

test("missing city components remain unverified instead of wrongly accusing the pin as outside", () => {
  assert.equal(resolveGoogleLocation([{ address_components: [{ long_name: "Road", types: ["route"] }] }], barangays).city, "unknown");
});

test("barangay density derives missing polygon area from shared boundary geometry", () => {
  const poblacion = iliganBarangayBoundaries.find((item) => item.properties.adm4_en === "Poblacion");
  assert.ok(poblacion);
  const area = barangayAreaKm2(poblacion);
  assert.ok(area > 0 && area < 100);
  assert.ok(barangayDensity(12, area) > 0);
  assert.equal(barangayAreaKm2(iliganBarangayBoundaries.find((item) => item.properties.adm4_en === "Abuno")!), 7);
});

test("Poblacion demo map fixture stays inside its mapped barangay boundary", () => {
  const poblacion = iliganBarangayBoundaries.find((item) => item.properties.adm4_en === "Poblacion");
  assert.ok(poblacion);
  assert.equal(pointInPolygon([124.2376, 8.22915], poblacion.geometry), true);
});
