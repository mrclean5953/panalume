<script module>
  import { states, renderTemplate } from '../lib/ha.svelte.js';

  // Every battery-percentage sensor in the house, asked of Home Assistant as one
  // live template: the card follows new sensors without re-editing the card.
  const BATTERIES = "{{ states.sensor | selectattr('attributes.device_class', 'eq', 'battery') | map(attribute='entity_id') | join(',') }}";
  const batteries = () => String(renderTemplate(BATTERIES) || '').split(',').map((s) => s.trim()).filter(Boolean);

  export const meta = {
    type: 'batteries', name: 'Batteries', icon: 'mdi:battery-heart-variant', category: 'Info',
    size: { w: 320, h: 340 }, tap: 'none', hold: 'more-info',
    defaults: { entities: [], threshold: 20, max: 0, name: '', stale: false },
    sections: [{ key: 'bar', label: 'Level capsule' }],
    // Nothing to auto-fill: an empty list means every battery in the house.
    watch: (p) => (p.entities?.length ? p.entities : batteries()),
    fields: [
      { key: 'name', label: 'Name (blank = Batteries)', type: 'text' },
      { key: 'entities', label: 'Sensors (blank = every battery in the house)', type: 'entities', domain: 'sensor' },
      { key: 'threshold', label: 'Warn at or below (%)', type: 'number' },
      { key: 'max', label: 'Most capsules (0 = all of them)', type: 'number' },
      { key: 'stale', label: 'Also list sensors with no reading', type: 'bool' },
    ],
  };
</script>

<script>
  // One capsule per battery sensor, emptiest first: a column of little vertical
  // meters so the ones that need changing read at a glance instead of hunting
  // through a dashboard. The same card is the popup's grid of every battery.
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/tpl.js';
  import { name } from '../lib/entity.js';
  import { STATUS } from '../lib/design.svelte.js';
  let { props, h = 340 } = $props();
  const show = (k) => !props.hide?.[k];
  const level = (e) => {
    const n = Number(e?.state);
    return e && e.state !== '' && Number.isFinite(n) ? n : null;
  };
  const list = $derived((props.entities?.length ? props.entities : String(renderTemplate(BATTERIES) || '').split(',').map((s) => s.trim()).filter(Boolean))
    .map((id) => states.get(id))
    .filter(Boolean));
  const rated = $derived(list.filter((e) => level(e) != null).sort((a, b) => level(a) - level(b) || byName(a, b)));
  const stale = $derived(list.filter((e) => level(e) == null).sort(byName));
  function byName(a, b) { return String(name(a)).localeCompare(String(name(b))); }
  const threshold = $derived(Number(props.threshold ?? 20));
  const low = $derived(rated.filter((e) => level(e) <= threshold));
  const max = $derived(Number(props.max) || 0);
  const shown = $derived([...rated, ...(props.stale ? stale : [])]);
  const rows = $derived(max > 0 ? shown.slice(0, max) : shown);
  const hidden = $derived(shown.length - rows.length);
  // Sensors that are in the list but not reporting: counted, not listed, unless asked for.
  const silent = $derived(props.stale ? 0 : stale.length);
  // "Alicias Phone Battery Level" reads better as "Alicias Phone" in a list.
  const short = (e) => String(name(e)).replace(/\s+battery(\s+level)?\s*$/i, '').trim() || String(name(e));
  // Item 25: blue when healthy, amber near the line, rose under it — never green.
  const tone = (v) => (v == null ? STATUS.idle : v <= threshold ? STATUS.bad : v <= threshold * 2 ? STATUS.warn : STATUS.good);
  // Few batteries stay one centred row; many (the popup) become a grid.
  const cols = $derived(Math.max(1, Math.min(4, rows.length)));
  const few = $derived(rows.length > 0 && rows.length <= 4);
  const compact = $derived(h < 220);
</script>

<div class="bs" class:compact>
  <div class="head">
    <span class="microcaps ttl">{t(props.name) || 'Batteries'}</span>
    <span class="status">
      {#if low.length}
        <span class="chip bad press" title="{low.length} at or below {threshold}%">
          <Icon icon="mdi:battery-alert-variant-outline" size="1em" />
          <b class="num">{low.length}</b> low
        </span>
      {:else if rated.length}
        <span class="chip ok"><Icon icon="mdi:check-circle-outline" size="1em" />All good</span>
      {/if}
    </span>
  </div>

  <div class="grid" class:few style="--n:{cols}">
    {#each rows as e (e.entity_id)}
      {@const v = level(e)}
      <div
        class="cap"
        class:low={v != null && v <= threshold}
        class:stale={v == null}
        style="--c:{tone(v)}"
        title={v == null ? `${name(e)} — no reading` : `${name(e)} — ${Math.round(v)}%`}
      >
        {#if show('bar')}
          <div class="tube">
            <div class="fill" style="height:{v == null ? 0 : Math.max(2, Math.min(100, v))}%"></div>
            {#if threshold > 0 && threshold < 100}<div class="mark" style="bottom:{threshold}%"></div>{/if}
            {#if v == null}<span class="q">?</span>{/if}
          </div>
        {/if}
        <div class="nm">{short(e)}</div>
        <div class="pc num" class:dim={v == null}>{#if v == null}—{:else}{Math.round(v)}<small>%</small>{/if}</div>
      </div>
    {/each}
    {#if !rows.length}
      <div class="empty"><Icon icon="mdi:battery-off-outline" size="1.1em" /> No battery sensors found</div>
    {/if}
  </div>

  {#if hidden > 0 || silent > 0}
    <div class="tail">
      {#if hidden > 0}<span class="more press">and {hidden} more</span>{/if}
      {#if silent > 0}<span class="more">{silent} with no reading</span>{/if}
    </div>
  {/if}
</div>

<style>
  .bs { height: 100%; display: flex; flex-direction: column; gap: min(8px, 2.4cqh); container-type: size; min-height: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; min-width: 0; }
  .ttl { font-size: min(.68em, 4.2cqh); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .chip { display: inline-flex; align-items: center; gap: 4px; font-size: min(.72em, 4.4cqh); font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .chip b { font-weight: 800; }
  .chip.bad { color: #f43f5e; background: rgba(244,63,94,.15); }
  .chip.ok { color: #3b82f6; background: rgba(59,130,246,.16); }

  /* The capsules: auto-fill columns so 1, 3 or 29 all lay out sensibly. */
  .grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 78px), 1fr)); grid-auto-rows: minmax(76px, 1fr); gap: min(10px, 3cqh) 6px; align-content: stretch; overflow-y: auto; overflow-x: hidden; padding: 2px 1px 0; margin: 0 -1px; }
  .grid.few { grid-template-columns: repeat(var(--n, 3), minmax(0, 104px)); justify-content: center; grid-auto-rows: minmax(0, 1fr); }
  .cap { min-width: 0; height: 100%; display: flex; flex-direction: column; align-items: center; gap: min(4px, 1.2cqh); }

  .tube {
    position: relative; flex: 1; width: min(30px, 58%); min-width: 15px; min-height: 22px;
    border-radius: 999px; overflow: hidden;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  }
  .fill {
    position: absolute; left: 0; right: 0; bottom: 0; border-radius: 999px;
    background: linear-gradient(0deg, color-mix(in srgb, var(--c) 52%, transparent), var(--c));
    box-shadow: 0 0 14px color-mix(in srgb, var(--c) 40%, transparent);
    transition: height .7s var(--ease, ease);
  }
  .low .fill { box-shadow: 0 0 16px color-mix(in srgb, var(--c) 60%, transparent); }
  /* The warn line on the tube, so a level reads against the threshold. */
  .mark { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(255,255,255,.22); pointer-events: none; }
  .q { position: absolute; inset: 0; display: grid; place-items: center; font-size: min(.9em, 5cqh); color: var(--muted); }
  .stale .tube { border-style: dashed; background: rgba(255,255,255,.03); }

  .nm {
    width: 100%; text-align: center; color: var(--muted);
    font-size: min(.72em, 4.3cqh); line-height: 1.15;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    word-break: break-word;
  }
  .low .nm { color: var(--text); font-weight: 600; }
  .pc { font-weight: 700; font-size: min(.95em, 5.6cqh); line-height: 1; font-variant-numeric: tabular-nums; color: var(--c); white-space: nowrap; }
  .pc small { font-size: .66em; font-weight: 600; margin-left: 1px; opacity: .8; }
  .pc.dim { color: var(--muted); font-weight: 500; }

  .tail { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: min(.72em, 4.2cqh); color: var(--muted); }
  .more { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { grid-column: 1 / -1; display: flex; align-items: center; gap: 7px; padding: 10px 6px; color: var(--muted); font-size: .88em; }

  .compact .nm { -webkit-line-clamp: 1; }
  .compact .pc { font-size: min(.84em, 5.4cqh); }
  @container (max-height: 150px) { .nm { display: none; } }
</style>
