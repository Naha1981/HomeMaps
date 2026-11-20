export type LocationPrecision = 'area' | 'approximate' | 'exact';
export type PropertyType = 'house' | 'townhouse' | 'apartment';

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
  id: string;
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

export interface SampleListing extends PropertyListing {
  propertyType: PropertyType;
  priceZar: number;
  beds: number;
  baths: number;
  sizeM2: number;
  description: string;
  photos: [string, string, string];
  isSample: true;
}

export const AGENT_WHATSAPP_PLACEHOLDER = '27000000000';
// Placeholder only. Replace with the pilot agent's number in one place
// after consent. Never commit a real number.

const DEFAULT_DEMO_VIEWPOINTS: Viewpoint[] = [
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
];

const DEFAULT_CAMERA_PRESET = {
  range: 480,
  tilt: 50,
  heading: 0,
};

const PHOTO_HEX_PALETTES: Array<[string, string, string]> = [
  ['163A2E', '1C221F', '73561C'],
  ['1C221F', '73561C', '163A2E'],
  ['73561C', '163A2E', '1C221F'],
];

function buildSamplePhotos(
  suburb: string,
  reference: string,
  paletteIndex: number
): [string, string, string] {
  const palette = PHOTO_HEX_PALETTES[paletteIndex % PHOTO_HEX_PALETTES.length];
  const makeSvg = (hex: string, index: number) => {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'>` +
      `<rect width='800' height='600' fill='%23${hex}'/>` +
      `<text x='400' y='280' font-family='system-ui,sans-serif' font-size='44' fill='%23ffffff' text-anchor='middle'>${suburb} — ${reference}</text>` +
      `<text x='400' y='340' font-family='system-ui,sans-serif' font-size='24' fill='%23ffffff' text-anchor='middle'>SAMPLE PHOTO ${index} of 3</text>` +
      `<text x='400' y='570' font-family='system-ui,sans-serif' font-size='18' fill='%23ffffff' fill-opacity='0.8' text-anchor='middle'>Demo image — not the actual property</text>` +
      `</svg>`;
    return `data:image/svg+xml;utf8,${svg}`;
  };

  return [
    makeSvg(palette[0], 1),
    makeSvg(palette[1], 2),
    makeSvg(palette[2], 3),
  ];
}

interface SampleSeed {
  id: string;
  reference: string;
  city: string;
  suburb: string;
  propertyType: PropertyType;
  beds: number;
  baths: number;
  sizeM2: number;
  priceZar: number;
  priceDisplay: string;
  centroid: Coordinates;
  approximateRadiusMetres: number;
  description: string;
}

const SAMPLE_SEEDS: SampleSeed[] = [
  {
    id: 'hm-sample-001',
    reference: 'HM-DEMO-001',
    city: 'Soweto',
    suburb: 'Diepkloof',
    propertyType: 'house',
    beds: 2,
    baths: 1,
    sizeM2: 68,
    priceZar: 620000,
    priceDisplay: 'R 620 000',
    centroid: { lat: -26.2564, lng: 27.9437 },
    approximateRadiusMetres: 600,
    description:
      'Sample 2-bedroom single-storey house in Diepkloof with a compact kitchen, lounge, and walled yard.',
  },
  {
    id: 'hm-sample-002',
    reference: 'HM-DEMO-002',
    city: 'Soweto',
    suburb: 'Orlando West',
    propertyType: 'house',
    beds: 3,
    baths: 1,
    sizeM2: 92,
    priceZar: 780000,
    priceDisplay: 'R 780 000',
    centroid: { lat: -26.2378, lng: 27.9076 },
    approximateRadiusMetres: 600,
    description:
      'Sample 3-bedroom freestanding house in Orlando West featuring an open living area and paved front courtyard.',
  },
  {
    id: 'hm-sample-003',
    reference: 'HM-DEMO-003',
    city: 'Soweto',
    suburb: 'Pimville',
    propertyType: 'townhouse',
    beds: 2,
    baths: 2,
    sizeM2: 88,
    priceZar: 895000,
    priceDisplay: 'R 895 000',
    centroid: { lat: -26.2712, lng: 27.8935 },
    approximateRadiusMetres: 400,
    description:
      'Sample 2-bedroom townhouse in Pimville offering two bathrooms, an open-plan kitchen, and covered parking.',
  },
  {
    id: 'hm-sample-004',
    reference: 'HM-DEMO-004',
    city: 'Protea Glen',
    suburb: 'Protea Glen Ext 12',
    propertyType: 'house',
    beds: 3,
    baths: 2,
    sizeM2: 110,
    priceZar: 980000,
    priceDisplay: 'R 980 000',
    centroid: { lat: -26.2768, lng: 27.8042 },
    approximateRadiusMetres: 600,
    description:
      'Sample 3-bedroom house in Protea Glen Ext 12 with an en-suite main bedroom and a private corner stand.',
  },
  {
    id: 'hm-sample-005',
    reference: 'HM-DEMO-005',
    city: 'Protea Glen',
    suburb: 'Protea Glen Ext 20',
    propertyType: 'house',
    beds: 4,
    baths: 2,
    sizeM2: 142,
    priceZar: 1240000,
    priceDisplay: 'R 1 240 000',
    centroid: { lat: -26.2835, lng: 27.7984 },
    approximateRadiusMetres: 600,
    description:
      'Sample 4-bedroom family home in Protea Glen Ext 20 with a dining area, fitted kitchen, and double carport.',
  },
  {
    id: 'hm-sample-006',
    reference: 'HM-DEMO-006',
    city: 'Randburg',
    suburb: 'Ferndale',
    propertyType: 'apartment',
    beds: 2,
    baths: 2,
    sizeM2: 78,
    priceZar: 1350000,
    priceDisplay: 'R 1 350 000',
    centroid: { lat: -26.0886, lng: 27.9979 },
    approximateRadiusMetres: 400,
    description:
      'Sample 2-bedroom apartment in Ferndale with two bathrooms, a covered balcony, and allocated resident parking.',
  },
  {
    id: 'hm-sample-007',
    reference: 'HM-DEMO-007',
    city: 'Randburg',
    suburb: 'Northcliff',
    propertyType: 'house',
    beds: 3,
    baths: 2,
    sizeM2: 210,
    priceZar: 2450000,
    priceDisplay: 'R 2 450 000',
    centroid: { lat: -26.1436, lng: 27.9591 },
    approximateRadiusMetres: 600,
    description:
      'Sample 3-bedroom house in Northcliff set on a terraced stand with a study nook, patio, and double garage.',
  },
  {
    id: 'hm-sample-008',
    reference: 'HM-DEMO-008',
    city: 'Bryanston',
    suburb: 'Bryanston Ext 3',
    propertyType: 'townhouse',
    beds: 3,
    baths: 2,
    sizeM2: 165,
    priceZar: 2850000,
    priceDisplay: 'R 2 850 000',
    centroid: { lat: -26.0668, lng: 28.0054 },
    approximateRadiusMetres: 400,
    description:
      'Sample 3-bedroom duplex townhouse in Bryanston Ext 3 featuring a private garden strip and two covered bays.',
  },
  {
    id: 'hm-sample-009',
    reference: 'HM-DEMO-009',
    city: 'Bryanston',
    suburb: 'Bryanston Ext 5',
    propertyType: 'house',
    beds: 4,
    baths: 3,
    sizeM2: 320,
    priceZar: 4250000,
    priceDisplay: 'R 4 250 000',
    centroid: { lat: -26.057, lng: 28.017 },
    approximateRadiusMetres: 600,
    description:
      'Sample 4-bedroom house in Bryanston Ext 5 with dual living rooms, an outdoor covered veranda, and double garaging.',
  },
  {
    id: 'hm-sample-010',
    reference: 'HM-DEMO-010',
    city: 'Sandton',
    suburb: 'Morningside',
    propertyType: 'apartment',
    beds: 2,
    baths: 2,
    sizeM2: 105,
    priceZar: 3100000,
    priceDisplay: 'R 3 100 000',
    centroid: { lat: -26.0772, lng: 28.0598 },
    approximateRadiusMetres: 400,
    description:
      'Sample 2-bedroom apartment in Morningside featuring open-plan reception space, kitchen island, and basement parking.',
  },
  {
    id: 'hm-sample-011',
    reference: 'HM-DEMO-011',
    city: 'Sandton',
    suburb: 'Rivonia',
    propertyType: 'house',
    beds: 4,
    baths: 3,
    sizeM2: 380,
    priceZar: 5400000,
    priceDisplay: 'R 5 400 000',
    centroid: { lat: -26.0468, lng: 28.0587 },
    approximateRadiusMetres: 600,
    description:
      'Sample 4-bedroom residence in Rivonia with a separate dining room, covered terrace, and landscaped garden.',
  },
  {
    id: 'hm-sample-012',
    reference: 'HM-DEMO-012',
    city: 'Sandton',
    suburb: 'Sandhurst',
    propertyType: 'house',
    beds: 5,
    baths: 4,
    sizeM2: 520,
    priceZar: 8500000,
    priceDisplay: 'R 8 500 000',
    centroid: { lat: -26.1157, lng: 28.0402 },
    approximateRadiusMetres: 600,
    description:
      'Sample 5-bedroom home in Sandhurst offering generous reception rooms, staff quarters, and triple-bay garaging.',
  },
];

// All samples are approximate; Street View is disabled because we have no verified exact location. This exercises the privacy gate end-to-end.
export const SAMPLE_LISTINGS: SampleListing[] = SAMPLE_SEEDS.map((seed, index) => ({
  id: seed.id,
  reference: seed.reference,
  isDemo: true,
  isSample: true,
  title: `${seed.beds}-bedroom ${seed.propertyType}`,
  suburb: seed.suburb,
  city: seed.city,
  propertyType: seed.propertyType,
  priceZar: seed.priceZar,
  priceDisplay: seed.priceDisplay,
  beds: seed.beds,
  baths: seed.baths,
  sizeM2: seed.sizeM2,
  description: seed.description,
  features: {
    bedrooms: seed.beds,
    bathrooms: seed.baths,
    floorSizeSqm: seed.sizeM2,
  },
  photos: buildSamplePhotos(seed.suburb, seed.reference, index),
  publicLocationPrecision: 'approximate',
  streetViewEnabled: false,
  coordinates: {
    exact: { lat: seed.centroid.lat, lng: seed.centroid.lng },
    approximateCentre: { lat: seed.centroid.lat, lng: seed.centroid.lng },
    approximateRadiusMetres: seed.approximateRadiusMetres,
  },
  cameraPreset: { ...DEFAULT_CAMERA_PRESET },
  viewpoints: DEFAULT_DEMO_VIEWPOINTS.map((vp) => ({ ...vp, aliases: [...vp.aliases] })),
  agent: {
    displayName: `Sample Agent ${(index % 4) + 1}`,
    whatsappNumber: AGENT_WHATSAPP_PLACEHOLDER,
  },
}));

export const DEFAULT_LISTING_ID = SAMPLE_LISTINGS[0].id;

export function getListingById(id: string): SampleListing | undefined {
  return SAMPLE_LISTINGS.find((listing) => listing.id === id);
}

// Backward-compatible alias so single-listing consumers render SampleListing[0] by default.
export const DEMO_LISTING: SampleListing = SAMPLE_LISTINGS[0];

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
