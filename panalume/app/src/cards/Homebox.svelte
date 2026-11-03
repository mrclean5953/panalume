<script module>
  import { states } from '../lib/ha.svelte.js';

  // The home inventory at a glance. Homebox sends no CORS headers, so a browser
  // cannot read its API from a dashboard unless the server has been opened up;
  // the card therefore reads Home Assistant sensors by default and only talks to
  // the server directly when a URL and an API key are both set.
  function autofill() {
    if (!states.size) return {};
    const ids = [...states.keys()];
    const pick = (...res) => {
      for (const re of res) {
        const id = ids.find((i) => re.test(i));
        if (id) return id;
      }
      return '';
    };
    const withItems = ids.find((id) => /homebox/i.test(id) && Array.isArray(states.get(id)?.attributes?.items));
    return {
      items: pick(/^sensor\.homebox_items?$/i, /^sensor\.homebox_item_count$/i),
      locations: pick(/^sensor\.homebox_locations?$/i, /^sensor\.homebox_location_count$/i),
      recent: withItems || pick(/^sensor\.homebox_recent/i),
      maintenance: pick(/^sensor\.homebox_maintenance_due$/i, /^sensor\.homebox_.*due$/i),
      value: pick(/^sensor\.homebox_(value|value_on_hand|total_value)$/i),
    };
  }

  export const meta = {
    type: 'homebox', name: 'Homebox', icon: 'mdi:package-variant-closed', category: 'Info',
    size: { w: 420, h: 300 }, tap: 'none',
    defaults: { title: 'Homebox', items: '', locations: '', recent: '', maintenance: '', value: '', rows: 4, url: '', api_key: '', refresh: 15, link: '' },
    sections: [{ key: 'recent', label: 'Recently added' }, { key: 'extra', label: 'Maintenance / value' }],
    autofill,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'items', label: 'Items sensor', type: 'entity', domain: 'sensor', hint: 'A sensor whose state is how many items the inventory holds.' },
      { key: 'locations', label: 'Locations sensor', type: 'entity', domain: 'sensor', hint: 'How many locations the inventory has — the number of nodes in Homebox’s location tree.' },
      { key: 'recent', label: 'Recently added sensor', type: 'entity', domain: 'sensor', hint: 'A sensor whose `items` attribute lists the newest entries: name, quantity, location and created.' },
      { key: 'maintenance', label: 'Maintenance due sensor', type: 'entity', domain: 'sensor', hint: 'How many maintenance jobs are due.' },
      { key: 'value', label: 'Value on hand sensor', type: 'entity', domain: 'sensor', hint: 'A monetary sensor for the collection’s total. Blank hides the chip.' },
      { key: 'rows', label: 'Recently added rows', type: 'number', hint: 'Also the page size used against the API.' },
      { key: 'link', label: 'Homebox address', type: 'text', placeholder: 'https://homebox.example.lan', hint: 'Opens in a new tab when the title is tapped. Does not fetch anything.' },
      { key: 'url', label: 'Server URL (direct mode)', type: 'text', placeholder: 'https://homebox.example.lan', hint: 'Reads the API from this page, so the server must allow this dashboard’s origin. Homebox does not by default — leave blank to read sensors instead. Nothing is fetched unless this and the key are both set.' },
      { key: 'api_key', label: 'API key (direct mode)', type: 'text', hint: 'Created in Homebox under Settings → API keys. It is stored in the dashboard settings like any other field, so anyone who can edit this dashboard can read it.' },
      { key: 'refresh', label: 'Refresh (minutes, direct mode)', type: 'number' },
    ],
  };
</script>

<script>
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { formatNumber, unavailable, relTime } from '../lib/entity.js';
  import { fmtMoney } from '../lib/money.svelte.js';
  import { hueFor, hueWash } from '../lib/design.svelte.js';

  let { props, h = 300 } = $props();
  const show = (k) => !props.hide?.[k];

  // A prop that is not a template stringifies to "undefined", which is truthy —
  // so nothing is ever stringified before it is known to be set.
  const str = (v) => (v ? String(t(v) ?? '').trim() : '');
  const count = (v) => {
    const n = Number(v);
    return v === '' || v == null || !Number.isFinite(n) ? null : n;
  };

  // ---- Home Assistant mode ------------------------------------------------
  const haNum = (id) => {
    const e = ent(id);
    return e && !unavailable(e) ? count(e.state) : null;
  };
  const haLive = $derived(props.items ? !!ent(props.items) && !unavailable(ent(props.items)) : null);

  function fromHa(it) {
    if (!it || typeof it !== 'object') return null;
    const nm = it.name || it.title || it.item || '';
    if (!nm) return null;
    const qty = Number(it.quantity ?? it.qty ?? 1);
    return {
      name: String(nm),
      qty: Number.isFinite(qty) && qty > 1 ? qty : 0,
      where: String(it.location ?? it.parent ?? it.where ?? it.place ?? ''),
      when: it.created ?? it.added ?? it.created_at ?? it.createdAt ?? '',
    };
  }
  const haRows = $derived.by(() => {
    const e = ent(props.recent);
    const list = e && Array.isArray(e.attributes?.items) ? e.attributes.items : [];
    return list.map(fromHa).filter(Boolean);
  });

  // ---- direct mode (opt-in; silent while either field is blank) -----------
  const url = $derived(str(props.url).replace(/\/+$/, ''));
  const key = $derived(str(props.api_key));
  const directOn = $derived(!!url && !!key);
  const rowsWanted = $derived(Math.max(1, Math.min(12, Number(props.rows) || 4)));
  const every = $derived(Math.max(1, Math.min(240, Number(props.refresh) || 15)) * 60e3);

  let api = $state(null);
  let apiErr = $state('');

  $effect(() => {
    // Depends on the settings alone. Two blanks mean no request ever leaves the
    // page — the card simply draws what the sensors say.
    if (!directOn) {
      api = null;
      apiErr = '';
      return;
    }
    const base = url;
    const auth = { Authorization: 'Bearer ' + key };
    const n = rowsWanted;
    let live = true;

    const depth = (nodes) => (Array.isArray(nodes) ? nodes.reduce((a, x) => a + 1 + depth(x.children), 0) : null);
    const due = (list) => {
      // Homebox answers 500 while the maintenance table is empty; that is
      // "nothing due", not a fault. Each due job is a separate dated entry.
      if (!Array.isArray(list)) return 0;
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return list.filter((m) => {
        const when = Date.parse(m.scheduledDate ?? m.scheduled_date ?? '');
        const done = m.completedDate ?? m.completed_date;
        return Number.isFinite(when) && when <= today.getTime() && !done;
      }).length;
    };

    const load = async () => {
      try {
        const st = await fetch(base + '/api/v1/status', { cache: 'no-store' });
        if (!st.ok) throw new Error(String(st.status));
        const status = await st.json().catch(() => ({}));

        const er = await fetch(base + '/api/v1/entities?page=1&pageSize=' + n + '&orderBy=createdAt', { headers: auth, cache: 'no-store' });
        if (!er.ok) throw new Error(String(er.status));
        const list = await er.json();
        const items = count(list?.total);
        const rows = (Array.isArray(list?.items) ? list.items : []).map(fromApi).filter(Boolean);

        const [tree, mt] = await Promise.all([
          fetch(base + '/api/v1/entities/tree', { headers: auth, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(base + '/api/v1/maintenance', { headers: auth, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!live) return;
        api = {
          items,
          locations: depth(tree),
          rows,
          due: due(mt),
          value: count(list?.totalPrice),
          live: status?.health !== false,
          version: String(status?.build?.version || ''),
        };
        apiErr = '';
      } catch (err) {
        if (!live) return;
        api = null;
        const msg = String(err?.message ?? err);
        apiErr = msg === '401'
          ? 'Homebox rejected the key'
          : /^\d+$/.test(msg) ? 'Homebox answered ' + msg
          : 'Can’t reach Homebox';
      }
    };

    function fromApi(it) {
      if (!it || !it.name) return null;
      const qty = Number(it.quantity);
      return {
        name: String(it.name),
        qty: Number.isFinite(qty) && qty > 1 ? qty : 0,
        where: String(it.parent?.name || ''),
        when: it.createdAt || '',
      };
    }

    load();
    const iv = setInterval(load, every);
    return () => {
      live = false;
      clearInterval(iv);
    };
  });

  // ---- one view, whichever mode feeds it ----------------------------------
  const view = $derived.by(() => {
    if (directOn) {
      if (apiErr) return { err: apiErr, live: false };
      if (!api) return { loading: true, live: null };
      return { ...api, source: 'api' };
    }
    const any = !!(props.items || props.locations || props.recent || props.maintenance || props.value);
    if (!any) return { empty: true, live: null };
    return {
      items: haNum(props.items),
      locations: haNum(props.locations),
      due: haNum(props.maintenance),
      value: haNum(props.value),
      rows: haRows,
      live: haLive,
      source: 'ha',
    };
  });

  const rows = $derived(view.rows || []);
  const dueCount = $derived(Number(view.due) || 0);
  const valueText = $derived(view.value ? fmtMoney(view.value, 0) : '');
  const link = $derived(str(props.link) || (directOn ? url : ''));
  const blurb = $derived(str(props.title) || 'Homebox');

  // Recent additions are chips now (item 42): a wrapping row of small tinted
  // pills, each with its quantity. They're packed against the measured width so
  // the slice follows the cell instead of guessing how many fit.
  const CHIP_H = 24;
  const CHIP_GAP = 6;
  let listH = $state(0);
  let chipsW = $state(0);
  let cardH = $state(h);
  const tight = $derived(cardH < 200);
  const chipW = (r) => 20 + Math.min(160, String(r.name).length * 6.4) + (r.qty ? 18 : 0);
  const packed = $derived.by(() => {
    const width = Math.max(80, chipsW || 260);
    const lines = [];
    let line = [], used = 0;
    for (const r of rows) {
      const w = chipW(r);
      if (line.length && used + w > width) { lines.push(line); line = []; used = 0; }
      line.push(r);
      used += w + CHIP_GAP;
    }
    if (line.length) lines.push(line);
    return lines;
  });
  const rowCap = $derived(Math.max(1, Math.floor((listH + CHIP_GAP) / (CHIP_H + CHIP_GAP))));
  const flat = $derived(packed.flat());
  // One line is kept for "and N more" only when the list really overflows.
  const keep = $derived.by(() => {
    if (flat.length <= rowCap) return flat.length;
    const lines = Math.max(1, rowCap - 1);
    return packed.slice(0, lines).reduce((a, l) => a + l.length, 0);
  });
  const shown = $derived(flat.slice(0, keep));
  const rest = $derived(rows.length - shown.length);
</script>

<div class="hb" class:tight bind:clientHeight={cardH}>
  <div class="head">
    <Icon icon="mdi:package-variant-closed" size="1.05em" />
    {#if link}
      <a class="ttl" href={link} target="_blank" rel="noopener">{blurb}</a>
    {:else}
      <span class="ttl">{blurb}</span>
    {/if}
    {#if view.live != null}
      <span class="dot" class:on={view.live} class:off={!view.live} title={view.live ? 'Homebox is answering' : 'Homebox is not answering'}></span>
    {/if}
    {#if link}<a class="open" href={link} target="_blank" rel="noopener" title="Open Homebox"><Icon icon="mdi:open-in-new" size="0.95em" /></a>{/if}
  </div>

  {#if view.err}
    <div class="none"><Icon icon="mdi:server-off" size="1.5em" /><div>{view.err}</div></div>
  {:else if view.empty}
    <div class="none"><Icon icon="mdi:package-variant" size="1.5em" /><div>Pick the Homebox sensors, or give the server URL and an API key.</div></div>
  {:else}
    <div class="hero" class:grow={!rows.length}>
      <span class="big">{view.items == null ? '—' : formatNumber(view.items, 0)}</span>
      <span class="lbl">items</span>
      {#if view.locations != null}
        <span class="loc"><Icon icon="mdi:map-marker-outline" size="0.9em" />{formatNumber(view.locations, 0)}</span>
      {/if}
      {#if view.source === 'api' && view.version && !tight}<span class="ver">{view.version}</span>{/if}
    </div>

    {#if show('recent') && rows.length}
      <div class="chips" bind:clientHeight={listH} bind:clientWidth={chipsW}>
        {#each shown as r, i (i + r.name)}
          <span class="ch" style="--h:{hueFor(r.name)}; --bg:{hueWash(r.name, 0.17)}"
            title={[r.where, r.when ? relTime(r.when) : ''].filter(Boolean).join(' · ') || r.name}>
            <span class="cn">{r.name}</span>
            {#if r.qty}<span class="cq">{r.qty}</span>{/if}
          </span>
        {/each}
        {#if rest > 0}<span class="more">+{rest}</span>{/if}
      </div>
    {/if}

    {#if show('extra') && (dueCount > 0 || valueText)}
      <div class="extra">
        {#if dueCount > 0}<span class="chip warn"><Icon icon="mdi:wrench-clock" size="0.9em" />{dueCount} maintenance due</span>{/if}
        {#if valueText}<span class="chip"><Icon icon="mdi:cash-multiple" size="0.9em" />{valueText}</span>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .hb { height: 100%; display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: hidden; container-type: size; }
  .head { display: flex; align-items: center; gap: 7px; flex: none; color: var(--muted); font-size: 0.95em; }
  .ttl { color: inherit; text-decoration: none; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  a.ttl:hover { color: var(--accent); }
  .open { flex: none; color: var(--muted); display: inline-flex; }
  .open:hover { color: var(--accent); }
  .dot { flex: none; margin-left: auto; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
  .dot.on { background: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
  .dot.off { background: #f43f5e; }

  .hero { flex: none; display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .hero.grow { flex: 1; align-items: center; min-height: 0; }
  .big { font-size: min(2.5em, 34cqh, 26cqw); font-weight: 700; letter-spacing: -0.02em; line-height: 1.12; font-variant-numeric: tabular-nums; }
  .lbl { color: var(--muted); font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.09em; }
  .loc { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 0.82em; font-variant-numeric: tabular-nums; }
  .ver { flex: none; color: var(--muted); opacity: 0.7; font-size: 0.72em; }

  /* Recently added: wrapping chips, each tinted by name (item 42). */
  .chips { flex: 1; min-height: 0; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; overflow: hidden; }
  .ch {
    display: inline-flex; align-items: center; gap: 6px; height: 24px; max-width: 100%;
    padding: 0 4px 0 10px; border-radius: 999px; background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--h) 34%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05);
  }
  .cn { min-width: 0; font-size: .79em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cq {
    flex: none; min-width: 1.5em; height: 1.45em; padding: 0 5px; border-radius: 999px;
    display: grid; place-items: center; font-size: .72em; font-weight: 700;
    font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--h) 34%, transparent);
  }
  .chips .more { align-self: center; color: var(--muted); font-size: .74em; font-variant-numeric: tabular-nums; padding: 0 3px; }

  .extra { flex: none; display: flex; align-items: center; gap: 8px; white-space: nowrap; overflow: hidden; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); color: var(--muted); font-size: 0.76em; }
  .chip.warn { color: #ffc861; background: rgba(255, 200, 97, 0.12); }

  .none { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: 0.88em; text-align: center; }

  @container (max-width: 330px) {
    .lbl { display: none; }
  }
  .tight .lbl { display: none; }
  /* A short card keeps a row: the number gives up height first. */
  .tight .big { font-size: min(1.8em, 24cqh, 18cqw); }
</style>
