<script module>
  import { states } from '../lib/ha.svelte.js';

  // Autofill runs by hand from the editor, after the states have arrived — unlike
  // `watch`, which sees an empty map on first paint.
  const WASTE = /(^|_)(trash|garbage|rubbish|refuse|waste|bins?|recycl(e|ing|ables?)|pickup|pick_up|collection)(_|$)/i;
  const isDate = (id) => states.get(id)?.attributes.device_class === 'date';

  export const meta = {
    type: 'trash', name: 'Trash day', icon: 'mdi:trash-can', category: 'Info',
    size: { w: 300, h: 180 }, tap: 'more-info',
    defaults: {
      entity: '', bins: '', name: 'Trash day', text: 'Bins out tonight',
      remind_eve: true, eve_hour: 17, waste: '',
      // Hues chosen to sit apart on the wheel, not just apart in shade: graphite,
      // azure, brown-amber, olive, violet, amber. See TINT below.
      c_garbage: '#5b6570', c_recycle: '#2f7ff0', c_compost: '#b45309',
      c_yard: '#6b8e23', c_mixed: '#8b5cf6', c_other: '#f59e0b',
    },
    sections: [
      { key: 'icon', label: 'Icon' },
      { key: 'date', label: 'Next date' },
      { key: 'type', label: 'Collection type' },
    ],
    fields: [
      { key: 'entity', label: 'Collection date', type: 'entity', domain: ['sensor', 'input_datetime'], hint: 'The next collection day — a date sensor (device class “date”), a timestamp sensor or an input_datetime.' },
      { key: 'bins', label: '“Bins out” sensor (optional)', type: 'entity', domain: 'binary_sensor', hint: 'A binary sensor that is on while the bins are waiting at the kerb. It lights the card on its own, whatever the date says.' },
      { key: 'name', label: 'Title', type: 'text', placeholder: 'Trash day' },
      { key: 'text', label: 'Collection-day words', type: 'text', placeholder: 'Bins out tonight', hint: 'The chip shown while the bins are out (or the evening before).' },
      { key: 'waste', label: 'Collection type (blank = read from the entity)', type: 'text', placeholder: 'Garbage, recycling, compost…', hint: 'Blank reads the date entity’s attributes — collection_type, type, waste_type, bin_type, collection, category, kind and a few more. The type picks the ring colour and the icon.' },
      { key: 'remind_eve', label: 'Highlight from the evening before', type: 'bool', hint: 'The bins go out at night, so the card shows the chip the evening before the collection, not the morning of it.' },
      { key: 'eve_hour', label: 'Evening starts at (hour)', type: 'number' },
      { key: 'c_garbage', label: 'Garbage colour', type: 'color' },
      { key: 'c_recycle', label: 'Recycling colour', type: 'color' },
      { key: 'c_compost', label: 'Compost colour', type: 'color' },
      { key: 'c_yard', label: 'Yard waste colour', type: 'color' },
      { key: 'c_mixed', label: 'Mixed colour', type: 'color' },
      { key: 'c_other', label: 'No type / other colour', type: 'color' },
    ],
    autofill: () => {
      const ids = [...states.keys()];
      const out = {};
      const date = ids.find((id) => id.startsWith('sensor.') && WASTE.test(id) && isDate(id))
        || ids.find((id) => id.startsWith('sensor.') && WASTE.test(id) && /^\d{4}-\d{2}-\d{2}$/.test(String(states.get(id)?.state || '')));
      const bin = ids.find((id) => id.startsWith('binary_sensor.') && WASTE.test(id) && ['on', 'off'].includes(String(states.get(id)?.state || '')));
      if (date) out.entity = date;
      if (bin) out.bins = bin;
      return out;
    },
  };
</script>

<script>
  // A ring counting down to the next collection (item 38). The ring is tinted by
  // what is being collected — garbage, recycling, compost, yard waste, mixed — so
  // the colour says *what*, never "good/bad"; urgency is carried by how full the
  // ring is and by the chip. Status colours stay blue/amber/rose (item 25). The
  // type comes from whatever the date sensor publishes; without one the card uses
  // the "no type" tone rather than inventing a rotation.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { clock } from '../lib/clock.svelte.js';
  import { STATUS, clamp, mmss } from '../lib/design.svelte.js';

  let { props, w = 300, h = 180 } = $props();
  const show = (k) => !props.hide?.[k];

  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Date sensors arrive as YYYY-MM-DD, timestamp sensors as epoch seconds or an
  // ISO string, input_datetime as either (or a bare time, which is not a date).
  function parseDate(v) {
    const s = String(v ?? '').trim();
    if (!s || /^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (/^\d{9,}$/.test(s)) {
      const d = new Date(Number(s) * (s.length <= 10 ? 1000 : 1));
      return isNaN(d) ? null : day0(d);
    }
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d) ? null : day0(d);
  }

  const dateEnt = $derived(ent(props.entity));
  const binEnt = $derived(props.bins ? ent(props.bins) : undefined);
  const gone = (e) => !e || ['unavailable', 'unknown', 'none', ''].includes(String(e.state).toLowerCase());

  const target = $derived(gone(dateEnt) ? null : parseDate(dateEnt.state));
  const today = $derived(day0(new Date(clock.now)));
  const away = $derived(target ? Math.round((target - today) / 864e5) : null);
  const binsOn = $derived(!!binEnt && !gone(binEnt) && binEnt.state === 'on');
  const eveHour = $derived(props.eve_hour === '' || props.eve_hour == null ? 17 : Number(props.eve_hour));
  const evening = $derived(new Date(clock.now).getHours() >= eveHour);
  const due = $derived(away === 0);
  // The reminder is on unless it was switched off; a layout written by hand (no
  // `defaults`) should still remind, so an absent setting means yes.
  const eve = $derived(props.remind_eve === undefined ? away === 1 && evening : !!props.remind_eve && away === 1 && evening);

  // Collection type: an explicit setting wins, else the first attribute that
  // carries one. Integrations disagree on the name, so several are tried.
  const ATTRS = ['collection_type', 'waste_type', 'bin_type', 'garbage_type', 'next_type', 'next_collection', 'type', 'collection', 'category', 'kind', 'waste', 'schedule'];
  const rawType = $derived.by(() => {
    if (props.waste) return String(t(props.waste)).trim();
    const a = dateEnt?.attributes || {};
    for (const k of ATTRS) {
      const v = a[k];
      if (v == null || v === '') continue;
      const s = Array.isArray(v) ? v.filter(Boolean).map(String).join(', ') : typeof v === 'string' ? v : '';
      if (s.trim()) return s.trim();
    }
    return '';
  });
  // Yard waste is split out of compost: green bins and leaf bags are their own
  // service in most of the estate's municipalities, and they get their own hue.
  const KIND = [
    ['recycle', /recycl|blue (box|bag|bin)|cardboard|paper|plastic|glass|metal|tin|\bcans?\b/i],
    ['yard', /yard|garden|green (bin|cart|waste)|leaf|leaves|branch|brush|grass|hedge|clipping/i],
    ['compost', /compost|organic|food|scrap/i],
    ['mixed', /mixed|multi|combin|both|all[ -]?(bins|types)|everything/i],
    ['garbage', /garbage|trash|rubbish|refuse|landfill|general|household|waste|bin|cart/i],
  ];
  const kind = $derived((KIND.find(([, re]) => re.test(rawType)) || ['other'])[0]);
  const ICON = {
    garbage: 'mdi:trash-can', recycle: 'mdi:recycle', compost: 'mdi:leaf',
    yard: 'mdi:tree-outline', mixed: 'mdi:delete-variant', other: 'mdi:trash-can-outline',
  };
  // The waste palette (item 38). Hues are deliberately spread — graphite 215 at
  // almost no chroma, azure 217 at full chroma, brown-amber 30, olive 80, violet
  // 262 — so the five read apart in hue, and the near-grey garbage never competes.
  // None of them means "good"; green-for-status is not in play (item 25).
  const TINT = {
    garbage: '#5b6570', recycle: '#2f7ff0', compost: '#b45309',
    yard: '#6b8e23', mixed: '#8b5cf6', other: '#f59e0b',
  };
  const FALLBACK_LABEL = { garbage: 'Garbage', recycle: 'Recycling', compost: 'Compost', yard: 'Yard waste', mixed: 'Mixed', other: '' };
  const pretty = $derived(rawType
    ? rawType.split(/\s*[,;/]\s*/).filter(Boolean)
      .map((s) => s.replace(/_/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()))
      .join(' & ')
    : '');
  const typeLabel = $derived(pretty || FALLBACK_LABEL[kind]);

  // A colour setting wins, then the built-in palette, then the "no type" colour.
  const colour = $derived(t(props['c_' + kind]) || TINT[kind] || t(props.c_other) || TINT.other);
  const icon = $derived(t(props.icon) || ICON[kind]);

  // White or near-black text, whichever reads on the chosen colour.
  function inkFor(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return '#fff';
    let x = m[1];
    if (x.length === 3) x = x.split('').map((d) => d + d).join('');
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(x.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#171b21' : '#ffffff';
  }
  const ink = $derived(inkFor(colour));

  // The kerb happens in the morning; counting to midnight would show a whole day
  // left on collection morning, so the ring counts to 07:00 on the date.
  const PICKUP_HOUR = 7;
  const deadline = $derived(target
    ? new Date(target.getFullYear(), target.getMonth(), target.getDate(), PICKUP_HOUR).getTime()
    : null);
  const leftMs = $derived(deadline == null ? 0 : Math.max(0, deadline - clock.now));
  const leftMain = $derived.by(() => {
    const ms = leftMs;
    if (ms >= 864e5) return `${Math.floor(ms / 864e5)}d`;
    if (ms >= 36e5) return `${Math.floor(ms / 36e5)}h`;
    return `${Math.floor(ms / 6e4)}m`;
  });
  // The second line inside the ring is the finer unit: "3d" over "4h", "7h" over
  // "12m", and the last hour as mm:ss.
  const leftSub = $derived.by(() => {
    const ms = leftMs;
    if (ms >= 864e5) return `${Math.floor((ms % 864e5) / 36e5)}h`;
    if (ms >= 36e5) return `${Math.floor((ms % 36e5) / 6e4)}m`;
    return mmss(ms / 1000);
  });
  // A week is the wait the ring describes; beyond that it sits empty, and it fills
  // as the collection closes in. Bins at the kerb means the wait is over.
  const frac = $derived(binsOn ? 1 : clamp(1 - leftMs / (7 * 864e5), 0, 1));

  // Item 58: the sweep is a CSS animation from the empty ring to the true offset,
  // which is also written on the element — so reduced motion, or a browser that
  // drops the keyframe, still shows the correct arc.
  const R = 44;
  const C = 2 * Math.PI * R;

  const fmt = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const title = $derived(t(props.name) || 'Trash day');
  const headline = $derived(t(props.text) || 'Bins out tonight');
  const soon = $derived(away == null ? '' : away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : fmt(target));
  // The chip is loud on its own: when the binary sensor is on, or the evening before.
  const chip = $derived(binsOn || eve);
</script>

{#if !props.entity}
  <div class="trash"><div class="note">Pick the collection date in the card’s settings.</div></div>
{:else if gone(dateEnt)}
  <div class="trash"><div class="note">{title} · collection date unavailable</div></div>
{:else if !target}
  <div class="trash"><div class="note">{title} · the date entity carries no date</div></div>
{:else}
  <div class="trash" class:hot={binsOn} style="--tc:{colour};--ink:{ink};--warn:{STATUS.warn}">
    <div class="head">
      {#if show('icon')}<span class="mark"><Icon icon={icon} size="1.1em" /></span>{/if}
      <span class="name">{title}</span>
      {#if show('type') && typeLabel}<span class="microcaps type">{typeLabel}</span>{/if}
    </div>

    <div class="body">
      <div class="ringbox">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="track" cx="50" cy="50" r={R} />
          <circle class="arc" cx="50" cy="50" r={R}
            style="--c:{C};--dash:{C * (1 - frac)};stroke-dasharray:{C};stroke-dashoffset:{C * (1 - frac)}" />
        </svg>
        <div class="mid">
          <span class="num left">{leftMain}</span>
          <span class="sub num">{leftSub}</span>
        </div>
      </div>

      <div class="info">
        <span class="microcaps eyebrow">pickup</span>
        {#if show('date')}<span class="day">{soon}</span>{/if}
        {#if chip}
          <span class="chip press" style="--cc:{binsOn ? colour : STATUS.warn};--ink:{binsOn ? ink : '#1a1206'}">{headline}</span>
        {/if}
        {#if away < 0}
          <span class="note">That date has passed — check the sensor still updates.</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .trash { height: 100%; display: flex; flex-direction: column; gap: .6em; min-height: 0; container-type: size; position: relative; }
  .head { display: flex; align-items: center; gap: .5em; min-width: 0; color: var(--muted); font-size: .92em; flex: none; }
  .mark { color: var(--tc); display: grid; flex: none; }
  .name { font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .type { color: var(--tc); margin-left: auto; flex: none; white-space: nowrap;
    padding: .16em .5em; border-radius: 99px; background: color-mix(in srgb, var(--tc) 16%, transparent); }

  .body { flex: 1; min-height: 0; display: flex; align-items: center; gap: min(5cqw, 4cqh); overflow: hidden; }

  .ringbox { position: relative; flex: none; width: min(32cqw, 74cqh, 190px); aspect-ratio: 1; display: grid; place-items: center; }
  .ringbox svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: rgba(255, 255, 255, .09); stroke-width: 7; }
  .arc { fill: none; stroke: var(--tc); stroke-width: 7; stroke-linecap: round;
    animation: sweep var(--dur-slow) var(--ease) forwards; }
  @keyframes sweep { from { stroke-dashoffset: var(--c); } to { stroke-dashoffset: var(--dash); } }
  .hot .arc { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--tc) 65%, transparent)); }

  .mid { display: flex; flex-direction: column; align-items: center; gap: .1em; line-height: 1; min-width: 0; padding: 0 10%; }
  .left { font-size: min(18cqh, 8cqw, 40px); font-weight: 700; letter-spacing: -.03em; color: var(--text); white-space: nowrap; }
  .sub { font-size: min(10cqh, 4.6cqw, 22px); color: var(--muted); white-space: nowrap; }

  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: .3em; }
  .eyebrow { color: color-mix(in srgb, var(--tc) 70%, var(--muted)); }
  .day { font-size: min(11cqh, 4cqw, 22px); font-weight: 650; line-height: 1.1; color: var(--text); white-space: nowrap; }
  .chip { display: inline-block; max-width: 100%; padding: .3em .7em; border-radius: 99px; font-weight: 700;
    font-size: min(9.5cqh, 3.6cqw, 18px); line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: var(--ink); background: var(--cc);
    box-shadow: 0 2px 14px color-mix(in srgb, var(--cc) 38%, transparent); }
  .note { color: var(--muted); font-size: .78em; line-height: 1.3; }

  /* A short cell drops the title line and keeps the ring and the chip. */
  @container (max-height: 116px) {
    .head { display: none; }
    .ringbox { width: min(32cqw, 96cqh, 150px); }
  }
  @container (max-width: 190px) {
    .type { display: none; }
  }
</style>
