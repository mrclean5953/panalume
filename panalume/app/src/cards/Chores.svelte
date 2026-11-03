<script module>
  import { states } from '../lib/ha.svelte.js';

  // Chore lists first (named "chores"), otherwise every to-do list there is.
  const autofill = () => {
    if (!states.size) return {};
    const ids = [...states.keys()].filter((id) => id.startsWith('todo.'));
    const chores = ids.filter((id) => /chore/.test(id));
    const picked = (chores.length ? chores : ids).slice(0, 3);
    return picked.length ? { people: picked.map((todo) => ({ name: '', todo, points: '' })) } : {};
  };

  export const meta = {
    type: 'chores',
    name: 'Chores',
    icon: 'mdi:broom',
    category: 'Info',
    size: { w: 560, h: 400 },
    tap: 'none',
    defaults: { people: [], title: '', hide_empty: false, rank: true, max: 0, compact: false },
    autofill,
    sections: [
      { key: 'head', label: 'Title' },
      { key: 'rank', label: 'Leaderboard' },
      { key: 'fit', label: 'Fit' },
    ],
    fields: [
      { key: 'people', label: 'People', type: 'people' },
      { key: 'title', label: 'Title (blank = "Chores")', type: 'text' },
      { key: 'rank', label: 'Show the leaderboard', type: 'bool' },
      { key: 'hide_empty', label: 'Hide people with nothing left', type: 'bool' },
      { key: 'max', label: 'Most chores per person (0 = as many as fit)', type: 'number' },
      { key: 'compact', label: 'Compact (smaller rows, no rings)', type: 'bool' },
    ],
  };
</script>

<script>
  // One column per person with their to-do list; tick a chore off from the card.
  // Each person carries their own hue (item 21) on the chip, the column edge and
  // the progress ring, so Charlie reads teal, Phoenix amber, House violet.
  // A leaderboard ranks the household: by a points counter when every person has
  // one, otherwise by who has the fewest chores left.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { subscribe, callService, conn } from '../lib/ha.svelte.js';
  import { name as entName } from '../lib/entity.js';
  import { hueFor, hueWash, STATUS, countUp, MOTION } from '../lib/design.svelte.js';

  let { props, h = 400 } = $props();
  const show = (k) => !props.hide?.[k];
  const compact = $derived(!!props.compact);

  const people = $derived(
    (props.people || []).map((p, i) => {
      const todo = p?.todo ? String(t(p.todo)).trim() : '';
      const points = p?.points ? String(t(p.points)).trim() : '';
      const e = todo ? states.get(todo) : undefined;
      const label = (p?.name ? String(t(p.name)).trim() : '') || entName(e) || todo || `Person ${i + 1}`;
      return { key: todo || `row${i}`, todo, points, name: label, entity: e };
    }),
  );
  // Subscriptions follow the ids, not the whole person object, so a state update
  // does not tear down and rebuild every list subscription.
  const idsKey = $derived(people.map((p) => p.todo).filter(Boolean).join('|'));
  let lists = $state({});

  $effect(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    if (!conn.connected || !ids.length) return;
    const stops = ids.map((id) =>
      subscribe({ type: 'todo/item/subscribe', entity_id: id }, (ev) => {
        lists = { ...lists, [id]: ev.items || [] };
      }),
    );
    return () => stops.forEach((stop) => stop());
  });

  const items = (id) => lists[id] || [];

  // Counts per person. The list entity's own summary attributes are used when the
  // integration publishes them; otherwise they come from the subscribed items.
  function statOf(id) {
    const it = lists[id];
    if (!it) return { loaded: false, open: 0, done: 0, total: 0, frac: 0 };
    const e = states.get(id);
    const a = e?.attributes || {};
    const done = it.filter((i) => i.status === 'completed').length;
    const total = Math.max(it.length, Number(a.total ?? NaN) || 0);
    const doneN = Number.isFinite(Number(a.completed)) ? Number(a.completed) : done;
    return { loaded: true, open: Math.max(0, total - doneN), done: doneN, total, frac: total ? doneN / total : 0 };
  }

  // Adding and removing chores from the card itself, confirmed on the row so a
  // stray tap on a wall panel does not delete somebody's job for the day.
  let drafts = $state({});
  let pending = $state('');
  const canAdd = (id) => !!(Number(states.get(id)?.attributes.supported_features || 0) & 1);
  const canDel = (id) => !!(Number(states.get(id)?.attributes.supported_features || 0) & 2);
  const canTick = (id) => !!(Number(states.get(id)?.attributes.supported_features || 0) & 4);

  function addChore(id) {
    const text = String(drafts[id] || '').trim();
    if (!text || !canAdd(id)) return;
    callService('todo', 'add_item', { item: text }, { entity_id: id });
    drafts = { ...drafts, [id]: '' };
  }
  function removeChore(id, item) {
    if (!canDel(id)) return;
    callService('todo', 'remove_item', { item: item.uid || item.summary }, { entity_id: id });
    pending = '';
  }
  const pkey = (id, item) => `${id}|${item.uid || item.summary}`;

  // Item 60: a ticked row stays on screen long enough to watch the box fill and
  // the strike-through draw, then it settles away instead of vanishing.
  let leaving = $state({});
  function tick(id, item) {
    if (!canTick(id)) return;
    const nowDone = item.status !== 'completed';
    const status = nowDone ? 'completed' : 'needs_action';
    lists = { ...lists, [id]: items(id).map((i) => (i.uid === item.uid && i.summary === item.summary ? { ...i, status } : i)) };
    if (nowDone) {
      const k = pkey(id, item);
      leaving = { ...leaving, [k]: true };
      setTimeout(() => {
        const next = { ...leaving };
        delete next[k];
        leaving = next;
      }, MOTION.slow + 100);
    }
    callService('todo', 'update_item', { item: item.uid || item.summary, status }, { entity_id: id });
  }

  const shown = $derived(
    props.hide_empty ? people.filter((p) => !lists[p.todo] || statOf(p.todo).open > 0) : people,
  );

  const cols = $derived(shown.map((p) => ({ p, s: statOf(p.todo), hue: hueFor(p.name) })));

  // Item 47: on this card the hero is the person furthest from done — their
  // column is the heaviest thing on the board, not the card title.
  const heroKey = $derived.by(() => {
    const rows = cols.filter((c) => c.s.loaded && c.s.total > 0);
    if (shown.length < 2 || rows.length < 2) return '';
    const worst = [...rows].sort((a, b) => a.s.frac - b.s.frac || b.s.open - a.s.open)[0];
    return worst.p.key;
  });

  const totalLeft = $derived(people.reduce((n, p) => n + statOf(p.todo).open, 0));
  const totalDone = $derived(people.reduce((n, p) => n + statOf(p.todo).done, 0));
  const anyLoaded = $derived(people.some((p) => lists[p.todo]));
  const title = $derived(String(t(props.title) || '').trim() || 'Chores');
  const small = $derived(h < 190);
  const board = $derived(show('rank') && shown.length > 1 && h >= 250);

  // Item 57: counts ease to their new value instead of snapping. countUp() has to
  // be called during init, so small pools are made up-front and read by index.
  const POOL = 8;
  const colDone = Array.from({ length: POOL }, (_, i) => countUp(() => cols[i]?.s.done ?? 0));
  const leftNum = countUp(() => totalLeft);
  const doneNum = countUp(() => totalDone);

  const ranked = $derived.by(() => {
    const rows = people.map((p) => {
      const s = statOf(p.todo);
      const raw = p.points ? ent(p.points)?.state : null;
      const num = raw == null || ['', 'unknown', 'unavailable'].includes(String(raw)) ? NaN : Number(raw);
      return { key: p.key, name: p.name, left: s.open, loaded: s.loaded, pts: Number.isFinite(num) ? num : null, hue: hueFor(p.name) };
    });
    // Points only rank the household when every person is counted; a half-filled
    // board would compare a counter with a chore count.
    const allPts = rows.length > 1 && rows.every((r) => r.pts !== null);
    const sorted = [...rows].sort((a, b) => (allPts ? b.pts - a.pts : a.left - b.left));
    return { allPts, rows: sorted };
  });
  const boardVal = $derived(ranked.rows.map((r) => (ranked.allPts ? (r.pts ?? 0) : r.left)));
  const boardNum = Array.from({ length: POOL }, (_, i) => countUp(() => boardVal[i] ?? 0));

  // Item: fit the card. The list measures itself and we divide by the row pitch
  // (the same clamp the CSS uses for --row) so a long list is sliced, not scrolled
  // out of the box.
  let listH = $state({});
  const pitch = $derived(Math.round((compact ? Math.min(24, Math.max(16, h * 0.046)) : Math.min(32, Math.max(20, h * 0.062))) + 1));
  const addH = $derived(pitch + 7);
  function capFor(p) {
    const hard = Number(props.max) > 0 ? Math.max(1, Math.floor(Number(props.max))) : Infinity;
    const hh = listH[p.key];
    const adder = lists[p.todo] && canAdd(p.todo) && !compact ? addH : 0;
    const room = hh && hh > pitch ? Math.floor((hh - adder) / pitch) : Infinity;
    return Math.max(1, Math.min(hard, room));
  }
  function rowsFor(p) {
    const id = p.todo;
    const all = items(id).filter((i) => i.status !== 'completed' || leaving[pkey(id, i)]);
    const cap = capFor(p);
    return all.slice(0, cap);
  }
  function extraFor(p) {
    const id = p.todo;
    const all = items(id).filter((i) => i.status !== 'completed' || leaving[pkey(id, i)]);
    return Math.max(0, all.length - rowsFor(p).length);
  }
</script>

<div class="chores" class:small class:compact style="--good:{STATUS.good}">
  {#if show('head') && !small}
    <div class="head">
      <Icon icon="mdi:broom" size="1.05em" />
      <span class="microcaps t">{title}</span>
      {#if anyLoaded}
        <span class="pill num" title="{Math.round(totalDone)} done, {Math.round(leftNum())} left">
          <b>{Math.round(leftNum())}</b> left
        </span>
      {/if}
    </div>
  {/if}

  {#if !people.length}
    <div class="msg">Add the people and their to-do lists in the card's settings.</div>
  {:else if !shown.length}
    <div class="msg done-all"><Icon icon="mdi:check-all" size="1.3em" /> Everything's done</div>
  {:else}
    <div class="cols" data-stop>
      {#each cols as row, ci (row.p.key)}
        {@const p = row.p}
        {@const s = row.s}
        <section
          class="col"
          class:hero={p.key === heroKey}
          style="--h:{row.hue};--wash:{hueWash(p.name, p.key === heroKey ? 0.16 : 0.07)}"
        >
          <header class="p">
            <span class="av">{(p.name || '?').slice(0, 1).toUpperCase()}</span>
            <span class="who">
              <span class="nm">{p.name}</span>
              <span class="microcaps sub">
                {#if s.loaded && s.total}
                  <span class="num">{Math.round(colDone[ci] ? colDone[ci]() : s.done)}/{s.total}</span> done
                {:else if s.loaded}no chores{:else}—{/if}
              </span>
            </span>
            {#if !compact && s.loaded && s.total}
              <span class="ringwrap" class:full={s.frac >= 1}>
                <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle class="track" cx="18" cy="18" r="15.5" pathLength="100" />
                  <circle
                    class="prog"
                    cx="18"
                    cy="18"
                    r="15.5"
                    pathLength="100"
                    style="stroke-dashoffset:{100 - Math.min(100, Math.max(0, Math.round(s.frac * 100)))}"
                  />
                </svg>
                {#if s.frac >= 1}
                  <Icon icon="mdi:check" size=".6em" />
                {:else}
                  <span class="pct num">{Math.round(s.frac * 100)}</span>
                {/if}
              </span>
            {/if}
          </header>

          <div class="list" bind:clientHeight={listH[p.key]}>
            {#each rowsFor(p) as item (item.uid || item.summary)}
              {@const k = pkey(p.todo, item)}
              {#if pending === k}
                <div class="row ask">
                  <span class="tx">{item.summary}</span>
                  <button class="yes" onclick={() => removeChore(p.todo, item)} title="Delete it">Delete</button>
                  <button class="no" onclick={() => (pending = '')} title="Keep it"><Icon icon="mdi:close" size=".9em" /></button>
                </div>
              {:else}
                <div class="row" class:done={item.status === 'completed'}>
                  <button class="it" onclick={() => tick(p.todo, item)} disabled={!canTick(p.todo)} title={item.summary}>
                    <span class="box"><Icon icon="mdi:check" size=".66em" /></span>
                    <span class="tx">{item.summary}</span>
                  </button>
                  {#if canDel(p.todo)}
                    <button class="del" onclick={() => (pending = k)} title="Remove this chore">
                      <Icon icon="mdi:trash-can-outline" size=".9em" />
                    </button>
                  {/if}
                </div>
              {/if}
            {:else}
              {#if lists[p.todo]}
                <div class="all"><Icon icon="mdi:check-all" size="1.05em" /><span>All done</span></div>
              {:else if p.entity}
                <div class="all load">Loading…</div>
              {:else}
                <div class="all load">No list picked</div>
              {/if}
            {/each}
            {#if extraFor(p) > 0}
              <div class="more microcaps num">+{extraFor(p)} more</div>
            {/if}
          </div>

          {#if lists[p.todo] && canAdd(p.todo) && !compact}
            <div class="adder">
              <input
                class="in"
                value={drafts[p.todo] || ''}
                placeholder="Add a chore"
                oninput={(ev) => (drafts = { ...drafts, [p.todo]: ev.currentTarget.value })}
                onkeydown={(ev) => { if (ev.key === 'Enter') addChore(p.todo); }}
              />
              <button class="plus" onclick={() => addChore(p.todo)} disabled={!(drafts[p.todo] || '').trim()} title="Add">
                <Icon icon="mdi:plus" size="1em" />
              </button>
            </div>
          {/if}
        </section>
      {/each}
    </div>

    {#if board}
      <div class="board">
        <span class="microcaps bl">{ranked.allPts ? 'Points' : 'Fewest left'}</span>
        <ol>
          {#each ranked.rows as r, i (r.key)}
            <li class:lead={i === 0 && r.loaded} style="--h:{r.hue};--wash:{hueWash(r.name, 0.18)}">
              <span class="rk num">{i + 1}</span>
              <span class="bn">{r.name}</span>
              <span class="bv num">{Math.round(boardNum[i] ? boardNum[i]() : 0)}<span class="u">{ranked.allPts ? ' pts' : ' left'}</span></span>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  {/if}
</div>

<style>
  .chores {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    container-type: size;
    --row: clamp(20px, 6.2cqh, 32px);
    --gap: min(10px, 2.6cqw);
  }
  .compact { --row: clamp(16px, 4.6cqh, 24px); }

  /* Item 46: section headers are micro-caps, not plain bold text. */
  .head { display: flex; align-items: center; gap: 8px; flex: none; min-width: 0; }
  .head :global(svg) { color: var(--accent); flex: none; }
  .head .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.28em;
    padding: 0 0.55em;
    height: 1.75em;
    border-radius: 1em;
    font-size: 0.72em;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: color-mix(in srgb, var(--text) 92%, var(--accent));
  }
  .pill b { font-weight: 700; font-size: 1.06em; }

  .msg {
    flex: 1;
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--muted);
    font-size: 0.86em;
  }
  .msg.done-all { color: color-mix(in srgb, var(--good, #3b82f6) 70%, var(--text)); }

  .cols {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: stretch;
    gap: var(--gap);
    overflow: hidden;
  }
  .col {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: min(4px, 1cqh);
    padding: min(7px, 1.8cqh) min(8px, 1.6cqw) min(5px, 1.4cqh);
    border-radius: 12px;
    background: linear-gradient(180deg, var(--wash), transparent 72%), color-mix(in srgb, var(--text) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--text) 7%, transparent);
    box-shadow: inset 3px 0 0 -1px var(--h);
  }
  /* Item 47: the hero column carries the weight — wider, brighter, bigger type. */
  .col.hero {
    flex-grow: 1.45;
    border-color: color-mix(in srgb, var(--h) 34%, transparent);
    box-shadow: inset 3px 0 0 0 var(--h), 0 2px 14px -8px var(--h);
  }
  .col.hero .nm { font-size: 0.94em; }
  .col.hero .av { width: min(1.85em, 6cqh); height: min(1.85em, 6cqh); font-size: 0.86em; }

  .p { display: flex; align-items: center; gap: 7px; flex: none; min-width: 0; }
  .av {
    flex: none;
    width: min(1.55em, 5.2cqh);
    height: min(1.55em, 5.2cqh);
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.74em;
    font-weight: 800;
    letter-spacing: 0.01em;
    color: color-mix(in srgb, var(--h) 30%, #fff);
    background: color-mix(in srgb, var(--h) 24%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--h) 70%, transparent);
  }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .nm {
    font-size: 0.86em;
    font-weight: 650;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub { font-size: 0.6em; letter-spacing: 0.12em; color: var(--muted); white-space: nowrap; overflow: hidden; }
  .sub .num { color: color-mix(in srgb, var(--h) 55%, var(--text)); font-weight: 700; }

  .ringwrap {
    flex: none;
    position: relative;
    width: min(2.3em, 7.4cqh);
    height: min(2.3em, 7.4cqh);
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--h) 72%, var(--text));
  }
  .col.hero .ringwrap { width: min(2.9em, 9cqh); height: min(2.9em, 9cqh); }
  .ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .track { fill: none; stroke: color-mix(in srgb, var(--text) 12%, transparent); stroke-width: 3.4; }
  .prog {
    fill: none;
    stroke: var(--h);
    stroke-width: 3.4;
    stroke-linecap: round;
    stroke-dasharray: 100;
    transition: stroke-dashoffset var(--dur-slow) var(--ease);
  }
  .ringwrap.full { color: var(--good, #3b82f6); }
  .ringwrap.full .prog { stroke: var(--good, #3b82f6); }
  .pct { font-size: 0.6em; font-weight: 700; color: color-mix(in srgb, var(--h) 62%, var(--text)); }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .list::-webkit-scrollbar { width: 4px; }
  .list::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text) 22%, transparent); border-radius: 4px; }
  .row { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .row .it { flex: 1; min-width: 0; }

  /* Item 60: the box fills, the strike draws, the row fades — no grey row that
     still looks tickable. */
  .it {
    flex: none;
    display: flex;
    align-items: center;
    gap: min(8px, 2cqw);
    width: 100%;
    min-height: var(--row);
    padding: 0 3px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .it:active:not(:disabled) { background: color-mix(in srgb, var(--text) 8%, transparent); }
  .it:disabled { cursor: default; }
  .box {
    flex: none;
    width: min(1.05em, 3.6cqh);
    height: min(1.05em, 3.6cqh);
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--text) 34%, transparent);
    display: grid;
    place-items: center;
    color: #0b0f17;
    transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease-spring);
  }
  .row.done .box {
    background: var(--h);
    border-color: var(--h);
    transform: scale(1.04);
  }
  .tx {
    flex: 1;
    min-width: 0;
    position: relative;
    font-size: 0.84em;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tx::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 52%;
    height: 1.5px;
    background: color-mix(in srgb, var(--text) 62%, transparent);
    transform: scaleX(0);
    transform-origin: left center;
    transition: transform 200ms var(--ease);
  }
  .row.done .tx::after { transform: scaleX(1); }
  .row.done { opacity: 0.4; transition: opacity 260ms var(--ease) 60ms; }
  .box :global(svg) { opacity: 0; transition: opacity var(--dur) var(--ease) 60ms; }
  .row.done .box :global(svg) { opacity: 1; }

  .del { flex: none; opacity: 0.3; background: none; border: 0; color: inherit; padding: 2px; cursor: pointer; }
  .del:hover { opacity: 0.9; color: #f43f5e; }

  .row.ask { background: rgba(244, 63, 94, 0.12); border-radius: 8px; padding: 2px 4px; min-height: var(--row); }
  .row.ask .tx { font-size: 0.8em; }
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

  .more { flex: none; padding: 2px 3px; color: var(--muted); font-size: 0.58em; letter-spacing: 0.1em; }

  .adder { flex: none; display: flex; align-items: center; gap: 3px; padding-top: 3px; }
  .in {
    flex: 1;
    min-width: 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    color: inherit;
    font: inherit;
    font-size: 0.78em;
    padding: 3px 6px;
  }
  .in::placeholder { color: var(--muted); }
  .plus {
    flex: none;
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    border-radius: 7px;
    color: inherit;
    padding: 3px 5px;
    display: inline-flex;
    cursor: pointer;
  }
  .plus:disabled { opacity: 0.35; cursor: default; }

  .all {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 0;
    color: color-mix(in srgb, var(--good, #3b82f6) 68%, var(--text));
    font-size: 0.78em;
  }
  .all.load { color: var(--muted); }

  .board { flex: none; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .bl { flex: none; font-size: 0.58em; }
  .board ol { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
  .board li {
    flex: 1 1 auto;
    min-width: 88px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--wash), transparent), color-mix(in srgb, var(--text) 5%, transparent);
    box-shadow: inset 2px 0 0 0 color-mix(in srgb, var(--h) 70%, transparent);
    font-size: 0.7em;
  }
  .board li.lead { background: linear-gradient(90deg, color-mix(in srgb, var(--h) 30%, transparent), transparent 80%); }
  .rk { flex: none; font-weight: 700; opacity: 0.65; font-size: 0.9em; }
  .bn { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bv { flex: none; font-weight: 700; }
  .bv .u { font-weight: 500; opacity: 0.7; }

  @container (max-width: 460px) {
    .board .bl { display: none; }
  }
  @container (max-width: 330px) {
    .board li { padding: 3px 6px; min-width: 74px; }
    .sub { display: none; }
  }
  .small .col { padding: 4px 6px 3px; }
  .small .it { padding: 0 2px; }
  .small .who { flex-direction: row; align-items: baseline; gap: 4px; }
</style>
