/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Bath, BedDouble, ChevronDown, ChevronUp, Compass, Loader2, Maximize2, MessageCircle } from 'lucide-react';
import {
  LocationPrecision,
  PropertyListing,
  SAMPLE_LISTINGS,
  buildWhatsAppUrl,
  canShowStreetView,
} from './listingData';
import { track } from './analytics';
import { getGoogleMapsApiKey } from './utils';
import { BuyerIntentPanel } from './components/BuyerIntentPanel';
import { PropertyLocationMap } from './components/PropertyLocationMap';

const StreetViewPanel = lazy(() => import('./components/StreetViewPanel'));

const PRECISION_OPTIONS: Array<{ value: LocationPrecision; label: string }> = [
  { value: 'exact', label: 'Exact' },
  { value: 'approximate', label: 'Approximate' },
  { value: 'area', label: 'Area' },
];

export default function App() {
  const [apiKey, setApiKey] = useState<string>(getGoogleMapsApiKey);
  const [configResolved, setConfigResolved] = useState<boolean>(() => Boolean(getGoogleMapsApiKey()));
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [listing, setListing] = useState<PropertyListing>(SAMPLE_LISTINGS[0]);
  const [isDemoControlsOpen, setIsDemoControlsOpen] = useState<boolean>(false);
  const [vibeText, setVibeText] = useState<string | null>(null);
  const [vibeLoading, setVibeLoading] = useState<boolean>(true);
  const [vibeError, setVibeError] = useState<string | null>(null);
  const [threeDFailureReason, setThreeDFailureReason] = useState<string | null>(null);
  const [isStreetViewOpen, setIsStreetViewOpen] = useState<boolean>(false);
  const [streetViewDisabledNotice, setStreetViewDisabledNotice] = useState<string | null>(null);

  const streetViewAllowed = canShowStreetView(listing);
  const hasTrackedPageViewRef = useRef(false);

  useEffect(() => {
    if (hasTrackedPageViewRef.current) return;
    hasTrackedPageViewRef.current = true;
    track('listing_page_view');
  }, []);

  useEffect(() => {
    if (!streetViewAllowed) {
      setIsStreetViewOpen((wasOpen) => {
        if (wasOpen && typeof track === 'function') {
          track('street_view_close');
        }
        return false;
      });
    }
  }, [streetViewAllowed]);

  useEffect(() => {
    if (quotaExceeded) {
      setStreetViewDisabledNotice('Street View is unavailable because map quota was exceeded.');
    }
  }, [quotaExceeded]);

  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (
          data?.googleMapsApiKey &&
          typeof data.googleMapsApiKey === 'string' &&
          data.googleMapsApiKey.trim() !== ''
        ) {
          const key = data.googleMapsApiKey.trim();
          setApiKey(key);
          if (typeof window !== 'undefined') {
            (window as any).__GOOGLE_MAPS_API_KEY__ = key;
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setConfigResolved(true);
      });
  }, []);

  const fetchNeighborhoodVibe = useCallback(
    async (signal?: AbortSignal) => {
      setVibeLoading(true);
      setVibeError(null);

      try {
        const res = await fetch('/api/gemini/neighborhood-vibe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            suburb: listing.suburb,
            city: listing.city,
          }),
          signal,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === 'string' && data.error
              ? data.error
              : 'Unable to load neighborhood overview.'
          );
        }

        if (typeof data?.description !== 'string' || !data.description.trim()) {
          throw new Error('No neighborhood description was returned.');
        }

        setVibeText(data.description.trim());
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setVibeError(err?.message || 'Unable to load neighborhood overview.');
      } finally {
        if (!signal?.aborted) {
          setVibeLoading(false);
        }
      }
    },
    [listing.suburb, listing.city]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchNeighborhoodVibe(controller.signal);
    return () => controller.abort();
  }, [fetchNeighborhoodVibe]);

  const askWhatsAppUrl = buildWhatsAppUrl(listing, 'ask');
  const viewingWhatsAppUrl = buildWhatsAppUrl(listing, 'viewing');

  const handlePrecisionChange = (precision: LocationPrecision) => {
    setListing((prev) => ({
      ...prev,
      publicLocationPrecision: precision,
    }));
  };

  return (
    <div className="min-h-screen bg-[#F5F2EB] text-[#1C221F] font-sans antialiased">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}
      <main className="max-w-2xl mx-auto px-3 py-3 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* 1. WhatsApp Enquiry Block — Directly above the property card and map */}
          <section
            aria-label="WhatsApp property enquiry"
            className="bg-[#FDFCF9] border border-[#E3DDD1] rounded-2xl p-3 sm:p-5"
          >
            <p className="text-[11px] font-medium tracking-[0.06em] text-[#4B544F] truncate mb-2">
              HOMEAI MAPS &nbsp;·&nbsp; {listing.title} &nbsp;·&nbsp; {listing.suburb}
            </p>

            <a
              href={askWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('whatsapp_cta_click', { button: 'ask' })}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#163A2E] hover:bg-[#102B22] active:bg-[#0B2019] text-[#FFFFFF] font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4 shrink-0 text-[#DFC58A]" aria-hidden="true" />
              <span>Ask about this property on WhatsApp</span>
            </a>

            <p className="text-xs text-[#4B544F] text-center my-1.5">
              Ask a question or request a viewing.
            </p>

            <a
              href={viewingWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                track('whatsapp_cta_click', { button: 'viewing' });
                track('viewing_cta_click');
              }}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#FAF8F4] hover:bg-[#EFECE3] text-[#1C221F] border border-[#C9C1B2] font-medium text-sm flex items-center justify-center transition-colors whitespace-nowrap"
            >
              Request a viewing
            </a>
          </section>

          {/* 2. Compact Property Card (rendered once) */}
          <section
            aria-label="Property summary"
            className="bg-[#FDFCF9] border border-[#E3DDD1] rounded-2xl p-3.5 sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-semibold text-[#1C221F] leading-snug">
                  {listing.title}
                </h1>
                <p className="text-xs sm:text-sm text-[#4B544F] mt-0.5">
                  {listing.suburb} &middot; {listing.city} &middot; Ref{' '}
                  <span className="font-mono text-xs">{listing.reference}</span>
                </p>
              </div>
              {listing.isDemo && (
                <span className="shrink-0 inline-block rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide bg-[#F5EFE0] text-[#73561C] border border-[#DEC99A] whitespace-nowrap">
                  DEMO DATA
                </span>
              )}
            </div>

            <div className="mt-3 pt-2.5 border-t border-[#ECE7DC] flex items-baseline justify-between gap-3">
              <span className="text-base sm:text-lg font-bold text-[#163A2E] tabular-nums">
                {listing.priceDisplay}
              </span>
              <span className="text-xs text-[#6B746E] truncate">
                {listing.agent.displayName}
              </span>
            </div>

            <div className="mt-3 pt-3 border-t border-[#ECE7DC]">
              <h2 className="text-xs font-semibold text-[#4B544F] mb-2">Features</h2>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-1.5 rounded-lg bg-[#F5F2EB] border border-[#E3DDD1] px-2.5 py-2 min-w-0">
                  <BedDouble className="w-3.5 h-3.5 shrink-0 text-[#163A2E]" aria-hidden="true" />
                  <span className="text-xs font-medium text-[#1C221F] tabular-nums truncate">
                    {listing.features.bedrooms} {listing.features.bedrooms === 1 ? 'Bed' : 'Beds'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-[#F5F2EB] border border-[#E3DDD1] px-2.5 py-2 min-w-0">
                  <Bath className="w-3.5 h-3.5 shrink-0 text-[#163A2E]" aria-hidden="true" />
                  <span className="text-xs font-medium text-[#1C221F] tabular-nums truncate">
                    {listing.features.bathrooms} {listing.features.bathrooms === 1 ? 'Bath' : 'Baths'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-[#F5F2EB] border border-[#E3DDD1] px-2.5 py-2 min-w-0">
                  <Maximize2 className="w-3.5 h-3.5 shrink-0 text-[#163A2E]" aria-hidden="true" />
                  <span className="text-xs font-medium text-[#1C221F] tabular-nums truncate">
                    {listing.features.floorSizeSqm} m&sup2;
                  </span>
                </div>
              </div>
            </div>

            {!vibeLoading && !vibeError && vibeText && (
              <div className="mt-3 pt-3 border-t border-[#ECE7DC]">
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <h2 className="text-xs font-semibold text-[#4B544F]">Neighborhood Vibe</h2>
                  <span className="text-[11px] text-[#6B746E]">Public area info</span>
                </div>
                <p className="text-xs sm:text-[13px] text-[#3E4641] leading-relaxed">
                  {vibeText}
                </p>
              </div>
            )}

            {streetViewAllowed && (
              <div className="mt-3 pt-3 border-t border-[#ECE7DC]">
                <button
                  type="button"
                  disabled={Boolean(quotaExceeded || streetViewDisabledNotice)}
                  onClick={() => {
                    if (!canShowStreetView(listing)) return;
                    setIsStreetViewOpen(true);
                  }}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#FAF8F4] hover:bg-[#EFECE3] active:bg-[#E5DFD2] disabled:opacity-50 disabled:cursor-not-allowed text-[#163A2E] border border-[#C4A052]/70 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Compass className="w-4 h-4 shrink-0 text-[#9A7832]" aria-hidden="true" />
                  <span>Street View</span>
                </button>
                {streetViewDisabledNotice && (
                  <p role="status" className="mt-1.5 text-xs text-[#7A3E1D] leading-snug">
                    {streetViewDisabledNotice}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 3. Photorealistic 3D Map (fixed height: 60vh, min 320px, never grows with content) */}
          <section
            aria-label="Property location map"
            className="relative w-full h-[60vh] min-h-[320px] max-h-[max(320px,60vh)] shrink-0 rounded-2xl overflow-hidden border border-[#DED7C9] bg-[#EAE5DA]"
          >
            <PropertyLocationMap
              listing={listing}
              apiKey={apiKey}
              configResolved={configResolved}
              quotaExceeded={quotaExceeded}
              on3DFailure={setThreeDFailureReason}
              onOpenStreetView={() => {
                if (canShowStreetView(listing)) {
                  setIsStreetViewOpen(true);
                }
              }}
              streetViewUnavailable={Boolean(quotaExceeded || streetViewDisabledNotice)}
            />
          </section>

          {/* 4. Collapsible Demo Controls */}
          <section
            aria-label="Demo controls"
            className="bg-[#FAF7F0] border border-[#E3DDD1] rounded-2xl overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setIsDemoControlsOpen((prev) => !prev)}
              aria-expanded={isDemoControlsOpen}
              className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-medium text-[#4B544F] hover:text-[#1C221F] transition-colors"
            >
              <span>Demo controls (remove before pilot)</span>
              {isDemoControlsOpen ? (
                <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
            </button>

            {isDemoControlsOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[#E9E3D7]">
                <p className="text-xs font-medium text-[#1C221F] mb-2">
                  Public location precision
                </p>
                <div
                  role="group"
                  aria-label="Public location precision"
                  className="grid grid-cols-3 gap-1.5 p-1 bg-[#ECE7DC] rounded-xl"
                >
                  {PRECISION_OPTIONS.map((option) => {
                    const active = listing.publicLocationPrecision === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handlePrecisionChange(option.value)}
                        aria-pressed={active}
                        className={`min-h-[44px] px-2 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-[#163A2E] text-[#FFFFFF] shadow-sm'
                            : 'text-[#3E4641] hover:bg-[#FDFCF9]/70'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2.5 text-xs text-[#6B746E] leading-relaxed">
                  {listing.publicLocationPrecision === 'exact'
                    ? 'Exact mode: displays the property marker at public coordinates.'
                    : `Privacy mode (${listing.publicLocationPrecision}): shows a ${listing.coordinates.approximateRadiusMetres} m approximate-area circle with no exact pin.`}
                </p>
                {threeDFailureReason && (
                  <p className="mt-2 pt-2 border-t border-[#E9E3D7] text-[11px] font-mono text-[#7A3E1D] break-words leading-snug">
                    Map diagnostic: {threeDFailureReason}
                  </p>
                )}
                {vibeError && (
                  <p className="mt-2 pt-2 border-t border-[#E9E3D7] text-[11px] font-mono text-[#7A3E1D] break-words leading-snug">
                    Neighborhood Vibe diagnostic: {vibeError}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 5. Buyer Intent Demo Agent Panel (gated strictly on listing.isDemo === true) */}
          {listing.isDemo === true && <BuyerIntentPanel />}
        </div>
      </main>

      {streetViewAllowed && isStreetViewOpen && (
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-2.5 bg-[#F2EEE5]/95 text-[#1C221F] md:inset-y-0 md:right-0 md:left-auto md:w-[480px] lg:w-[540px] md:border-l md:border-[#DED7C9] md:shadow-2xl"
            >
              <Loader2 className="w-6 h-6 animate-spin text-[#163A2E]" aria-hidden="true" />
              <p className="text-sm font-medium">Loading Street View…</p>
            </div>
          }
        >
          <StreetViewPanel
            listing={listing}
            apiKey={apiKey}
            quotaExceeded={quotaExceeded}
            onClose={() => setIsStreetViewOpen(false)}
            onDisableStreetView={(_reason, message) => {
              setStreetViewDisabledNotice(message);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
