<script module>
  export const meta = {
    type: 'weather', name: 'Weather', icon: 'mdi:weather-partly-cloudy', category: 'Info',
    size: { w: 420, h: 220 }, tap: 'more-info',
    defaults: { entity: '', forecast: 'daily', days: 5 },
    sections: [{ key: 'icon', label: 'Icon' }, { key: 'temp', label: 'Temperature' }, { key: 'cond', label: 'Condition' },
      { key: 'feels', label: 'Feels like' }, { key: 'humidity', label: 'Humidity' }, { key: 'wind', label: 'Wind' },
      { key: 'gust', label: 'Gusts' }, { key: 'uv', label: 'UV index' }, { key: 'rain', label: 'Rain today' },
      { key: 'forecast', label: 'Forecast', section: 'forecast' }, { key: 'low', label: 'Forecast lows' }],
    fields: [
      { key: 'entity', label: 'Weather', type: 'entity', domain: 'weather' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'forecast', label: 'Forecast', type: 'select', options: ['daily', 'hourly', 'none'] },
      { key: 'days', label: 'Forecast items', type: 'number' },
      { key: 'hilo', label: "Show today's high and low", type: 'bool' },
    ],
  };
  export const WX = { 'clear-night': 'mdi:weather-night', cloudy: 'mdi:weather-cloudy', exceptional: 'mdi:alert-circle-outline', fog: 'mdi:weather-fog', hail: 'mdi:weather-hail', lightning: 'mdi:weather-lightning', 'lightning-rainy': 'mdi:weather-lightning-rainy', partlycloudy: 'mdi:weather-partly-cloudy', pouring: 'mdi:weather-pouring', rainy: 'mdi:weather-rainy', snowy: 'mdi:weather-snowy', 'snowy-rainy': 'mdi:weather-snowy-rainy', sunny: 'mdi:weather-sunny', windy: 'mdi:weather-windy', 'windy-variant': 'mdi:weather-windy-variant' };
</script>

<script>
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { stateWord } from '../lib/i18n.svelte.js';
  import { subscribe } from '../lib/ha.svelte.js';
  import { weatherIcon, weatherLook, reducedMotion } from '../lib/design.svelte.js';
  let { props, w } = $props();
  const show = (k) => !props.hide?.[k];
  const e = $derived(ent(props.entity));
  const a = $derived(e?.attributes || {});
  let forecast = $state([]);
  $effect(() => {
    const id = e?.entity_id;
    const type = props.forecast;
    if (!id || type === 'none') return;
    return subscribe({ type: 'weather/subscribe_forecast', entity_id: id, forecast_type: type }, (ev) => (forecast = ev.forecast || []));
  });
  // The daily forecast feeds today's high and low, and today's rain, whatever
  // the card itself shows.
  let daily = $state([]);
  $effect(() => {
    const id = e?.entity_id;
    if (!id || props.forecast === 'daily') return;
    if (!props.hilo && props.hide?.rain) return;
    return subscribe({ type: 'weather/subscribe_forecast', entity_id: id, forecast_type: 'daily' }, (ev) => (daily = ev.forecast || []));
  });
  const day0 = $derived.by(() => {
    const list = props.forecast === 'daily' ? forecast : daily;
    const d = new Date().toDateString();
    return list.find((f) => new Date(f.datetime).toDateString() === d) || null;
  });
  const today = $derived(props.hilo ? day0 : null);
  const COND = { sunny: 'Sunny', clear: 'Clear', 'clear-night': 'Clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy',
    rainy: 'Rain', pouring: 'Pouring', lightning: 'Lightning', 'lightning-rainy': 'Thunderstorms', snowy: 'Snow',
    'snowy-rainy': 'Sleet', fog: 'Fog', hail: 'Hail', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Severe weather' };
  // The condition is its own line: the card's title, when there is one, is not a substitute.
  const condWord = $derived.by(() => {
    const st = String(e?.state || '');
    const w = stateWord('weather', null, st);
    return w && w !== st ? w : (COND[st] || st.replace(/-/g, ' '));
  });

  const hourly = $derived(props.forecast === 'hourly');
  const items = $derived(hourly ? forecast.slice(0, 24) : forecast.slice(0, Number(props.days) || 5));
  const label = (f) => hourly
    ? String(new Date(f.datetime).getHours()).padStart(2, '0') + 'h'
    : new Date(f.datetime).toLocaleDateString([], { weekday: 'short' });

  // ---- the condition, drawn (item 35) -------------------------------------
  const look = $derived(weatherLook(e?.state));
  const isNight = $derived(/night/.test(String(e?.state || '')));
  const wxIcon = $derived(weatherIcon(e?.state, isNight));
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
  const anim = $derived(animKind(e?.state));
  let motion = $state(!reducedMotion());
  $effect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (motion = !mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  });

  // Conditions beside the temperature, in the space to its right, so they never add
  // height and push the forecast down. Only what this weather entity carries, and
  // only the rows left switched on, so the card degrades instead of showing blanks.
  const bearing = $derived(a.wind_bearing == null ? null : Number(a.wind_bearing));
  const details = $derived.by(() => {
    const out = [];
    if (a.humidity != null && show('humidity')) out.push({ key: 'humidity', icon: 'mdi:water-percent', text: `${Math.round(a.humidity)}%` });
    if (a.wind_speed != null && show('wind')) out.push({ key: 'wind', icon: 'mdi:weather-windy', text: `${Math.round(a.wind_speed)} ${a.wind_speed_unit || ''}`.trim(), bearing });
    if (a.apparent_temperature != null && show('feels')) out.push({ key: 'feels', icon: 'mdi:thermometer', text: `Feels ${Math.round(a.apparent_temperature)}°` });
    if (a.wind_gust_speed != null && show('gust')) out.push({ key: 'gust', icon: 'mdi:weather-windy-variant', text: `Gusts ${Math.round(a.wind_gust_speed)} ${a.wind_gust_speed_unit || a.wind_speed_unit || ''}`.trim() });
    if (a.uv_index != null && show('uv')) out.push({ key: 'uv', icon: 'mdi:white-balance-sunny', text: `UV ${Math.round(a.uv_index)}`, tone: a.uv_index >= 8 ? 'high' : a.uv_index >= 6 ? 'mid' : '' });
    if (day0 && show('rain')) {
      if (day0.precipitation != null) out.push({ key: 'rain', icon: 'mdi:weather-rainy', text: `Rain ${day0.precipitation} ${day0.precipitation_unit || a.precipitation_unit || ''}`.trim() });
      else if (day0.precipitation_probability != null) out.push({ key: 'rain', icon: 'mdi:weather-rainy', text: `Rain ${day0.precipitation_probability}%` });
    }
    return out;
  });
  // As many whole lines as fit beside the icon and temperature (measured), so the
  // details never make the top of the card taller.
  let dh = $state(0), lineH = $state(17), detEl = $state();
  $effect(() => { w; if (detEl) lineH = parseFloat(getComputedStyle(detEl).fontSize) * 1.35 || 17; });
  const rows = $derived(Math.max(1, Math.floor((dh + 3) / (lineH + 3))));

  // ---- 24h temperature curve (item 35) ------------------------------------
  // Only in hourly mode: the forecast the card already holds is the source, so this
  // draws what is there rather than subscribing to anything new.
  let pw = $state(0), ph = $state(0);
  const geo = $derived.by(() => {
    if (!hourly || items.length < 3 || pw < 40 || ph < 30) return null;
    const temps = items.map((f) => (Number.isFinite(Number(f.temperature)) && f.temperature !== null ? Number(f.temperature) : null));
    return buildCurve(temps, pw, ph);
  });
  const tickStep = $derived(Math.max(1, Math.ceil(items.length / Math.max(3, Math.floor(pw / 46)))));

  function buildCurve(temps, width, height) {
    const n = temps.length;
    const seen = temps.filter((v) => v != null);
    if (!n || !seen.length) return null;
    let lo = Math.min(...seen), hi = Math.max(...seen);
    if (hi - lo < 1.5) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    const padT = 16, padB = 14;
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
    };
  }
</script>

<div class="wx" class:motion>
  <div class="band">
    <div class="head">
      <span class="microcaps">{e ? t('Now') : ''}</span>
      <span class="spacer"></span>
      {#if props.name}<span class="nm">{t(props.name)}</span>{/if}
    </div>
    <div class="now">
      {#if show('icon')}
        <span class="wx-icon {anim}">
          <span class="glyph"><Icon icon={wxIcon} size="clamp(30px, 15cqh, 52px)" /></span>
          {#if anim === 'rain' || anim === 'storm'}<i class="drop d1"></i><i class="drop d2"></i><i class="drop d3"></i>{/if}
        </span>
      {/if}
      <div class="mid">
        <div class="trow">
          {#if show('temp')}<div class="temp num grad-num" style="--grad-a:#ffffff;--grad-b:{look.tint}">{a.temperature != null ? Math.round(a.temperature) + '°' : '—'}</div>{/if}
          {#if today}<div class="hl"><span class="num">↑ {Math.round(today.temperature)}°</span>{#if today.templow != null}<span class="num lo">↓ {Math.round(today.templow)}°</span>{/if}</div>{/if}
        </div>
        {#if show('cond')}<div class="cond">{condWord}</div>{/if}
      </div>
      {#if details.length}
        <div class="dwrap" bind:clientHeight={dh}><div class="details" bind:this={detEl} style:max-height="{rows * lineH + (rows - 1) * 3}px">
          {#each details as d (d.key)}
            <span class="stat {d.tone || ''}">
              {#if d.bearing != null}
                <span class="dir" style="transform:rotate({d.bearing}deg)"><Icon icon="mdi:navigation" size="0.95em" /></span>
              {:else}
                <Icon icon={d.icon} size="0.95em" />
              {/if}
              <span class="num">{d.text}</span>
            </span>
          {/each}
        </div></div>
      {/if}
    </div>
  </div>

  {#if items.length && show('forecast')}
    {#if hourly && geo}
      <div class="curve">
        <div class="plot" bind:clientWidth={pw} bind:clientHeight={ph}>
          <svg width="100%" height="100%" viewBox="0 0 {pw} {ph}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="wxc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color={look.tint} stop-opacity=".34" />
                <stop offset="1" stop-color={look.tint} stop-opacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" x2={pw} y1={geo.hi.y} y2={geo.hi.y} class="guide" />
            <line x1="0" x2={pw} y1={geo.lo.y} y2={geo.lo.y} class="guide" />
            <path d={geo.area} fill="url(#wxc)" />
            <path d={geo.d} class="line" vector-effect="non-scaling-stroke" />
          </svg>
          <span class="mark hi num" style="left:{geo.hi.x}px;top:{geo.hi.y}px">{Math.round(geo.hi.v)}°</span>
          <span class="mark lo num" style="left:{geo.lo.x}px;top:{geo.lo.y}px">{Math.round(geo.lo.v)}°</span>
        </div>
        <div class="ticks">
          {#each items as f, i}
            <span class="tk num">{i % tickStep === 0 ? label(f) : ''}</span>
          {/each}
        </div>
      </div>
    {:else}
      <div class="fc">
        {#each items as f}
          <div class="day">
            <div class="d">{label(f)}</div>
            <Icon icon={WX[f.condition] || 'mdi:weather-cloudy'} size="1.5em" />
            <div class="hi num">{f.temperature == null ? '—' : Math.round(f.temperature) + '°'}</div>
            {#if f.templow != null && show('low')}<div class="lo num">{Math.round(f.templow)}°</div>{/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .wx { height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: .5em; container-type: size; min-height: 0; }
  .band { display: flex; flex-direction: column; gap: .2em; min-height: 0; }
  .head { display: flex; align-items: baseline; gap: .5em; min-width: 0; }
  .head .nm { font-size: .7em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
  .now { display: flex; align-items: center; gap: .85em; min-width: 0; }
  .now > div:not(.dwrap) { flex: none; }
  /* One hero per card: the reading, tinted by the sky. */
  .trow .temp { font-size: min(2.6em, 19cqh); font-weight: 700; line-height: 1; letter-spacing: -.03em; white-space: nowrap; }
  /* Today's high / low sit beside the temperature, so they take no extra height. */
  .trow { display: flex; align-items: center; gap: .5em; }
  .hl { display: flex; flex-direction: column; font-size: .76em; font-weight: 600; line-height: 1.2; }
  .cond { color: var(--muted); text-transform: capitalize; font-size: .88em; line-height: 1.2; }
  .wx-icon { position: relative; display: inline-flex; flex: none; }
  .wx-icon .glyph { display: inline-flex; }
  .drop { position: absolute; width: 8%; height: 14%; top: 24%; border-radius: 50% 50% 60% 60% / 70% 70% 30% 30%; background: #7cc4f5; opacity: 0; }
  .d1 { left: 31%; } .d2 { left: 47%; } .d3 { left: 63%; }
  /* Short lines, right-aligned in the space beside the temperature and never taller than it.
     What doesn't fit is left off, last first, rather than pushing the forecast down. */
  .dwrap { flex: 1; min-width: 0; align-self: stretch; position: relative; }
  .details { position: absolute; inset: 0 0 auto 0; display: flex; flex-wrap: wrap; justify-content: flex-end; align-content: flex-start; gap: 3px 12px; line-height: 1.35; overflow: hidden; color: var(--muted); font-size: .78em; }
  .stat { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .stat.mid { color: #ffc861; }
  .stat.high { color: #ff8f6b; }
  .dir { display: inline-flex; }

  /* ---- 24h curve ---- */
  .curve { display: flex; flex-direction: column; gap: .1em; flex: none; min-height: 0; }
  .plot { position: relative; height: min(9.5em, 34cqh); }
  .plot svg { position: absolute; inset: 0; overflow: visible; }
  .line { fill: none; stroke: var(--text); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; opacity: .92; }
  .guide { stroke: rgba(255, 255, 255, .16); stroke-width: 1; stroke-dasharray: 3 4; }
  .mark { position: absolute; transform: translate(-50%, -160%); font-size: .64em; font-weight: 650; color: var(--muted); white-space: nowrap; }
  .mark.lo { transform: translate(-50%, 55%); }
  .ticks { display: flex; gap: 0; }
  .tk { flex: 1 1 0; min-width: 0; text-align: center; font-size: .6em; color: var(--muted); white-space: nowrap; overflow: hidden; }

  .fc { display: flex; justify-content: space-between; gap: .25em; }
  .day { display: flex; flex-direction: column; align-items: center; gap: .12em; font-size: .85em; flex: 1; min-width: 0; }
  .d { color: var(--muted); font-size: .92em; }
  .hi { font-weight: 600; }
  .lo { color: var(--muted); }

  /* ---- gentle weather motion (item 35) ---- */
  .motion .sun .glyph { animation: wx-spin 26s linear infinite; }
  .motion .sun { animation: wx-glow 7s ease-in-out infinite; }
  .motion .moon { animation: wx-glow 8s ease-in-out infinite; }
  .motion .cloud .glyph { animation: wx-drift 11s ease-in-out infinite alternate; }
  .motion .rain .glyph { animation: wx-bob 3.4s ease-in-out infinite; }
  .motion .storm .glyph { animation: wx-flicker 5s ease-in-out infinite; }
  .motion .snow .glyph { animation: wx-snow 9s ease-in-out infinite alternate; }
  .motion .fog .glyph { animation: wx-drift 16s ease-in-out infinite alternate; }
  .motion .wind .glyph { animation: wx-sway 3.6s ease-in-out infinite; }
  .motion .rain .drop, .motion .storm .drop { animation: wx-fall 2.2s linear infinite; }
  .motion .d2 { animation-delay: .7s; } .motion .d3 { animation-delay: 1.4s; }

  @keyframes wx-spin { to { transform: rotate(360deg); } }
  @keyframes wx-glow { 0%, 100% { opacity: 1; } 50% { opacity: .72; } }
  @keyframes wx-drift { from { transform: translateX(-5%); } to { transform: translateX(5%); } }
  @keyframes wx-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(10%); } }
  @keyframes wx-snow { from { transform: translate(-6%, -4%) rotate(-4deg); } to { transform: translate(6%, 6%) rotate(4deg); } }
  @keyframes wx-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
  @keyframes wx-flicker { 0%, 62%, 100% { opacity: 1; } 66% { opacity: .45; } 70% { opacity: 1; } }
  @keyframes wx-fall { 0% { opacity: 0; transform: translateY(0); } 20% { opacity: .8; } 100% { opacity: 0; transform: translateY(150%); } }

  @media (prefers-reduced-motion: reduce) {
    .drop { display: none; }
  }
</style>
