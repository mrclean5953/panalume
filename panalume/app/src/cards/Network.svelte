<script module>
  import { states, renderTemplate } from '../lib/ha.svelte.js';

  // The estate's device trackers, asked of Home Assistant as one live template so
  // the card can follow every tracker without having them all as settings.
  const TRACKERS = "{{ states.device_tracker | map(attribute='entity_id') | join(',') }}";
  const trackers = () => String(renderTemplate(TRACKERS) || '').split(',').map((s) => s.trim()).filter(Boolean);

  const UP = ['on', 'up', 'online', 'connected', 'ok', 'home', 'running', 'true'];
  const STALE = ['unknown', 'unavailable', 'none', ''];

  export const meta = {
    type: 'network', name: 'Network status', icon: 'mdi:wan', category: 'Info',
    size: { w: 420, h: 300 }, tap: 'none', hold: 'more-info',
    defaults: { wan: '', download: '', upload: '', ping: '', clients: [], count: '', max: 5, max_speed: 0 },
    sections: [
      { key: 'wan', label: 'Internet' },
      { key: 'speed', label: 'Speed test' },
      { key: 'history', label: '24h outages' },
      { key: 'clients', label: 'Clients offline' },
      { key: 'when', label: 'Since when' },
    ],
    autofill: () => {
      const ids = [...states.keys()];
      const first = (re) => ids.find((id) => re.test(id)) || '';
      return {
        wan: first(/^binary_sensor\..*(wan|internet)/i) || first(/^sensor\..*wan.*status/i) || first(/^binary_sensor\..*connectivity/i),
        download: first(/^sensor\..*speedtest.*(download|down)/i),
        upload: first(/^sensor\..*speedtest.*(upload|up)/i),
        ping: first(/^sensor\..*speedtest.*(ping|latency)/i),
        clients: [],
      };
    },
    // The clients list can be left empty, in which case the card reads every
    // device tracker — which means asking for their states too.
    watch: (p) => (p.clients?.length ? p.clients : trackers()),
    fields: [
      { key: 'wan', label: 'Internet status', type: 'entity', section: 'wan', hint: 'A binary sensor or a status sensor whose on / up / online means the line is working.' },
      { key: 'download', label: 'Download', type: 'entity', domain: 'sensor', section: 'speed' },
      { key: 'upload', label: 'Upload', type: 'entity', domain: 'sensor', section: 'speed' },
      { key: 'ping', label: 'Ping', type: 'entity', domain: 'sensor', section: 'speed' },
      { key: 'max_speed', label: 'Speed bar scale (Mbit/s, blank = automatic)', type: 'number', section: 'speed' },
      { key: 'clients', label: 'Clients (blank = every device tracker)', type: 'entities', domain: 'device_tracker', section: 'clients' },
      { key: 'count', label: 'Connected client count (optional)', type: 'entity', domain: 'sensor', section: 'clients' },
      { key: 'max', label: 'Most clients listed', type: 'number', section: 'clients' },
    ],
  };
</script>

<script>
  // The line as two live bars scaled to the same ceiling, the ping and the
  // people who are not on the network — then a 24-hour outage band along the
  // bottom, one slot per quarter hour, filled from the WAN sensor's own history.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { name, entityIcon, formatNumber, relTime } from '../lib/entity.js';
  import { history, conn } from '../lib/ha.svelte.js';
  import { STATUS, countUp, clamp } from '../lib/design.svelte.js';
  let { props, h = 300 } = $props();
  const show = (k) => !props.hide?.[k];

  const wanE = $derived(ent(props.wan));
  const wan = $derived.by(() => {
    if (!wanE) return null;
    const s = String(wanE.state).toLowerCase();
    if (STALE.includes(s)) return 'unknown';
    if (UP.includes(s)) return 'up';
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return 'up';
    return 'down';
  });
  const isUp = (s) => {
    const v = String(s ?? '').toLowerCase();
    if (STALE.includes(v)) return null;
    if (UP.includes(v)) return true;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  };

  // Speeds, normalised to Mbit/s for the bars only; the figure keeps the unit
  // the sensor reports so nothing is invented.
  const toMbit = (n, unit) => {
    const u = String(unit || '').toLowerCase();
    if (u.includes('gbit') || u.includes('gb/s')) return n * 1000;
    if (u.includes('mbit') || u.includes('mb/s')) return n;
    if (u.includes('kbit') || u.includes('kb/s')) return n / 1000;
    if (u.includes('bit/s') || u.includes('b/s')) return n / 1e6;
    return n;
  };
  const rate = (id) => {
    const e = ent(id);
    if (!e || STALE.includes(String(e.state).toLowerCase())) return null;
    const n = Number(e.state);
    if (!Number.isFinite(n)) return null;
    const unit = e.attributes.unit_of_measurement || '';
    return { n, unit, mbit: toMbit(n, unit) };
  };
  const down = $derived(rate(props.download));
  const up = $derived(rate(props.upload));
  const ping = $derived.by(() => {
    const e = ent(props.ping);
    const v = Number(e?.state);
    return e && Number.isFinite(v) ? { v, u: e.attributes.unit_of_measurement || 'ms' } : null;
  });

  // One scale for both bars: the configured max_speed, else the next round
  // ceiling above the larger live figure.
  const STEPS = [10, 25, 50, 100, 250, 500, 750, 1000, 2500, 5000, 10000];
  const auto = $derived.by(() => {
    const m = Math.max(down?.mbit ?? 0, up?.mbit ?? 0);
    if (m <= 0) return 100;
    return STEPS.find((s) => m <= s) ?? Math.ceil(m / 1000) * 1000;
  });
  const scale = $derived.by(() => {
    const p = Number(props.max_speed);
    return p > 0 ? p : auto;
  });
  const pct = (r) => (r ? Math.round(clamp(r.mbit / scale) * 1000) / 10 : 0);
  const figure = (n) => formatNumber(n, n >= 100 ? 0 : 1);
  const downShown = countUp(() => down?.n ?? 0);

  const all = $derived((props.clients?.length ? props.clients : String(renderTemplate(TRACKERS) || '').split(',').map((s) => s.trim()).filter(Boolean))
    .map((id) => states.get(id))
    .filter(Boolean));
  const offline = $derived(all.filter((e) => !STALE.includes(String(e.state).toLowerCase()) && e.state !== 'home').sort(byName));
  const stale = $derived(all.filter((e) => STALE.includes(String(e.state).toLowerCase()) && e.state !== '').sort(byName));
  function byName(a, b) { return String(name(a)).localeCompare(String(name(b))); }
  const max = $derived(Number(props.max) || 5);
  // Rows that fit under the bars and above the outage band at this height.
  const fit = $derived(Math.max(0, Math.min(max, Math.round((h - 200) / 30))));
  const rows = $derived([...offline, ...(show('stale') ? stale : [])].slice(0, fit));
  const more = $derived(offline.length + (show('stale') ? stale.length : 0) - rows.length);
  const count = $derived.by(() => {
    const e = ent(props.count);
    const n = Number(e?.state);
    return e && Number.isFinite(n) ? n : null;
  });

  const word = (e) => {
    const s = String(e?.state || '');
    if (s === 'not_home') return 'Away';
    return s ? s.replace(/_/g, ' ') : 'No reading';
  };

  // ---- 24h outage band ----------------------------------------------------
  // useHistory reduces every point to a number, which discards "Up"/"down"
  // states, so the band reads the same history/history_during_period call
  // directly and keeps the strings.
  const SLOTS = 96;
  const STEP = 15 * 60e3;
  const stamp = (v) => {
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  };
  function build(points) {
    const now = Date.now();
    const start = now - SLOTS * STEP;
    const pts = (points || [])
      .map((p) => ({ t: stamp(p.lu ?? p.lc), s: p.s }))
      .filter((p) => p.t > 0)
      .sort((a, b) => a.t - b.t);
    if (!pts.length) return { loaded: true, slots: Array(SLOTS).fill('none'), down: 0, outages: 0, none: true };
    const slots = [];
    let k = 0;
    let cur;
    let downSlots = 0;
    let outages = 0;
    for (let i = 0; i < SLOTS; i++) {
      const slotEnd = start + (i + 1) * STEP;
      while (k < pts.length && pts[k].t <= slotEnd) { cur = pts[k].s; k++; }
      const upNow = cur === undefined ? null : isUp(cur);
      const s = upNow == null ? 'none' : upNow ? 'up' : 'down';
      if (s === 'down') downSlots++;
      if (s === 'down' && slots[slots.length - 1] !== 'down') outages++;
      slots.push(s);
    }
    return { loaded: true, slots, down: downSlots * 15, outages, none: false };
  }
  let outage = $state({ loaded: false, slots: [], down: 0, outages: 0, none: true });
  $effect(() => {
    const id = props.wan ? String(t(props.wan) || '').trim() : '';
    if (!id || !conn.connected || !show('history')) return;
    let alive = true;
    const load = () =>
      history([id], 24)
        .then((res) => { if (alive) outage = build(res?.[id]); })
        .catch(() => { if (alive) outage = { loaded: true, slots: Array(SLOTS).fill('none'), down: 0, outages: 0, none: true }; });
    load();
    const timer = setInterval(load, 5 * 60e3);
    return () => { alive = false; clearInterval(timer); };
  });
  const bandNote = $derived(
    !outage.loaded ? 'loading'
    : outage.none ? 'no data'
    : outage.outages === 0 ? 'no outages'
    : `${outage.down}m down · ${outage.outages} ${outage.outages === 1 ? 'drop' : 'drops'}`,
  );
</script>

<div class="net">
  <div class="head">
    <span class="microcaps ttl">Internet</span>
    {#if show('wan') && wan}
      <span class="pill {wan}" title={wanE ? `WAN reported ${wanE.state}` : ''}>
        <span class="dot"></span>{wan === 'up' ? 'Up' : wan === 'down' ? 'Down' : 'Unknown'}
      </span>
    {/if}
    {#if show('speed') && ping}
      <span class="ping num"><Icon icon="mdi:timer-sand" size=".95em" />{formatNumber(ping.v, 0)}<em>{ping.u}</em></span>
    {/if}
    <span class="who num" class:bad={offline.length > 0}>
      {#if offline.length > 0}{offline.length} offline{:else if count != null}{count} clients{:else}All home{/if}
    </span>
  </div>

  {#if show('speed')}
    <div class="speeds">
      {#each [{ key: 'down', label: 'Down', icon: 'mdi:download', r: down, c: STATUS.good }, { key: 'up', label: 'Up', icon: 'mdi:upload', r: up, c: '#8b5cf6' }] as s (s.key)}
        <div class="sp" class:empty={!s.r} title={s.r ? `${scale} Mbit/s scale` : 'No reading'}>
          <div class="sl"><Icon icon={s.icon} size="1em" /><span class="microcaps">{s.label}</span></div>
          <div class="sv num" style="--c:{s.c}">
            {#if s.r}
              {s.key === 'down' ? figure(downShown()) : figure(s.r.n)}<em>{s.r.unit || 'Mbit/s'}</em>
            {:else}
              —<em>no reading</em>
            {/if}
          </div>
          <div class="track"><span class="fill" style="width:{pct(s.r)}%;background:{s.c}"></span></div>
        </div>
      {/each}
      <div class="scale microcaps" title="Both bars share this ceiling">{formatNumber(scale, 0)} Mbit/s</div>
    </div>
  {/if}

  {#if show('clients')}
    <div class="rows">
      {#each rows as e (e.entity_id)}
        <div class="row" class:stale={STALE.includes(String(e.state).toLowerCase())} title={name(e)}>
          <span class="ic"><Icon icon={STALE.includes(String(e.state).toLowerCase()) ? 'mdi:help-network-outline' : entityIcon(e)} size="1.15em" /></span>
          <span class="n">{name(e)}</span>
          <span class="s">{word(e)}{#if show('when') && e.last_changed}<i>{relTime(e.last_changed)}</i>{/if}</span>
        </div>
      {/each}
      {#if !rows.length && !offline.length}
        <div class="empty"><Icon icon="mdi:check-network-outline" size="1.1em" /> Everyone is home</div>
      {/if}
      {#if more > 0}<div class="more">and {more} more</div>{/if}
    </div>
  {/if}

  {#if show('history')}
    <div class="strip" class:none={outage.none || !outage.loaded} title="WAN state, one slot per 15 minutes">
      <div class="slots">
        {#each (outage.slots.length ? outage.slots : Array(SLOTS).fill('none')) as s}<span class="slot {s}"></span>{/each}
      </div>
      <div class="scap">
        <span class="microcaps">24h</span>
        <span class="num" class:warn={outage.outages > 0}>{props.wan ? bandNote : 'no WAN sensor'}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .net { height: 100%; display: flex; flex-direction: column; gap: min(9px, 3cqh); container-type: size; min-height: 0; }
  .head { display: flex; align-items: center; gap: 8px; flex: none; min-width: 0; }
  .ttl { font-size: min(.68em, 4.4cqh); flex: none; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: min(.76em, 4.6cqh); font-weight: 650;
    background: rgba(255,255,255,.07); color: var(--muted); white-space: nowrap; flex: none; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
  .pill.up { color: #3b82f6; background: rgba(59,130,246,.15); }
  .pill.down { color: #f43f5e; background: rgba(244,63,94,.16); }
  .pill.unknown { color: #f59e0b; background: rgba(245,158,11,.15); }
  .ping { display: inline-flex; align-items: center; gap: 4px; font-size: min(.78em, 4.4cqh); color: var(--muted); white-space: nowrap; flex: none; }
  .ping em { font-style: normal; font-size: .85em; margin-left: 1px; opacity: .8; }
  .who { margin-left: auto; font-size: min(.78em, 4.4cqh); color: var(--muted); white-space: nowrap; flex: none; }
  .who.bad { color: #f43f5e; font-weight: 600; }

  .speeds { flex: none; display: flex; gap: 8px; align-items: stretch; }
  .sp { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: min(5px, 1.6cqh); padding: min(9px, 2.6cqh) 10px; border-radius: 12px; background: rgba(255,255,255,.05); }
  .sp.empty { opacity: .65; }
  .sl { display: flex; align-items: center; gap: 5px; color: var(--muted); }
  .sl .microcaps { font-size: min(.66em, 3.8cqh); }
  .sv { font-size: min(1.7em, 8cqh, 7.4cqw); font-weight: 700; letter-spacing: -.02em; line-height: 1; color: var(--c, var(--text)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sv em { font-style: normal; font-size: .5em; font-weight: 600; color: var(--muted); margin-left: 3px; }
  .track { height: min(7px, 2.2cqh); border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 999px; min-width: 2px; transition: width .7s var(--ease, ease), background-color .3s; }
  /* The shared ceiling, tucked to the right so the two bars read as one scale. */
  .scale { flex: none; align-self: flex-end; display: flex; align-items: center; font-size: min(.6em, 3.4cqh); padding-bottom: 3px; }

  .rows { flex: 1; min-height: 0; overflow: hidden; margin: 0 -6px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 4px 6px; border-radius: 10px; min-height: 27px; }
  .row .ic { color: #f43f5e; display: grid; flex: none; }
  .row.stale .ic { color: var(--muted); }
  .n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .9em; }
  .row.stale .n { color: var(--muted); }
  .s { margin-left: auto; display: inline-flex; align-items: baseline; gap: 6px; font-size: .78em; color: #f43f5e; white-space: nowrap; }
  .row.stale .s { color: var(--muted); }
  .s i { font-style: normal; opacity: .7; font-size: .9em; }
  .empty { display: flex; align-items: center; gap: 7px; padding: 6px; color: var(--muted); font-size: .86em; }
  .more { padding: 2px 6px; font-size: .76em; color: var(--muted); }

  /* One slot per quarter hour; a slot is filled only where the sensor itself
     said something other than up. Empty history is evenly lit, never faked. */
  .strip { flex: none; display: flex; flex-direction: column; gap: 4px; }
  .slots { display: flex; gap: 1px; height: min(16px, 4.4cqh); }
  .slot { flex: 1; min-width: 1px; border-radius: 2px; background: rgba(255,255,255,.12); }
  .slot.up { background: rgba(59,130,246,.55); }
  .slot.down { background: #f43f5e; }
  .strip.none .slot { background: rgba(255,255,255,.12); }
  .scap { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: min(.7em, 3.8cqh); color: var(--muted); }
  .scap .num.warn { color: #f43f5e; }

  @container (max-height: 190px) { .rows { display: none; } }
  @container (max-width: 300px) { .scale { display: none; } }
</style>
