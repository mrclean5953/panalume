<script module>
  import { states } from '../lib/ha.svelte.js';
  // The shopping list if there is one, otherwise the first to-do list.
  const autofill = () => {
    const ids = [...states.keys()].filter((id) => id.startsWith('todo.')).sort();
    return { entity: ids.find((id) => id === 'todo.shopping_list') || ids[0] || '' };
  };
  export const meta = {
    type: 'todo', name: 'To-do list', icon: 'mdi:clipboard-check-outline', category: 'Info',
    size: { w: 320, h: 360 }, tap: 'none',
    defaults: { entity: '', add: true, done: true, max: 0 },
    autofill,
    sections: [{ key: 'head', label: 'Title' }, { key: 'fit', label: 'Fit' }],
    fields: [
      { key: 'entity', label: 'List', type: 'entity', domain: 'todo', hint: 'Home Assistant\'s shopping list, a Local to-do list, Todoist, Google Tasks…' },
      { key: 'name', label: 'Title (blank = the list\'s name)', type: 'text' },
      { key: 'add', label: 'Add items from the card', type: 'bool' },
      { key: 'done', label: 'Show ticked items (under "Done")', type: 'bool' },
      { key: 'max', label: 'Most open items shown (0 = as many as fit)', type: 'number' },
    ],
  };
</script>

<script>
  // A to-do list from Home Assistant (shopping list, Local to-do, Todoist…): tick items off,
  // add new ones, and clear the ticked ones. Live: changes from anywhere show at once.
  // Item 47: the open count is this card's one hero — a big numeral behind a small
  // micro-caps label, with everything else a step down from it.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { subscribe, callService, conn } from '../lib/ha.svelte.js';
  import { name } from '../lib/entity.js';
  import { STATUS, countUp, MOTION } from '../lib/design.svelte.js';

  let { props, h = 360 } = $props();
  const show = (k) => !props.hide?.[k];

  const e = $derived(ent(props.entity));
  const id = $derived(e?.entity_id || '');
  // What the list allows (HA's TodoListEntityFeature): add 1, remove 2, update (tick) 4.
  const feat = $derived(Number(e?.attributes.supported_features) || 0);
  const canAdd = $derived(!!(feat & 1));
  const canRemove = $derived(!!(feat & 2));
  const canTick = $derived(!!(feat & 4));

  let items = $state([]);
  let loaded = $state(false);
  $effect(() => {
    if (!id || !conn.connected) return;
    loaded = false;
    return subscribe({ type: 'todo/item/subscribe', entity_id: id }, (ev) => { items = ev.items || []; loaded = true; });
  });
  const open = $derived(items.filter((i) => i.status !== 'completed'));
  const done = $derived(items.filter((i) => i.status === 'completed'));
  let showDone = $state(false);

  const call = (svc, data) => callService('todo', svc, data, { entity_id: id });

  // Item 60: the row is kept on screen while the strike-through draws and the
  // checkbox fills, then it settles out — never a grey row left looking unticked.
  let leaving = $state({});
  const ikey = (item) => item.uid || item.summary;
  function tick(item) {
    if (!canTick) return;
    const nowDone = item.status !== 'completed';
    const status = nowDone ? 'completed' : 'needs_action';
    items = items.map((i) => (i === item ? { ...i, status } : i));
    if (nowDone) {
      const k = ikey(item);
      leaving = { ...leaving, [k]: true };
      setTimeout(() => {
        const next = { ...leaving };
        delete next[k];
        leaving = next;
      }, MOTION.slow + 100);
    }
    call('update_item', { item: ikey(item), status });
  }
  const rows = $derived(items.filter((i) => i.status !== 'completed' || leaving[ikey(i)]));

  let text = $state('');
  function add(ev) {
    ev?.preventDefault();
    const s = text.trim();
    if (!s || !canAdd) return;
    call('add_item', { item: s });
    text = '';
  }
  const clearDone = () => call('remove_completed_items', {});

  // Delete is confirmed on the row, same two taps as the chores board, so a stray
  // tap on a wall panel does not bin the shopping list.
  let pending = $state('');
  function remove(item) {
    if (!canRemove) return;
    call('remove_item', { item: ikey(item) });
    pending = '';
    items = items.filter((i) => i !== item);
  }

  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  function due(item) {
    if (!item.due) return null;
    const d = new Date(item.due.length <= 10 ? `${item.due}T00:00` : item.due);
    if (isNaN(d)) return null;
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today()) / 864e5);
    const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, diff > 1 && diff < 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
    return { label, late: diff < 0 && item.status !== 'completed', soon: diff === 0 };
  }
  const dueToday = $derived(open.filter((i) => due(i)?.soon).length);
  const overdue = $derived(open.filter((i) => due(i)?.late).length);

  const title = $derived(t(props.name) || name(e) || 'To-do');
  const small = $derived(h < 170);

  // Item 57: counts ease to their new value instead of snapping.
  const openNum = countUp(() => open.length);
  const doneNum = countUp(() => done.length);

  // Fit the card: measure the list and divide by the row pitch (the same clamp the
  // CSS uses for --row), so a long list is sliced with a "+N more" rather than
  // pushed out of the box.
  let listH = $state(0);
  const pitch = $derived(Math.round(Math.min(34, Math.max(22, h * 0.075))) + 2);
  const slice = $derived.by(() => {
    const hard = Number(props.max) > 0 ? Math.max(1, Math.floor(Number(props.max))) : Infinity;
    if (!listH) return hard;
    const bar = props.done !== false && done.length ? pitch : 0;
    const room = Math.max(1, Math.floor((listH - bar) / pitch));
    return Math.min(hard, room);
  });
  const shownRows = $derived(slice === Infinity ? rows : rows.slice(0, slice));
  const extra = $derived(Math.max(0, open.length - shownRows.length));
</script>

<div class="todo" class:small style="--bad:{STATUS.bad};--warn:{STATUS.warn};--good:{STATUS.good}">
  {#if show('head') && !small}
    <div class="head">
      <Icon icon={e?.attributes.icon || 'mdi:clipboard-check-outline'} size="1.1em" />
      <span class="microcaps t">{title}</span>
      {#if loaded}
        <span class="hero">
          <span class="hero-num num grad-num" style="--grad-b:{overdue ? STATUS.bad : open.length ? '#ffffff' : STATUS.good}">{Math.round(openNum())}</span>
          <span class="microcaps hl">left</span>
        </span>
      {/if}
    </div>
    {#if loaded && (overdue || dueToday)}
      <div class="flags">
        {#if overdue}<span class="flag bad" style="--c:{STATUS.bad}"><Icon icon="mdi:alert-circle-outline" size=".95em" />{overdue} overdue</span>{/if}
        {#if dueToday}<span class="flag warn" style="--c:{STATUS.warn}"><Icon icon="mdi:clock-outline" size=".95em" />{dueToday} today</span>{/if}
      </div>
    {/if}
  {/if}

  {#if !props.entity}
    <div class="msg">Pick a to-do list in the card's settings.</div>
  {:else if !e}
    <div class="msg">List not found</div>
  {:else}
    {#if props.add !== false && canAdd && !small}
      <form class="add" onsubmit={add} data-stop>
        <input bind:value={text} placeholder="Add an item" enterkeyhint="done" />
        <button type="submit" disabled={!text.trim()} aria-label="Add"><Icon icon="mdi:plus" size="1.1em" /></button>
      </form>
    {/if}

    <div class="list" bind:clientHeight={listH} data-stop>
      {#each shownRows as item (ikey(item))}
        {@const d = due(item)}
        {@const k = ikey(item)}
        {#if pending === k}
          <div class="row ask">
            <span class="tx">{item.summary}</span>
            <button class="yes" onclick={() => remove(item)}>Delete</button>
            <button class="no" onclick={() => (pending = '')} title="Keep it"><Icon icon="mdi:close" size=".9em" /></button>
          </div>
        {:else}
          <div class="row" class:done={item.status === 'completed'}>
            <button class="it" onclick={() => tick(item)} disabled={!canTick} title={item.summary}>
              <span class="box"><Icon icon="mdi:check" size=".72em" /></span>
              <span class="tx">{item.summary}</span>
              {#if d}
                <span class="due" class:late={d.late} class:soon={d.soon} style="--c:{d.late ? STATUS.bad : d.soon ? STATUS.warn : 'transparent'}">{d.label}</span>
              {/if}
            </button>
            {#if canRemove}
              <button class="del" onclick={() => (pending = k)} title="Delete this item">
                <Icon icon="mdi:trash-can-outline" size=".9em" />
              </button>
            {/if}
          </div>
        {/if}
      {:else}
        {#if loaded}<div class="empty"><Icon icon="mdi:check-all" size="1.3em" />All done</div>{/if}
      {/each}

      {#if extra > 0}
        <div class="more microcaps num">+{extra} more</div>
      {/if}

      {#if props.done !== false && done.length}
        <div class="donebar">
          <button class="microcaps dt" onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
            <Icon icon={showDone ? 'mdi:chevron-down' : 'mdi:chevron-right'} size="1.05em" />
            Done <span class="num dn">{Math.round(doneNum())}</span>
          </button>
          {#if canRemove}<button class="clear" onclick={clearDone}>Clear</button>{/if}
        </div>
        {#if showDone}
          {#each done.filter((i) => !leaving[ikey(i)]) as item (ikey(item))}
            <div class="row done">
              <button class="it" onclick={() => tick(item)} disabled={!canTick}>
                <span class="box"><Icon icon="mdi:check" size=".72em" /></span>
                <span class="tx">{item.summary}</span>
              </button>
            </div>
          {/each}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .todo {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
    container-type: size;
    --row: clamp(22px, 7.5cqh, 34px);
  }

  /* Item 46: the header is a micro-caps label; item 47: the count beside it is
     the one hero numeral on the card. */
  .head { display: flex; align-items: center; gap: 8px; min-width: 0; flex: none; }
  .head :global(svg) { color: var(--accent); flex: none; }
  .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hero { flex: none; display: flex; align-items: baseline; gap: 5px; }
  .hero .hero-num { font-size: min(2.6em, 11cqh); }
  .hl { letter-spacing: 0.14em; }

  .flags { flex: none; display: flex; flex-wrap: wrap; gap: 5px; }
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px 1px 5px;
    border-radius: 999px;
    font-size: 0.66em;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--c) 72%, var(--text));
    background: color-mix(in srgb, var(--c) 16%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent);
  }

  .msg { flex: 1; display: grid; place-items: center; text-align: center; color: var(--muted); font-size: 0.85em; }

  .add { display: flex; gap: 6px; flex: none; }
  .add input {
    flex: 1;
    min-width: 0;
    padding: min(8px, 2cqh) 11px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font: inherit;
    font-size: 0.86em;
  }
  .add input:focus { outline: none; border-color: var(--accent); }
  .add button {
    flex: none;
    width: 2.3em;
    border: 0;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--text);
    display: grid;
    place-items: center;
  }
  .add button:disabled { opacity: 0.4; }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scrollbar-width: thin;
    mask-image: linear-gradient(to bottom, #000 calc(100% - 10px), transparent);
  }

  .row { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .row .it { flex: 1; min-width: 0; }
  .it {
    display: flex;
    align-items: center;
    gap: min(10px, 3cqw);
    width: 100%;
    min-height: var(--row);
    padding: 0 4px;
    border: 0;
    border-radius: 9px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .it:active:not(:disabled) { background: rgba(255, 255, 255, 0.05); }
  .it:disabled { cursor: default; }

  .box {
    flex: none;
    width: min(1.2em, 4.2cqh);
    height: min(1.2em, 4.2cqh);
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.32);
    display: grid;
    place-items: center;
    color: #0b0f17;
    transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease-spring);
  }
  .box :global(svg) { opacity: 0; transition: opacity var(--dur) var(--ease) 40ms; }
  .row.done .box { background: var(--good); border-color: var(--good); transform: scale(1.04); }
  .row.done .box :global(svg) { opacity: 1; }

  .tx {
    flex: 1;
    min-width: 0;
    position: relative;
    font-size: 0.9em;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Item 60: the strike draws across the label over ~200ms, then the row fades. */
  .tx::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 54%;
    height: 1.5px;
    background: color-mix(in srgb, var(--text) 60%, transparent);
    transform: scaleX(0);
    transform-origin: left center;
    transition: transform 200ms var(--ease);
  }
  .row.done .tx::after { transform: scaleX(1); }
  .row.done { opacity: 0.4; transition: opacity 260ms var(--ease) 60ms; }

  .due {
    flex: none;
    font-size: 0.66em;
    font-weight: 650;
    letter-spacing: 0.02em;
    padding: 1px 7px;
    border-radius: 999px;
    color: color-mix(in srgb, var(--c) 74%, var(--text));
    background: color-mix(in srgb, var(--c) 15%, transparent);
    white-space: nowrap;
  }
  .due.late { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bad) 34%, transparent); }

  .del { flex: none; opacity: 0.28; background: none; border: 0; color: inherit; padding: 2px; cursor: pointer; }
  .del:hover { opacity: 0.9; color: var(--bad); }

  .row.ask { background: rgba(244, 63, 94, 0.12); border-radius: 8px; padding: 2px 4px; min-height: var(--row); }
  .row.ask .tx { font-size: 0.82em; }
  .yes {
    flex: none;
    background: rgba(244, 63, 94, 0.24);
    color: #ffd7dd;
    border: 0;
    border-radius: 6px;
    padding: 2px 7px;
    font-size: 0.72em;
    cursor: pointer;
  }
  .no { flex: none; background: none; border: 0; color: var(--muted); padding: 2px 4px; cursor: pointer; display: inline-flex; }

  .more { flex: none; padding: 2px 4px; color: var(--muted); font-size: 0.56em; letter-spacing: 0.1em; }

  .empty {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    padding: 14px 0;
    color: color-mix(in srgb, var(--good) 68%, var(--text));
    font-size: 0.84em;
  }

  .donebar { display: flex; align-items: center; margin-top: 4px; flex: none; }
  .dt {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0;
    background: none;
    color: var(--muted);
    padding: 3px 0;
    cursor: pointer;
  }
  .dt .dn { margin-left: 2px; color: color-mix(in srgb, var(--text) 80%, var(--muted)); }
  .clear { margin-left: auto; border: 0; background: none; color: var(--accent); font: inherit; font-size: 0.78em; cursor: pointer; }
  .small .it { padding: 0 3px; }
  .small .del, .small .due { display: none; }
</style>
