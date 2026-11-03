<script module>
  import { states } from '../lib/ha.svelte.js';
  // An Unraid (or similar NAS) box at a glance: how full the array is and what
  // is left, CPU and memory load, the CPU and drive temperatures, what the
  // containers are doing, and how long it has been up.
  //
  // Autofill keys off a `<prefix>_array_used` sensor and then looks for that
  // prefix's siblings, which is the shape a template or REST set built on an
  // Unraid API produces. Every entity is optional and pickable by hand.
  function autofill() {
    const ids = [...states.keys()];
    const base = ids.map((id) => /^sensor\.(.+)_array_used$/.exec(id)?.[1]).find(Boolean);
    if (!base) return {};
    const has = (...names) => {
      for (const n of names) if (states.has(`sensor.${base}_${n}`)) return `sensor.${base}_${n}`;
      return '';
    };
    return {
      array_used: `sensor.${base}_array_used`,
      array_free: has('array_free', 'array_space_free'),
      cpu: has('cpu_usage', 'cpu_load', 'cpu'),
      ram: has('ram_usage', 'memory_usage', 'ram'),
      cpu_temp: has('cpu_temperature', 'cpu_temp'),
      disk_temp: has('disk_temperature', 'disk_temp', 'hottest_drive_temperature'),
      containers: has('containers', 'containers_running', 'docker_containers'),
      containers_running: has('containers_running', 'docker_running'),
      containers_stopped: has('containers_stopped', 'docker_stopped'),
      containers_unhealthy: has('containers_unhealthy', 'docker_unhealthy'),
      ups_runtime: has('ups_runtime', 'ups_battery_runtime'),
      ups_load: has('ups_load', 'ups_load_percent'),
      uptime: has('uptime', 'server_uptime'),
    };
  }
  export const meta = {
    type: 'unraid', name: 'Unraid', icon: 'mdi:server', category: 'Info',
    size: { w: 440, h: 240 }, tap: 'more-info',
    defaults: {
      array_used: '', array_free: '', cpu: '', ram: '', cpu_temp: '', disk_temp: '',
      containers: '', containers_running: '', containers_stopped: '', containers_unhealthy: '',
      ups_runtime: '', ups_load: '', uptime: '',
    },
    autofill,
    sections: [
      { key: 'array', label: 'Array' },
      { key: 'load', label: 'CPU / RAM / containers' },
      { key: 'temps', label: 'Temperatures' },
      { key: 'ups', label: 'UPS' },
      { key: 'foot', label: 'Free space / uptime' },
    ],
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Unraid' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'array_used', label: 'Array used %', type: 'entity', domain: 'sensor' },
      { key: 'array_free', label: 'Array free (optional)', type: 'entity', domain: 'sensor', section: 'foot' },
      { key: 'cpu', label: 'CPU %', type: 'entity', domain: 'sensor', section: 'load' },
      { key: 'ram', label: 'Memory %', type: 'entity', domain: 'sensor', section: 'load' },
      { key: 'cpu_temp', label: 'CPU temperature', type: 'entity', domain: 'sensor', section: 'temps' },
      { key: 'disk_temp', label: 'Drive temperature (optional)', type: 'entity', domain: 'sensor', section: 'temps' },
      { key: 'containers', label: 'Containers (total)', type: 'entity', domain: 'sensor', section: 'load' },
      { key: 'containers_running', label: 'Containers running (optional)', type: 'entity', domain: 'sensor', section: 'load' },
      { key: 'containers_stopped', label: 'Containers stopped (optional)', type: 'entity', domain: 'sensor', section: 'load' },
      { key: 'containers_unhealthy', label: 'Containers unhealthy (optional)', type: 'entity', domain: 'sensor', section: 'load' },
      { key: 'ups_runtime', label: 'UPS runtime (optional)', type: 'entity', domain: 'sensor', section: 'ups', hint: 'Seconds, minutes, hours or days — the card converts from the unit.' },
      { key: 'ups_load', label: 'UPS load % (optional)', type: 'entity', domain: 'sensor', section: 'ups' },
      { key: 'uptime', label: 'Uptime (optional)', type: 'entity', domain: 'sensor', section: 'foot' },
    ],
  };
</script>

<script>
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { formatNumber } from '../lib/entity.js';
  import { STATUS, countUp, easeTo, mmss } from '../lib/design.svelte.js';
  let { props, w = 440, h = 240 } = $props();
  const show = (k) => !props.hide?.[k];
  const num = (id) => { const v = Number(ent(id)?.state); return id && Number.isFinite(v) ? v : null; };
  const unitOf = (id) => ent(id)?.attributes.unit_of_measurement || '';

  const used = $derived(num(props.array_used));
  // Item 57: the array figure counts up to its target.
  const usedShown = countUp(() => used ?? 0);
  // The array's own state rides along as an attribute on the usage sensor, so a
  // box that is stopped reads as stopped rather than as an empty array.
  const arrayState = $derived(String(ent(props.array_used)?.attributes?.state ?? '').toUpperCase());
  const stopped = $derived(/STOP|MAINT|DISABLE|STARTING/.test(arrayState));
  const chip = $derived(
    /MAINT/.test(arrayState) ? 'Maintenance'
    : /STARTED/.test(arrayState) ? 'Started'
    : /STOP/.test(arrayState) ? 'Stopped'
    : /SYNC|CHECK|REBUILD/.test(arrayState) ? 'Working'
    : '');
  const barColor = $derived(used == null ? 'var(--muted)' : used >= 90 ? STATUS.bad : used >= 80 ? STATUS.warn : STATUS.good);
  const pct = $derived(used == null ? 0 : Math.max(0, Math.min(100, used)));

  const free = $derived.by(() => {
    if (!show('foot')) return '';
    const e = ent(props.array_free);
    const v = Number(e?.state);
    if (!e || !Number.isFinite(v)) return '';
    const d = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${formatNumber(v, d)} ${unitOf(props.array_free) || 'TB'} free`;
  });
  const up = $derived.by(() => {
    if (!show('foot')) return '';
    const e = ent(props.uptime);
    const v = Number(e?.state);
    if (!e || !Number.isFinite(v)) return '';
    return `up ${formatNumber(v, v >= 100 ? 0 : 1)} ${unitOf(props.uptime) || 'd'}`;
  });
  const drives = $derived.by(() => {
    if (!show('temps')) return '';
    const v = num(props.disk_temp);
    return v == null ? '' : `drives ${formatNumber(v, 0)}°`;
  });
  const foot = $derived([free, drives, up].filter(Boolean).join(' · '));

  // ---- containers, stacked by state -------------------------------------
  // A breakdown may come from sibling sensors or from attributes on the total;
  // with neither, the card shows one bar and the count rather than guessing.
  const parts = $derived.by(() => {
    if (!show('load') || !props.containers) return null;
    const a = ent(props.containers)?.attributes || {};
    const pick = (id, key) => {
      const v = num(id);
      if (v != null) return v;
      const av = Number(a[key]);
      return Number.isFinite(av) ? av : null;
    };
    const running = pick(props.containers_running, 'running');
    const stopped = pick(props.containers_stopped, 'stopped');
    const unhealthy = pick(props.containers_unhealthy, 'unhealthy');
    const known = [running, stopped, unhealthy].filter((v) => v != null);
    if (!known.length) return null;
    const out = { running: running ?? 0, stopped: stopped ?? 0, unhealthy: unhealthy ?? 0 };
    out.total = known.reduce((a, b) => a + b, 0);
    return out;
  });
  const got = $derived(num(props.containers));
  const totalContainers = $derived(got ?? parts?.total ?? null);
  const segs = $derived.by(() => {
    if (!parts) return [];
    return [
      { k: 'Running', n: parts.running, c: STATUS.good },
      { k: 'Stopped', n: parts.stopped, c: 'rgba(255,255,255,.30)' },
      { k: 'Unhealthy', n: parts.unhealthy, c: STATUS.bad },
    ].filter((s) => s.n > 0);
  });

  // ---- UPS (only when the entities are actually set) --------------------
  const rt = $derived.by(() => {
    if (!show('ups') || !props.ups_runtime) return null;
    const e = ent(props.ups_runtime);
    const v = Number(e?.state);
    if (!e || !Number.isFinite(v) || v < 0) return null;
    const u = String(e.attributes.unit_of_measurement || 's').toLowerCase();
    const sec = u.startsWith('h') ? v * 3600 : u.startsWith('min') ? v * 60 : u.startsWith('d') ? v * 86400 : v;
    return {
      sec,
      frac: Math.min(1, sec / 3600),
      text: sec < 3600 ? mmss(sec) : `${Math.round(sec / 60)} min`,
    };
  });
  const ld = $derived.by(() => {
    if (!show('ups') || !props.ups_load) return null;
    const e = ent(props.ups_load);
    const v = Number(e?.state);
    const u = String(e.attributes?.unit_of_measurement || '%').toLowerCase();
    if (!e || !Number.isFinite(v) || !(u === '%' || u === '')) return null;
    const p = Math.max(0, Math.min(100, v));
    return { p, c: p >= 85 ? STATUS.bad : p >= 60 ? STATUS.warn : STATUS.good };
  });
  const ring = easeTo(() => rt?.frac ?? 0);
  const R = 15.5;
  const C = 2 * Math.PI * R;

  const tiles = $derived.by(() => {
    const out = [];
    if (show('load') && props.cpu) out.push({ k: 'CPU', v: num(props.cpu), u: '%', d: 0 });
    if (show('load') && props.ram) out.push({ k: 'RAM', v: num(props.ram), u: '%', d: 0 });
    if (show('temps') && props.cpu_temp) out.push({ k: 'CPU temp', v: num(props.cpu_temp), u: '°', d: 0 });
    return out;
  });

  const small = $derived(h < 170);
  const narrow = $derived(w < 300);
  // A short card is one line: the number and its bar, then as many readings as
  // fit beside it. Estimating the width keeps the row from ellipsising.
  const shortParts = $derived.by(() => {
    const extra = totalContainers == null ? [] : [`Containers ${formatNumber(totalContainers, 0)}`];
    const all = [...tiles.filter((x) => x.v != null).map((x) => `${x.k} ${formatNumber(x.v, x.d)}${x.u}`), ...extra];
    const avail = Math.max(60, w - 132);
    const out = [];
    let run = 0;
    for (const part of all) {
      const px = part.length * 7.6 + (out.length ? 14 : 0);
      if (run + px > avail) break;
      run += px;
      out.push(part);
    }
    return out;
  });
</script>

<div class="ur" class:small class:narrow class:stopped>
  <div class="head">
    {#if !small}<span class="ic"><Icon icon={t(props.icon) || 'mdi:server'} size="1.05em" /></span>{/if}
    <span class="name">{t(props.name) || 'Unraid'}</span>
    {#if chip}<span class="chip">{chip}</span>{/if}
  </div>

  {#if small}
    <div class="sline">
      <span class="lnum num">{used == null ? '—' : formatNumber(usedShown(), 0)}<em>{used == null ? '' : '%'}</em></span>
      <div class="sbar"><i style="width:{pct}%;background:{barColor}"></i></div>
    </div>
    {#if shortParts.length}
      <div class="schips">{#each shortParts as part}<span class="sc num">{part}</span>{/each}</div>
    {/if}
    {#if foot && h >= 140}<div class="foot" title={foot}>{foot}</div>{/if}
  {:else}
    <div class="array">
      <div class="arow">
        <span class="microcaps ak">Array</span>
        <span class="av num">{used == null ? '—' : formatNumber(usedShown(), 0)}<em>{used == null ? '' : '%'}</em></span>
      </div>
      <div class="bar"><i style="width:{pct}%;background:{barColor}"></i></div>
    </div>

    {#if tiles.length}
      <div class="tiles" class:few={tiles.length < 3} style="--n:{Math.min(tiles.length, 3)}">
        {#each tiles as x}
          <div class="tile" class:dim={x.v == null}>
            <span class="microcaps tk">{x.k}</span>
            <span class="tv num">{x.v == null ? '—' : formatNumber(x.v, x.d)}<em>{x.v == null ? '' : x.u}</em></span>
          </div>
        {/each}
      </div>
    {/if}

    {#if (show('load') && props.containers) || (show('ups') && (rt || ld))}
      <div class="pair">
        {#if show('load') && props.containers}
          <div class="panel cont" title={segs.length ? 'Containers by state' : 'Container state not reported — total only'}>
            <div class="ptop">
              <span class="microcaps">Containers</span>
              <span class="pn num">{totalContainers == null ? '—' : formatNumber(totalContainers, 0)}</span>
            </div>
            {#if segs.length}
              <div class="stack">
                {#each segs as s}<span class="seg" style="flex:{s.n};background:{s.c}" title="{s.k}: {s.n}"></span>{/each}
              </div>
              <div class="legend">
                {#each segs as s}<span class="lg"><i style="background:{s.c}"></i>{s.k}<b class="num">{s.n}</b></span>{/each}
              </div>
            {:else}
              <div class="single"><i style="width:100%"></i></div>
              <div class="legend"><span class="lg"><i style="background:rgba(255,255,255,.30)"></i>total<b class="num">{totalContainers == null ? '—' : formatNumber(totalContainers, 0)}</b></span></div>
            {/if}
          </div>
        {/if}

        {#if show('ups') && (rt || ld)}
          <div class="panel ups">
            {#if rt}
              <div class="ringbox">
                <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle class="tr" cx="18" cy="18" r={R} />
                  <circle class="pr" cx="18" cy="18" r={R} stroke-dasharray={C} stroke-dashoffset={C * (1 - ring())} />
                </svg>
                <div class="rt">
                  <span class="rv num">{rt.text}</span>
                  <span class="microcaps">Runtime</span>
                </div>
              </div>
            {/if}
            {#if ld}
              <div class="load">
                <div class="ltop"><span class="microcaps">Load</span><span class="lv num">{formatNumber(ld.p, 0)}<em>%</em></span></div>
                <div class="ltrack"><i style="width:{ld.p}%;background:{ld.c}"></i></div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if foot}<div class="foot" title={foot}>{foot}</div>{/if}
  {/if}
</div>

<style>
  .ur { height: 100%; display: flex; flex-direction: column; gap: min(8px, 2.6cqh); container-type: size; min-width: 0; }
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; flex: none; }
  .ic { width: 1.9em; height: 1.9em; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); flex: none; }
  .name { font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip { font-size: .72em; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: rgba(59,130,246,.18); color: #3b82f6; white-space: nowrap; flex: none; }
  .stopped .chip { background: rgba(255,255,255,.08); color: var(--muted); }

  .array { flex: none; }
  .arow { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .ak { font-size: min(.66em, 4.2cqh); letter-spacing: .14em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .av { font-size: min(2.05em, 11cqh, 18cqw); font-weight: 700; letter-spacing: -.02em; line-height: 1.02; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .av em { font-style: normal; font-size: .48em; color: var(--muted); margin-left: 1px; }
  .bar { height: min(7px, 2.6cqh); border-radius: 5px; background: rgba(255,255,255,.09); overflow: hidden; margin-top: 4px; }
  .bar i { display: block; height: 100%; border-radius: 5px; transition: width .6s var(--ease, ease), background .3s; }

  /* The readings reflow: three across on a wide card, a pair stays a pair. */
  .tiles { flex: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 78px), 1fr)); gap: min(7px, 2.2cqh); }
  .tiles.few { grid-template-columns: repeat(var(--n, 2), minmax(0, 168px)); justify-content: start; }
  .tile { min-width: 0; border-radius: 10px; background: rgba(255,255,255,.05); padding: min(5px, 1.8cqh) 9px; display: flex; flex-direction: column; justify-content: center; gap: 1px; overflow: hidden; }
  .tk, .tv { flex: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tk { font-size: min(.62em, 3.8cqh); }
  .tv { font-size: min(1.22em, 6.6cqh, 9cqw); font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .tv em { font-style: normal; font-size: .62em; color: var(--muted); }
  .dim .tv { color: var(--muted); font-weight: 500; }

  /* Containers + UPS share one row so neither pushes the array off the card. */
  .pair { flex: 1; min-height: 0; display: flex; gap: min(8px, 2.4cqh); }
  .panel { min-width: 0; border-radius: 11px; background: rgba(255,255,255,.045); padding: min(7px, 2.2cqh) 9px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
  .cont { flex: 1.35; justify-content: center; }
  .ups { flex: 1; flex-direction: row; align-items: center; gap: 8px; }
  .ptop { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .ptop .microcaps { font-size: min(.6em, 3.6cqh); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn { font-size: min(1.05em, 5.6cqh); font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }

  .stack, .single { display: flex; gap: 2px; height: min(9px, 3cqh); border-radius: 5px; overflow: hidden; background: rgba(255,255,255,.06); }
  .seg { min-width: 3px; height: 100%; border-radius: 3px; transition: flex .5s var(--ease, ease); }
  .single { display: block; }
  .single i { display: block; height: 100%; border-radius: 5px; background: rgba(255,255,255,.28); }
  .legend { display: flex; flex-wrap: wrap; gap: 3px 9px; font-size: min(.62em, 3.6cqh); color: var(--muted); overflow: hidden; min-height: 0; }
  .lg { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .lg i { width: 6px; height: 6px; border-radius: 2px; flex: none; }
  .lg b { font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

  .ringbox { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; }
  .ring { width: min(40px, 11cqh); height: min(40px, 11cqh); flex: none; transform: rotate(-90deg); }
  .tr, .pr { fill: none; stroke-width: 3; }
  .tr { stroke: rgba(255,255,255,.10); }
  .pr { stroke: #3b82f6; stroke-linecap: round; transition: stroke-dashoffset .6s var(--ease, ease); }
  .rt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .rv { font-size: min(.98em, 5.2cqh); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rt .microcaps { font-size: min(.56em, 3.4cqh); white-space: nowrap; }
  .load { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .ltop { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
  .ltop .microcaps { font-size: min(.56em, 3.4cqh); }
  .lv { font-size: min(.85em, 4.6cqh); font-weight: 700; font-variant-numeric: tabular-nums; }
  .lv em { font-style: normal; font-size: .7em; color: var(--muted); }
  .ltrack { height: min(6px, 2.2cqh); border-radius: 4px; background: rgba(255,255,255,.09); overflow: hidden; }
  .ltrack i { display: block; height: 100%; border-radius: 4px; transition: width .6s var(--ease, ease), background .3s; }

  .foot { flex: none; font-size: min(.72em, 4.2cqh); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .sline { flex: none; display: flex; align-items: center; gap: 10px; }
  .lnum { font-size: min(1.9em, 12cqh, 16cqw); font-weight: 700; letter-spacing: -.02em; line-height: 1.05; flex: none; font-variant-numeric: tabular-nums; }
  .lnum em { font-style: normal; font-size: .5em; color: var(--muted); }
  .sbar { flex: 1; min-width: 24px; height: min(8px, 3cqh); border-radius: 5px; background: rgba(255,255,255,.09); overflow: hidden; }
  .sbar i { display: block; height: 100%; border-radius: 5px; transition: width .6s, background .3s; }
  .schips { flex: 1; min-height: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
  .sc { font-size: min(.76em, 4.8cqh); padding: 3px 9px; border-radius: 99px; background: rgba(255,255,255,.06); color: var(--muted); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }

  @container (max-height: 215px) { .pair { display: none; } }
  @container (max-width: 300px) { .legend { display: none; } }
</style>
