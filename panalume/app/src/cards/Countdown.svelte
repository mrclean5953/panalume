<script module>
  import { states } from '../lib/ha.svelte.js';
  // Birthdays first (the common use), then holidays, then anything else.
  const autofill = () => {
    const ids = [...states.keys()].filter((id) => id.startsWith('calendar.')).sort();
    return {
      entity:
        ids.find((id) => /birthday|anniversar|cake/.test(id)) ||
        ids.find((id) => /holiday|feiertag|vacance/.test(id)) ||
        ids[0] || '',
    };
  };
  export const meta = {
    type: 'countdown', name: 'Countdown', icon: 'mdi:cake-variant', category: 'Info',
    size: { w: 300, h: 240 }, tap: 'none',
    defaults: { entity: '', list: true, count: 4, days: 366, date: true },
    autofill,
    sections: [
      { key: 'head', label: 'Title' },
      { key: 'next', label: 'The countdown' },
      { key: 'list', label: 'What comes after' },
    ],
    fields: [
      { key: 'entity', label: 'Calendar', type: 'entity', domain: 'calendar', hint: "Home Assistant's birthdays calendar, holidays, a Google calendar of trips and dates." },
      { key: 'name', label: 'Title (blank = the calendar\'s name)', type: 'text' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'count', label: 'Dates after the next one', type: 'number' },
      { key: 'days', label: 'Look ahead (days)', type: 'number' },
      { key: 'list', label: 'Show the dates after the next one', type: 'bool' },
      { key: 'date', label: 'Show the date', type: 'bool' },
    ],
  };
</script>

<script>
  // How long until the next date on a calendar: birthdays, anniversaries, holidays,
  // trips. The next date is the hero — a ring that fills as the wait passes, with
  // the days left as a gradient numeral inside it (item 41) and the name beside it.
  // The ring also carries the urgency tone: quiet far out, amber inside two days,
  // rose on the day itself (item 25 — no green-for-good). The dates after it stay
  // as quieter rows below.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { name } from '../lib/entity.js';
  import { clock } from '../lib/clock.svelte.js';
  import { STATUS, countUp, clamp } from '../lib/design.svelte.js';
  let { props, w = 300, h = 240 } = $props();
  const show = (k) => !props.hide?.[k];

  const cal = $derived(props.entity?.startsWith('calendar.') ? props.entity : '');
  const calName = $derived(name(ent(cal)) || '');
  const title = $derived(t(props.name) || calName || 'Countdown');
  const look = $derived(Math.min(1095, Math.max(1, Number(props.days) || 366)));
  const want = $derived(Math.min(12, Math.max(0, props.count == null || props.count === '' ? 4 : Number(props.count))));
  const icon = $derived(t(props.icon) || 'mdi:cake-variant');

  let events = $state([]);
  let loaded = $state(false);
  let error = $state('');
  let refresh = $state(0);
  const stamp = $derived(states.get(cal)?.last_updated || '');

  $effect(() => {
    const i = setInterval(() => refresh++, 5 * 60e3);
    return () => clearInterval(i);
  });

  // All-day dates (birthdays, holidays) come as YYYY-MM-DD; timed ones as date-times.
  const fromDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  function norm(ev) {
    const allDay = !!ev.start?.date && !ev.start?.dateTime;
    const start = allDay ? fromDate(ev.start.date) : new Date(ev.start?.dateTime);
    if (isNaN(start)) return null;
    return { key: `${ev.uid || ''}|${start.getTime()}|${ev.summary || ''}`, title: ev.summary || '(No title)', allDay, start };
  }

  $effect(() => {
    refresh; stamp;
    if (!cal) { events = []; loaded = true; return; }
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + look);
    const q = `?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
    let alive = true;
    loaded = false;
    fetch(`ha/api/calendars/${cal}${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Calendar: ${r.status}`))))
      .then((evs) => {
        if (!alive) return;
        events = evs.map(norm).filter(Boolean).sort((a, b) => a.start - b.start);
        error = '';
        loaded = true;
      })
      .catch((e) => { if (alive) { error = e.message || 'Could not load the calendar'; loaded = true; } });
    return () => (alive = false);
  });

  // Days are counted in calendar days, so "tomorrow" is 1 whatever the hour.
  const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const today = $derived(day0(clock.now).getTime());
  const daysTo = (d) => Math.round((day0(d) - today) / 864e5);
  // An all-day event stays "today" all day; a timed one drops off once it is over.
  const ahead = $derived.by(() => {
    const now = clock.now;
    return events
      .filter((e) => daysTo(e.start) >= 0 && (e.allDay || e.start.getTime() + 60e3 > now || daysTo(e.start) > 0))
      .map((e) => ({ ...e, days: daysTo(e.start) }));
  });
  const next = $derived(ahead[0] || null);
  const count = $derived(next ? next.days : 0);

  // How far through the wait: the ring spans from the date before this one to this
  // one, i.e. the cycle the calendar itself implies (this date → the next date on
  // it). With only one date ahead there is no cycle to read, so a month stands in
  // and the ring simply shows how close that date is.
  const cycle = $derived.by(() => {
    const after = ahead[1];
    if (!next) return 30;
    const gap = after ? after.days - next.days : Math.max(1, next.days + 1);
    return clamp(Math.round(gap) || 30, 1, 366);
  });
  const frac = $derived(next ? clamp(1 - count / cycle, 0, 1) : 0);

  // The tone of the whole card: quiet, then amber inside two days, rose on the day.
  const tone = $derived(!next ? STATUS.idle : count <= 0 ? STATUS.bad : count <= 2 ? STATUS.warn : 'var(--accent)');
  const nudge = $derived(count === 0 ? 'today' : count === 1 ? 'tomorrow' : count === 2 ? 'in 2 days' : '');
  const unit = $derived(count === 1 ? 'day' : 'days');

  // Item 57: the number counts up rather than snapping.
  const shownDays = countUp(() => count);
  const numeral = $derived(Math.max(0, Math.round(shownDays())));

  // Item 58: the arc sweeps from empty to its value on load. That is a CSS animation
  // from the empty ring to the true offset, which is also written on the element —
  // so the value stays right under reduced motion (the global stylesheet collapses
  // the animation) and nothing depends on JS animation for correctness.
  const R = 44;
  const C = 2 * Math.PI * R;

  const when = $derived(next ? next.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const wordy = $derived(next ? (count === 0 ? 'Today' : count === 1 ? 'Tomorrow' : String(count)) : '');
  const short = (d) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 60 ? `in ${d} days` : `in ${Math.round(d / 30)} mo`);
  const compact = $derived(h < 170 || w < 220);

  // A wide cell puts the copy beside the ring and has more room for rows; a narrow
  // one stacks them. Either way only the rows that fit are drawn — the rest slice.
  const wide = $derived(w > h * 1.8);
  const room = $derived(Math.floor((h - (wide ? 170 : 175)) / 30));
  const rest = $derived(compact ? [] : ahead.slice(1, 1 + Math.max(0, Math.min(want, room))));
</script>

<div class="cd" class:compact style="--tc:{tone};--grad-b:{tone}">
  {#if show('head') && !compact}
    <div class="head">
      <Icon icon={icon} size="1.1em" />
      <span class="t">{title}</span>
    </div>
  {/if}

  {#if !cal}
    <div class="msg">Pick a calendar in the card's settings.</div>
  {:else if error}
    <div class="msg">{error}</div>
  {:else if !next}
    <div class="msg">
      {#if loaded}<Icon icon={icon} size="1.4em" /><span>Nothing coming up</span>{:else}Loading…{/if}
    </div>
  {:else if compact}
    <div class="tiny">
      <span class="grad-num num tn">{wordy}</span>
      {#if count > 1}<span class="microcaps tu">{unit}</span>{/if}
      <span class="huge">{next.title}</span>
    </div>
  {:else}
    <div class="body">
      {#if show('next')}
        <div class="hero">
          <div class="ringbox">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle class="track" cx="50" cy="50" r={R} />
              <circle class="arc" cx="50" cy="50" r={R}
                style="--c:{C};--dash:{C * (1 - frac)};stroke-dasharray:{C};stroke-dashoffset:{C * (1 - frac)}" />
            </svg>
            <div class="mid">
              <span class="grad-num num n">{numeral}</span>
              <span class="microcaps unit">{unit}</span>
            </div>
          </div>
          <div class="hcopy">
            <span class="microcaps eyebrow">next</span>
            <div class="what">{next.title}</div>
            {#if props.date !== false && !nudge}<div class="date">{when}</div>{/if}
            {#if nudge}<div class="nudge microcaps">{nudge}</div>{/if}
          </div>
        </div>
      {/if}

      {#if props.list !== false && rest.length && show('list')}
        <div class="list">
          <span class="microcaps eyebrow">upcoming</span>
          {#each rest as e (e.key)}
            <div class="row">
              <span class="rt">{e.title}</span>
              <span class="rn num">{short(e.days)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cd { height: 100%; display: flex; flex-direction: column; gap: 1.2cqh; min-height: 0; container-type: size; }
  .head { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .9em; flex: none; }
  .head :global(svg) { color: var(--accent); flex: none; }
  .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2cqh; overflow: hidden; }
  .hero { flex: none; display: flex; align-items: center; gap: 4cqw; min-width: 0; }
  .hcopy { display: flex; flex-direction: column; align-items: flex-start; gap: .25em; min-width: 0; flex: 1; }
  .eyebrow { color: color-mix(in srgb, var(--tc) 70%, var(--muted)); }

  /* The ring is the card: it takes the smaller of the width and the height, so a
     short cell can never push it past the edge. */
  .ringbox { position: relative; flex: none; width: min(40cqw, 34cqh, 200px); aspect-ratio: 1; display: grid; place-items: center; }
  .ringbox svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: rgba(255, 255, 255, .09); stroke-width: 6; }
  .arc { fill: none; stroke: var(--tc); stroke-width: 6; stroke-linecap: round;
    animation: sweep var(--dur-slow) var(--ease) forwards; }
  /* Sweeps from the empty ring to whatever --dash holds; the element already carries
     the final offset, so this is decoration, never the source of truth. */
  @keyframes sweep { from { stroke-dashoffset: var(--c); } to { stroke-dashoffset: var(--dash); } }
  .mid { display: flex; flex-direction: column; align-items: center; gap: .12em; line-height: 1; }
  .n { font-size: min(9cqw, 13cqh, 56px); font-weight: 700; letter-spacing: -.03em; }
  .unit { color: var(--muted); }

  .what { font-weight: 600; font-size: min(7cqh, 3.4cqw, 22px); max-width: 100%; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .date { color: var(--muted); font-size: min(4.6cqh, 2.6cqw, 15px); }
  .nudge { color: var(--tc); padding: .18em .55em; border-radius: 99px;
    background: color-mix(in srgb, var(--tc) 18%, transparent); }

  .list { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; gap: .3em; overflow: hidden; }
  .row { display: flex; align-items: baseline; gap: 8px; font-size: .82em; line-height: 1.25; min-width: 0; flex: none; }
  .rt { flex: 1; min-width: 0; color: var(--muted);
    display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
  .rn { flex: none; color: color-mix(in srgb, var(--tc) 60%, var(--text)); white-space: nowrap; }

  /* A wide cell gets a bigger ring beside the copy; a narrow one stacks the copy
     under it and centres it. */
  @container (min-aspect-ratio: 9/5) {
    .ringbox { width: min(42cqw, 50cqh, 220px); }
    .hcopy { max-width: 55cqw; }
    .n { font-size: min(5.5cqw, 20cqh, 74px); }
    .what { font-size: min(7.5cqh, 1.8cqw, 26px); }
  }
  @container (max-aspect-ratio: 9/5) {
    .hero { flex-direction: column; align-items: center; gap: 1cqh; }
    .hcopy { align-items: center; text-align: center; flex: none; width: 100%; }
  }

  .tiny { flex: 1; display: flex; flex-wrap: wrap; align-items: baseline; gap: .15em .3em; min-height: 0; align-content: center; }
  .tn { font-size: min(4.6em, 34cqw, 46cqh); font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .tu { color: var(--muted); }
  .huge { flex-basis: 100%; font-weight: 600; font-size: .95em; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  .msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; color: var(--muted); font-size: .85em; padding: 8px; }
  .msg :global(svg) { opacity: .5; }
</style>
