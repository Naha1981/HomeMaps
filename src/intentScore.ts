import type { TrackedEvent } from './analytics';

// prototype weights, rebalance after pilot
export const WEIGHTS = {
  listing_page_view: { weight: 1, cap: 1 },
  map_ready: { weight: 1, cap: 1 },
  zoom_in: { weight: 1, cap: 3 },
  zoom_out: { weight: 1, cap: 3 },
  rotate_left: { weight: 1, cap: 3 },
  rotate_right: { weight: 1, cap: 3 },
  tilt_up: { weight: 2, cap: 4 },
  tilt_down: { weight: 2, cap: 4 },
  top_down_view: { weight: 2, cap: 4 },
  reset_view: { weight: 0, cap: 0 },
  full_screen_enter: { weight: 2, cap: 2 },
  fly_to_viewpoint_ground: { weight: 3, cap: 9 },
  fly_to_viewpoint_aerial: { weight: 1, cap: 3 },
  command_used_ok: { weight: 2, cap: 6 },
  street_view_open: { weight: 4, cap: 12 },
  place_category_selected: { weight: 2, cap: 6 },
  place_selected: { weight: 2, cap: 6 },
  whatsapp_cta_click: { weight: 8, cap: 8 },
  viewing_cta_click: { weight: 10, cap: 10 },
  time_on_page: { weight: 1, cap: 5 },
} as const;

export type IntentTier = 'cold' | 'warm' | 'hot';

export interface IntentSignal {
  label: string;
  points: number;
}

export interface IntentResult {
  score: number;
  rawPoints: number;
  tier: IntentTier;
  signals: IntentSignal[];
  timeOnPageSeconds: number;
  eventCount: number;
}

function capPoints(count: number, rule: { weight: number; cap: number }): number {
  return Math.min(rule.cap, count * rule.weight);
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

export function computeIntent(
  events: ReadonlyArray<TrackedEvent>,
  nowMs: number = Date.now()
): IntentResult {
  if (events.length === 0) {
    return {
      score: 0,
      rawPoints: 0,
      tier: 'cold',
      signals: [],
      timeOnPageSeconds: 0,
      eventCount: 0,
    };
  }

  let listingPageViewCount = 0;
  let mapReadyCount = 0;
  let zoomInCount = 0;
  let zoomOutCount = 0;
  let rotateLeftCount = 0;
  let rotateRightCount = 0;
  let tiltUpCount = 0;
  let tiltDownCount = 0;
  let topDownViewCount = 0;
  let fullScreenEnterCount = 0;
  let commandUsedOkCount = 0;
  let placeCategoryCount = 0;
  let placeSelectedCount = 0;
  let whatsappClickCount = 0;
  let viewingClickCount = 0;

  const groundViewpointIds = new Set<string>();
  const aerialViewpointIds = new Set<string>();
  const streetViewIds = new Set<string>();

  let firstTs = events[0].ts;

  for (const ev of events) {
    if (ev.ts < firstTs) {
      firstTs = ev.ts;
    }

    switch (ev.event) {
      case 'listing_page_view':
        listingPageViewCount += 1;
        break;
      case 'map_ready':
        mapReadyCount += 1;
        break;
      case 'zoom_in':
        zoomInCount += 1;
        break;
      case 'zoom_out':
        zoomOutCount += 1;
        break;
      case 'rotate_left':
        rotateLeftCount += 1;
        break;
      case 'rotate_right':
        rotateRightCount += 1;
        break;
      case 'tilt_up':
        tiltUpCount += 1;
        break;
      case 'tilt_down':
        tiltDownCount += 1;
        break;
      case 'top_down_view':
        topDownViewCount += 1;
        break;
      case 'full_screen_enter':
        fullScreenEnterCount += 1;
        break;
      case 'fly_to_viewpoint': {
        const vpKey = ev.viewpointId || '__default__';
        if (ev.cameraMode === 'ground') {
          groundViewpointIds.add(vpKey);
        } else {
          aerialViewpointIds.add(vpKey);
        }
        break;
      }
      case 'command_used':
        if (ev.outcome === 'ok') {
          commandUsedOkCount += 1;
        }
        break;
      case 'street_view_open':
        streetViewIds.add(ev.viewpointId || '__listing__');
        break;
      case 'place_category_selected':
        placeCategoryCount += 1;
        break;
      case 'place_selected':
        placeSelectedCount += 1;
        break;
      case 'whatsapp_cta_click':
        whatsappClickCount += 1;
        break;
      case 'viewing_cta_click':
        viewingClickCount += 1;
        break;
      case 'reset_view':
      default:
        break;
    }
  }

  const timeOnPageSeconds = Math.max(0, Math.floor((nowMs - firstTs) / 1000));
  const fullMinutes = Math.floor(timeOnPageSeconds / 60);

  const listingViewPts = capPoints(listingPageViewCount, WEIGHTS.listing_page_view);
  const mapReadyPts = capPoints(mapReadyCount, WEIGHTS.map_ready);
  const zoomInPts = capPoints(zoomInCount, WEIGHTS.zoom_in);
  const zoomOutPts = capPoints(zoomOutCount, WEIGHTS.zoom_out);
  const rotateLeftPts = capPoints(rotateLeftCount, WEIGHTS.rotate_left);
  const rotateRightPts = capPoints(rotateRightCount, WEIGHTS.rotate_right);
  const tiltUpPts = capPoints(tiltUpCount, WEIGHTS.tilt_up);
  const tiltDownPts = capPoints(tiltDownCount, WEIGHTS.tilt_down);
  const topDownPts = capPoints(topDownViewCount, WEIGHTS.top_down_view);
  const fullScreenPts = capPoints(fullScreenEnterCount, WEIGHTS.full_screen_enter);
  const groundVpPts = capPoints(groundViewpointIds.size, WEIGHTS.fly_to_viewpoint_ground);
  const aerialVpPts = capPoints(aerialViewpointIds.size, WEIGHTS.fly_to_viewpoint_aerial);
  const commandOkPts = capPoints(commandUsedOkCount, WEIGHTS.command_used_ok);
  const streetViewPts = capPoints(streetViewIds.size, WEIGHTS.street_view_open);
  const placeCategoryPts = capPoints(placeCategoryCount, WEIGHTS.place_category_selected);
  const placeSelectedPts = capPoints(placeSelectedCount, WEIGHTS.place_selected);
  const whatsappPts = capPoints(whatsappClickCount, WEIGHTS.whatsapp_cta_click);
  const viewingPts = capPoints(viewingClickCount, WEIGHTS.viewing_cta_click);
  const timeOnPagePts = capPoints(fullMinutes, WEIGHTS.time_on_page);

  const rawPoints =
    listingViewPts +
    mapReadyPts +
    zoomInPts +
    zoomOutPts +
    rotateLeftPts +
    rotateRightPts +
    tiltUpPts +
    tiltDownPts +
    topDownPts +
    fullScreenPts +
    groundVpPts +
    aerialVpPts +
    commandOkPts +
    streetViewPts +
    placeCategoryPts +
    placeSelectedPts +
    whatsappPts +
    viewingPts +
    timeOnPagePts;

  // 40 points is roughly "opened WhatsApp twice or opened Street View and commanded the map several times", which is a hot buyer.
  const score = Math.min(100, Math.round((rawPoints / 40) * 100));

  const tier: IntentTier =
    rawPoints >= 25 ? 'hot' : rawPoints >= 10 ? 'warm' : 'cold';

  const uniqueViewpointsCount = new Set([
    ...groundViewpointIds,
    ...aerialViewpointIds,
  ]).size;
  const viewpointsPts = groundVpPts + aerialVpPts;
  const zoomPts = zoomInPts + zoomOutPts;
  const orbitPts = rotateLeftPts + rotateRightPts + tiltUpPts + tiltDownPts;

  const candidateSignals: IntentSignal[] = [];

  if (viewingPts > 0) {
    candidateSignals.push({
      label: `Requested a viewing (${viewingPts} pts)`,
      points: viewingPts,
    });
  }
  if (whatsappPts > 0) {
    candidateSignals.push({
      label: `Clicked WhatsApp enquiry (${whatsappPts} pts)`,
      points: whatsappPts,
    });
  }
  if (streetViewPts > 0) {
    const svCount = streetViewIds.size;
    candidateSignals.push({
      label: `Opened Street View (${svCount} ${plural(svCount, 'view')}, ${streetViewPts} pts)`,
      points: streetViewPts,
    });
  }
  if (viewpointsPts > 0) {
    candidateSignals.push({
      label: `Explored viewpoints (${uniqueViewpointsCount} ${plural(uniqueViewpointsCount, 'view')}, ${viewpointsPts} pts)`,
      points: viewpointsPts,
    });
  }
  if (commandOkPts > 0) {
    candidateSignals.push({
      label: `Used map commands (${commandUsedOkCount} ${plural(commandUsedOkCount, 'command')}, ${commandOkPts} pts)`,
      points: commandOkPts,
    });
  }
  if (placeSelectedPts > 0) {
    candidateSignals.push({
      label: `Selected nearby places (${placeSelectedCount} ${plural(placeSelectedCount, 'place')}, ${placeSelectedPts} pts)`,
      points: placeSelectedPts,
    });
  }
  if (placeCategoryPts > 0) {
    candidateSignals.push({
      label: `Browsed place categories (${placeCategoryCount} ${plural(placeCategoryCount, 'category', 'categories')}, ${placeCategoryPts} pts)`,
      points: placeCategoryPts,
    });
  }
  if (orbitPts > 0) {
    candidateSignals.push({
      label: `Adjusted camera angle (${orbitPts} pts)`,
      points: orbitPts,
    });
  }
  if (zoomPts > 0) {
    candidateSignals.push({
      label: `Zoomed map (${zoomPts} pts)`,
      points: zoomPts,
    });
  }
  if (topDownPts > 0) {
    candidateSignals.push({
      label: `Viewed top-down (${topDownPts} pts)`,
      points: topDownPts,
    });
  }
  if (fullScreenPts > 0) {
    candidateSignals.push({
      label: `Entered full-screen map (${fullScreenPts} pts)`,
      points: fullScreenPts,
    });
  }
  if (timeOnPagePts > 0) {
    candidateSignals.push({
      label: `Time on page (${fullMinutes} min, ${timeOnPagePts} ${plural(timeOnPagePts, 'pt')})`,
      points: timeOnPagePts,
    });
  }
  if (mapReadyPts > 0) {
    candidateSignals.push({
      label: `Loaded interactive map (${mapReadyPts} pt)`,
      points: mapReadyPts,
    });
  }
  if (listingViewPts > 0) {
    candidateSignals.push({
      label: `Viewed listing page (${listingViewPts} pt)`,
      points: listingViewPts,
    });
  }

  const signals = candidateSignals
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);

  return {
    score,
    rawPoints,
    tier,
    signals,
    timeOnPageSeconds,
    eventCount: events.length,
  };
}
