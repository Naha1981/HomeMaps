export type LocationPrecision = 'area' | 'approximate' | 'exact';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface PropertyFeatures {
  bedrooms: number;
  bathrooms: number;
  floorSizeSqm: number;
}

export interface Viewpoint {
  id: string;
  label: string;
  aliases: string[];
  cameraMode: 'ground' | 'aerial';
  offsetNorthM: number;
  offsetEastM: number;
  range: number;
  tilt: number;
  heading: number;
  requiresExactLocation: boolean;
  isDemo: boolean;
}

export interface PropertyListing {
  reference: string;
  isDemo: boolean;
  title: string;
  suburb: string;
  city: string;
  priceDisplay: string;
  features: PropertyFeatures;
  publicLocationPrecision: LocationPrecision;
  streetViewEnabled: boolean;
  coordinates: {
    exact: Coordinates;
    approximateCentre: Coordinates;
    approximateRadiusMetres: number;
  };
  cameraPreset: {
    range: number;
    tilt: number;
    heading: number;
  };
  viewpoints: Viewpoint[];
  agent: {
    displayName: string;
    whatsappNumber: string;
  };
}

export const DEMO_LISTING: PropertyListing = {
  reference: 'HM-DEMO-001',
  isDemo: true,
  title: 'Demo family home',
  suburb: 'Bryanston',
  city: 'Johannesburg',
  priceDisplay: 'R 0 (demo)',
  features: {
    bedrooms: 4,
    bathrooms: 3,
    floorSizeSqm: 320,
  },
  publicLocationPrecision: 'exact',
  streetViewEnabled: true,
  coordinates: {
    exact: { lat: -26.0600, lng: 28.0200 },
    approximateCentre: { lat: -26.0570, lng: 28.0170 },
    approximateRadiusMetres: 800,
  },
  cameraPreset: {
    range: 480,
    tilt: 50,
    heading: 0,
  },
  viewpoints: [
    {
      id: 'overview',
      label: 'Overview',
      aliases: ['overview', 'property', 'home', 'house', 'main view', 'default'],
      cameraMode: 'aerial',
      offsetNorthM: 0,
      offsetEastM: 0,
      range: 480,
      tilt: 50,
      heading: 0,
      requiresExactLocation: false,
      isDemo: true,
    },
    {
      id: 'front-gate',
      label: 'Front gate',
      aliases: ['front gate', 'gate', 'front', 'entrance', 'front entrance', 'driveway'],
      cameraMode: 'ground',
      offsetNorthM: -35,
      offsetEastM: 0,
      range: 35,
      tilt: 87,
      heading: 0,
      requiresExactLocation: true,
      isDemo: true,
    },
    {
      id: 'back-garden',
      label: 'Back garden',
      aliases: ['back garden', 'backyard', 'back yard', 'garden', 'yard', 'back', 'rear'],
      cameraMode: 'ground',
      offsetNorthM: 30,
      offsetEastM: 0,
      range: 30,
      tilt: 87,
      heading: 180,
      requiresExactLocation: true,
      isDemo: true,
    },
    {
      id: 'roof-top',
      label: 'Roof top',
      aliases: ['roof top', 'rooftop', 'roof', 'top'],
      cameraMode: 'aerial',
      offsetNorthM: 0,
      offsetEastM: 0,
      range: 200,
      tilt: 0,
      heading: 0,
      requiresExactLocation: true,
      isDemo: true,
    },
    {
      id: 'street-approach',
      label: 'From the street',
      aliases: ['from the street', 'street', 'street approach', 'approach', 'road'],
      cameraMode: 'ground',
      offsetNorthM: -50,
      offsetEastM: 0,
      range: 50,
      tilt: 87,
      heading: 0,
      requiresExactLocation: true,
      isDemo: true,
    },
  ],
  agent: {
    displayName: 'Demo Agent',
    whatsappNumber: '27000000000',
  },
};

/**
 * Single public coordinate accessor.
 * Every part of the app must obtain coordinates exclusively through this function.
 */
export function getPublicCoordinates(listing: PropertyListing): Coordinates {
  if (listing.publicLocationPrecision === 'exact') {
    return listing.coordinates.exact;
  }
  return listing.coordinates.approximateCentre;
}

/**
 * Privacy gate for Street View:
 * Returns true ONLY when exact location precision is enabled AND Street View is enabled.
 */
export function canShowStreetView(listing: PropertyListing): boolean {
  return (
    listing.publicLocationPrecision === 'exact' &&
    listing.streetViewEnabled === true
  );
}

/**
 * Resolves a viewpoint's coordinates relative to getPublicCoordinates(listing).
 */
export function getViewpointCoordinates(
  listing: PropertyListing,
  viewpoint: Viewpoint
): Coordinates {
  const base = getPublicCoordinates(listing);
  const earthRadius = 6378137;
  const dLat = (viewpoint.offsetNorthM / earthRadius) * (180 / Math.PI);
  const dLng =
    (viewpoint.offsetEastM / (earthRadius * Math.cos((base.lat * Math.PI) / 180))) *
    (180 / Math.PI);

  return {
    lat: base.lat + dLat,
    lng: base.lng + dLng,
  };
}

export type WhatsAppEnquiryType = 'ask' | 'viewing';

/**
 * Builds a wa.me link containing only the listing reference and plain enquiry text.
 */
export function buildWhatsAppUrl(
  listing: PropertyListing,
  enquiryType: WhatsAppEnquiryType
): string {
  const digitsOnly = listing.agent.whatsappNumber.replace(/\D/g, '');
  const message =
    enquiryType === 'ask'
      ? `Hi, I'm enquiring about listing ${listing.reference} on HomeAI Maps. Please tell me more about the property and how to arrange a viewing.`
      : `Hi, I'd like to request a viewing for listing ${listing.reference} on HomeAI Maps. Please let me know what times are available.`;

  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}
