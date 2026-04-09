type GoogleGeocodeAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResponse = {
  status?: string;
  results?: Array<{
    place_id?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    address_components?: GoogleGeocodeAddressComponent[];
  }>;
};

export type ResolvedLocationAddress = {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  mapsUrl: string | null;
};

function pickAddressComponent(
  components: GoogleGeocodeAddressComponent[] | undefined,
  type: string,
  field: "long_name" | "short_name" = "long_name",
) {
  return components?.find((component) => component.types?.includes(type))?.[field] ?? null;
}

export function buildLocationMapsUrl(input: {
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
}) {
  const query =
    typeof input.latitude === "number" && typeof input.longitude === "number"
      ? `${input.latitude},${input.longitude}`
      : input.address;

  const searchParams = new URLSearchParams({
    api: "1",
    query,
  });

  if (input.placeId) {
    searchParams.set("query_place_id", input.placeId);
  }

  return `https://www.google.com/maps/search/?${searchParams.toString()}`;
}

export async function geocodeLocationAddress(address: string): Promise<ResolvedLocationAddress | null> {
  const trimmedAddress = address.trim();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!trimmedAddress || !apiKey) {
    return null;
  }

  try {
    const searchParams = new URLSearchParams({
      address: trimmedAddress,
      key: apiKey,
    });

    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${searchParams.toString()}`);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GoogleGeocodeResponse;
    const result = payload.results?.[0];
    if (!result) {
      return null;
    }

    const latitude = result?.geometry?.location?.lat;
    const longitude = result?.geometry?.location?.lng;

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return null;
    }

    const components = result.address_components ?? [];
    const city =
      pickAddressComponent(components, "locality") ??
      pickAddressComponent(components, "postal_town") ??
      pickAddressComponent(components, "sublocality_level_1") ??
      pickAddressComponent(components, "administrative_area_level_3");
    const state = pickAddressComponent(components, "administrative_area_level_1", "short_name");
    const zip = pickAddressComponent(components, "postal_code");

    return {
      latitude,
      longitude,
      city,
      state,
      zip,
      mapsUrl: buildLocationMapsUrl({
        address: trimmedAddress,
        latitude,
        longitude,
        placeId: result?.place_id ?? null,
      }),
    };
  } catch {
    return null;
  }
}
