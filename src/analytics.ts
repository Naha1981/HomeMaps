export type HomeAiEvent =
  | 'listing_page_view'
  | 'map_ready'
  | 'map_interaction'
  | 'zoom_in'
  | 'zoom_out'
  | 'rotate_left'
  | 'rotate_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'top_down_view'
  | 'reset_view'
  | 'full_screen_enter'
  | 'full_screen_exit'
  | 'fly_to_viewpoint'
  | 'command_used'
  | 'street_view_open'
  | 'street_view_no_coverage'
  | 'street_view_close'
  | 'place_category_selected'
  | 'place_selected'
  | 'tour_started'
  | 'whatsapp_cta_click'
  | 'viewing_cta_click';

export type EventProps = {
  viewpointId?: string;
  cameraMode?: 'ground' | 'aerial';
  action?: string;
  outcome?: 'ok' | 'rejected' | 'refused';
  button?: 'ask' | 'viewing';
  category?: string;
  placeId?: string;
  reason?: string;
};

export interface TrackedEvent extends EventProps {
  ts: number;
  sid: string;
  event: HomeAiEvent;
}

const SESSION_STORAGE_KEY = 'homeai_sid';

const ALLOWED_PROP_KEYS: ReadonlyArray<keyof EventProps> = [
  'viewpointId',
  'cameraMode',
  'action',
  'outcome',
  'button',
  'category',
  'placeId',
  'reason',
];

export type AnalyticsListener = () => void;

let memorySid: string | null = null;
const events: TrackedEvent[] = [];
const listeners = new Set<AnalyticsListener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Isolate listener errors so analytics emitter stays safe
    }
  }
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateSessionId(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (existing && existing.trim() !== '') {
        memorySid = existing;
        return existing;
      }
      const nextSid = createSessionId();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSid);
      memorySid = nextSid;
      return nextSid;
    } catch {
      // Fallback to in-memory sid if sessionStorage is unavailable
    }
  }
  if (!memorySid) {
    memorySid = createSessionId();
  }
  return memorySid;
}

function sanitizeProps(props?: EventProps): EventProps {
  if (!props || typeof props !== 'object') {
    return {};
  }
  const clean: EventProps = {};
  for (const key of ALLOWED_PROP_KEYS) {
    const value = (props as Record<string, unknown>)[key];
    if (value !== undefined) {
      (clean as Record<string, unknown>)[key] = value;
    }
  }
  return clean;
}

export function track(event: HomeAiEvent, props?: EventProps): void {
  const sid = getOrCreateSessionId();
  const cleanProps = sanitizeProps(props);
  const record: TrackedEvent = {
    ts: Date.now(),
    sid,
    event,
    ...cleanProps,
  };

  events.push(record);
  console.log('[HomeAI event]', record);
  notifyListeners();
}

export function getEvents(): ReadonlyArray<TrackedEvent> {
  return events.slice();
}

export function subscribe(listener: AnalyticsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSession(): void {
  events.length = 0;
  const nextSid = createSessionId();
  memorySid = nextSid;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSid);
    } catch {
      // ignore sessionStorage write errors
    }
  }
  notifyListeners();
}
