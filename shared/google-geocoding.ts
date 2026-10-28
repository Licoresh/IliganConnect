export type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

export type GoogleGeocodeResult = {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
};

export type BarangayMatch = { id: string; name: string };
export type CityCheck = "inside" | "outside" | "unknown";

const cleanName = (value: string) => value.toLowerCase().replace(/^(barangay|brgy)\.?\s*/i, "").replace(/[^a-z0-9]/g, "");

/** Resolves Google's address components against the city's official barangay lookup. */
export function resolveGoogleLocation(results: GoogleGeocodeResult[], barangays: BarangayMatch[]) {
  const components = results.flatMap((result) => result.address_components ?? []);
  const barangay = barangays.find((item) => {
    const name = cleanName(item.name);
    return components.some((component) => [component.long_name, component.short_name].some((value) => !!value && cleanName(value) === name));
  }) ?? null;
  const localityParts = components.filter((component) => component.types?.some((type) => ["locality", "postal_town"].includes(type)));
  const cityParts = components.filter((component) => component.types?.some((type) => ["administrative_area_level_2", "administrative_area_level_3"].includes(type)));
  const citySaysIligan = [...localityParts, ...cityParts].some((component) =>
    [component.long_name, component.short_name].some((value) => !!value && cleanName(value).includes("iligan")),
  );
  const barangayName = barangay ? cleanName(barangay.name) : "";
  const citySaysSomewhereElse = localityParts.some((component) =>
    [component.long_name, component.short_name].some((value) => !!value && !cleanName(value).includes("iligan") && cleanName(value) !== barangayName),
  );
  const city: CityCheck = citySaysSomewhereElse ? "outside" : citySaysIligan ? "inside" : "unknown";
  return {
    city,
    barangay: barangay?.name ?? null,
    address: results.find((result) => result.formatted_address)?.formatted_address ?? "",
  };
}
