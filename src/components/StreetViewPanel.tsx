import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Calendar, Loader2, X } from 'lucide-react';
import {
  Coordinates,
  PropertyListing,
  canShowStreetView,
  getPublicCoordinates,
} from '../listingData';
import { loadGoogleMapsScript } from '../utils';
import { track } from '../analytics';

export type StreetViewAnalyticsEvent =
  | 'street_view_open'
  | 'street_view_no_coverage'
  | 'street_view_close';

export type StreetViewFailureReason =
  | 'script_blocked'
  | 'quota_exceeded'
  | 'no_coverage'
  | 'timeout';

export function trackStreetViewEvent(event: StreetViewAnalyticsEvent): void {
  if (typeof track === 'function') {
    track(event);
  }
}

interface StreetViewPanelProps {
  listing: PropertyListing;
  apiKey?: string;
  quotaExceeded?: boolean;
  onClose: () => void;
  onDisableStreetView?: (reason: StreetViewFailureReason, message: string) => void;
}

/**
 * Computes initial compass bearing (0-360 deg) from (fromLat, fromLng) toward (toLat, toLng).
 */
function computeGreatCircleBearing(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const dLng = toRad(toLng - fromLng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatStreetViewImageDate(rawDate?: string | null): string {
  if (!rawDate || typeof rawDate !== 'string') {
    return 'Capture date unavailable';
  }
  const match = rawDate.trim().match(/^(\d{4})-(\d{1,2})/);
  if (!match) {
    return 'Capture date unavailable';
  }
  const year = match[1];
  const monthIdx = Number(match[2]) - 1;
  const monthName = MONTH_NAMES[monthIdx];
  if (!monthName) {
    return 'Capture date unavailable';
  }
  return `Street View imagery: ${monthName} ${year}`;
}

function getLatLngNumbers(latLng: any): Coordinates | null {
  if (!latLng) return null;
  const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
  const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export const StreetViewPanel: React.FC<StreetViewPanelProps> = ({
  listing,
  apiKey,
  quotaExceeded = false,
  onClose,
  onDisableStreetView,
}) => {
  const panoHostRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<any>(null);
  const onCloseRef = useRef(onClose);
  const onDisableRef = useRef(onDisableStreetView);
  onCloseRef.current = onClose;
  onDisableRef.current = onDisableStreetView;

  const [isLoading, setIsLoading] = useState(true);
  const [captureDateText, setCaptureDateText] = useState<string>('Capture date unavailable');
  const [errorState, setErrorState] = useState<{
    reason: StreetViewFailureReason;
    message: string;
  } | null>(null);

  const allowed = canShowStreetView(listing);
  const publicCoords = allowed ? getPublicCoordinates(listing) : null;

  // Immediately close if privacy gate flips off while open
  useEffect(() => {
    if (!allowed) {
      trackStreetViewEvent('street_view_close');
      onCloseRef.current();
    }
  }, [allowed]);

  // Escape key closes panel and returns to 3D map
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        trackStreetViewEvent('street_view_close');
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Lazy-load Google Maps streetView library and query nearest outdoor panorama
  useEffect(() => {
    if (!allowed || !publicCoords) return;

    if (quotaExceeded) {
      const msg = 'Street View could not load because map quota was exceeded.';
      setIsLoading(false);
      setErrorState({ reason: 'quota_exceeded', message: msg });
      onDisableRef.current?.('quota_exceeded', msg);
      return;
    }

    let cancelled = false;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (cancelled || settled) return;
      settled = true;
      const msg = 'Street View could not load';
      setIsLoading(false);
      setErrorState({ reason: 'timeout', message: msg });
      onDisableRef.current?.('timeout', 'Street View timed out. You can still use the 3D map.');
    }, 10000);

    const loadStreetView = async () => {
      setIsLoading(true);
      setErrorState(null);

      try {
        await loadGoogleMapsScript(apiKey);
        if (cancelled || settled) return;

        const google = (window as any).google;
        if (!google?.maps) {
          throw new Error('SCRIPT_BLOCKED');
        }

        const streetViewLib = google.maps.importLibrary
          ? await google.maps.importLibrary('streetView')
          : google.maps;

        if (cancelled || settled) return;

        const StreetViewServiceCtor =
          streetViewLib?.StreetViewService || google.maps.StreetViewService;
        const StreetViewPanoramaCtor =
          streetViewLib?.StreetViewPanorama || google.maps.StreetViewPanorama;

        if (!StreetViewServiceCtor || !StreetViewPanoramaCtor) {
          throw new Error('SCRIPT_BLOCKED');
        }

        const service = new StreetViewServiceCtor();
        const preference =
          streetViewLib?.StreetViewPreference?.NEAREST ||
          google.maps.StreetViewPreference?.NEAREST ||
          'nearest';
        const source =
          streetViewLib?.StreetViewSource?.OUTDOOR ||
          google.maps.StreetViewSource?.OUTDOOR ||
          'outdoor';

        const queryPanorama = (radius: number): Promise<{ data: any; status: string }> =>
          new Promise((resolve) => {
            try {
              service.getPanorama(
                {
                  location: publicCoords,
                  radius,
                  preference,
                  source,
                },
                (data: any, status: string) => {
                  resolve({ data, status });
                }
              );
            } catch {
              resolve({ data: null, status: 'UNKNOWN_ERROR' });
            }
          });

        // 1. Try 50m first, then retry within 150m
        let result = await queryPanorama(50);
        if (cancelled || settled) return;

        if (result.status !== 'OK' || !result.data?.location?.pano) {
          if (result.status === 'OVER_QUERY_LIMIT') {
            settled = true;
            clearTimeout(timeoutId);
            const msg = 'Street View is unavailable because map quota was exceeded.';
            setIsLoading(false);
            setErrorState({ reason: 'quota_exceeded', message: msg });
            onDisableRef.current?.('quota_exceeded', msg);
            return;
          }
          result = await queryPanorama(150);
          if (cancelled || settled) return;
        }

        if (result.status === 'OVER_QUERY_LIMIT') {
          settled = true;
          clearTimeout(timeoutId);
          const msg = 'Street View is unavailable because map quota was exceeded.';
          setIsLoading(false);
          setErrorState({ reason: 'quota_exceeded', message: msg });
          onDisableRef.current?.('quota_exceeded', msg);
          return;
        }

        if (result.status !== 'OK' || !result.data?.location?.pano) {
          settled = true;
          clearTimeout(timeoutId);
          trackStreetViewEvent('street_view_no_coverage');
          const noCoverageMsg = "Street View isn't available at this location";
          setIsLoading(false);
          setErrorState({ reason: 'no_coverage', message: noCoverageMsg });
          onDisableRef.current?.('no_coverage', noCoverageMsg);
          return;
        }

        if (!panoHostRef.current) {
          throw new Error('SCRIPT_BLOCKED');
        }

        const panoCoords = getLatLngNumbers(result.data.location.latLng);
        const initialHeading = panoCoords
          ? computeGreatCircleBearing(
              panoCoords.lat,
              panoCoords.lng,
              publicCoords.lat,
              publicCoords.lng
            )
          : 0;

        setCaptureDateText(formatStreetViewImageDate(result.data.imageDate));

        panoHostRef.current.innerHTML = '';
        const panorama = new StreetViewPanoramaCtor(panoHostRef.current, {
          pano: result.data.location.pano,
          pov: {
            heading: initialHeading,
            pitch: 5,
          },
          zoom: 1,
          addressControl: true,
          linksControl: true,
          panControl: true,
          zoomControl: true,
          enableCloseButton: false,
          motionTracking: false,
        });

        panoramaRef.current = panorama;
        settled = true;
        clearTimeout(timeoutId);
        setIsLoading(false);
        trackStreetViewEvent('street_view_open');
      } catch {
        if (cancelled || settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const msg = 'Street View could not load';
        setIsLoading(false);
        setErrorState({ reason: 'script_blocked', message: msg });
        onDisableRef.current?.(
          'script_blocked',
          'Street View is unavailable because the map script could not load.'
        );
      }
    };

    loadStreetView();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      panoramaRef.current = null;
      if (panoHostRef.current) {
        panoHostRef.current.innerHTML = '';
      }
    };
  }, [allowed, apiKey, quotaExceeded, publicCoords?.lat, publicCoords?.lng]);

  if (!allowed) return null;

  const handleCloseClick = () => {
    trackStreetViewEvent('street_view_close');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Street View"
      className="fixed inset-0 z-[60] flex flex-col bg-[#FDFCF9] md:inset-y-0 md:right-0 md:left-auto md:w-[480px] lg:w-[540px] md:border-l md:border-[#DED7C9] md:shadow-2xl"
    >
      {/* Header with visible close and Back to 3D map controls */}
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 bg-[#FDFCF9] border-b border-[#E3DDD1]">
        <button
          type="button"
          onClick={handleCloseClick}
          className="min-h-[44px] px-3 py-2 rounded-xl bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4 shrink-0 text-[#DFC58A]" aria-hidden="true" />
          <span>Back to 3D map</span>
        </button>

        <button
          type="button"
          onClick={handleCloseClick}
          aria-label="Close Street View"
          className="min-w-[44px] min-h-[44px] rounded-xl bg-[#FAF8F4] hover:bg-[#EFECE3] border border-[#DED7C9] text-[#1C221F] inline-flex items-center justify-center transition-colors shrink-0"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </header>

      {/* Main panorama area (default Google controls & attribution remain completely unobstructed) */}
      <div className="relative flex-1 min-h-0 w-full bg-[#EAE5DA]">
        <div
          ref={panoHostRef}
          className="w-full h-full"
          aria-label={`Street View near ${listing.title} in ${listing.suburb}`}
        />

        {isLoading && !errorState && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-[#F2EEE5]/95 text-[#1C221F]"
          >
            <Loader2 className="w-6 h-6 animate-spin text-[#163A2E]" aria-hidden="true" />
            <p className="text-sm font-medium">Loading Street View…</p>
          </div>
        )}

        {errorState && (
          <div
            role="alert"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-[#F5F2EB] text-[#1C221F]"
          >
            <div className="max-w-sm rounded-2xl bg-[#FDFCF9] border border-[#E3DDD1] p-5 shadow-sm">
              <AlertCircle className="w-6 h-6 text-[#9A7832] mx-auto mb-2.5" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#1C221F] mb-4">{errorState.message}</p>
              <button
                type="button"
                onClick={handleCloseClick}
                className="min-h-[44px] w-full px-4 py-2.5 rounded-xl bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-[#DFC58A]" aria-hidden="true" />
                <span>Back to 3D map</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata & required Street View disclaimer placed strictly below the panorama */}
      <footer className="shrink-0 bg-[#FDFCF9] border-t border-[#E3DDD1] px-3.5 py-2.5 sm:px-4 text-xs text-[#4B544F] space-y-1">
        {!isLoading && !errorState && (
          <div className="flex items-center gap-1.5 font-medium text-[#1C221F]">
            <Calendar className="w-3.5 h-3.5 text-[#163A2E] shrink-0" aria-hidden="true" />
            <span>{captureDateText}</span>
          </div>
        )}
        <p className="text-[11px] leading-snug text-[#6B746E]">
          Street-level imagery from Google. It may not reflect the property&apos;s current condition.
        </p>
      </footer>
    </div>
  );
};

export default StreetViewPanel;
