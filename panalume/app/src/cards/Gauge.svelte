<script module>
  export const meta = {
    type: 'gauge', name: 'Gauge', icon: 'mdi:gauge', category: 'Info',
    size: { w: 200, h: 180 }, tap: 'more-info',
    defaults: { entity: '', min: 0, max: 100, trend_hours: 24 },
    fields: [
      { key: 'entity', label: 'Entity', type: 'entity' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'value', label: 'Value (override/template)', type: 'text' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'min', label: 'Min', type: 'text' },
      { key: 'max', label: 'Max', type: 'text' },
      { key: 'green', label: 'Green from', type: 'text' },
      { key: 'yellow', label: 'Yellow from', type: 'text' },
      { key: 'red', label: 'Red from', type: 'text' },
      { key: 'color', label: 'Colour (fixed/template)', type: 'color' },
      { key: 'band_min', label: 'Target band from', type: 'text', hint: 'A pale band on the ring showing the healthy range, e.g. 40. Leave both band fields empty for none.' },
      { key: 'band_max', label: 'Target band to', type: 'text' },
      { key: 'trend', label: 'Show the last-24h trend', type: 'bool' },
      { key: 'trend_hours', label: 'Trend hours', type: 'text' },
    ],
  };
</script>

<script>
  import { t, ent } from '../lib/tpl.js';
  import { name, formatNumber } from '../lib/entity.js';
  import { useHistory } from '../lib/history.svelte.js';
  import { STATUS, countUp } from '../lib/design.svelte.js';

  let { props } = $props();
  const e = $derived(ent(props.entity));
  const v = $derived(Number(props.value ? t(props.value) : e?.state));
  const min = $derived(Number(t(props.min)) || 0);
  const max = $derived(Number(t(props.max)) || 100);
  const span = $derived(max - min || 1);
  const frac = $derived(Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, (v - min) / span)));
  const pct = (x) => Math.min(1, Math.max(0, (x - min) / span));

  const num = (k) => (props[k] === '' || props[k] == null ? null : Number(t(props[k])));
  // Colour-blind pass (item 25): good is BLUE. Green against red is the one pair
  // a deuteranope cannot separate, and a gauge is exactly where that matters.
  const color = $derived.by(() => {
    if (props.color) return t(props.color);
    const r = num('red'), y = num('yellow');
    if (r != null && v >= r) return STATUS.bad;
    if (y != null && v >= y) return STATUS.warn;
    return STATUS.good;
  });

  // Target band (item 28): a pale arc from band_min to band_max.
  const band = $derived.by(() => {
    const lo = num('band_min'), hi = num('band_max');
    if (lo == null && hi == null) return null;
    const a = pct(lo ?? min), b = pct(hi ?? max);
    return { from: Math.min(a, b), to: Math.max(a, b) };
  });

  // 24h trend (item 27).
  const series = useHistory(() => (props.entity && props.trend !== false ? [String(t(props.entity)).trim()] : []), () => Number(t(props.trend_hours)) || 24);
  const id = $derived(String(t(props.entity) || '').trim());
  const pts = $derived((series.series[id] || []).slice(-96));
  const trend = $derived.by(() => {
    if (props.trend === false || pts.length < 3) return null;
    const vals = pts.map((p) => p[1]).filter((n) => Number.isFinite(n));
    if (vals.length < 3) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < span * 0.02) { const m = (hi + lo) / 2; lo = m - span * 0.01; hi = m + span * 0.01; }
    const n = vals.length;
    const path = vals.map((val, i) => `${(i / (n - 1)) * 100},${28 - ((val - lo) / (hi - lo)) * 26}`).join(' ');
    return { path, up: vals[n - 1] >= vals[0] };
  });

  // Item 57: the number counts up rather than snapping.
  const shown = countUp(() => (Number.isNaN(v) ? NaN : v));
  const digits = $derived(props.digits === '' || props.digits == null ? undefined : Number(props.digits));
  const display = $derived(Number.isNaN(shown()) ? '—' : formatNumber(shown(), digits));

  // Arc geometry: a 240° sweep so the ring reads as a dial, not a C.
  const R = 40, CX = 50, CY = 50;
  const START = 150, SWEEP = 240;
  const polar = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
  };
  const arc = (from, to, r = R) => {
    const a0 = START + SWEEP * from, a1 = START + SWEEP * to;
    const rad = (d) => (d * Math.PI) / 180;
    const p0 = [CX + r * Math.cos(rad(a0)), CY + r * Math.sin(rad(a0))];
    const p1 = [CX + r * Math.cos(rad(a1)), CY + r * Math.sin(rad(a1))];
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M${p0[0].toFixed(2)},${p0[1].toFixed(2)} A${r},${r} 0 ${large} 1 ${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
  };
  const TICKS = Array.from({ length: 11 }, (_, i) => {
    const a = (START + (SWEEP * i) / 10) * (Math.PI / 180);
    const r0 = 34.5, r1 = i % 5 === 0 ? 30.5 : 32;
    return { x1: CX + r0 * Math.cos(a), y1: CY + r0 * Math.sin(a), x2: CX + r1 * Math.cos(a), y2: CY + r1 * Math.sin(a), major: i % 5 === 0 };
  });
</script>

<div class="gauge" class:trend={!!trend}>
  <svg viewBox="0 0 100 74" class="dial">
    <!-- target band (item 28) -->
    {#if band}
      <path d={arc(band.from, band.to)} fill="none" stroke="rgba(255,255,255,.16)" stroke-width="11" stroke-linecap="butt" />
    {/if}
    <!-- tick marks -->
    {#each TICKS as k, i}
      <line x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} stroke="rgba(255,255,255,{k.major ? .34 : .16})" stroke-width={k.major ? 1.4 : 1} stroke-linecap="round" />
    {/each}
    <!-- track + value (item 58: the sweep is a CSS dashoffset transition) -->
    <path d={arc(0, 1)} fill="none" stroke="rgba(255,255,255,.09)" stroke-width="7" stroke-linecap="round" />
    <path d={arc(0, 1)} fill="none" stroke-width="7" stroke-linecap="round" class="fill"
      style="stroke:{color};--p:{frac}" pathLength="100" stroke-dasharray="100" stroke-dashoffset={100 - frac * 100} />
  </svg>
  <div class="val num grad-num" style="--grad-a:#fff;--grad-b:{color}">{display}<small>{t(props.unit) || e?.attributes.unit_of_measurement || ''}</small></div>
  <div class="name">{t(props.name) || name(e)}</div>
  {#if trend}
    <svg viewBox="0 0 100 30" class="trendline" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={trend.path} fill="none" stroke={color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity=".75" />
    </svg>
  {/if}
  {#if !e && !props.value}<div class="empty microcaps">Pick a sensor</div>{/if}
</div>

<style>
  .gauge {
    position: relative; height: 100%; container-type: size;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  .dial { width: 100%; flex: 1 1 auto; min-height: 0; max-height: 82cqh; overflow: visible; }
  .fill { transition: stroke-dashoffset 600ms cubic-bezier(.2,.8,.25,1), stroke 300ms linear; }
  .val {
    position: absolute; left: 0; right: 0; top: 34%;
    display: flex; align-items: baseline; justify-content: center; gap: 2px;
    font-size: min(2.1em, 30cqh); font-weight: 700; letter-spacing: -.02em; line-height: 1;
    pointer-events: none;
  }
  .trend .val { top: 26%; font-size: min(1.9em, 26cqh); }
  small { font-size: .42em; font-weight: 600; opacity: .8; margin-left: 1px; -webkit-text-fill-color: currentColor; color: var(--muted); }
  .name { color: var(--muted); font-size: .86em; margin-top: 2px; text-align: center; max-width: 96%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trend .name { margin-top: 0; }
  /* Item 27: the 24h shape under the dial. */
  .trendline { position: absolute; left: 8%; right: 8%; bottom: 4%; height: 22cqh; min-height: 18px; opacity: .9; }
  .trend .dial { max-height: 70cqh; }
  .empty { position: absolute; bottom: 6px; }
</style>
