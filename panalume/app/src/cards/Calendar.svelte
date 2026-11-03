<script module>
  import { states } from '../lib/ha.svelte.js';
  export const meta = {
    type: 'calendar', name: 'Calendar', icon: 'mdi:calendar-month-outline', category: 'Info',
    size: { w: 360, h: 320 }, tap: 'none',
    defaults: { entities: [], view: 'list', days: 7, max: 20, hour12: false },
    // Every calendar in Home Assistant, up to six.
    autofill: () => ({ entities: [...states.keys()].filter((id) => id.startsWith('calendar.')).sort().slice(0, 6) }),
    sections: [{ key: 'head', label: 'Title & date' }, { key: 'location', label: 'Locations' }, { key: 'legend', label: 'Calendar names' }],
    fields: [
      { key: 'title', label: 'Title (blank = today’s date)', type: 'text' },
      { key: 'entities', label: 'Calendars', type: 'entities', domain: 'calendar' },
      { key: 'view', label: 'View', type: 'select', options: [{ value: 'list', label: 'List of upcoming events' }, { value: 'week', label: 'Week' }, { value: 'timeline', label: 'Week with hours' }, { value: 'month', label: 'Month' }] },
      { key: 'days', label: 'Days ahead (list)', type: 'number' },
      { key: 'max', label: 'Most events shown (list)', type: 'number' },
      { key: 'week_start', label: 'Week starts on (week and month)', type: 'select', options: [{ value: '', label: 'Automatic (from the language)' }, { value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }, { value: '6', label: 'Saturday' }] },
      { key: 'day_start', label: 'First hour shown (week with hours, 0–23)', type: 'number' },
      { key: 'day_end', label: 'Last hour shown (week with hours, 1–24)', type: 'number' },
      { key: 'hour12', label: '12-hour times', type: 'bool' },
    ],
  };
</script>

<script>
  // Today's and upcoming events from Home Assistant's calendars (Google, CalDAV,
  // Local calendar, holidays…). The list view opens with a seven-day strip: tap a
  // day to narrow the list to it, tap again to clear. All-day events sit in a
  // single chip row above the timed list rather than as rows with a blank time,
  // events belonging to a family member take that person's hue, and the whole
  // list is sliced to what actually fits the card. Or a week or month at a
  // glance, with arrows to move through them; tapping a day opens its events.
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/tpl.js';
  import { clock } from '../lib/clock.svelte.js';
  import { hueFor, hueWash } from '../lib/design.svelte.js';
  let { props, w = 360, h = 320 } = $props();
  const show = (k) => !props.hide?.[k];
  const COLORS = ['#4fb4ff', '#ff8fb1', '#5bd88f', '#ffc861', '#b48cff', '#ff9a3c', '#2ed3c4', '#ff6b6b'];

  const cals = $derived((props.entities || []).filter((id) => id?.startsWith('calendar.')));
  const days = $derived(Math.min(31, Math.max(1, Number(props.days) || 7)));
  const view = $derived(props.view === 'week' || props.view === 'month' || props.view === 'timeline' ? props.view : 'list');
  // Weeks or months forward (or back) from the current one, and the day opened from the grid.
  let offset = $state(0);
  let sheet = $state(null);
  let lastView = '';
  $effect.pre(() => { if (view !== lastView) { lastView = view; offset = 0; sheet = null; } });
  // Refetch when a calendar's state changes (its current / next event moved),
  // and every 5 minutes anyway.
  const stamp = $derived(cals.map((id) => states.get(id)?.last_updated || '').join('|'));
  let events = $state([]);
  let error = $state('');
  let loading = $state(true);
  let refresh = $state(0);
  $effect(() => {
    const i = setInterval(() => refresh++, 5 * 60e3);
    return () => clearInterval(i);
  });
  $effect(() => {
    refresh; stamp;
    const list = cals;
    if (!list.length) { events = []; loading = false; return void (error = ''); }
    const [from, to] = range.split('|').map((x) => new Date(Number(x)));
    const q = `?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
    let alive = true;
    loading = true;
    Promise.all(list.map((id, i) => fetch(`ha/api/calendars/${id}${q}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${id}: ${r.status}`)))).then((evs) => evs.map((ev) => norm(ev, id, i)))))
      .then((all) => { if (alive) { events = all.flat().filter(Boolean).sort((a, b) => a.start - b.start || b.allDay - a.allDay); error = ''; loading = false; } })
      .catch((e) => { if (alive) { error = e.message || 'Could not load the calendars'; loading = false; } });
    return () => (alive = false);
  });

  // All-day events come as dates (end exclusive); timed ones as date-times.
  const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const fromDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  function norm(ev, cal, i) {
    const allDay = !!ev.start?.date && !ev.start?.dateTime;
    const start = allDay ? fromDate(ev.start.date) : new Date(ev.start?.dateTime);
    const end = allDay ? fromDate(ev.end?.date || ev.start.date) : new Date(ev.end?.dateTime || ev.start?.dateTime);
    if (isNaN(start)) return null;
    return { key: `${cal}|${ev.uid || ''}|${start.getTime()}|${ev.summary}`, cal, color: COLORS[i % COLORS.length], title: ev.summary || '(No title)', location: ev.location || '', description: ev.description || '', allDay, start, end };
  }

  // A family member's hue when the event is theirs — named in the title, or the
  // calendar is theirs. Everyone else keeps the card's accent, so a calendar of
  // school runs and bins doesn't turn into a paint chart.
  const PEOPLE = [
    ['charlie', /(^|[^a-z])charlie([^a-z]|$)/],
    ['phoenix', /(^|[^a-z])phoenix([^a-z]|$)/],
    ['alicia', /(^|[^a-z])alicia([^a-z]|$)/],
    ['ali', /(^|[^a-z])ali([^a-z]|$)/],
    ['kyle', /(^|[^a-z])kyle([^a-z]|$)/],
  ];
  const calName = (id) => (states.get(id)?.attributes.friendly_name || id.slice(9)).replace(/\s*calendar$/i, '');
  const personOf = (e) => {
    const hay = `${e.title || ''} ${calName(e.cal)}`.toLowerCase();
    const hit = PEOPLE.find(([, re]) => re.test(hay));
    return hit ? hit[0] : '';
  };
  // The row / chip colour: a person's hue, else the card's accent (item 21).
  const look = (e) => {
    const who = personOf(e);
    return who
      ? { who, hue: hueFor(who), wash: hueWash(who, 0.18) }
      : { who: '', hue: 'var(--accent)', wash: 'color-mix(in srgb, var(--accent) 15%, transparent)' };
  };
  const people = $derived([...new Set(events.map(personOf).filter(Boolean))]);

  // Grouped by day; an event spanning several days shows on each of them.
  const now = $derived(clock.now);
  const today = $derived(day0(now).getTime());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const crosses = (e, date) => {
    const next = addDays(date, 1);
    return e.start < next && (e.end > date || (+e.end === +e.start && e.start >= date));
  };

  const maxN = $derived(Math.max(1, Number(props.max) || 20));
  const small = $derived(h < 170);

  // ---- list view: the seven-day strip -------------------------------------
  // Always today plus the six days after it, whether or not they hold events —
  // tapping one narrows the list, tapping it again clears the filter.
  let picked = $state(null);
  const stripDays = $derived(Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(today), i);
    return { d, key: d.getTime(), n: events.filter((e) => crosses(e, d)).length };
  }));
  $effect(() => { if (picked != null && !stripDays.some((s) => s.key === picked)) picked = null; });

  // Timed events per day, not already over.
  const notOver = (e) => e.allDay || e.end > now || (+e.end === +e.start && e.start >= now - 60e3);
  const dayGroups = $derived.by(() => {
    const out = [];
    for (let d = 0; d < days; d++) {
      const date = addDays(new Date(today), d);
      const evs = events.filter((e) => !e.allDay && crosses(e, date) && notOver(e));
      if (evs.length) out.push({ date, evs });
    }
    return out;
  });
  const shownGroups = $derived(picked == null ? dayGroups : dayGroups.filter((g) => g.date.getTime() === picked));

  // All-day events: one chip row above the timed list, never a row.
  const allday = $derived.by(() => {
    const t0 = new Date(today), end = addDays(t0, days);
    return events
      .filter((e) => e.allDay && e.start < end && e.end > t0)
      .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  });
  const chips = $derived((picked == null ? allday : allday.filter((e) => crosses(e, new Date(picked)))).slice(0, maxN));

  // ---- list view: slice to fit -------------------------------------------
  // Rows are a fixed height (--rh, set from the card's height), so the number
  // that fits is arithmetic rather than a scrollbar surprise.
  const rowH = $derived(Math.max(26, Math.min(38, h * 0.055)));
  const headH = $derived(show('head') && !small ? 30 : 0);
  const stripH = $derived(small ? 0 : 48);
  const fitted = $derived.by(() => {
    const budget = Math.max(rowH * 2 + 34, h - headH - stripH - (chips.length ? 28 : 0) - 14);
    // Fit once; if the list had to be cut, fit again leaving room for the "+N more" line.
    const pass = (px0) => {
      let left = Math.max(1, maxN - chips.length);
      let px = px0, cut = false;
      const out = [];
      for (const g of shownGroups) {
        if (left <= 0 || px < rowH + 14) { cut = true; break; }
        px -= 20; // the micro-caps section header
        const evs = [];
        let full = true;
        for (const e of g.evs) {
          if (left <= 0 || px < rowH - 2) { full = false; break; }
          evs.push(e); px -= rowH; left--;
        }
        if (evs.length) out.push({ date: g.date, evs });
        if (!full) { cut = true; break; }
      }
      return { out, cut };
    };
    const first = pass(budget);
    return first.cut ? pass(budget - 15).out : first.out;
  });
  const more = $derived(Math.max(0, shownGroups.reduce((n, g) => n + g.evs.length, 0) - fitted.reduce((n, g) => n + g.evs.length, 0)));

  const diffTo = (d) => Math.round((day0(d) - day0(now)) / 864e5);
  const sectionLabel = (d) => {
    const k = diffTo(d);
    if (k === 0) return 'Today';
    if (k === 1) return 'Tomorrow';
    return d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: d.getMonth() !== new Date(now).getMonth() ? 'short' : undefined });
  };
  const dayTag = (e) => (crosses(e, day0(now)) ? '' : e.start.toLocaleDateString(lang, { weekday: 'short' }));

  // Week and month: the first day of the week (from the setting, else the language).
  const firstDay = $derived.by(() => {
    if (props.week_start !== '' && props.week_start != null && !isNaN(Number(props.week_start))) return Number(props.week_start) % 7;
    try {
      const loc = new Intl.Locale(navigator.language);
      const fd = (loc.getWeekInfo?.() || loc.weekInfo)?.firstDay;
      if (fd) return fd % 7;
    } catch {}
    return 1;
  });
  const weekOf = (d) => addDays(day0(d), -((day0(d).getDay() - firstDay + 7) % 7));
  // The days on screen, as a "from|to" key so the calendars are only fetched again when it changes.
  const span = $derived.by(() => {
    const t0 = new Date(today);
    if (view === 'week' || view === 'timeline') { const from = addDays(weekOf(t0), 7 * offset); return { from, to: addDays(from, 7), weeks: 1 }; }
    if (view === 'month') {
      const first = new Date(t0.getFullYear(), t0.getMonth() + offset, 1);
      const from = weekOf(first);
      const weeks = Math.ceil((Math.round((new Date(first.getFullYear(), first.getMonth() + 1, 1) - from) / 864e5)) / 7);
      return { from, to: addDays(from, weeks * 7), weeks, first };
    }
    return { from: t0, to: addDays(t0, days), weeks: 0 };
  });
  const range = $derived(`${span.from.getTime()}|${span.to.getTime()}`);
  const gridDays = $derived(view === 'list' ? [] : Array.from({ length: span.weeks * 7 }, (_, i) => addDays(span.from, i)));
  const onDate = (date) => {
    const next = addDays(date, 1);
    return events.filter((e) => e.start < next && (e.end > date || (+e.end === +e.start && e.start >= date)));
  };
  const byDay = $derived(new Map(gridDays.map((d) => [d.getTime(), onDate(d)])));
  const period = $derived.by(() => {
    if (view === 'month') return span.first.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    const end = addDays(span.from, 6);
    const same = end.getMonth() === span.from.getMonth();
    return `${span.from.toLocaleDateString(lang, same ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(lang, { day: 'numeric', month: 'short' })}`;
  });
  const weekdays = $derived(Array.from({ length: 7 }, (_, i) => addDays(span.from, i).toLocaleDateString(lang, { weekday: w >= 420 ? 'short' : 'narrow' })));
  // Week view: columns when there's room for them, otherwise a row per day.
  const rows = $derived(w < 420);
  // Month view: how many event titles fit in a cell (0 = coloured dots instead).
  const cellH = $derived(span.weeks ? (h - (show('head') && !small ? 34 : 0) - 22 - (span.weeks - 1) * 3) / span.weeks : 0);
  const lines = $derived(w / 7 >= 58 ? Math.max(0, Math.floor((cellH - 22) / 17)) : 0);
  const openDay = (d, key = null) => { sheet = d.getTime(); open = key; };

  // Week with hours: an hour scale down the side and a column per day, each
  // timed event a block from its start to its end. All-day events (and timed
  // ones covering the whole day) sit in a row above, as in Google Calendar.
  const num = (v, def) => (v === '' || v == null || isNaN(Number(v)) ? def : Number(v));
  // Hours on the clock face, so a day with a daylight-saving change still lines up.
  const clockH = (t, d) => (t <= d ? 0 : t >= addDays(d, 1) ? 24 : t.getHours() + t.getMinutes() / 60);
  const wholeDay = (e) => e.allDay || e.end - e.start >= 864e5;
  // All-day bars, each stretching across the days it covers, stacked in lanes.
  const allDayBars = $derived.by(() => {
    if (view !== 'timeline') return [];
    const col = (t) => Math.round((day0(t) - span.from) / 864e5);
    const lanes = [], out = [];
    for (const e of events) {
      if (!wholeDay(e) || e.start >= span.to || e.end <= span.from) continue;
      const a = Math.max(0, col(e.start));
      // End is exclusive: an all-day event's end date, or the day after a timed one ends (unless at midnight).
      const b = Math.max(a + 1, Math.min(7, col(e.end) + (!e.allDay && +e.end !== +day0(e.end) ? 1 : 0)));
      let lane = lanes.findIndex((x) => x <= a);
      if (lane < 0) { lane = lanes.length; lanes.push(b); } else lanes[lane] = b;
      out.push({ e, a, b, lane });
    }
    return out;
  });
  // Timed events of a day, with side-by-side columns for ones that overlap.
  const layout = (d) => {
    const out = (byDay.get(d.getTime()) || []).filter((e) => !wholeDay(e))
      .map((ev) => { const s = clockH(ev.start, d); return { ev, s, end: Math.max(clockH(ev.end, d), s) }; })
      .sort((a, b) => a.s - b.s || b.end - a.end);
    let cluster = [], cols = [], clusterEnd = -1;
    const flush = () => { for (const p of cluster) p.n = cols.length; cluster = []; cols = []; };
    for (const p of out) {
      const end = Math.max(p.end, p.s + 0.5); // short events still get room for their title
      if (p.s >= clusterEnd) { flush(); clusterEnd = -1; }
      let c = cols.findIndex((x) => x <= p.s);
      if (c < 0) { c = cols.length; cols.push(end); } else cols[c] = end;
      p.col = c; cluster.push(p); clusterEnd = Math.max(clusterEnd, end);
    }
    flush();
    return out;
  };
  const timedByDay = $derived(view === 'timeline' ? new Map(gridDays.map((d) => [d.getTime(), layout(d)])) : new Map());
  // The hours shown: the card's setting, widened to fit the week's events so none are hidden.
  const hourSpan = $derived.by(() => {
    let a = Math.min(23, Math.max(0, Math.floor(num(props.day_start, 7))));
    let b = Math.min(24, Math.max(a + 1, Math.ceil(num(props.day_end, 22))));
    for (const ps of timedByDay.values()) for (const p of ps) { a = Math.min(a, Math.floor(p.s)); b = Math.max(b, Math.ceil(p.end)); }
    return [a, Math.max(b, a + 1)];
  });
  const hourLabel = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString(lang, h12 ? { hour: 'numeric', hour12: true } : { hour: '2-digit', minute: '2-digit', hour12: false });
  const nowH = $derived(new Date(now).getHours() + new Date(now).getMinutes() / 60);
  const pct = (x) => `${((x - hourSpan[0]) / (hourSpan[1] - hourSpan[0])) * 100}%`;

  const lang = undefined;
  const h12 = $derived(!!props.hour12);
  const hm = (d) => d.toLocaleTimeString(lang, h12 ? { hour: 'numeric', minute: '2-digit', hour12: true } : { hour: '2-digit', minute: '2-digit', hour12: false });
  const when = (e, date) => {
    if (e.allDay) return 'All day';
    const next = new Date(date); next.setDate(next.getDate() + 1);
    const startsToday = e.start >= date, endsToday = e.end <= next;
    if (startsToday && (endsToday || small)) return +e.start === +e.end || small ? hm(e.start) : `${hm(e.start)}–${hm(e.end)}`;
    if (startsToday) return `From ${hm(e.start)}`;
    if (endsToday) return `Until ${hm(e.end)}`;
    return 'All day';
  };
  const isNow = (e) => !e.allDay && e.start <= now && e.end > now;
  let open = $state(null);
  const title = $derived(view !== 'list' ? [t(props.title), period].filter(Boolean).join(' · ') : t(props.title) || new Date(now).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }));
  const past = (e) => !e.allDay && e.end < now;
  const dstr = (d) => d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' });
  const adWhen = (e) => {
    const last = e.end > e.start ? addDays(e.end, -1) : e.start;
    return e.start.toDateString() === last.toDateString() ? dstr(e.start) : `${dstr(e.start)} – ${dstr(last)}`;
  };
  const adOpen = $derived(events.find((e) => e.allDay && e.key === open) || null);
</script>

<div class="cal" class:small class:h12 style="--rh:{rowH}px">
  {#if show('head') && !small}
    <div class="head">
      <Icon icon="mdi:calendar-month-outline" size="1.2em" />
      <span class="t">{title}</span>
      {#if view !== 'list'}
        <span class="nav" data-stop>
          {#if offset}<button class="today-btn" onclick={() => { offset = 0; sheet = null; }}>Today</button>{/if}
          <button onclick={() => { offset--; sheet = null; }} aria-label="Previous"><Icon icon="mdi:chevron-left" size="1.2em" /></button>
          <button onclick={() => { offset++; sheet = null; }} aria-label="Next"><Icon icon="mdi:chevron-right" size="1.2em" /></button>
        </span>
      {/if}
      {#if show('legend') && w >= 300}
        {#if view === 'list'}
          {#if people.length > 1 || (people.length && cals.length > 1)}
            <span class="legend people">{#each people as p}<i style="background:{hueFor(p)}" title={p[0].toUpperCase() + p.slice(1)}></i>{/each}</span>
          {/if}
        {:else if cals.length > 1}
          <span class="legend">{#each cals as id, i}<i style="background:{COLORS[i % COLORS.length]}" title={calName(id)}></i>{/each}</span>
        {/if}
      {/if}
    </div>
  {/if}

  {#if !cals.length}
    <div class="blank">
      <Icon icon="mdi:calendar-blank-outline" size="1.5em" />
      <span class="microcaps">No calendars</span>
      <span class="bl">Pick one or more in the card’s settings</span>
    </div>
  {:else if error}
    <div class="blank">
      <Icon icon="mdi:calendar-alert" size="1.5em" />
      <span class="microcaps">Calendars offline</span>
      <span class="bl">{error}</span>
    </div>
  {:else if view === 'list'}
    <div class="lbody">
      {#if !small}
        <div class="strip" data-stop>
          {#each stripDays as s (s.key)}
            <button
              class="pill"
              class:today={s.key === today}
              class:on={picked === s.key}
              class:quiet={!s.n}
              onclick={() => (picked = picked === s.key ? null : s.key)}
              aria-pressed={picked === s.key}
              aria-label={`${s.d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}, ${s.n ? `${s.n} ${s.n === 1 ? 'event' : 'events'}` : 'nothing on'}`}
            >
              <span class="pl">{s.d.toLocaleDateString(lang, { weekday: 'narrow' })}</span>
              <b class="pn num">{s.d.getDate()}</b>
              <i class="pd" class:has={!!s.n}></i>
            </button>
          {/each}
        </div>
      {/if}

      {#if loading && !events.length}
        <div class="blank">
          <Icon icon="mdi:calendar-sync-outline" size="1.5em" />
          <span class="microcaps">Reading calendars</span>
        </div>
      {:else}
        {#if chips.length}
          {@render adRow(chips)}
        {/if}
        {#if adOpen && chips.some((c) => c.key === adOpen.key)}
          {@render adInfo(adOpen)}
        {/if}

        {#if fitted.length}
          <div class="list" data-stop>
            {#each fitted as g (g.date.getTime())}
              <div class="day microcaps" class:today={g.date.getTime() === today}>
                <span>{sectionLabel(g.date)}</span><i class="rule"></i>
              </div>
              {#each g.evs as e (e.key)}{@render row(e, g.date)}{/each}
            {/each}
            {#if more > 0}<div class="more microcaps">+{more} more</div>{/if}
          </div>
        {:else}
          <div class="blank">
            <Icon icon="mdi:calendar-check-outline" size="1.5em" />
            <span class="microcaps">{picked ? 'Nothing timed' : 'Nothing on'}</span>
            <span class="bl">{picked ? dstr(new Date(picked)) : `The next ${days === 1 ? 'day' : `${days} days`} ${days === 1 ? 'is' : 'are'} clear`}</span>
          </div>
        {/if}
      {/if}
    </div>
  {:else if sheet}
    {@const d = new Date(sheet)}
    {@const evs = onDate(d)}
    <div class="sheet">
      <button class="back" onclick={() => { sheet = null; open = null; }}><Icon icon="mdi:arrow-left" size="1.1em" />{d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}</button>
      {#if evs.length}
        {#if evs.some((e) => e.allDay)}{@render adRow(evs.filter((e) => e.allDay), false)}{/if}
        {#if adOpen && evs.includes(adOpen)}{@render adInfo(adOpen)}{/if}
        <div class="list" data-stop>{#each evs.filter((e) => !e.allDay) as e (e.key)}{@render row(e, d)}{/each}</div>
      {:else}<div class="blank"><Icon icon="mdi:calendar-check-outline" size="1.5em" /><span class="microcaps">Nothing on</span></div>{/if}
    </div>
  {:else if view === 'week'}
    <div class="week" class:rows data-stop>
      {#each gridDays as d (d.getTime())}
        {@const evs = byDay.get(d.getTime()) || []}
        <div class="wday" class:today={d.getTime() === today} class:gone={d.getTime() < today}>
          <button class="dh" onclick={() => openDay(d)}><span>{d.toLocaleDateString(lang, { weekday: rows ? 'short' : w >= 560 ? 'short' : 'narrow' })}</span><b class="num">{d.getDate()}</b></button>
          <div class="chips">
            {#each evs as e (e.key)}
              {@const lk = look(e)}
              <button class="chip" class:all={e.allDay} class:past={past(e)} style="--c:{lk.hue}" onclick={() => openDay(d, e.key)} title={e.title}>
                {#if !e.allDay && e.start >= d && (rows || w >= 640)}<span class="tm num">{hm(e.start)}</span>{/if}<span class="ct">{e.title}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else if view === 'timeline'}
    {@const [h0, h1] = hourSpan}
    <div class="tl" class:narrow={w < 420} data-stop style="--hours:{h1 - h0}">
      <div class="tl-row">
        <span></span>
        {#each gridDays as d (d.getTime())}
          <button class="tl-dh" class:today={d.getTime() === today} class:gone={d.getTime() < today} onclick={() => openDay(d)}><span>{d.toLocaleDateString(lang, { weekday: w >= 420 ? 'short' : 'narrow' })}</span><b class="num">{d.getDate()}</b></button>
        {/each}
      </div>
      {#if allDayBars.length}
        <div class="tl-row tl-all">
          {#each allDayBars as { e, a, b, lane } (e.key)}
            {@const lk = look(e)}
            <button class="tl-allev" style="--c:{lk.hue};grid-column:{a + 2} / {b + 2};grid-row:{lane + 1}" onclick={() => openDay(addDays(span.from, a), e.key)} title={e.title}>{e.title}</button>
          {/each}
        </div>
      {/if}
      <div class="tl-body">
        <div class="tl-grid">
          <div class="tl-hours">
            {#each Array.from({ length: h1 - h0 - 1 }, (_, i) => h0 + i + 1) as hr}<span class="num" style="top:{pct(hr)}">{hourLabel(hr)}</span>{/each}
          </div>
          {#each gridDays as d (d.getTime())}
            <div class="tl-col" class:today={d.getTime() === today}>
              {#each timedByDay.get(d.getTime()) || [] as p (p.ev.key)}
                {@const e = p.ev}
                {@const lk = look(e)}
                <button class="tl-ev" class:past={past(e)} class:now={isNow(e)} style="--c:{lk.hue};top:{pct(p.s)};height:{((Math.max(p.end, p.s + 0.25) - p.s) / (h1 - h0)) * 100}%;left:calc({(p.col / p.n) * 100}% + 1px);width:calc({100 / p.n}% - 3px)" onclick={() => openDay(d, e.key)} title={e.title}>
                  <span class="tl-ti">{e.title}</span>
                  <span class="tl-tm num">{hm(e.start)} – {hm(e.end)}</span>
                  {#if e.location && show('location')}<span class="tl-loc">{e.location}</span>{/if}
                </button>
              {/each}
              {#if d.getTime() === today && nowH >= h0 && nowH <= h1}<i class="tl-now" style="top:{pct(nowH)}"></i>{/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="month" data-stop style="--weeks:{span.weeks}">
      {#each weekdays as wd}<span class="wd">{wd}</span>{/each}
      {#each gridDays as d (d.getTime())}
        {@const evs = byDay.get(d.getTime()) || []}
        <button class="cell" class:other={d.getMonth() !== span.first.getMonth()} class:today={d.getTime() === today} onclick={() => openDay(d)} aria-label={d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }) + (evs.length ? `, ${evs.length} events` : '')}>
          <span class="dn num">{d.getDate()}</span>
          {#if lines}
            {#each evs.slice(0, evs.length > lines ? lines - 1 : lines) as e (e.key)}{@const lk = look(e)}<span class="mchip" class:all={e.allDay} style="--c:{lk.hue}">{e.title}</span>{/each}
            {#if evs.length > lines}<span class="more">+{evs.length - lines + 1}</span>{/if}
          {:else if evs.length}
            <span class="dots">{#each evs.slice(0, 4) as e (e.key)}{@const lk = look(e)}<i style="background:{lk.hue}"></i>{/each}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#snippet row(e, date)}
  {@const lk = look(e)}
  <button class="ev" class:now={isNow(e)} class:open={open === e.key} style="--c:{lk.hue}" onclick={() => (open = open === e.key ? null : e.key)}>
    <span class="bar"></span>
    <span class="when num">{when(e, date)}</span>
    <span class="what">
      <span class="ti">{e.title}</span>
      {#if open === e.key}
        {#if e.location}<span class="sub"><Icon icon="mdi:map-marker-outline" size="1em" />{e.location}</span>{/if}
        {#if e.description}<span class="desc">{e.description}</span>{/if}
        {#if show('legend') && cals.length > 1}<span class="sub"><Icon icon="mdi:calendar" size="1em" />{calName(e.cal)}</span>{/if}
      {:else if e.location && show('location') && !small && w >= 360}
        <span class="loc">{e.location}</span>
      {/if}
    </span>
  </button>
{/snippet}

{#snippet adRow(list, label = true)}
  <div class="adrow" data-stop>
    {#if label && !small}<span class="microcaps adlbl">All day</span>{/if}
    <div class="adchips">
      {#each list as e (e.key)}
        {@const lk = look(e)}
        <button class="adchip" class:open={open === e.key} style="--c:{lk.hue};--w:{lk.wash}" onclick={() => (open = open === e.key ? null : e.key)} title={e.title}>
          {#if dayTag(e)}<i class="adday">{dayTag(e)}</i>{/if}<span class="adt">{e.title}</span>
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet adInfo(e)}
  {@const lk = look(e)}
  <div class="adinfo" style="--c:{lk.hue}">
    <span class="ai-t">{e.title}</span>
    <span class="microcaps ai-w">{adWhen(e)}</span>
    {#if e.location && show('location')}<span class="ai-l"><Icon icon="mdi:map-marker-outline" size="1em" />{e.location}</span>{/if}
    {#if e.description}<span class="ai-d">{e.description}</span>{/if}
    {#if show('legend') && cals.length > 1}<span class="ai-l"><Icon icon="mdi:calendar" size="1em" />{calName(e.cal)}</span>{/if}
  </div>
{/snippet}

<style>
  .cal { height: 100%; display: flex; flex-direction: column; gap: 8px; min-height: 0; container-type: size; container-name: cal; }
  .head { display: flex; align-items: center; gap: 8px; font-weight: 600; flex: none; }
  .head :global(svg) { color: var(--accent); flex: none; }
  .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend { display: flex; gap: 4px; flex: none; }
  .legend i { width: 8px; height: 8px; border-radius: 50%; }
  .legend.people i { width: 7px; height: 7px; }

  /* Quiet placeholders (item 61): never an empty card, never a bare zero. */
  .blank { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; padding: 8px; color: var(--muted); }
  .blank :global(svg) { opacity: .5; }
  .bl { font-size: .78em; opacity: .75; max-width: 90%; }

  .lbody { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: min(8px, 1.2cqh); }

  /* ---- the seven-day strip (item 36) ---- */
  .strip { flex: none; display: flex; gap: min(6px, 1cqw); }
  .pill {
    flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: min(2px, .3cqh); height: min(48px, max(34px, 7.4cqh)); padding: 0 2px;
    border: 0; border-radius: min(11px, 2.2cqw); background: rgba(255,255,255,.045);
    color: var(--muted); font: inherit; transition: background-color 160ms var(--ease), color 160ms var(--ease), box-shadow 160ms var(--ease);
  }
  .pill .pl { font-size: .58em; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; line-height: 1; }
  .pill .pn { font-size: min(1.12em, 3.1cqh); font-weight: 600; line-height: 1.15; color: var(--text); }
  .pill .pd { width: 4px; height: 4px; border-radius: 50%; background: transparent; }
  .pill .pd.has { background: var(--accent); opacity: .85; }
  .pill.quiet .pn { color: var(--muted); opacity: .7; }
  .pill.today { background: var(--accent); color: #0b1220; }
  .pill.today .pn { color: #0b1220; }
  .pill.today .pd.has { background: #0b1220; opacity: .75; }
  .pill.on { background: color-mix(in srgb, var(--accent) 18%, rgba(255,255,255,.045)); color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .pill.on .pn { color: var(--accent); }
  .pill.today.on { background: var(--accent); color: #0b1220; box-shadow: inset 0 0 0 2px rgba(255,255,255,.55); }
  .pill.today.on .pn { color: #0b1220; }

  /* ---- all-day chips (item 36) ---- */
  .adrow { flex: none; display: flex; align-items: center; gap: 7px; min-width: 0; }
  .adlbl { flex: none; }
  .adchips { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow: hidden; }
  .adchip {
    display: flex; align-items: center; gap: 5px; flex: 0 1 auto; min-width: 0; max-width: 100%;
    height: min(24px, max(18px, 3.5cqh)); padding: 0 9px; border: 0; border-radius: 999px;
    background: var(--w); color: inherit; font: inherit; font-size: .74em; white-space: nowrap; overflow: hidden;
  }
  .adchip.open { box-shadow: inset 0 0 0 1.5px var(--c); }
  .adchip .adt { overflow: hidden; text-overflow: ellipsis; }
  .adchip .adday { flex: none; font-style: normal; font-size: .88em; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--c); }
  .adinfo { flex: none; display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border-radius: 9px; background: rgba(255,255,255,.045); border-left: 3px solid var(--c); max-height: 8em; overflow: auto; }
  .ai-t { font-size: .88em; font-weight: 600; }
  .ai-w { font-size: .62em; }
  .ai-l { display: flex; align-items: center; gap: 4px; font-size: .75em; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ai-d { font-size: .75em; color: var(--muted); white-space: pre-line; }

  /* ---- the timed list ---- */
  .list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: min(3px, .5cqh); margin-right: -6px; padding-right: 6px; scrollbar-width: thin; }
  /* Micro-caps section headers (item 46), with a hairline rule after the label. */
  .day { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex: none; }
  .day:first-child { margin-top: 0; }
  .day .rule { flex: 1; height: 1px; background: rgba(255,255,255,.09); }
  .day.today { color: var(--accent); }
  .day.today .rule { background: color-mix(in srgb, var(--accent) 34%, transparent); }
  .more { margin-top: 3px; opacity: .6; }

  .ev {
    display: flex; align-items: center; gap: min(9px, 1.4cqw); width: 100%; height: var(--rh); flex: none;
    text-align: left; background: rgba(255,255,255,.04); border: 0; border-radius: 10px;
    padding: 0 10px 0 0; color: inherit; font: inherit; overflow: hidden; cursor: pointer;
  }
  .ev.now { background: color-mix(in srgb, var(--c) 16%, transparent); }
  .ev.open { height: auto; align-items: flex-start; padding-top: 8px; padding-bottom: 9px; }
  .bar { width: 3px; align-self: stretch; border-radius: 2px; background: var(--c); flex: none; margin-left: 6px; border-radius: 0 2px 2px 0; }
  .ev.open .bar { align-self: stretch; }
  /* Tabular numerals down the time column (item 52). */
  .when { flex: none; width: 6.9em; white-space: nowrap; font-size: .8em; color: var(--muted); font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
  .ev.now .when { color: var(--c); font-weight: 600; }
  .what { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 7px; overflow: hidden; }
  .ev.open .what { flex-direction: column; align-items: stretch; gap: 3px; }
  .ti { flex: 0 1 auto; min-width: 0; font-size: .9em; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev.open .ti { white-space: normal; font-weight: 600; }
  .loc { flex: 0 1 auto; min-width: 0; max-width: 46%; font-size: .74em; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { display: flex; align-items: center; gap: 4px; font-size: .75em; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: .78em; color: var(--muted); white-space: pre-line; max-height: 8em; overflow: auto; }
  .small .ev { padding-top: 0; padding-bottom: 0; border-radius: 7px; }
  .small .when { width: 3.6em; }
  .h12 .when { width: 9.4em; }
  .small.h12 .when { width: 4.9em; }

  .nav { display: flex; align-items: center; gap: 2px; flex: none; }
  .nav button { display: grid; place-items: center; min-width: 28px; height: 28px; padding: 0 4px; border: 0; border-radius: 8px; background: rgba(255,255,255,.06); color: inherit; font: inherit; }
  .nav .today-btn { font-size: .75em; font-weight: 600; padding: 0 9px; margin-right: 2px; }
  /* Week: a column per day, or a row per day on narrow cards. */
  .week { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; align-content: start; scrollbar-width: thin; }
  .wday { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .dh { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 4px 0; border: 0; border-radius: 8px; background: rgba(255,255,255,.04); color: var(--muted); font: inherit; font-size: .72em; text-transform: uppercase; letter-spacing: .04em; }
  .dh b { font-size: 1.45em; color: var(--text); letter-spacing: 0; font-weight: 600; }
  .wday.today .dh { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
  .wday.gone .dh b { color: var(--muted); }
  .chips { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .chip { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; min-width: 0; padding: 4px 6px; border: 0; border-left: 3px solid var(--c); border-radius: 6px; background: rgba(255,255,255,.05); color: inherit; font: inherit; font-size: .74em; text-align: left; line-height: 1.25; }
  .chip.all { background: color-mix(in srgb, var(--c) 22%, transparent); }
  .chip.past { opacity: .5; }
  .tm { color: var(--muted); font-size: .9em; font-variant-numeric: tabular-nums; }
  .ct { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .week.rows { grid-template-columns: 1fr; gap: 5px; }
  .week.rows .wday { flex-direction: row; align-items: flex-start; gap: 8px; }
  .week.rows .dh { flex: none; width: 3.4em; padding: 3px 0; }
  .week.rows .dh b { font-size: 1.2em; }
  .week.rows .chips { flex: 1; flex-direction: row; flex-wrap: wrap; padding-top: 2px; }
  .week.rows .chip { width: auto; max-width: 100%; flex-direction: row; gap: 5px; align-items: baseline; }
  /* Week with hours: a time scale on the left, a column per day, events as blocks. */
  .tl { flex: 1; min-height: 0; display: flex; flex-direction: column; --gut: 3.4em; }
  .h12 .tl { --gut: 3.8em; }
  .tl-row, .tl-grid { display: grid; grid-template-columns: var(--gut) repeat(7, minmax(0, 1fr)); }
  .tl-dh { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 2px 0 6px; border: 0; background: none; color: var(--muted); font: inherit; font-size: .72em; text-transform: uppercase; letter-spacing: .06em; }
  .tl-dh b { display: grid; place-items: center; min-width: 1.9em; height: 1.9em; border-radius: 50%; font-size: 1.6em; font-weight: 500; color: var(--text); letter-spacing: 0; }
  .tl-dh.today { color: var(--accent); }
  .tl-dh.today b { background: var(--accent); color: #0b1220; }
  .tl-dh.gone b { color: var(--muted); }
  .tl-all { row-gap: 2px; border-bottom: 1px solid rgba(255,255,255,.1); padding-bottom: 4px; }
  .tl-allev { min-width: 0; margin: 0 2px; padding: 2px 8px; border: 0; border-radius: 5px; background: color-mix(in srgb, var(--c) 70%, #000); color: #fff; font: inherit; font-size: .74em; font-weight: 500; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; padding-top: 6px; }
  .tl-grid { position: relative; height: max(100%, calc(var(--hours) * 32px)); background: repeating-linear-gradient(to bottom, rgba(255,255,255,.08) 0 1px, transparent 1px calc(100% / var(--hours))); }
  .tl-hours { position: relative; }
  .tl-hours span { position: absolute; right: 8px; transform: translateY(-50%); font-size: .66em; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .tl-col { position: relative; border-left: 1px solid rgba(255,255,255,.07); min-width: 0; }
  .tl-col.today { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .tl-ev { position: absolute; display: flex; flex-direction: column; gap: 1px; min-height: 1.4em; overflow: hidden; padding: 3px 7px; border: 0; border-radius: 6px; background: color-mix(in srgb, var(--c) 72%, #000); color: #fff; font: inherit; font-size: .74em; line-height: 1.25; text-align: left; box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
  .tl-ev.now { box-shadow: 0 0 0 2px var(--c); }
  .tl-ev.past { opacity: .5; }
  .tl-ti { font-weight: 600; }
  .tl-tm, .tl-loc { opacity: .85; font-size: .92em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Phone-sized cards: just the titles, in tighter blocks. */
  .tl.narrow { --gut: 2.6em; }
  .tl.narrow .tl-ev { padding: 2px 3px; font-size: .64em; border-radius: 4px; }
  .tl.narrow .tl-tm, .tl.narrow .tl-loc { display: none; }
  .tl.narrow .tl-allev { padding: 1px 4px; font-size: .64em; }
  .tl.narrow .tl-dh b { font-size: 1.25em; }
  .tl-now { position: absolute; left: -1px; right: 0; height: 2px; background: #ff5b5b; z-index: 2; pointer-events: none; }
  .tl-now::before { content: ''; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: #ff5b5b; }
  /* Month: a grid of days with titles, or dots when the cells are small. */
  .month { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: auto repeat(var(--weeks), minmax(0, 1fr)); gap: 3px; }
  .wd { font-size: .68em; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); text-align: center; }
  .cell { display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 0; min-height: 0; overflow: hidden; padding: 3px; border: 0; border-radius: 7px; background: rgba(255,255,255,.04); color: inherit; font: inherit; text-align: left; }
  .cell.other { opacity: .4; }
  .cell.today { box-shadow: inset 0 0 0 1.5px var(--accent); }
  .dn { font-size: .72em; font-weight: 600; padding-left: 2px; }
  .cell.today .dn { color: var(--accent); }
  .mchip { font-size: .64em; line-height: 1.35; padding: 0 4px; border-radius: 4px; border-left: 2px solid var(--c); background: rgba(255,255,255,.05); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
  .mchip.all { background: color-mix(in srgb, var(--c) 24%, transparent); }
  .more { font-size: .62em; color: var(--muted); padding-left: 4px; }
  .dots { display: flex; gap: 2px; padding-left: 2px; flex-wrap: wrap; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; }
  /* A day opened from the week or month. */
  .sheet { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  .back { display: flex; align-items: center; gap: 6px; align-self: flex-start; padding: 4px 10px 4px 6px; border: 0; border-radius: 8px; background: rgba(255,255,255,.06); color: inherit; font: inherit; font-size: .85em; font-weight: 600; }
  /* Fade out at the bottom when there's more to scroll to. */
  .list, .week { mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); }

  /* A narrow card drops the decorative bits before it drops information. */
  @container cal (max-width: 330px) {
    .adlbl { display: none; }
    .strip { gap: 3px; }
  }
  @container cal (max-height: 240px) {
    .day { margin-top: 2px; }
  }
</style>
