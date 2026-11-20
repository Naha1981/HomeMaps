import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  Compass,
  HelpCircle,
  Loader2,
  LocateFixed,
  MapPin,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  PropertyListing,
  Viewpoint,
  buildWhatsAppUrl,
  canShowStreetView,
  getPublicCoordinates,
  getViewpointCoordinates,
} from '../listingData';
import { getGoogleMapsApiKey, loadGoogleMapsScript } from '../utils';

interface PropertyLocationMapProps {
  listing: PropertyListing;
  apiKey?: string;
  configResolved?: boolean;
  quotaExceeded?: boolean;
  on3DFailure?: (reason: string | null) => void;
  onOpenStreetView?: () => void;
  streetViewUnavailable?: boolean;
}

function supportsWebGL2(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

function buildCirclePath(
  centerLat: number,
  centerLng: number,
  radiusMetres: number,
  steps: number = 64
): Array<{ lat: number; lng: number }> {
  const earthRadius = 6378137;
  const latRad = (centerLat * Math.PI) / 180;
  const points: Array<{ lat: number; lng: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const angle = (i * 2 * Math.PI) / steps;
    const dLat = (radiusMetres * Math.cos(angle)) / earthRadius;
    const dLng = (radiusMetres * Math.sin(angle)) / (earthRadius * Math.cos(latRad));
    points.push({
      lat: centerLat + (dLat * 180) / Math.PI,
      lng: centerLng + (dLng * 180) / Math.PI,
    });
  }

  return points;
}

function extract3DEventReason(event: any): string {
  if (!event) return 'Map3DElement emitted an unspecified error event.';
  const type = typeof event.type === 'string' ? event.type : 'error';
  const parts: string[] = [];

  if (typeof event.message === 'string' && event.message.trim()) {
    parts.push(event.message.trim());
  }
  if (event.error) {
    if (typeof event.error === 'string' && event.error.trim()) {
      parts.push(event.error.trim());
    } else if (typeof event.error?.message === 'string' && event.error.message.trim()) {
      parts.push(event.error.message.trim());
    } else {
      try {
        parts.push(JSON.stringify(event.error));
      } catch {
        parts.push(String(event.error));
      }
    }
  }
  if (event.detail !== undefined && event.detail !== null) {
    if (typeof event.detail === 'string' && event.detail.trim()) {
      parts.push(event.detail.trim());
    } else if (typeof event.detail?.message === 'string' && event.detail.message.trim()) {
      parts.push(event.detail.message.trim());
    } else {
      try {
        const serialized = JSON.stringify(event.detail);
        if (serialized && serialized !== '{}') parts.push(serialized);
      } catch {
        parts.push(String(event.detail));
      }
    }
  }

  if (parts.length === 0) {
    return `Map3DElement fired "${type}" event (no error payload provided).`;
  }
  return `Event "${type}": ${parts.join(' — ')}`;
}

type AllowedMapAction =
  | { name: 'flyToViewpoint'; args: { id: string } }
  | { name: 'orbit'; args: { direction: 'left' | 'right'; degrees: number } }
  | { name: 'setView'; args: { mode: 'top_down' | 'oblique' } }
  | { name: 'zoom'; args: { direction: 'in' | 'out' } }
  | { name: 'resetView'; args: Record<string, never> }
  | { name: 'openStreetView'; args: Record<string, never> }
  | { name: 'enterFullScreen'; args: Record<string, never> }
  | { name: 'exitFullScreen'; args: Record<string, never> };

const EXAMPLE_COMMAND_CHIPS = ['Front gate', 'From the street', 'Roof top', 'Left side'] as const;

function isPromptInjectionAttempt(rawText: string): boolean {
  const normalized = rawText
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return /\b(ignore\s+(all\s+|your\s+|previous\s+)?(rules|instructions|prompts?)|disregard\s+(all\s+|your\s+)?(rules|instructions)|reveal\s+(your\s+)?(rules|instructions|system\s+prompt)|owner'?s?\s+address|exact\s+address|private\s+address|what\s+is\s+the\s+address)\b/.test(
    normalized
  );
}

function isPropertyOrAreaQuestion(rawText: string): boolean {
  const normalized = rawText
    .toLowerCase()
    .replace(/[^\w\s?']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /\b(safe|safety|crime|security|price|pricing|cost|worth|value|levy|levies|rates|taxes|tax|schools?|crime rate|neighborhood|neighbourhood|area|suburb|bed|bedroom|bedrooms|bath|bathroom|bathrooms|pool|garage|pet|pets|negotiable|agent|viewing|available|market|rent|rental|deposit|transfer|bond|mortgage|hoa|body corporate|utilities|water|electricity)\b/.test(
    normalized
  );
}

function parseDeterministicCommand(
  rawText: string,
  viewpoints: Viewpoint[]
): AllowedMapAction | null {
  if (isPromptInjectionAttempt(rawText)) return null;

  const normalized = rawText
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  if (/\b(exit|leave|close)\s+full\s*screen\b/.test(normalized)) {
    return { name: 'exitFullScreen', args: {} };
  }
  if (/\bfull\s*screen\b/.test(normalized)) {
    return { name: 'enterFullScreen', args: {} };
  }

  if (
    /^(reset|reset view|reset map|home|default|default view|start|back to start)$/.test(normalized) ||
    /\breset\s+(the\s+)?(view|map|camera)\b/.test(normalized)
  ) {
    return { name: 'resetView', args: {} };
  }

  if (/\bzoom\s+in\b/.test(normalized) || /^(closer|zoom closer)$/.test(normalized)) {
    return { name: 'zoom', args: { direction: 'in' } };
  }
  if (/\bzoom\s+out\b/.test(normalized) || /^(farther|further|zoom back)$/.test(normalized)) {
    return { name: 'zoom', args: { direction: 'out' } };
  }

  if (/\b(from the street|street view|street approach|street|road)\b/.test(normalized)) {
    return { name: 'openStreetView', args: {} };
  }

  if (/\b(from above|top[\s-]*down|bird'?s? eye|aerial view|overhead)\b/.test(normalized)) {
    return { name: 'setView', args: { mode: 'top_down' } };
  }
  if (/\b(oblique|angled view|3d view)\b/.test(normalized)) {
    return { name: 'setView', args: { mode: 'oblique' } };
  }

  // Match predefined viewpoint labels and aliases (longest phrase first)
  const candidates: Array<{ phrase: string; id: string }> = [];
  for (const vp of viewpoints) {
    candidates.push({ phrase: vp.label.toLowerCase(), id: vp.id });
    for (const alias of vp.aliases) {
      candidates.push({ phrase: alias.toLowerCase(), id: vp.id });
    }
  }
  candidates.sort((a, b) => b.phrase.length - a.phrase.length);

  for (const { phrase, id } of candidates) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
    if (pattern.test(normalized)) {
      if (id === 'street-approach') {
        return { name: 'openStreetView', args: {} };
      }
      return { name: 'flyToViewpoint', args: { id } };
    }
  }

  const orbitPhraseMatch = normalized.match(
    /^(?:go |turn |look |move |rotate |orbit |pan |show )*(?:to the )?(left|right)(?: side)?(?:\s+(\d{1,3})\s*(?:deg|degrees)?)?$/
  );
  if (orbitPhraseMatch) {
    const direction = orbitPhraseMatch[1] as 'left' | 'right';
    const rawDeg = orbitPhraseMatch[2] ? Number(orbitPhraseMatch[2]) : 90;
    const degrees = Number.isFinite(rawDeg) ? Math.min(180, Math.max(15, rawDeg)) : 90;
    return { name: 'orbit', args: { direction, degrees } };
  }

  const explicitOrbitMatch = normalized.match(
    /\b(?:rotate|orbit|turn|spin)\s+(left|right)(?:\s+(\d{1,3})\s*(?:deg|degrees)?)?\b/
  );
  if (explicitOrbitMatch) {
    const direction = explicitOrbitMatch[1] as 'left' | 'right';
    const rawDeg = explicitOrbitMatch[2] ? Number(explicitOrbitMatch[2]) : 90;
    const degrees = Number.isFinite(rawDeg) ? Math.min(180, Math.max(15, rawDeg)) : 90;
    return { name: 'orbit', args: { direction, degrees } };
  }

  return null;
}

function clampCameraCenterNearProperty(
  target: { lat: number; lng: number; altitude: number },
  base: { lat: number; lng: number },
  maxOffsetMetres = 150
): { lat: number; lng: number; altitude: number } {
  const earthRadius = 6378137;
  const latScale = earthRadius * (Math.PI / 180);
  const lngScale = earthRadius * Math.cos((base.lat * Math.PI) / 180) * (Math.PI / 180);

  const dNorth = (target.lat - base.lat) * latScale;
  const dEast = (target.lng - base.lng) * lngScale;
  const distance = Math.hypot(dNorth, dEast);

  if (!Number.isFinite(distance) || distance <= maxOffsetMetres || distance === 0) {
    return target;
  }

  const scale = maxOffsetMetres / distance;
  return {
    lat: base.lat + (dNorth * scale) / latScale,
    lng: base.lng + (dEast * scale) / lngScale,
    altitude: target.altitude,
  };
}

interface MapControlButtonProps {
  id: string;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  onAction: () => void;
  isExpanded: boolean;
  activeTooltipId: string | null;
  setActiveTooltipId: React.Dispatch<React.SetStateAction<string | null>>;
  tooltipAlign?: 'left' | 'center' | 'right';
  variant?: 'default' | 'primary';
  alwaysShowText?: boolean;
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
}

const MapControlButton: React.FC<MapControlButtonProps> = ({
  id,
  label,
  shortLabel,
  icon,
  onAction,
  isExpanded,
  activeTooltipId,
  setActiveTooltipId,
  tooltipAlign = 'center',
  variant = 'default',
  alwaysShowText = false,
  ariaPressed,
  ariaExpanded,
}) => {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const recentTouchRef = useRef(false);
  const tooltipId = `map-ctrl-tip-${id}`;
  const isTooltipVisible = activeTooltipId === id;

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (clearTooltipTimerRef.current) clearTimeout(clearTooltipTimerRef.current);
    };
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'touch') return;
    recentTouchRef.current = true;
    longPressTriggeredRef.current = false;
    touchStartPosRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    if (clearTooltipTimerRef.current) {
      clearTimeout(clearTooltipTimerRef.current);
      clearTooltipTimerRef.current = null;
    }
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setActiveTooltipId(id);
    }, 450);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'touch' || !touchStartPosRef.current) return;
    const dx = Math.abs(e.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(e.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPressTimer();
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'touch') return;
    clearLongPressTimer();
    touchStartPosRef.current = null;
    if (longPressTriggeredRef.current) {
      clearTooltipTimerRef.current = setTimeout(() => {
        setActiveTooltipId((curr) => (curr === id ? null : curr));
      }, 1600);
    }
    setTimeout(() => {
      recentTouchRef.current = false;
    }, 300);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      e.preventDefault();
      return;
    }
    onAction();
  };

  const alignClass =
    tooltipAlign === 'right'
      ? 'right-0'
      : tooltipAlign === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2';

  const variantClass =
    variant === 'primary'
      ? 'bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] text-white border-[#163A2E]'
      : 'bg-[#FAF8F4] hover:bg-[#EFECE3] active:bg-[#E5DFD2] text-[#1C221F] border-[#DED7C9]';

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-describedby={isTooltipVisible ? tooltipId : undefined}
        aria-pressed={ariaPressed}
        aria-expanded={ariaExpanded}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onMouseEnter={() => {
          if (!recentTouchRef.current) setActiveTooltipId(id);
        }}
        onMouseLeave={() => {
          setActiveTooltipId((curr) => (curr === id ? null : curr));
        }}
        onFocus={() => setActiveTooltipId(id)}
        onBlur={() => setActiveTooltipId((curr) => (curr === id ? null : curr))}
        className={`min-w-[44px] min-h-[44px] rounded-lg border transition-colors flex ${
          isExpanded
            ? 'flex-col items-center justify-center px-2 py-1.5 min-w-[54px]'
            : alwaysShowText
              ? 'items-center justify-center gap-1.5 px-2.5 py-2'
              : 'items-center justify-center p-2'
        } ${variantClass}`}
      >
        <span className="shrink-0 flex items-center justify-center" aria-hidden="true">
          {icon}
        </span>
        {isExpanded ? (
          <span className="text-[10px] font-medium leading-tight mt-1 whitespace-nowrap">
            {shortLabel}
          </span>
        ) : alwaysShowText ? (
          <span className="text-xs font-semibold leading-none whitespace-nowrap">{shortLabel}</span>
        ) : null}
      </button>

      {isTooltipVisible && (
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute top-full mt-1.5 ${alignClass} z-30 whitespace-nowrap rounded-lg bg-[#1C221F] text-[#FDFCF9] border border-[#C4A052]/40 px-2.5 py-1 text-xs font-medium shadow-md`}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export const PropertyLocationMap: React.FC<PropertyLocationMapProps> = ({
  listing,
  apiKey,
  configResolved = true,
  quotaExceeded = false,
  on3DFailure,
  onOpenStreetView,
  streetViewUnavailable = false,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const map3DRef = useRef<any>(null);
  const map2DRef = useRef<any>(null);
  const marker2DRef = useRef<any>(null);
  const circle2DRef = useRef<any>(null);
  const helpContainerRef = useRef<HTMLDivElement>(null);
  const lastSynced3DStateRef = useRef<string | null>(null);
  const on3DFailureRef = useRef(on3DFailure);
  on3DFailureRef.current = on3DFailure;

  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFallbackFullscreen, setIsFallbackFullscreen] = useState(false);
  const [isBarExpanded, setIsBarExpanded] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [activeGroundViewpoint, setActiveGroundViewpoint] = useState<Viewpoint | null>(null);
  const [isTourPlaying, setIsTourPlaying] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const isFullscreen = isNativeFullscreen || isFallbackFullscreen;

  const [readyAfterFirstPaint, setReadyAfterFirstPaint] = useState(false);
  const [renderMode, setRenderMode] = useState<'3d' | '2d'>('3d');
  const [isLoading, setIsLoading] = useState(true);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [fatalMapError, setFatalMapError] = useState<string | null>(null);
  const [mapReadyVersion, setMapReadyVersion] = useState(0);
  const [commandInput, setCommandInput] = useState('');
  const [isCommandLoading, setIsCommandLoading] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState<{
    text: string;
    isError: boolean;
    showWhatsAppCta?: boolean;
  } | null>(null);

  const publicCoords = getPublicCoordinates(listing);
  const isExact = listing.publicLocationPrecision === 'exact';
  const tourViewpoints = listing.viewpoints.filter((vp) => isExact || !vp.requiresExactLocation);

  useEffect(() => {
    if (!isExact) {
      setActiveGroundViewpoint(null);
      setIsTourPlaying(false);
    }
  }, [isExact]);

  // Defer map script & WebGL initialization until after first paint
  useEffect(() => {
    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    rafId = window.requestAnimationFrame(() => {
      timerId = setTimeout(() => {
        setReadyAfterFirstPaint(true);
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // React to global auth/quota failures from main.tsx
  useEffect(() => {
    if (quotaExceeded) {
      const authReason = 'Google Maps Platform authentication or quota failure (gm_authFailure / OverQuotaMapError).';
      console.error('[HomeAI Maps 3D Failure]', authReason);
      on3DFailureRef.current?.(authReason);
      setIsLoading(false);
      setFatalMapError(
        'Google Maps could not authenticate or load tiles. Check that VITE_GOOGLE_MAPS_API_KEY is valid and has Maps JavaScript API enabled.'
      );
    }
  }, [quotaExceeded]);

  // Initialize 3D Photorealistic Map (with automatic fallback to 2D on failure)
  useEffect(() => {
    if (!readyAfterFirstPaint || !configResolved || renderMode !== '3d' || quotaExceeded) return;

    let cancelled = false;
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let readinessIntervalId: ReturnType<typeof setInterval> | null = null;
    let stage = 'initializing';
    let lastSteadyState = 'not fired';
    let switchedTo2D = false;

    const clearTimers = () => {
      if (loadTimeoutId) {
        clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
      if (readinessIntervalId) {
        clearInterval(readinessIntervalId);
        readinessIntervalId = null;
      }
    };

    const triggerFallbackTo2D = (userNotice: string, diagnosticReason: string) => {
      if (cancelled || switchedTo2D) return;
      switchedTo2D = true;
      clearTimers();
      console.error('[HomeAI Maps 3D Failure]', diagnosticReason);
      on3DFailureRef.current?.(diagnosticReason);
      setFallbackNotice(userNotice);
      setRenderMode('2d');
      setIsLoading(true);
    };

    const waitForHostLayout = async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (cancelled) return false;
        const host = mapHostRef.current;
        if (host && host.clientWidth > 0 && host.clientHeight > 0) {
          return true;
        }
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      }
      return Boolean(!cancelled && mapHostRef.current);
    };

    const init3DMap = async () => {
      setIsLoading(true);
      setFatalMapError(null);
      on3DFailureRef.current?.(null);

      const effectiveKey = (apiKey && apiKey.trim()) || getGoogleMapsApiKey();
      if (!effectiveKey) {
        const missingReason = 'VITE_GOOGLE_MAPS_API_KEY is missing.';
        console.error('[HomeAI Maps 3D Failure]', missingReason);
        on3DFailureRef.current?.(missingReason);
        setIsLoading(false);
        setFatalMapError(
          'Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in your environment secrets or .env file.'
        );
        return;
      }

      if (!supportsWebGL2()) {
        triggerFallbackTo2D(
          '3D Photorealistic view requires WebGL2, which is unavailable in this browser. Showing the 2D map instead.',
          'WebGL2 context unavailable (supportsWebGL2() returned false).'
        );
        return;
      }

      try {
        stage = 'loading-maps-js-script';
        await loadGoogleMapsScript(effectiveKey);
        if (cancelled) return;

        const google = (window as any).google;
        if (!google?.maps) {
          throw new Error('Google Maps JavaScript API (window.google.maps) did not initialize.');
        }

        stage = 'importing-maps3d-library';
        const maps3dLib = google.maps.importLibrary
          ? await google.maps.importLibrary('maps3d')
          : google.maps.maps3d;

        if (!maps3dLib?.Map3DElement && !customElements.get('gmp-map-3d')) {
          throw new Error('Photorealistic 3D Maps library (maps3d / gmp-map-3d) is unavailable.');
        }

        stage = 'defining-gmp-map-3d';
        if (typeof customElements !== 'undefined' && customElements.whenDefined) {
          await customElements.whenDefined('gmp-map-3d');
        }

        const hasLayout = await waitForHostLayout();
        if (!hasLayout || cancelled || !mapHostRef.current) return;

        mapHostRef.current.innerHTML = '';

        const initialRange = isExact
          ? listing.cameraPreset.range
          : Math.max(listing.cameraPreset.range, listing.coordinates.approximateRadiusMetres * 2.5);

        const initialCenter = { lat: publicCoords.lat, lng: publicCoords.lng, altitude: 0 };
        const hybridMode = maps3dLib?.MapMode?.HYBRID ?? 'HYBRID';

        let map3DEl: any;
        if (typeof maps3dLib?.Map3DElement === 'function') {
          try {
            map3DEl = new maps3dLib.Map3DElement({
              center: initialCenter,
              range: initialRange,
              tilt: listing.cameraPreset.tilt,
              heading: listing.cameraPreset.heading,
              mode: hybridMode,
              defaultUIHidden: true,
              gestureHandling: 'GREEDY',
              internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
            });
          } catch {
            map3DEl = null;
          }
        }

        if (!map3DEl) {
          map3DEl = document.createElement('gmp-map-3d') as any;
          map3DEl.setAttribute('mode', 'HYBRID');
          map3DEl.setAttribute('default-ui-hidden', '');
          map3DEl.setAttribute('internal-usage-attribution-ids', 'gmp_mcp_codeassist_v1_aistudio');
          map3DEl.setAttribute('gesture-handling', 'GREEDY');
          map3DEl.setAttribute('center', `${publicCoords.lat},${publicCoords.lng},0`);
          map3DEl.setAttribute('range', String(initialRange));
          map3DEl.setAttribute('tilt', String(listing.cameraPreset.tilt));
          map3DEl.setAttribute('heading', String(listing.cameraPreset.heading));
          try {
            map3DEl.mode = hybridMode;
            map3DEl.defaultUIHidden = true;
            map3DEl.internalUsageAttributionIds = ['gmp_mcp_codeassist_v1_aistudio'];
            map3DEl.center = initialCenter;
            map3DEl.range = initialRange;
            map3DEl.tilt = listing.cameraPreset.tilt;
            map3DEl.heading = listing.cameraPreset.heading;
          } catch {
            // Attribute values remain applied if imperative setters are deferred
          }
        }

        map3DEl.style.width = '100%';
        map3DEl.style.height = '100%';
        map3DEl.style.display = 'block';

        let settled = false;
        const mountedAt = Date.now();
        const markLoaded = () => {
          if (cancelled || switchedTo2D || settled) return;
          settled = true;
          clearTimers();
          setIsLoading(false);
          setMapReadyVersion((v) => v + 1);
        };

        const handleSteadyChange = (event: any) => {
          lastSteadyState = String(event?.isSteady);
          if (event?.isSteady !== false) {
            markLoaded();
          }
        };

        const handle3DError = (event: any) => {
          if (cancelled || switchedTo2D) return;
          const eventReason = extract3DEventReason(event);
          console.error('[HomeAI Maps 3D Error Event]', event);
          triggerFallbackTo2D(
            'Unable to load the 3D Photorealistic map. Showing the standard 2D map instead.',
            eventReason
          );
        };

        map3DEl.addEventListener('gmp-load', markLoaded);
        map3DEl.addEventListener('gmp-steadystate', markLoaded);
        map3DEl.addEventListener('gmp-steadychange', handleSteadyChange);
        map3DEl.addEventListener('gmp-error', handle3DError);
        map3DEl.addEventListener('gmp-map-id-error', handle3DError);

        stage = 'waiting-for-3d-scene';
        map3DRef.current = map3DEl;
        mapHostRef.current.appendChild(map3DEl);

        // Poll for active WebGL canvas or steady state in case gmp-steadychange did not transition
        readinessIntervalId = setInterval(() => {
          if (cancelled || switchedTo2D || settled) return;
          const elapsed = Date.now() - mountedAt;
          if ((map3DEl as any).isSteady === true) {
            lastSteadyState = 'true';
            markLoaded();
            return;
          }
          const shadowCanvas = map3DEl.shadowRoot?.querySelector?.('canvas') as
            | HTMLCanvasElement
            | null
            | undefined;
          const hasRenderedCanvas = Boolean(
            shadowCanvas && shadowCanvas.width > 0 && shadowCanvas.height > 0
          );
          if (hasRenderedCanvas && (lastSteadyState === 'false' || elapsed >= 3500)) {
            markLoaded();
          }
        }, 250);

        loadTimeoutId = setTimeout(() => {
          if (!cancelled && !switchedTo2D && !settled) {
            settled = true;
            triggerFallbackTo2D(
              'The 3D Photorealistic map took too long to respond. Showing the standard 2D map instead.',
              `Timeout after 20000ms at stage "${stage}" (gmp-steadychange isSteady: ${lastSteadyState}).`
            );
          }
        }, 20000);
      } catch (err: any) {
        if (cancelled) return;
        const message = err?.message || '';
        const errDetail =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : err && typeof err === 'object' && 'type' in err
              ? `Script event "${String(err.type)}" while loading Maps JS API (${stage})`
              : String(err || `Unknown 3D initialization error at stage "${stage}"`);
        if (message.includes('VITE_GOOGLE_MAPS_API_KEY')) {
          console.error('[HomeAI Maps 3D Failure]', errDetail, err);
          on3DFailureRef.current?.(errDetail);
          setIsLoading(false);
          setFatalMapError(
            'Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in your environment secrets or .env file.'
          );
        } else {
          console.error('[HomeAI Maps 3D Exception]', err);
          triggerFallbackTo2D(
            'Unable to load the 3D Photorealistic map. Showing the standard 2D map instead.',
            errDetail
          );
        }
      }
    };

    init3DMap();

    return () => {
      cancelled = true;
      clearTimers();
      if (map3DRef.current && typeof map3DRef.current.stopCameraAnimation === 'function') {
        try {
          map3DRef.current.stopCameraAnimation();
        } catch {
          // ignore
        }
      }
      map3DRef.current = null;
      lastSynced3DStateRef.current = null;
    };
    // Mount 3D map once after first paint; precision changes update overlays & camera smoothly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyAfterFirstPaint, configResolved, renderMode, apiKey, quotaExceeded]);

  // Update 3D map camera, marker, or approximate-area circle when precision changes
  useEffect(() => {
    if (renderMode !== '3d' || !map3DRef.current || mapReadyVersion === 0) return;
    const map3DEl = map3DRef.current;
    let cancelled = false;

    const syncKey = `${isExact}:${publicCoords.lat}:${publicCoords.lng}:${listing.coordinates.approximateRadiusMetres}`;
    const shouldMoveCamera =
      lastSynced3DStateRef.current !== null && lastSynced3DStateRef.current !== syncKey;
    lastSynced3DStateRef.current = syncKey;

    const sync3DOverlaysAndCamera = async () => {
      if (shouldMoveCamera) {
        const targetRange = isExact
          ? listing.cameraPreset.range
          : Math.max(listing.cameraPreset.range, listing.coordinates.approximateRadiusMetres * 2.5);
        const targetCenter = {
          lat: publicCoords.lat,
          lng: publicCoords.lng,
          altitude: 0,
        };

        try {
          if (typeof map3DEl.flyCameraTo === 'function' && !prefersReducedMotion) {
            if (typeof map3DEl.stopCameraAnimation === 'function') {
              map3DEl.stopCameraAnimation();
            }
            map3DEl.flyCameraTo({
              endCamera: {
                center: targetCenter,
                range: targetRange,
                tilt: listing.cameraPreset.tilt,
                heading: listing.cameraPreset.heading,
              },
              durationMillis: 1200,
            });
          } else {
            map3DEl.center = targetCenter;
            map3DEl.range = targetRange;
            map3DEl.tilt = listing.cameraPreset.tilt;
            map3DEl.heading = listing.cameraPreset.heading;
          }
        } catch {
          // ignore transient camera sync errors before upgrade
        }
      }

      // Clear previous 3D markers and polygons
      const existingOverlays = map3DEl.querySelectorAll(
        'gmp-marker-3d, gmp-marker-3d-interactive, gmp-polygon-3d, gmp-polygon-3d-interactive'
      );
      existingOverlays.forEach((node: Element) => {
        try {
          node.remove();
        } catch {
          // ignore
        }
      });

      const google = (window as any).google;
      if (!google?.maps?.importLibrary) return;

      try {
        const [maps3dLib, markerLib] = await Promise.all([
          google.maps.importLibrary('maps3d'),
          google.maps.importLibrary('marker'),
        ]);
        if (cancelled || map3DRef.current !== map3DEl) return;

        if (isExact) {
          const Marker3D = maps3dLib?.Marker3DElement;
          const Pin = markerLib?.PinElement;
          if (Marker3D) {
            const marker = new Marker3D({
              position: { lat: publicCoords.lat, lng: publicCoords.lng, altitude: 10 },
              altitudeMode: 'RELATIVE_TO_MESH',
              extruded: true,
              label: listing.title,
            });
            if (Pin) {
              const pin = new Pin({
                background: '#163A2E',
                borderColor: '#C4A052',
                glyphColor: '#FFFFFF',
                scale: 1.25,
              });
              marker.append(pin);
            }
            map3DEl.append(marker);
          }
        } else {
          const Polygon3D = maps3dLib?.Polygon3DElement;
          if (Polygon3D) {
            const circlePolygon = new Polygon3D({
              strokeColor: '#163A2ECC',
              strokeWidth: 3,
              fillColor: '#C4A0523D',
              altitudeMode: 'CLAMP_TO_GROUND',
              drawsOccludedSegments: true,
              geodesic: true,
            });
            circlePolygon.path = buildCirclePath(
              publicCoords.lat,
              publicCoords.lng,
              listing.coordinates.approximateRadiusMetres
            );
            map3DEl.append(circlePolygon);
          }
        }
      } catch (err) {
        console.warn('3D overlay update notice:', err);
      }
    };

    sync3DOverlaysAndCamera();

    return () => {
      cancelled = true;
    };
  }, [
    renderMode,
    mapReadyVersion,
    isExact,
    publicCoords.lat,
    publicCoords.lng,
    listing.title,
    listing.cameraPreset.range,
    listing.cameraPreset.tilt,
    listing.cameraPreset.heading,
    listing.coordinates.approximateRadiusMetres,
  ]);

  // Initialize 2D Google Map Fallback
  useEffect(() => {
    if (!readyAfterFirstPaint || !configResolved || renderMode !== '2d' || quotaExceeded) return;

    let cancelled = false;

    const init2DMap = async () => {
      setIsLoading(true);
      setFatalMapError(null);

      const effectiveKey = (apiKey && apiKey.trim()) || getGoogleMapsApiKey();
      if (!effectiveKey) {
        setIsLoading(false);
        setFatalMapError(
          'Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in your environment secrets or .env file.'
        );
        return;
      }

      try {
        await loadGoogleMapsScript(effectiveKey);
        if (cancelled || !mapHostRef.current) return;

        const google = (window as any).google;
        if (!google?.maps) {
          throw new Error('Google Maps JavaScript API could not be initialized.');
        }

        const mapsLib = google.maps.importLibrary
          ? await google.maps.importLibrary('maps')
          : google.maps;

        if (cancelled || !mapHostRef.current) return;

        mapHostRef.current.innerHTML = '';
        const mapDiv = document.createElement('div');
        mapDiv.style.width = '100%';
        mapDiv.style.height = '100%';
        mapHostRef.current.appendChild(mapDiv);

        const MapConstructor = mapsLib.Map || google.maps.Map;
        const map2D = new MapConstructor(mapDiv, {
          center: publicCoords,
          zoom: isExact ? 17 : 14,
          mapId: 'DEMO_MAP_ID',
          internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
          gestureHandling: 'greedy',
          disableDefaultUI: true,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
        });

        map2DRef.current = map2D;
        setMapReadyVersion((v) => v + 1);
        setIsLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setIsLoading(false);
        const msg = err?.message || '';
        if (msg.includes('VITE_GOOGLE_MAPS_API_KEY')) {
          setFatalMapError(
            'Google Maps API key is not configured. Set VITE_GOOGLE_MAPS_API_KEY in your environment secrets or .env file.'
          );
        } else {
          setFatalMapError(
            'Unable to load Google Maps. Please check your network connection and API key configuration.'
          );
        }
      }
    };

    init2DMap();

    return () => {
      cancelled = true;
      if (marker2DRef.current) {
        try {
          marker2DRef.current.map = null;
        } catch {
          // ignore
        }
        marker2DRef.current = null;
      }
      if (circle2DRef.current) {
        try {
          circle2DRef.current.setMap(null);
        } catch {
          // ignore
        }
        circle2DRef.current = null;
      }
      map2DRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyAfterFirstPaint, configResolved, renderMode, apiKey, quotaExceeded]);

  // Update 2D map marker or approximate-area circle when precision changes
  useEffect(() => {
    if (renderMode !== '2d' || !map2DRef.current) return;
    const map2D = map2DRef.current;
    let cancelled = false;

    const sync2DOverlays = async () => {
      if (marker2DRef.current) {
        try {
          marker2DRef.current.map = null;
        } catch {
          // ignore
        }
        marker2DRef.current = null;
      }
      if (circle2DRef.current) {
        try {
          circle2DRef.current.setMap(null);
        } catch {
          // ignore
        }
        circle2DRef.current = null;
      }

      const google = (window as any).google;
      if (!google?.maps) return;

      if (isExact) {
        map2D.setCenter(publicCoords);
        map2D.setZoom(17);

        try {
          const markerLib = google.maps.importLibrary
            ? await google.maps.importLibrary('marker')
            : google.maps.marker;
          if (cancelled || map2DRef.current !== map2D) return;

          const AdvancedMarker = markerLib?.AdvancedMarkerElement;
          const Pin = markerLib?.PinElement;

          if (AdvancedMarker) {
            let content: HTMLElement | undefined;
            if (Pin) {
              const pin = new Pin({
                background: '#163A2E',
                borderColor: '#C4A052',
                glyphColor: '#FFFFFF',
                scale: 1.15,
              });
              content = pin.element || (pin as any);
            }
            marker2DRef.current = new AdvancedMarker({
              map: map2D,
              position: publicCoords,
              title: listing.title,
              ...(content ? { content } : {}),
            });
          }
        } catch (err) {
          console.warn('2D marker notice:', err);
        }
      } else {
        const mapsLib = google.maps.importLibrary
          ? await google.maps.importLibrary('maps')
          : google.maps;
        if (cancelled || map2DRef.current !== map2D) return;

        const CircleConstructor = mapsLib?.Circle || google.maps.Circle;
        if (CircleConstructor) {
          const circle = new CircleConstructor({
            map: map2D,
            center: publicCoords,
            radius: listing.coordinates.approximateRadiusMetres,
            strokeColor: '#163A2E',
            strokeOpacity: 0.85,
            strokeWeight: 2,
            fillColor: '#C4A052',
            fillOpacity: 0.2,
          });
          circle2DRef.current = circle;
          const bounds = circle.getBounds?.();
          if (bounds) {
            map2D.fitBounds(bounds, 24);
          } else {
            map2D.setCenter(publicCoords);
            map2D.setZoom(14);
          }
        }
      }
    };

    sync2DOverlays();

    return () => {
      cancelled = true;
    };
  }, [
    renderMode,
    mapReadyVersion,
    isExact,
    publicCoords.lat,
    publicCoords.lng,
    listing.title,
    listing.coordinates.approximateRadiusMetres,
  ]);

  // Track prefers-reduced-motion preference
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(mq.matches);
    syncPreference();
    mq.addEventListener?.('change', syncPreference);
    return () => mq.removeEventListener?.('change', syncPreference);
  }, []);

  const preserve2DCameraAfterResize = useCallback(() => {
    if (renderMode !== '2d' || !map2DRef.current) return;
    const google = (window as any).google;
    if (!google?.maps?.event?.trigger) return;
    const center = map2DRef.current.getCenter?.();
    const zoom = map2DRef.current.getZoom?.();
    setTimeout(() => {
      try {
        google.maps.event.trigger(map2DRef.current, 'resize');
        if (center) map2DRef.current.setCenter(center);
        if (typeof zoom === 'number') map2DRef.current.setZoom(zoom);
      } catch {
        // ignore resize errors
      }
    }, 50);
  }, [renderMode]);

  // Listen to native Fullscreen API changes (including Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsEl =
        document.fullscreenElement || (document as any).webkitFullscreenElement || null;
      setIsNativeFullscreen(Boolean(wrapperRef.current && fsEl === wrapperRef.current));
      preserve2DCameraAfterResize();
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [preserve2DCameraAfterResize]);

  // Handle Esc and body scroll lock for fallback full-screen overlay (e.g., iPhone Safari)
  useEffect(() => {
    if (!isFallbackFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isHelpOpen) {
        setIsFallbackFullscreen(false);
        preserve2DCameraAfterResize();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFallbackFullscreen, isHelpOpen, preserve2DCameraAfterResize]);

  // Close the navigation commands help popup on Escape or outside click
  useEffect(() => {
    if (!isHelpOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsHelpOpen(false);
      }
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (
        helpContainerRef.current &&
        e.target instanceof Node &&
        !helpContainerRef.current.contains(e.target)
      ) {
        setIsHelpOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isHelpOpen]);

  const handleToggleFullscreen = async () => {
    setActiveTooltipId(null);

    if (isNativeFullscreen) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
      } catch {
        setIsNativeFullscreen(false);
      }
      return;
    }

    if (isFallbackFullscreen) {
      setIsFallbackFullscreen(false);
      preserve2DCameraAfterResize();
      return;
    }

    const el = wrapperRef.current as any;
    const canUseNative =
      Boolean(el) &&
      document.fullscreenEnabled !== false &&
      (typeof el.requestFullscreen === 'function' ||
        typeof el.webkitRequestFullscreen === 'function');

    if (canUseNative) {
      try {
        if (typeof el.requestFullscreen === 'function') {
          await el.requestFullscreen();
        } else {
          el.webkitRequestFullscreen();
        }
        return;
      } catch {
        // Fallback to edge-to-edge viewport overlay if native fullscreen is blocked/unsupported
      }
    }

    setIsFallbackFullscreen(true);
    preserve2DCameraAfterResize();
  };

  const move3DCamera = (
    updater: (current: {
      center: { lat: number; lng: number; altitude: number };
      range: number;
      tilt: number;
      heading: number;
    }) => {
      center: { lat: number; lng: number; altitude: number };
      range: number;
      tilt: number;
      heading: number;
    },
    isBigJump = false,
    customDurationMs?: number
  ) => {
    const map3DEl = map3DRef.current;
    if (!map3DEl) return;

    const rawCenter = map3DEl.center;
    const currentCenter = {
      lat: typeof rawCenter?.lat === 'number' ? rawCenter.lat : publicCoords.lat,
      lng: typeof rawCenter?.lng === 'number' ? rawCenter.lng : publicCoords.lng,
      altitude:
        typeof rawCenter?.altitude === 'number' && Number.isFinite(rawCenter.altitude)
          ? rawCenter.altitude
          : 0,
    };
    const fallbackRange = isExact
      ? listing.cameraPreset.range
      : Math.max(listing.cameraPreset.range, listing.coordinates.approximateRadiusMetres * 2.5);
    const currentRange =
      typeof map3DEl.range === 'number' && Number.isFinite(map3DEl.range)
        ? map3DEl.range
        : fallbackRange;
    const currentTilt =
      typeof map3DEl.tilt === 'number' && Number.isFinite(map3DEl.tilt)
        ? map3DEl.tilt
        : listing.cameraPreset.tilt;
    const currentHeading =
      typeof map3DEl.heading === 'number' && Number.isFinite(map3DEl.heading)
        ? map3DEl.heading
        : listing.cameraPreset.heading;

    const nextRaw = updater({
      center: currentCenter,
      range: currentRange,
      tilt: currentTilt,
      heading: currentHeading,
    });

    const maxAllowedRange = Math.max(2500, listing.coordinates.approximateRadiusMetres * 3);
    const next = {
      center: clampCameraCenterNearProperty(nextRaw.center, publicCoords, 150),
      range: Math.min(maxAllowedRange, Math.max(15, Math.round(nextRaw.range))),
      tilt: Math.min(89, Math.max(0, Math.round(nextRaw.tilt))),
      heading: ((nextRaw.heading % 360) + 360) % 360,
    };

    const durationMillis = prefersReducedMotion
      ? 0
      : typeof customDurationMs === 'number'
        ? customDurationMs
        : isBigJump
          ? 1500
          : 280;

    try {
      if (typeof map3DEl.stopCameraAnimation === 'function') {
        map3DEl.stopCameraAnimation();
      }
      if (typeof map3DEl.flyCameraTo === 'function' && durationMillis > 0) {
        map3DEl.flyCameraTo({
          endCamera: {
            center: next.center,
            range: next.range,
            tilt: next.tilt,
            heading: next.heading,
          },
          durationMillis,
        });
      } else {
        map3DEl.center = next.center;
        map3DEl.range = next.range;
        map3DEl.tilt = next.tilt;
        map3DEl.heading = next.heading;
      }
    } catch {
      map3DEl.center = next.center;
      map3DEl.range = next.range;
      map3DEl.tilt = next.tilt;
      map3DEl.heading = next.heading;
    }
  };

  const handleZoomIn = () => {
    setIsTourPlaying(false);
    if (renderMode === '3d') {
      move3DCamera((cur) => ({
        ...cur,
        range: Math.max(15, Math.round(cur.range * 0.7)),
      }));
    } else if (map2DRef.current) {
      const z = map2DRef.current.getZoom?.() ?? 16;
      map2DRef.current.setZoom(Math.min(21, z + 1));
    }
  };

  const handleZoomOut = () => {
    setIsTourPlaying(false);
    if (renderMode === '3d') {
      move3DCamera((cur) => ({
        ...cur,
        range: Math.min(25000, Math.round(cur.range * 1.4)),
      }));
    } else if (map2DRef.current) {
      const z = map2DRef.current.getZoom?.() ?? 16;
      map2DRef.current.setZoom(Math.max(3, z - 1));
    }
  };

  const handleTiltUp = () => {
    setIsTourPlaying(false);
    if (renderMode !== '3d') return;
    move3DCamera((cur) => ({
      ...cur,
      tilt: Math.min(89, Math.round(cur.tilt + 10)),
    }));
  };

  const handleTiltDown = () => {
    setIsTourPlaying(false);
    if (renderMode !== '3d') return;
    move3DCamera((cur) => ({
      ...cur,
      tilt: Math.max(0, Math.round(cur.tilt - 10)),
    }));
  };

  const handleRotateLeft = () => {
    setIsTourPlaying(false);
    if (renderMode !== '3d') return;
    move3DCamera((cur) => ({
      ...cur,
      heading: ((cur.heading - 30) % 360 + 360) % 360,
    }));
  };

  const handleRotateRight = () => {
    setIsTourPlaying(false);
    if (renderMode !== '3d') return;
    move3DCamera((cur) => ({
      ...cur,
      heading: ((cur.heading + 30) % 360 + 360) % 360,
    }));
  };

  const handleResetView = () => {
    setIsTourPlaying(false);
    flyToViewpoint('overview');
  };

  const handleTopDownView = () => {
    setIsTourPlaying(false);
    if (renderMode !== '3d') return;
    setActiveGroundViewpoint(null);
    move3DCamera(
      (cur) => ({
        ...cur,
        range: isExact ? Math.max(cur.range, 200) : cur.range,
        tilt: 0,
        heading: 0,
      }),
      true
    );
  };

  const getAvailableViewLabels = (): string => {
    return listing.viewpoints
      .filter((vp) => isExact || !vp.requiresExactLocation)
      .map((vp) => vp.label)
      .join(', ');
  };

  const computeGroundViewpointCamera = (vp: Viewpoint) => {
    const horizontalDistance = Math.hypot(vp.offsetNorthM, vp.offsetEastM);
    const range =
      horizontalDistance > 0
        ? Math.round(horizontalDistance)
        : Number.isFinite(vp.range) && vp.range > 0
          ? vp.range
          : 35;

    // Bearing from the viewpoint (offsetNorthM, offsetEastM) toward the property (0, 0)
    const dNorthToProperty = -vp.offsetNorthM;
    const dEastToProperty = -vp.offsetEastM;
    const heading =
      dNorthToProperty !== 0 || dEastToProperty !== 0
        ? ((Math.atan2(dEastToProperty, dNorthToProperty) * 180) / Math.PI + 360) % 360
        : vp.heading;

    return {
      center: {
        lat: publicCoords.lat,
        lng: publicCoords.lng,
        altitude: 0,
      },
      range,
      tilt: 87,
      heading,
    };
  };

  const flyToViewpoint = (id: string): { ok: boolean; message: string } => {
    const vp = listing.viewpoints.find((item) => item.id === id);
    if (!vp) {
      return {
        ok: false,
        message: `That view isn't available. Available views: ${getAvailableViewLabels()}.`,
      };
    }
    if (vp.requiresExactLocation && !isExact) {
      return {
        ok: false,
        message: `That view isn't available for this listing. Available views: ${getAvailableViewLabels()}.`,
      };
    }

    if (vp.cameraMode === 'ground') {
      const groundCamera = computeGroundViewpointCamera(vp);
      if (renderMode === '3d') {
        move3DCamera(() => groundCamera, true, 2000);
      } else if (map2DRef.current) {
        if (typeof map2DRef.current.panTo === 'function') {
          map2DRef.current.panTo(publicCoords);
        } else {
          map2DRef.current.setCenter(publicCoords);
        }
        map2DRef.current.setZoom(18);
      }

      setActiveGroundViewpoint(vp);
      return {
        ok: true,
        message: `Flying to: ${vp.label}${vp.isDemo ? ' (demo view)' : ''}`,
      };
    }

    setActiveGroundViewpoint(null);

    const targetCoords = getViewpointCoordinates(listing, vp);
    const aerialRange =
      !isExact && vp.id === 'overview'
        ? Math.max(vp.range, listing.coordinates.approximateRadiusMetres * 2.5)
        : vp.range;

    if (renderMode === '3d') {
      move3DCamera(
        () => ({
          center: {
            lat: targetCoords.lat,
            lng: targetCoords.lng,
            altitude: 0,
          },
          range: aerialRange,
          tilt: vp.tilt,
          heading: vp.heading,
        }),
        true
      );
    } else if (map2DRef.current) {
      if (!isExact) {
        const bounds = circle2DRef.current?.getBounds?.();
        if (bounds) {
          map2DRef.current.fitBounds(bounds, 24);
        } else {
          map2DRef.current.setCenter(targetCoords);
          map2DRef.current.setZoom(14);
        }
      } else {
        const zoom2D = vp.id === 'overview' ? 17 : aerialRange <= 280 ? 18 : aerialRange <= 520 ? 17 : 16;
        if (typeof map2DRef.current.panTo === 'function') {
          map2DRef.current.panTo(targetCoords);
        } else {
          map2DRef.current.setCenter(targetCoords);
        }
        map2DRef.current.setZoom(zoom2D);
      }
    }

    return {
      ok: true,
      message: `Flying to: ${vp.label}${vp.isDemo ? ' (demo view)' : ''}`,
    };
  };

  const flyToViewpointRef = useRef(flyToViewpoint);
  flyToViewpointRef.current = flyToViewpoint;

  // Sequentially cycle through available viewpoints when Autoplay Cinematic Tour is active
  useEffect(() => {
    if (!isTourPlaying) return;

    if (renderMode !== '3d' || !isExact || fatalMapError || tourViewpoints.length <= 1) {
      setIsTourPlaying(false);
      return;
    }

    const safeIndex = tourStepIndex % tourViewpoints.length;
    const currentStop = tourViewpoints[safeIndex];
    flyToViewpointRef.current(currentStop.id);

    const dwellMs = prefersReducedMotion
      ? 2500
      : safeIndex === 0 && currentStop.id === 'overview'
        ? 2600
        : currentStop.cameraMode === 'ground'
          ? 4500
          : 3600;

    const timerId = setTimeout(() => {
      setTourStepIndex((prev) => (prev + 1) % tourViewpoints.length);
    }, dwellMs);

    return () => clearTimeout(timerId);
  }, [
    isTourPlaying,
    tourStepIndex,
    renderMode,
    isExact,
    fatalMapError,
    prefersReducedMotion,
    tourViewpoints.length,
  ]);

  const handleToggleTour = () => {
    setActiveTooltipId(null);
    setIsHelpOpen(false);
    if (isTourPlaying) {
      setIsTourPlaying(false);
      return;
    }
    if (renderMode !== '3d' || !isExact || tourViewpoints.length <= 1) return;
    setTourStepIndex(0);
    setIsTourPlaying(true);
  };

  const executeAllowedAction = async (
    action: AllowedMapAction
  ): Promise<{ ok: boolean; message: string }> => {
    switch (action.name) {
      case 'flyToViewpoint': {
        return flyToViewpoint(action.args.id);
      }

      case 'orbit': {
        if (renderMode !== '3d') {
          return {
            ok: false,
            message: `Rotation isn't available in 2D view. Available views: ${getAvailableViewLabels()}.`,
          };
        }
        const delta = action.args.direction === 'left' ? action.args.degrees : -action.args.degrees;
        move3DCamera(
          (cur) => ({
            ...cur,
            heading: ((cur.heading + delta) % 360 + 360) % 360,
          }),
          true
        );
        return {
          ok: true,
          message: `Moved camera ${action.args.direction} (${action.args.degrees}°)`,
        };
      }

      case 'setView': {
        if (renderMode !== '3d') {
          return {
            ok: false,
            message: `3D camera angle isn't available in 2D view. Available views: ${getAvailableViewLabels()}.`,
          };
        }
        if (action.args.mode === 'top_down') {
          handleTopDownView();
          return { ok: true, message: 'Switched to: Top-down view' };
        }
        setActiveGroundViewpoint(null);
        move3DCamera(
          (cur) => ({
            ...cur,
            range: isExact ? Math.max(cur.range, 350) : cur.range,
            tilt: listing.cameraPreset.tilt,
          }),
          true
        );
        return { ok: true, message: 'Switched to: Oblique view' };
      }

      case 'zoom': {
        if (action.args.direction === 'in') {
          handleZoomIn();
          return { ok: true, message: 'Zoomed in' };
        }
        handleZoomOut();
        return { ok: true, message: 'Zoomed out' };
      }

      case 'resetView': {
        return flyToViewpoint('overview');
      }

      case 'openStreetView': {
        if (canShowStreetView(listing) && onOpenStreetView && !streetViewUnavailable) {
          if (isNativeFullscreen) {
            await handleToggleFullscreen();
          }
          onOpenStreetView();
          return { ok: true, message: 'Opened Street View' };
        }
        return flyToViewpoint('street-approach');
      }

      case 'enterFullScreen': {
        if (!isFullscreen) {
          await handleToggleFullscreen();
        }
        return { ok: true, message: 'Entered full screen' };
      }

      case 'exitFullScreen': {
        if (isFullscreen) {
          await handleToggleFullscreen();
        }
        return { ok: true, message: 'Exited full screen' };
      }
    }
  };

  const redirectToWhatsAppButton = () => {
    setCommandFeedback({
      text: 'I can only move the map. For questions about the property or area, use WhatsApp.',
      isError: true,
      showWhatsAppCta: true,
    });
    if (!isFullscreen && typeof document !== 'undefined') {
      const mainWhatsAppBtn = document.querySelector<HTMLAnchorElement>(
        'section[aria-label="WhatsApp property enquiry"] a[href*="wa.me"]'
      );
      if (mainWhatsAppBtn) {
        mainWhatsAppBtn.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'center',
        });
        mainWhatsAppBtn.focus({ preventScroll: true });
      }
    }
  };

  const handleCommand = async (text: string, source: 'text') => {
    void source;
    const boundedText = text.slice(0, 200).trim();
    if (!boundedText || isCommandLoading) return;
    setIsTourPlaying(false);

    if (isPromptInjectionAttempt(boundedText)) {
      console.info('command_used:', 'none', 'rejected');
      setCommandFeedback({ text: 'No map action taken.', isError: false });
      return;
    }

    const deterministicMatch = parseDeterministicCommand(boundedText, listing.viewpoints);
    if (deterministicMatch) {
      const outcome = await executeAllowedAction(deterministicMatch);
      console.info('command_used:', deterministicMatch.name, outcome.ok ? 'ok' : 'refused');
      setCommandFeedback({ text: outcome.message, isError: !outcome.ok });
      return;
    }

    if (isPropertyOrAreaQuestion(boundedText)) {
      console.info('command_used:', 'none', 'rejected');
      redirectToWhatsAppButton();
      return;
    }

    setIsCommandLoading(true);
    try {
      const res = await fetch('/api/gemini/map-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: boundedText,
          viewpoints: listing.viewpoints.map((vp) => ({ id: vp.id, label: vp.label })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.action) {
        console.info('command_used:', 'none', 'rejected');
        if (res.status === 429 && typeof data?.error === 'string') {
          setCommandFeedback({ text: data.error, isError: true });
        } else {
          redirectToWhatsAppButton();
        }
        return;
      }

      const outcome = await executeAllowedAction(data.action as AllowedMapAction);
      console.info('command_used:', data.action.name, outcome.ok ? 'ok' : 'refused');
      setCommandFeedback({ text: outcome.message, isError: !outcome.ok });
    } catch {
      console.info('command_used:', 'error', 'rejected');
      redirectToWhatsAppButton();
    } finally {
      setIsCommandLoading(false);
    }
  };

  const askWhatsAppUrl = buildWhatsAppUrl(listing, 'ask');

  return (
    <div
      ref={wrapperRef}
      className={
        isFallbackFullscreen
          ? 'fixed inset-0 z-50 flex flex-col w-screen h-dvh bg-[#EAE5DA] overflow-hidden'
          : 'flex flex-col w-full h-full bg-[#EAE5DA] overflow-hidden'
      }
    >
      {/* Fallback / 3D error banner positioned strictly above map so bottom Google attribution is never obscured or clipped */}
      {fallbackNotice && !fatalMapError && (
        <div
          role="status"
          className="shrink-0 z-20 flex items-start gap-2 px-3 py-2 bg-[#FDFCF9] border-b border-[#E3DDD1] text-[#3E4641] text-xs leading-snug"
        >
          <AlertCircle className="w-4 h-4 text-[#9A7832] shrink-0 mt-0.5" aria-hidden="true" />
          <span>{fallbackNotice}</span>
        </div>
      )}

      {/* Map canvas */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        <div
          ref={mapHostRef}
          onPointerDown={() => {
            if (isTourPlaying) setIsTourPlaying(false);
          }}
          className="w-full h-full overflow-hidden"
          aria-label={
            isExact
              ? `Map showing ${listing.title} in ${listing.suburb}`
              : `Map showing approximate location in ${listing.suburb}`
          }
        />

        {/* Top overlay strip: Approximate badge + Fullscreen WhatsApp CTA + Labelled Control Bar (kept strictly away from bottom Google logos/attribution) */}
        {!fatalMapError && (
          <div className="pointer-events-none absolute top-2.5 inset-x-2.5 z-20 flex flex-wrap items-start justify-between gap-2 max-h-[calc(100%-56px)]">
            <div className="flex flex-wrap items-center gap-2 pointer-events-none">
              {!isExact && (
                <div className="pointer-events-none min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#1C221F]/90 text-[#FAF8F4] px-3 py-2 text-xs font-medium shadow-sm border border-[#C4A052]/40">
                  <MapPin className="w-3.5 h-3.5 text-[#D8B979] shrink-0" aria-hidden="true" />
                  <span>Approximate location</span>
                </div>
              )}

              {isFullscreen && (
                <a
                  href={askWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto min-h-[44px] px-3.5 py-2 rounded-xl bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-md border border-[#C4A052]/40 transition-colors whitespace-nowrap"
                >
                  <MessageCircle className="w-4 h-4 shrink-0 text-[#DFC58A]" aria-hidden="true" />
                  <span>Ask on WhatsApp</span>
                </a>
              )}
            </div>

            <div
              ref={helpContainerRef}
              className="pointer-events-none ml-auto flex flex-col items-end gap-1.5 max-w-full"
            >
              <div
                role="toolbar"
                aria-label="Map controls"
                className="pointer-events-auto flex flex-wrap items-center justify-end gap-1 rounded-xl bg-[#FDFCF9]/95 backdrop-blur-sm border border-[#DED7C9] p-1 shadow-md max-w-full"
              >
                <MapControlButton
                  id="zoom-in"
                  label="Zoom in"
                  shortLabel="Zoom in"
                  icon={<ZoomIn className="w-4 h-4" />}
                  onAction={handleZoomIn}
                  isExpanded={isBarExpanded}
                  activeTooltipId={activeTooltipId}
                  setActiveTooltipId={setActiveTooltipId}
                  tooltipAlign="left"
                />
                <MapControlButton
                  id="zoom-out"
                  label="Zoom out"
                  shortLabel="Zoom out"
                  icon={<ZoomOut className="w-4 h-4" />}
                  onAction={handleZoomOut}
                  isExpanded={isBarExpanded}
                  activeTooltipId={activeTooltipId}
                  setActiveTooltipId={setActiveTooltipId}
                />

                {renderMode === '3d' && (
                  <>
                    <MapControlButton
                      id="tilt-up"
                      label="Tilt up"
                      shortLabel="Tilt up"
                      icon={<ChevronUp className="w-4 h-4" />}
                      onAction={handleTiltUp}
                      isExpanded={isBarExpanded}
                      activeTooltipId={activeTooltipId}
                      setActiveTooltipId={setActiveTooltipId}
                    />
                    <MapControlButton
                      id="tilt-down"
                      label="Tilt down"
                      shortLabel="Tilt down"
                      icon={<ChevronDown className="w-4 h-4" />}
                      onAction={handleTiltDown}
                      isExpanded={isBarExpanded}
                      activeTooltipId={activeTooltipId}
                      setActiveTooltipId={setActiveTooltipId}
                    />
                    <MapControlButton
                      id="rotate-left"
                      label="Rotate left"
                      shortLabel="Rotate L"
                      icon={<RotateCcw className="w-4 h-4" />}
                      onAction={handleRotateLeft}
                      isExpanded={isBarExpanded}
                      activeTooltipId={activeTooltipId}
                      setActiveTooltipId={setActiveTooltipId}
                    />
                    <MapControlButton
                      id="rotate-right"
                      label="Rotate right"
                      shortLabel="Rotate R"
                      icon={<RotateCw className="w-4 h-4" />}
                      onAction={handleRotateRight}
                      isExpanded={isBarExpanded}
                      activeTooltipId={activeTooltipId}
                      setActiveTooltipId={setActiveTooltipId}
                    />
                  </>
                )}

                <MapControlButton
                  id="reset-view"
                  label="Reset view"
                  shortLabel="Reset"
                  icon={<LocateFixed className="w-4 h-4" />}
                  onAction={handleResetView}
                  isExpanded={isBarExpanded}
                  activeTooltipId={activeTooltipId}
                  setActiveTooltipId={setActiveTooltipId}
                />

                {renderMode === '3d' && (
                  <MapControlButton
                    id="top-down"
                    label="Top-down view"
                    shortLabel="Top-down"
                    icon={<ArrowDownToLine className="w-4 h-4" />}
                    onAction={handleTopDownView}
                    isExpanded={isBarExpanded}
                    activeTooltipId={activeTooltipId}
                    setActiveTooltipId={setActiveTooltipId}
                  />
                )}

                <MapControlButton
                  id="toggle-labels"
                  label={isBarExpanded ? 'Hide button labels' : 'Show button labels'}
                  shortLabel={isBarExpanded ? 'Compact' : 'Labels'}
                  icon={<Tag className="w-4 h-4" />}
                  onAction={() => setIsBarExpanded((prev) => !prev)}
                  isExpanded={isBarExpanded}
                  activeTooltipId={activeTooltipId}
                  setActiveTooltipId={setActiveTooltipId}
                  tooltipAlign="right"
                  ariaExpanded={isBarExpanded}
                  ariaPressed={isBarExpanded}
                />

                <MapControlButton
                  id="map-help"
                  label={isHelpOpen ? 'Close navigation help' : 'Navigation commands help'}
                  shortLabel="Help"
                  icon={<HelpCircle className="w-4 h-4" />}
                  onAction={() => {
                    setIsHelpOpen((prev) => !prev);
                    setActiveTooltipId(null);
                  }}
                  isExpanded={isBarExpanded}
                  activeTooltipId={activeTooltipId}
                  setActiveTooltipId={setActiveTooltipId}
                  tooltipAlign="right"
                  variant={isHelpOpen ? 'primary' : 'default'}
                  ariaExpanded={isHelpOpen}
                  ariaPressed={isHelpOpen}
                />

                {renderMode === '3d' && isExact && tourViewpoints.length > 1 && (
                  <MapControlButton
                    id="cinematic-tour"
                    label={isTourPlaying ? 'Stop cinematic tour' : 'Autoplay Cinematic Tour'}
                    shortLabel={isTourPlaying ? 'Stop tour' : 'Tour'}
                    icon={isTourPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    onAction={handleToggleTour}
                    isExpanded={isBarExpanded}
                    activeTooltipId={activeTooltipId}
                    setActiveTooltipId={setActiveTooltipId}
                    tooltipAlign="right"
                    variant={isTourPlaying ? 'primary' : 'default'}
                    alwaysShowText
                    ariaPressed={isTourPlaying}
                  />
                )}

                {activeGroundViewpoint && (
                  <MapControlButton
                    id="return-to-overview"
                    label="Return to overview"
                    shortLabel="Return to overview"
                    icon={<Compass className="w-4 h-4" />}
                    onAction={() => {
                      setIsTourPlaying(false);
                      flyToViewpoint('overview');
                    }}
                    isExpanded={isBarExpanded}
                    activeTooltipId={activeTooltipId}
                    setActiveTooltipId={setActiveTooltipId}
                    tooltipAlign="right"
                    variant="primary"
                    alwaysShowText
                  />
                )}

                <MapControlButton
                  id="fullscreen"
                  label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  shortLabel={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  icon={isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  onAction={handleToggleFullscreen}
                  isExpanded={isBarExpanded}
                  activeTooltipId={activeTooltipId}
                  setActiveTooltipId={setActiveTooltipId}
                  tooltipAlign="right"
                  variant={isFullscreen ? 'primary' : 'default'}
                  alwaysShowText
                  ariaPressed={isFullscreen}
                />
              </div>

              {isHelpOpen && (
                <div
                  role="dialog"
                  aria-label="Supported map navigation commands"
                  className={`pointer-events-auto w-[min(276px,calc(100vw-28px))] ${
                    isFullscreen
                      ? 'max-h-[min(320px,calc(100dvh-180px))]'
                      : 'max-h-[155px] sm:max-h-[220px]'
                  } overflow-y-auto rounded-xl bg-[#FDFCF9]/98 backdrop-blur-sm border border-[#DED7C9] p-3 shadow-lg text-[#1C221F]`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-xs font-semibold text-[#1C221F]">
                      Supported map commands
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsHelpOpen(false)}
                      aria-label="Close navigation help"
                      className="w-6 h-6 -mr-1 -mt-0.5 rounded-md flex items-center justify-center text-[#5A635E] hover:text-[#1C221F] hover:bg-[#EFECE3] transition-colors"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B746E] mb-1">
                        Views
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {['Front gate', 'Back garden', 'Roof', 'From the street', 'Overview'].map(
                          (cmd) => (
                            <button
                              key={cmd}
                              type="button"
                              onClick={() => {
                                setCommandInput(cmd);
                                setIsHelpOpen(false);
                                void handleCommand(cmd, 'text');
                              }}
                              className="px-2 py-1 rounded-md bg-[#F5F2EB] hover:bg-[#EAE4D7] border border-[#DED7C9] text-[11px] font-medium text-[#1C221F] transition-colors"
                            >
                              {cmd}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B746E] mb-1">
                        Camera
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {[
                          'Left side',
                          'Right side',
                          'Zoom in',
                          'Zoom out',
                          ...(renderMode === '3d' ? ['Top-down', 'Oblique'] : []),
                          'Reset',
                          isFullscreen ? 'Exit full screen' : 'Full screen',
                        ].map((cmd) => (
                          <button
                            key={cmd}
                            type="button"
                            onClick={() => {
                              setCommandInput(cmd);
                              setIsHelpOpen(false);
                              void handleCommand(cmd, 'text');
                            }}
                            className="px-2 py-1 rounded-md bg-[#F5F2EB] hover:bg-[#EAE4D7] border border-[#DED7C9] text-[11px] font-medium text-[#1C221F] transition-colors"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    </div>

                    {!isExact && (
                      <p className="text-[10px] leading-snug text-[#6B746E] pt-0.5">
                        Close-up property views require Exact location mode.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && !fatalMapError && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-[#F2EEE5]/90 text-[#1C221F]"
          >
            <Loader2 className="w-6 h-6 animate-spin text-[#163A2E]" aria-hidden="true" />
            <p className="text-sm font-medium">
              {renderMode === '3d' ? 'Loading 3D neighbourhood map…' : 'Loading 2D fallback map…'}
            </p>
          </div>
        )}

        {/* Fatal map error state (e.g. missing or invalid API key) */}
        {fatalMapError && (
          <div
            role="alert"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-[#F5F2EB] text-[#1C221F]"
          >
            <div className="max-w-sm rounded-xl bg-[#FDFCF9] border border-[#E3DDD1] p-5 shadow-sm">
              <AlertCircle className="w-6 h-6 text-[#9A7832] mx-auto mb-2.5" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[#1C221F] mb-1">
                Map could not be loaded
              </h2>
              <p className="text-xs text-[#4B544F] leading-relaxed">{fatalMapError}</p>
            </div>
          </div>
        )}
      </div>

      {/* Persistent 1-line ground viewpoint / tour status strip positioned outside map canvas so Google attribution, WhatsApp CTA, and controls are never covered */}
      {(activeGroundViewpoint || isTourPlaying) && !fatalMapError && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[#1C221F] text-[#FAF8F4] border-t border-[#C4A052]/40 text-xs font-medium"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="w-3.5 h-3.5 text-[#DFC58A] shrink-0" aria-hidden="true" />
            <span className="truncate">
              {activeGroundViewpoint
                ? `You are at: ${activeGroundViewpoint.label}${activeGroundViewpoint.isDemo ? ' (demo view)' : ''}`
                : (() => {
                    const currentStop =
                      tourViewpoints[tourStepIndex % Math.max(1, tourViewpoints.length)];
                    return currentStop
                      ? `Cinematic tour: ${currentStop.label}${currentStop.isDemo ? ' (demo view)' : ''}`
                      : 'Cinematic tour';
                  })()}
            </span>
          </div>
          {isTourPlaying && tourViewpoints.length > 0 && (
            <span className="shrink-0 text-[11px] text-[#DFC58A] tabular-nums whitespace-nowrap">
              Tour {(tourStepIndex % tourViewpoints.length) + 1}/{tourViewpoints.length}
            </span>
          )}
        </div>
      )}

      {/* Bottom command bar positioned strictly below map canvas so Google logos/attribution are never covered */}
      {!fatalMapError && (
        <div className="shrink-0 bg-[#FDFCF9] border-t border-[#E3DDD1] px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
            <span className="text-[11px] font-medium text-[#6B746E]">
              Automated map assistant
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {EXAMPLE_COMMAND_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={isCommandLoading}
                  onClick={() => {
                    setCommandInput(chip);
                    void handleCommand(chip, 'text');
                  }}
                  className="px-2 py-1 rounded-lg bg-[#F5F2EB] hover:bg-[#EAE4D7] border border-[#DED7C9] text-[11px] font-medium text-[#1C221F] transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCommand(commandInput, 'text');
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={commandInput}
              maxLength={200}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="Tell the map where to go..."
              aria-label="Tell the map where to go"
              className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#DED7C9] text-xs sm:text-sm text-[#1C221F] placeholder:text-[#6B746E] focus:outline-none focus:border-[#163A2E]"
            />
            <button
              type="submit"
              disabled={isCommandLoading || !commandInput.trim()}
              aria-label="Send map command"
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shrink-0"
            >
              {isCommandLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="w-4 h-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Go</span>
            </button>
          </form>

          {commandFeedback && (
            <div
              role="status"
              aria-live="polite"
              className="mt-1.5 flex flex-wrap items-center justify-between gap-2"
            >
              <p
                className={`text-[11px] leading-snug ${
                  commandFeedback.isError ? 'text-[#7A3E1D]' : 'text-[#163A2E] font-medium'
                }`}
              >
                {commandFeedback.text}
              </p>
              {commandFeedback.showWhatsAppCta && (
                <a
                  href={askWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-[#DFC58A]" aria-hidden="true" />
                  <span>Ask on WhatsApp</span>
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
