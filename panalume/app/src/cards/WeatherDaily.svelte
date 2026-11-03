<script module>
  import { states } from '../lib/ha.svelte.js';
  export const meta = {
    type: 'weather-daily', name: 'Weather: daily', icon: 'mdi:calendar-week', category: 'Info',
    size: { w: 540, h: 330 }, tap: 'more-info',
    defaults: { entity: '', days: 7, bar: true, precip: true, wind: false },
    autofill: () => {
      // Daily forecast is feature bit 1.
      const ids = [...states.keys()].filter((id) => id.startsWith('weather.'));
      const daily = ids.find((id) => (Number(states.get(id)?.attributes?.supported_features || 0) & 1)) || ids[0] || '';
      return daily ? { entity: daily } : {};
    },
    sections: [{ key: 'icon', label: 'Conditions' }, { key: 'bar', label: 'Temperature range' },
      { key: 'precip', label: 'Chance of precipitation' }, { key: 'wind', label: 'Wind' },
      { key: 'uv', label: 'UV index' }],
    fields: [
      { key: 'entity', label: 'Weather', type: 'entity', domain: 'weather' },
      { key: 'name', label: 'Title', type: 'text' },
      { key: 'days', label: 'Days to show', type: 'number', hint: 'The forecast is whatever the service offers: eight days on OpenWeatherMap, six on Met.no.' },
    ],
  };
</script>

<script>
  // A week at a glance: each day's sky, its chance of precipitation, and its high and low drawn
  // as a bar against the whole week, so a warm day reads as warm without reading the numbers.
  // The bar is the one cooling-to-warm gradient; everything numeric is tabular, so the column
  // of values holds still as the days change.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { stateWord } from '../lib/i18n.svelte.js';
  import { subscribe } from '../lib/ha.svelte.js';
  import { reducedMotion } from '../lib/design.svelte.js';
  import { WX } from './Weather.svelte';

  let { props, h } = $props();
  const show = (k) => !props.hide?.[k];
  const e = $derived(ent(props.entity));
  const a = $derived(e?.attributes || {});
  let forecast = $state([]);
  $effect(() => {
    const id = e?.entity_id;
    if (!id) return;
    return subscribe({ type: 'weather/subscribe_forecast', entity_id: id, forecast_type: 'daily' }, (ev) => (forecast = ev.forecast || []));
  });

  const days = $derived(forecast.slice(0, Number(props.days) || 7));
  // The bar is relative to the days on show, not to an absolute scale.
  const lo = $derived(Math.min(...days.map((d) => Number(d.templow ?? d.temperature ?? 0))));
  const hi = $derived(Math.max(...days.map((d) => Number(d.temperature ?? d.templow ?? 0))));
  const span = $derived(Math.max(1, hi - lo));
  const pos = (v) => Math.max(0, Math.min(100, ((Number(v) - lo) / span) * 100));

  const dayName = (f, i) => {
    const d = new Date(f.datetime);
    return i === 0 ? t('Today') : d.toLocaleDateString([], { weekday: 'short' });
  };
  const date = (f) => new Date(f.datetime).toLocaleDateString([], { month: 'short', day: 'numeric' });

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
  const tall = $derived((Number(h) || 330) > 280);
</script>

<div class="wrap" class:motion>
  <div class="head">
    {#if props.name}<span class="nm">{t(props.name)}</span>{/if}
    {#if days.length}<span class="microcaps">{days.length} {t('days')}</span>{/if}
  </div>
  {#if days.length}
    <div class="list">
      {#each days as f, i (f.datetime)}
        <div class="row" title={`${stateWord('weather', null, f.condition) || f.condition} · ${Math.round(f.temperature)}° / ${Math.round(f.templow ?? f.temperature)}°`}>
          <div class="day">
            <b>{dayName(f, i)}</b>
            {#if tall}<small>{date(f)}</small>{/if}
          </div>
          {#if show('icon')}
            <span class="wx-icon {i === 0 ? animKind(f.condition) : ''}"><span class="glyph"><Icon icon={WX[f.condition] || 'mdi:weather-cloudy'} size="1.35em" /></span></span>
          {/if}
          {#if show('precip') && f.precipitation_probability != null}
            <div class="pop num {Number(f.precipitation_probability) >= 50 ? 'wet' : ''}">
              <Icon icon="mdi:water" size=".85em" />{Math.round(f.precipitation_probability)}%
            </div>
          {:else}<div class="pop"></div>{/if}
          <div class="temps">
            {#if show('bar')}
              <div class="bar">
                <span class="fill" style:left="{pos(f.templow ?? f.temperature)}%" style:right="{100 - pos(f.temperature)}%"></span>
              </div>
            {/if}
            <div class="nums">
              <b class="num">{f.temperature == null ? '—' : Math.round(f.temperature) + '°'}</b>
              {#if f.templow != null}<span class="num">{Math.round(f.templow)}°</span>{/if}
            </div>
          </div>
          {#if show('wind') && f.wind_speed != null}
            <div class="wind num">
              {#if f.wind_bearing != null}
                <span class="dir" style="transform:rotate({Number(f.wind_bearing)}deg)"><Icon icon="mdi:navigation" size=".8em" /></span>
              {/if}
              {Math.round(f.wind_speed)} {a.wind_speed_unit || ''}
            </div>
          {/if}
          {#if show('uv') && f.uv_index != null}<div class="uv num {Number(f.uv_index) >= 8 ? 'high' : Number(f.uv_index) >= 6 ? 'mid' : ''}">UV {Math.round(f.uv_index)}</div>{/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="wait">{e ? t('This weather service has no daily forecast') : t('Pick a weather entity')}</div>
  {/if}
</div>

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; gap: .4em; min-height: 0; container-type: size; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: .6em; flex: none; min-width: 0; }
  .head .nm { font-size: .8em; font-weight: 600; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
  .row { display: flex; align-items: center; gap: .55em; min-height: 0; flex: 0 1 auto; }
  .day { display: flex; flex-direction: column; min-width: 3.4em; line-height: 1.15; }
  .day b { font-size: .86em; font-weight: 600; }
  .day small { font-size: .68em; color: var(--muted); }
  .pop { display: flex; align-items: center; gap: .1em; font-size: .72em; color: var(--muted); min-width: 2.5em; }
  .pop.wet { color: #74c0fc; }
  .temps { flex: 1; display: flex; align-items: center; gap: .5em; min-width: 0; }
  .bar { position: relative; flex: 1; height: min(.42em, 2cqh); border-radius: .3em; background: rgba(255, 255, 255, .09); min-width: 2em; }
  .fill { position: absolute; top: 0; bottom: 0; border-radius: .3em; background: linear-gradient(90deg, #4dabf7, #ffd43b 55%, #ff922b); }
  .nums { display: flex; gap: .35em; align-items: baseline; min-width: 3.6em; justify-content: flex-end; }
  .nums b { font-size: .92em; font-weight: 600; }
  .nums span { font-size: .8em; color: var(--muted); }
  .wind { display: flex; align-items: center; gap: .15em; font-size: .72em; color: var(--muted); min-width: 3.6em; justify-content: flex-end; }
  .dir { display: inline-flex; transform-origin: 50% 50%; }
  .uv { font-size: .7em; color: var(--muted); }
  .uv.mid { color: #f0b429; }
  .uv.high { color: #e8590c; }
  .wx-icon { position: relative; display: inline-flex; flex: none; }
  .wx-icon .glyph { display: inline-flex; }
  .wait { margin: auto; color: var(--muted); font-size: .9em; text-align: center; }

  /* Today's sky moves; the rest of the week stays still so the list reads as a table. */
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
</style>
