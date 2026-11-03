<script module>
  import { states } from '../lib/ha.svelte.js';
  export const meta = {
    type: 'weather-hourly', name: 'Weather: hourly', icon: 'mdi:clock-outline', category: 'Info',
    size: { w: 700, h: 300 }, tap: 'more-info',
    defaults: { entity: '', hours: 24, feels: false, wind: true, precip: true },
    autofill: () => {
      // Hourly forecast is feature bit 2.
      const ids = [...states.keys()].filter((id) => id.startsWith('weather.'));
      const hourly = ids.find((id) => (Number(states.get(id)?.attributes?.supported_features || 0) & 2)) || ids[0] || '';
      return hourly ? { entity: hourly } : {};
    },
    sections: [{ key: 'icon', label: 'Conditions' }, { key: 'feels', label: 'Feels like' },
      { key: 'precip', label: 'Chance of precipitation' }, { key: 'wind', label: 'Wind' }],
    fields: [
      { key: 'entity', label: 'Weather', type: 'entity', domain: 'weather' },
      { key: 'name', label: 'Title', type: 'text' },
      { key: 'hours', label: 'Hours to show', type: 'number', hint: 'The forecast itself is whatever the weather service offers, up to 48 hours on OpenWeatherMap. Columns that do not fit are dropped, not squeezed.' },
    ],
  };
</script>

<script>
  // The next 24 hours as one temperature curve, drawn from the forecast this card already
  // holds — no extra fetch. Hour labels sit under the curve at the same spacing as the
  // hours, and the window's high and low are marked where they happen. The columns below
  // stay secondary: the sky, the chance of rain, the wind.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { stateWord } from '../lib/i18n.svelte.js';
  import { subscribe } from '../lib/ha.svelte.js';
  import { weatherLook, reducedMotion } from '../lib/design.svelte.js';
  import { WX } from './Weather.svelte';

  let { props, w, h } = $props();
  const show = (k) => !props.hide?.[k];
  const e = $derived(ent(props.entity));
  const a = $derived(e?.attributes || {});
  let forecast = $state([]);
  $effect(() => {
    const id = e?.entity_id;
    if (!id) return;
    return subscribe({ type: 'weather/subscribe_forecast', entity_id: id, forecast_type: 'hourly' }, (ev) => (forecast = ev.forecast || []));
  });

  // Column width is set in em and the card measures itself, so a narrow card shows fewer
  // hours instead of unreadable ones.
  // A column carrying "feels like" needs about 3.9em once the temperature has moved to the
  // curve; without it, 3em is comfortable.
  const COL = $derived(show('feels') ? 3.9 : 3.05);
  let cols = $derived(Math.max(1, Math.floor((Number(w) || 700) / (COL * 16))));
  const items = $derived(forecast.slice(0, Math.min(Number(props.hours) || 24, cols)));

  const time = (f) => new Date(f.datetime).toLocaleTimeString([], { hour: 'numeric', hour12: false }).replace(':00', '') + 'h';
  const tall = $derived((Number(h) || 300) > 240);
  // '°C' and '°F' both read as a plain degree on a chart; anything else (K) keeps its unit.
  const unit = $derived(a.temperature_unit && !/^°/.test(a.temperature_unit) ? ' ' + a.temperature_unit : '°');

  const look = $derived(weatherLook(e?.state));
  const animKind = (s) => {
    const st = String(s || '');
    if (!st) return 'cloud';
    if (st.includes('snow') || st === 'sleet') return 'snow';
    if (st.includes('lightning')) return 'storm';
    if (st.includes('rain') || st === 'pouring' || st === 'hail' || st === 'exceptional') return 'rain';
    if (st === 'fog') return 'fog';
    if (st.startsWith('windy')) return 'wind';
    if (st === 'clear-night') return 'moon';
    if (st === 'sunny' || st === 'clear') return 'sun';
    return 'cloud';
  };
  let motion = $state(!reducedMotion());
  $effect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (motion = !mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  });

  // ---- the curve ----------------------------------------------------------
  let pw = $state(0), ph = $state(0);
  function buildCurve(temps, width, height) {
    const n = temps.length;
    const seen = temps.filter((v) => v != null);
    if (!n || !seen.length) return null;
    let lo = Math.min(...seen), hi = Math.max(...seen);
    if (hi - lo < 1.5) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    const padT = 18, padB = 14;
    const inner = Math.max(6, height - padT - padB);
    const X = (i) => ((i + 0.5) / n) * width;
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * inner;
    let d = '', run = [];
    const flush = () => {
      if (run.length === 1) { d += `M${run[0][0].toFixed(1)},${run[0][1].toFixed(1)}l.1,0`; return; }
      if (!run.length) return;
      d += `M${run[0][0].toFixed(1)},${run[0][1].toFixed(1)}`;
      for (let k = 1; k < run.length; k++) {
        const [x0, y0] = run[k - 1], [x1, y1] = run[k];
        const cx = (x0 + x1) / 2;
        d += `C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
      }
    };
    for (let i = 0; i < n; i++) {
      const v = temps[i];
      if (v == null) { flush(); run = []; continue; }
      run.push([X(i), Y(v)]);
    }
    flush();
    const firstI = temps.findIndex((v) => v != null);
    const lastI = n - 1 - [...temps].reverse().findIndex((v) => v != null);
    const hiV = Math.max(...seen), loV = Math.min(...seen);
    return {
      d,
      area: `${d}L${X(lastI).toFixed(1)},${height}L${X(firstI).toFixed(1)},${height}Z`,
      hi: { x: X(temps.indexOf(hiV)), y: Y(hiV), v: hiV },
      lo: { x: X(temps.indexOf(loV)), y: Y(loV), v: loV },
      hiV, loV,
    };
  }
  const geo = $derived.by(() => {
    if (items.length < 2 || pw < 60 || ph < 40) return null;
    const temps = items.map((f) => (Number.isFinite(Number(f.temperature)) && f.temperature !== null ? Number(f.temperature) : null));
    return buildCurve(temps, pw, ph);
  });
  // Labels every few hours, so they never collide however many hours the card holds.
  const tickStep = $derived(Math.max(1, Math.ceil(items.length / Math.max(3, Math.floor(pw / 62)))));
</script>

<div class="wrap" class:motion>
  <div class="head">
    {#if props.name}<span class="nm">{t(props.name)}</span>{/if}
    <span class="microcaps">{t('Next')} {items.length || Number(props.hours) || 24} {t('hours')}</span>
    <span class="spacer"></span>
    {#if geo}
      <span class="range"><i class="microcaps">{t('High')}</i> <b class="num">{Math.round(geo.hiV)}{unit}</b></span>
      <span class="range"><i class="microcaps">{t('Low')}</i> <b class="num">{Math.round(geo.loV)}{unit}</b></span>
    {/if}
  </div>

  {#if items.length}
    {#if geo}
      <div class="plot" bind:clientWidth={pw} bind:clientHeight={ph}>
        <svg width="100%" height="100%" viewBox="0 0 {pw} {ph}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="wxf" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color={look.tint} stop-opacity=".32" />
              <stop offset="1" stop-color={look.tint} stop-opacity="0" />
            </linearGradient>
          </defs>
          {#each items as f, i}
            {#if i > 0 && i % tickStep === 0}<line x1={(i / items.length) * pw} x2={(i / items.length) * pw} y1="0" y2={ph} class="vg" />{/if}
          {/each}
          <line x1="0" x2={pw} y1={geo.hi.y} y2={geo.hi.y} class="guide" />
          <line x1="0" x2={pw} y1={geo.lo.y} y2={geo.lo.y} class="guide" />
          <path d={geo.area} fill="url(#wxf)" />
          <path d={geo.d} class="line" vector-effect="non-scaling-stroke" />
        </svg>
        <span class="mark hi num" style="left:{geo.hi.x}px;top:{geo.hi.y}px">{Math.round(geo.hi.v)}{unit}</span>
        <span class="mark lo num" style="left:{geo.lo.x}px;top:{geo.lo.y}px">{Math.round(geo.lo.v)}{unit}</span>
      </div>
    {/if}

    <div class="row">
      {#each items as f, i}
        <div class="col" title={`${new Date(f.datetime).toLocaleString()} · ${stateWord('weather', null, f.condition) || f.condition}${f.temperature != null ? ' · ' + Math.round(f.temperature) + '°' : ''}${f.wind_speed != null ? ' · ' + Math.round(f.wind_speed) + ' ' + (a.wind_speed_unit || '') : ''}${f.precipitation_probability != null ? ' · ' + Math.round(f.precipitation_probability) + '%' : ''}`}>
          <div class="t num">{time(f)}</div>
          {#if show('icon')}
            <span class="wx-icon {i === 0 ? animKind(f.condition) : ''}"><span class="glyph"><Icon icon={WX[f.condition] || 'mdi:weather-cloudy'} size="1.45em" /></span></span>
          {/if}
          {#if !geo}<div class="temp num">{f.temperature == null ? '—' : Math.round(f.temperature) + '°'}</div>{/if}
          {#if show('precip') && f.precipitation_probability != null}
            <div class="small pop num {Number(f.precipitation_probability) >= 50 ? 'wet' : ''}">
              <Icon icon="mdi:water" size=".8em" />{Math.round(f.precipitation_probability)}%
            </div>
          {/if}
          {#if show('feels') && f.apparent_temperature != null}
            <div class="small num">{t('feels')} {Math.round(f.apparent_temperature)}°</div>
          {/if}
          {#if show('wind') && f.wind_speed != null && tall}
            <div class="small wind num">
              {#if f.wind_bearing != null}
                <span class="dir" style="transform:rotate({Number(f.wind_bearing)}deg)"><Icon icon="mdi:navigation" size=".8em" /></span>
              {/if}
              {Math.round(f.wind_speed)}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="wait">{e ? t('This weather service has no hourly forecast') : t('Pick a weather entity')}</div>
  {/if}
</div>

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; gap: .4em; min-height: 0; container-type: size; }
  .head { display: flex; align-items: baseline; gap: .55em; flex: none; min-width: 0; }
  .head .nm { font-size: .72em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
  .range { display: inline-flex; align-items: baseline; gap: .28em; font-size: .78em; color: var(--muted); }
  .range b { color: var(--text); font-weight: 650; }

  .plot { position: relative; flex: 1; min-height: 44px; }
  .plot svg { position: absolute; inset: 0; overflow: visible; }
  .line { fill: none; stroke: var(--text); stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round; opacity: .94; }
  .guide { stroke: rgba(255, 255, 255, .14); stroke-width: 1; stroke-dasharray: 3 5; }
  .vg { stroke: rgba(255, 255, 255, .05); stroke-width: 1; }
  .mark { position: absolute; transform: translate(-50%, -170%); font-size: .66em; font-weight: 650; color: var(--muted); white-space: nowrap; }
  .mark.lo { transform: translate(-50%, 60%); }

  .row { flex: none; display: flex; gap: .15em; height: min(7em, 32cqh); min-height: 64px; overflow: hidden; }
  .col { flex: 1 1 0; min-width: 2.6em; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: .1em; padding: .2em .1em; border-radius: .55em; background: rgba(255, 255, 255, .035); overflow: hidden; }
  .col:first-child { background: rgba(255, 255, 255, .09); }
  .t { font-size: .72em; color: var(--muted); }
  .temp { font-size: 1em; font-weight: 600; }
  .small { font-size: .66em; color: var(--muted); display: flex; align-items: center; gap: .1em; white-space: nowrap; }
  .pop.wet { color: #74c0fc; }
  .dir { display: inline-flex; transform-origin: 50% 50%; }
  .wx-icon { position: relative; display: inline-flex; }
  .wx-icon .glyph { display: inline-flex; }
  .wait { margin: auto; color: var(--muted); font-size: .9em; text-align: center; }

  /* ---- gentle motion on the current hour only; a wall of drifting icons would be noise ---- */
  .motion .sun .glyph { animation: wx-spin 26s linear infinite; }
  .motion .sun { animation: wx-glow 7s ease-in-out infinite; }
  .motion .moon { animation: wx-glow 8s ease-in-out infinite; }
  .motion .cloud .glyph { animation: wx-drift 11s ease-in-out infinite alternate; }
  .motion .rain .glyph { animation: wx-bob 3.4s ease-in-out infinite; }
  .motion .storm .glyph { animation: wx-flicker 5s ease-in-out infinite; }
  .motion .snow .glyph { animation: wx-snow 9s ease-in-out infinite alternate; }
  .motion .fog .glyph { animation: wx-drift 16s ease-in-out infinite alternate; }
  .motion .wind .glyph { animation: wx-sway 3.6s ease-in-out infinite; }

  @keyframes wx-spin { to { transform: rotate(360deg); } }
  @keyframes wx-glow { 0%, 100% { opacity: 1; } 50% { opacity: .72; } }
  @keyframes wx-drift { from { transform: translateX(-5%); } to { transform: translateX(5%); } }
  @keyframes wx-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(10%); } }
  @keyframes wx-snow { from { transform: translate(-6%, -4%) rotate(-4deg); } to { transform: translate(6%, 6%) rotate(4deg); } }
  @keyframes wx-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
  @keyframes wx-flicker { 0%, 62%, 100% { opacity: 1; } 66% { opacity: .45; } 70% { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .plot * { animation: none; }
  }
</style>
