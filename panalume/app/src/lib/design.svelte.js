// Shared design language for the dashboard: person hues, status colours, the
// time-of-day palette, weather tints, and the motion helpers (count-up numbers,
// reduced-motion). Cards import from here so colour and timing stay consistent
// across the whole board rather than being re-invented per card.

/** Per-person hues (item 21). Charlie teal, Phoenix amber, House violet. */
export const PERSON_HUES = {
  charlie: '#14b8a6',
  phoenix: '#f59e0b',
  house: '#8b5cf6',
  kyle: '#38bdf8',
  alicia: '#f472b6',
  ali: '#f472b6',
};

const HUE_RING = ['#14b8a6', '#f59e0b', '#8b5cf6', '#38bdf8', '#f472b6', '#a3e635'];

/** A stable colour for a person's name; unknown names hash onto the ring. */
export function hueFor(name, fallback = 'var(--accent)') {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return fallback;
  if (PERSON_HUES[key]) return PERSON_HUES[key];
  const first = key.split(/\s+/)[0];
  if (PERSON_HUES[first]) return PERSON_HUES[first];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return HUE_RING[h % HUE_RING.length];
}

/** A soft tint of a person's hue, for a chip or a column background. */
export function hueWash(name, alpha = 0.16) {
  const c = hueFor(name, '#7aa2ff');
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return `color-mix(in srgb, ${c} ${Math.round(alpha * 100)}%, transparent)`;
}

/**
 * Status colours (item 25: colour-blind pass). Good is BLUE, not green — with
 * deuteranopia a green tick and a red alarm are the same dull brown, while blue
 * against red/amber stays legible. Green is kept only for decorative accents.
 */
export const STATUS = {
  good: '#3b82f6',
  warn: '#f59e0b',
  bad: '#f43f5e',
  idle: 'rgba(255,255,255,.32)',
};

/** Pick a status colour from a fraction (0 = bad, 1 = good) with two thresholds. */
export function byFraction(frac, low = 0.2, high = 0.6) {
  if (!Number.isFinite(frac)) return STATUS.idle;
  if (frac <= low) return STATUS.bad;
  if (frac < high) return STATUS.warn;
  return STATUS.good;
}

// ---- time of day (item 3: dawn amber → day cyan → dusk violet → night indigo) ----
export const PERIODS = {
  dawn: { label: 'Dawn', a: '#f59e0b', b: '#c2703f', c: '#7c5cff', wash: 'rgba(245,158,11,.30)' },
  day: { label: 'Day', a: '#06b6d4', b: '#2563eb', c: '#22d3ee', wash: 'rgba(6,182,212,.24)' },
  dusk: { label: 'Dusk', a: '#8b5cf6', b: '#db2777', c: '#f59e0b', wash: 'rgba(139,92,246,.30)' },
  night: { label: 'Night', a: '#3b3fbf', b: '#1e1b4b', c: '#0ea5e9', wash: 'rgba(49,46,129,.42)' },
};

/** dawn 05–08, day 08–17, dusk 17–21, night 21–05. */
export function periodOf(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'dusk';
  return 'night';
}

// ---- weather (item 4: rain cool, snow soft white, clear warm) ----
const WX_GROUPS = [
  { kind: 'snow', tint: '#e8f1ff', alpha: 0.16, states: ['snowy', 'snowy-rainy', 'sleet'] },
  { kind: 'rain', tint: '#5ec8f5', alpha: 0.14, states: ['rainy', 'pouring', 'lightning', 'lightning-rainy', 'hail', 'exceptional'] },
  { kind: 'fog', tint: '#94a3b8', alpha: 0.12, states: ['fog'] },
  { kind: 'clear', tint: '#fbbf24', alpha: 0.13, states: ['sunny', 'clear', 'clear-night', 'windy', 'windy-variant'] },
  { kind: 'cloud', tint: '#8fa3c8', alpha: 0.08, states: ['partlycloudy', 'cloudy'] },
];

/** The tint a weather state paints over the ground. */
export function weatherLook(state) {
  const s = String(state || '').toLowerCase();
  for (const g of WX_GROUPS) if (g.states.includes(s)) return g;
  return { kind: 'cloud', tint: '#8fa3c8', alpha: 0.06 };
}

/** An mdi icon for a condition, day or night (item 35). */
export function weatherIcon(state, isNight = false) {
  const s = String(state || '').toLowerCase();
  if (s === 'sunny' || (s === 'clear' && !isNight)) return 'mdi:weather-sunny';
  if (s === 'clear' || s === 'clear-night') return 'mdi:weather-night';
  if (s === 'partlycloudy') return isNight ? 'mdi:weather-night-partly-cloudy' : 'mdi:weather-partly-cloudy';
  if (s === 'cloudy') return 'mdi:weather-cloudy';
  if (s === 'rainy') return 'mdi:weather-rainy';
  if (s === 'pouring') return 'mdi:weather-pouring';
  if (s === 'lightning') return 'mdi:weather-lightning';
  if (s === 'lightning-rainy') return 'mdi:weather-lightning-rainy';
  if (s === 'snowy') return 'mdi:weather-snowy';
  if (s === 'snowy-rainy') return 'mdi:weather-snowy-rainy';
  if (s === 'fog') return 'mdi:weather-fog';
  if (s === 'windy' || s === 'windy-variant') return 'mdi:weather-windy';
  if (s === 'hail') return 'mdi:weather-hail';
  return 'mdi:weather-cloudy';
}

// ---- motion ----
/** Item 56: page transition, 57: number count-up, 58: gauge sweep, 59: popup spring. */
export const MOTION = { fast: 120, base: 180, slow: 600, count: 700 };

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts up to its target instead of snapping (item 57).
 * Call it during component init, then read the returned function in the markup.
 */
export function countUp(get, { duration = MOTION.count } = {}) {
  const shown = $state({ v: 0 });
  let cur = 0;
  let raf = 0;
  $effect(() => {
    const target = Number(get());
    if (!Number.isFinite(target)) return;
    if (reducedMotion()) { cur = target; shown.v = target; return; }
    const from = cur;
    const t0 = performance.now();
    cancelAnimationFrame(raf);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      cur = from + (target - from) * eased;
      shown.v = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  $effect(() => () => cancelAnimationFrame(raf));
  return () => shown.v;
}

/** A 0..1 progress value that eases to its target — for rings and bars. */
export function easeTo(get, { duration = 700 } = {}) {
  const shown = $state({ v: 0 });
  let cur = 0;
  let raf = 0;
  $effect(() => {
    const target = Math.max(0, Math.min(1, Number(get()) || 0));
    if (reducedMotion()) { cur = target; shown.v = target; return; }
    const from = cur;
    const t0 = performance.now();
    cancelAnimationFrame(raf);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      cur = from + (target - from) * (1 - Math.pow(1 - k, 3));
      shown.v = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  $effect(() => () => cancelAnimationFrame(raf));
  return () => shown.v;
}

/** Clamp, and a safe number from a possibly-templated setting. */
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const num = (v, fallback = NaN) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** mm:ss from seconds. */
export function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
