<script module>
  import { states } from '../lib/ha.svelte.js';
  export const meta = {
    type: 'weather-details', name: 'Weather details', icon: 'mdi:weather-windy-variant', category: 'Info',
    size: { w: 460, h: 260 }, tap: 'more-info',
    defaults: { entity: '', extra: '', columns: 0 },
    autofill: () => {
      // The entity that carries the most of what this card shows.
      const ids = [...states.keys()].filter((id) => id.startsWith('weather.'));
      const score = (id) => Object.keys(states.get(id)?.attributes || {}).length;
      const best = ids.sort((a, b) => score(b) - score(a))[0] || '';
      return best ? { entity: best } : {};
    },
    sections: [{ key: 'feels', label: 'Feels like' }, { key: 'dew', label: 'Dew point' },
      { key: 'humidity', label: 'Humidity' }, { key: 'pressure', label: 'Pressure' },
      { key: 'wind', label: 'Wind' }, { key: 'gust', label: 'Gusts' },
      { key: 'visibility', label: 'Visibility' }, { key: 'clouds', label: 'Cloud cover' },
      { key: 'uv', label: 'UV index' }, { key: 'rain', label: 'Rain today' },
      { key: 'extra', label: 'Extra sensor' }],
    fields: [
      { key: 'entity', label: 'Weather', type: 'entity', domain: 'weather' },
      { key: 'name', label: 'Title', type: 'text' },
      { key: 'columns', label: 'Tiles across (0 = as many as fit)', type: 'number' },
      { key: 'extra', label: 'Extra sensor', type: 'entity', domain: 'sensor', hint: 'One more tile, anywhere: air quality, pollen, a rain gauge. Uses its own name, unit and icon. Blank hides it.' },
    ],
  };
</script>

<script>
  // A hero reading, then the conditions as tiles: everything the weather entity carries, in
  // the units it reports. Wind gets a compass rose rather than a bare bearing, so the
  // direction reads at a glance from across the room. Nothing is fetched beyond the entity
  // itself, and today's rain comes from the daily forecast, so the card works the same on
  // OpenWeatherMap, Met.no or a local station.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { name as entName } from '../lib/entity.js';
  import { stateWord } from '../lib/i18n.svelte.js';
  import { subscribe } from '../lib/ha.svelte.js';
  import { weatherIcon, weatherLook, reducedMotion } from '../lib/design.svelte.js';

  let { props } = $props();
  const show = (k) => !props.hide?.[k];
  const e = $derived(ent(props.entity));
  const a = $derived(e?.attributes || {});

  const round = (v, d = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const m = 10 ** d;
    return Math.round(n * m) / m;
  };
  const deg = (v) => {
    const n = round(v);
    return n == null ? null : `${n}°`;
  };
  const nm = (v, unit) => {
    const n = round(v, 1);
    return n == null ? null : `${n}${unit ? ' ' + unit : ''}`;
  };
  const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const cardinal = (b) => (b == null ? '' : CARD[Math.round(((Number(b) % 360) + 360) % 360 / 22.5) % 16]);

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
  // Animations are off unless the reader wants motion; the class carries the gates.
  let motion = $state(!reducedMotion());
  $effect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (motion = !mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  });

  let daily = $state([]);
  $effect(() => {
    const id = e?.entity_id;
    if (!id || props.hide?.rain) return;
    return subscribe({ type: 'weather/subscribe_forecast', entity_id: id, forecast_type: 'daily' }, (ev) => (daily = ev.forecast || []));
  });
  const today = $derived.by(() => {
    const d = new Date().toDateString();
    return daily.find((f) => new Date(f.datetime).toDateString() === d) || daily[0] || null;
  });

  const wunit = $derived(a.wind_speed_unit || '');
  const tiles = $derived.by(() => {
    const out = [];
    const push = (key, icon, label, value, opt = {}) => {
      if (value != null && value !== '' && show(key)) out.push({ key, icon, label, value, ...opt });
    };
    push('feels', 'mdi:thermometer-lines', t('Feels like'), deg(a.apparent_temperature));
    push('dew', 'mdi:water-thermometer', t('Dew point'), deg(a.dew_point));
    push('humidity', 'mdi:water-percent', t('Humidity'), a.humidity == null ? null : `${Math.round(a.humidity)}%`);
    push('pressure', 'mdi:gauge', t('Pressure'), nm(a.pressure, a.pressure_unit));
    const bearing = a.wind_bearing == null ? null : ((Number(a.wind_bearing) % 360) + 360) % 360;
    push('wind', 'mdi:weather-windy', t('Wind'), a.wind_speed == null ? null : `${Math.round(a.wind_speed)} ${wunit}`.trim(),
      { kind: 'wind', bearing, sub: cardinal(bearing) });
    push('gust', 'mdi:weather-windy-variant', t('Gusts'), a.wind_gust_speed == null ? null : `${Math.round(a.wind_gust_speed)} ${(a.wind_gust_speed_unit || wunit)}`.trim());
    push('visibility', 'mdi:eye-outline', t('Visibility'), nm(a.visibility, a.visibility_unit));
    push('clouds', 'mdi:cloud-outline', t('Cloud cover'), a.cloud_coverage == null ? null : `${Math.round(a.cloud_coverage)}%`);
    const uv = round(a.uv_index, 1);
    push('uv', 'mdi:white-balance-sunny', t('UV index'), uv == null ? null : String(uv), { tone: uv >= 8 ? 'high' : uv >= 6 ? 'mid' : '' });
    if (today) {
      const p = today.precipitation;
      const pop = today.precipitation_probability;
      const val = p != null ? nm(p, today.precipitation_unit || a.precipitation_unit) : pop != null ? `${Math.round(pop)}%` : null;
      push('rain', 'mdi:weather-pouring', t('Rain today'), val);
    }
    const x = ent(props.extra);
    if (x && show('extra')) {
      const v = x.state === 'unknown' || x.state === 'unavailable' ? null : `${x.state}${x.attributes?.unit_of_measurement ? ' ' + x.attributes.unit_of_measurement : ''}`;
      push('extra', x.attributes?.icon || 'mdi:information-outline', entName(x) || '', v);
    }
    return out;
  });

  // A tile needs roughly 7.4em; below that the value squeezes into its label.
  let cols = $derived(Number(props.columns) > 0 ? Number(props.columns) : null);
  const COND = { sunny: 'Sunny', clear: 'Clear', 'clear-night': 'Clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy',
    rainy: 'Rain', pouring: 'Pouring', lightning: 'Lightning', 'lightning-rainy': 'Thunderstorms', snowy: 'Snow',
    'snowy-rainy': 'Sleet', fog: 'Fog', hail: 'Hail', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Severe weather' };
  const cond = $derived.by(() => {
    const st = String(e?.state || '');
    const w = stateWord('weather', null, st);
    return w && w !== st ? w : (COND[st] || st.replace(/-/g, ' '));
  });
  const tval = $derived(a.temperature == null ? '—' : Math.round(a.temperature) + '°');
</script>

<div class="wrap" class:motion>
  <div class="head">
    <span class="microcaps">{e ? t('Now') : ''}</span>
    {#if props.name}<span class="nm">{t(props.name)}</span>{/if}
  </div>

  {#if e}
    <div class="body">
      <div class="hero">
        <div class="hero-top">
          <span class="wx-icon {anim}">
            <span class="glyph"><Icon icon={wxIcon} size="clamp(26px, 13cqh, 44px)" /></span>
            {#if anim === 'rain' || anim === 'storm'}<i class="drop d1"></i><i class="drop d2"></i><i class="drop d3"></i>{/if}
          </span>
          <div class="hero-num grad-num num" style="--grad-a:#ffffff;--grad-b:{look.tint}">{tval}</div>
        </div>
        {#if cond}<div class="cond">{cond}</div>{/if}
      </div>

      {#if tiles.length}
        <div class="grid" style:--cols={cols ? `repeat(${cols}, 1fr)` : null}>
          {#each tiles as tile (tile.key)}
            <div class="tile {tile.tone || ''}">
              <div class="microcaps lbl">{tile.label}</div>
              {#if tile.kind === 'wind' && tile.bearing != null}
                <div class="windbody">
                  <svg class="rose" viewBox="0 0 48 48" aria-hidden="true">
                    <circle cx="24" cy="24" r="20.5" class="ring" />
                    <circle cx="24" cy="24" r="13.5" class="ring inner" />
                    {#each [[24, 1.5, 24, 6.5], [46.5, 24, 41.5, 24], [24, 46.5, 24, 41.5], [1.5, 24, 6.5, 24]] as [x1, y1, x2, y2]}
                      <line {x1} {y1} {x2} {y2} class="tick" />
                    {/each}
                    <g class="needle" style="transform:rotate({tile.bearing}deg)">
                      <path d="M24 8.5 L28.4 26.5 L24 22.8 L19.6 26.5 Z" class="arrow" />
                      <circle cx="24" cy="24" r="1.7" class="hub" />
                    </g>
                  </svg>
                  <div class="windval">
                    <b class="num">{tile.value}</b>
                    <span class="microcaps">{tile.sub}</span>
                  </div>
                </div>
              {:else}
                <div class="val num">
                  <Icon icon={tile.icon} size=".95em" />
                  <span class="vtext">{tile.value}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="wait">{t('No current conditions on this entity')}</div>
      {/if}
    </div>
  {:else}
    <div class="wait">{t('Pick a weather entity')}</div>
  {/if}
</div>

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; gap: .5em; min-height: 0; container-type: size; }
  .head { display: flex; align-items: baseline; gap: .6em; min-height: 0; flex: none; }
  .head .nm { font-size: .72em; color: var(--muted); letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .body { flex: 1; min-height: 0; display: flex; gap: 1em; align-items: stretch; }

  /* One hero (item 47): the temperature at twice body size, tinted by the sky. */
  .hero { flex: none; width: min(11.5em, 27cqw); display: flex; flex-direction: column; justify-content: center; gap: .18em;
    padding-right: 1em; border-right: 1px solid rgba(255,255,255,.07); min-width: 0; }
  .hero-top { display: flex; align-items: center; gap: .45em; min-width: 0; }
  .hero .hero-num { font-size: min(2.7em, 19cqh); font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cond { color: var(--muted); font-size: .86em; text-transform: capitalize; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wx-icon { position: relative; display: inline-flex; flex: none; color: var(--text); }
  .wx-icon .glyph { display: inline-flex; }
  .drop { position: absolute; width: 9%; height: 15%; top: 22%; border-radius: 50% 50% 60% 60% / 70% 70% 30% 30%;
    background: #7cc4f5; opacity: 0; }
  .d1 { left: 30%; } .d2 { left: 47%; } .d3 { left: 64%; }

  .grid { flex: 1; min-width: 0; min-height: 0; display: grid; gap: .45em;
    grid-template-columns: var(--cols, repeat(auto-fit, minmax(7.4em, 1fr))); align-content: safe center; overflow: hidden; }
  .tile { background: rgba(255, 255, 255, .05); border-radius: .7em; padding: .38em .6em; display: flex; flex-direction: column;
    gap: .16em; min-width: 0; overflow: hidden; }
  .tile .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .val { display: flex; align-items: center; gap: .3em; font-size: 1.02em; font-weight: 600; line-height: 1.15; min-width: 0; color: var(--text); }
  .val :global(svg) { color: var(--muted); }
  .vtext { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mid .val { color: #f0b429; }
  .high .val { color: #e8590c; }

  .windbody { display: flex; align-items: center; gap: .45em; min-width: 0; }
  .rose { width: min(2.9em, 13cqh); height: min(2.9em, 13cqh); flex: none; color: var(--muted); overflow: visible; }
  .ring { fill: none; stroke: rgba(255, 255, 255, .18); stroke-width: 1.2; }
  .ring.inner { stroke: rgba(255, 255, 255, .1); stroke-width: 1; }
  .tick { stroke: rgba(255, 255, 255, .45); stroke-width: 1.6; stroke-linecap: round; }
  .needle { transform-box: view-box; transform-origin: 24px 24px; transition: transform .5s var(--ease); }
  .arrow { fill: #7cc4f5; }
  .hub { fill: var(--text); opacity: .8; }
  .windval { display: flex; flex-direction: column; min-width: 0; line-height: 1.1; }
  .windval b { font-size: 1em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .windval .microcaps { font-size: .6em; letter-spacing: .12em; }

  .wait { margin: auto; color: var(--muted); font-size: .9em; text-align: center; }

  /* ---- gentle weather motion (item 35), never for reduced motion ---- */
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
