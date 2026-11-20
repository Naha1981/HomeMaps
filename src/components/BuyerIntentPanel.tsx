import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { getEvents, resetSession, subscribe } from '../analytics';
import { IntentResult, IntentTier, computeIntent } from '../intentScore';

const TIER_STYLES: Record<
  IntentTier,
  {
    label: string;
    badgeClass: string;
    barClass: string;
  }
> = {
  cold: {
    label: 'Cold',
    badgeClass: 'bg-[#E6EAE7] text-[#3E4641] border-[#C5CCC7]',
    barClass: 'bg-[#7A847E]',
  },
  warm: {
    label: 'Warm',
    badgeClass: 'bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]',
    barClass: 'bg-[#D97706]',
  },
  hot: {
    label: 'Hot',
    badgeClass: 'bg-[#FBF0D1] text-[#6B4E0C] border-[#C4A052]',
    barClass: 'bg-[#C4A052]',
  },
};

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function BuyerIntentPanel() {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [intent, setIntent] = useState<IntentResult>(() => computeIntent(getEvents()));
  const prevTierRef = useRef<IntentTier>(intent.tier);

  useEffect(() => {
    const recompute = () => {
      setIntent(computeIntent(getEvents()));
    };

    recompute();
    const unsubscribe = subscribe(recompute);
    const intervalId = window.setInterval(recompute, 15000);

    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (intent.eventCount === 0) {
      prevTierRef.current = intent.tier;
      return;
    }
    if (intent.tier !== prevTierRef.current) {
      const events = getEvents();
      const sid = events[events.length - 1]?.sid || '';
      console.log('[HomeAI intent]', {
        sid,
        from: prevTierRef.current,
        to: intent.tier,
        score: intent.score,
        rawPoints: intent.rawPoints,
      });
      prevTierRef.current = intent.tier;
    }
  }, [intent]);

  const handleReset = () => {
    prevTierRef.current = 'cold';
    resetSession();
    setIntent(computeIntent(getEvents()));
  };

  const tierStyle = TIER_STYLES[intent.tier];

  return (
    <section
      aria-label="Buyer intent (demo) — agent view"
      className="bg-[#F2EFE7] border border-dashed border-[#C7BFA9] rounded-2xl overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full min-h-[44px] px-4 py-2.5 flex items-center justify-between gap-2 text-left text-xs font-semibold text-[#3E4641] hover:text-[#1C221F] transition-colors"
      >
        <span className="truncate">Buyer intent (demo) &mdash; agent view</span>
        <span className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tierStyle.badgeClass}`}
          >
            {tierStyle.label} &middot; {intent.score}/100
          </span>
          {isOpen ? (
            <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-3 pt-3 border-t border-[#E1DACB] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm sm:text-base font-bold uppercase tracking-wider ${tierStyle.badgeClass}`}
              >
                {tierStyle.label}
              </span>
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-bold text-[#1C221F] tabular-nums leading-tight">
                  {intent.score}
                  <span className="text-xs font-medium text-[#6B746E]"> / 100</span>
                </div>
                <div className="text-[11px] text-[#6B746E] tabular-nums">
                  {intent.rawPoints} raw pts
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#FDFCF9] hover:bg-[#EAE5DA] active:bg-[#E1DACB] border border-[#C9C1B2] text-xs font-medium text-[#1C221F] inline-flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Reset session</span>
            </button>
          </div>

          <div
            role="progressbar"
            aria-label="Normalised buyer intent score"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={intent.score}
            className="w-full h-1.5 rounded-full bg-[#E1DACB] overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${tierStyle.barClass}`}
              style={{ width: `${intent.score}%` }}
            />
          </div>

          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#4B544F] mb-1.5">
              Signals
            </h3>
            {intent.signals.length > 0 ? (
              <ul className="space-y-1">
                {intent.signals.map((signal) => (
                  <li
                    key={signal.label}
                    className="text-xs text-[#1C221F] bg-[#FDFCF9] border border-[#E3DDD1] rounded-lg px-2.5 py-1.5"
                  >
                    {signal.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#6B746E]">No signals recorded yet.</p>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pt-2 border-t border-[#E1DACB] text-xs">
            <div>
              <div className="text-[11px] text-[#6B746E]">Events</div>
              <div className="font-semibold text-[#1C221F] tabular-nums">
                {intent.eventCount}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#6B746E]">Time on page</div>
              <div className="font-semibold text-[#1C221F] tabular-nums">
                {formatDuration(intent.timeOnPageSeconds)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#6B746E]">Sessions</div>
              <div className="font-semibold text-[#1C221F]">
                1 (this browser only)
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="px-4 py-2 border-t border-[#E1DACB] bg-[#EAE5DA]/60 text-[11px] text-[#4B544F] leading-snug">
        Prototype rule-based scoring. Client-side only, no PII, session-scoped.
        Real tiers require server-side aggregation across visitors and a POPIA and
        consent review before the pilot. Not &apos;AI&apos;.
      </p>
    </section>
  );
}
