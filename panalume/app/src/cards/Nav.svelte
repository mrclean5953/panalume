<script module>
  export const meta = {
    type: 'nav', name: 'Navigation', icon: 'mdi:menu', category: 'Layout',
    size: { w: 260, h: 220 }, tap: 'none',
    defaults: { direction: 'vertical', show_icons: true, show_names: true, icon_style: 'plain', primary: 6, groups: true, idle: 60 },
    fields: [
      { key: 'direction', label: 'Direction', type: 'select', options: ['vertical', 'horizontal'] },
      { key: 'show_icons', label: 'Icons', type: 'bool' },
      { key: 'icon_style', label: 'Icon style', type: 'select', options: [{ value: 'plain', label: 'Plain' }, { value: 'tile', label: 'Tile (Android-style)' }], hint: 'A tile is a rounded, tinted square behind each icon, filled with the accent colour for the view you are on.' },
      { key: 'show_names', label: 'Names', type: 'bool' },
      { key: 'primary', label: 'First tier (how many views)', type: 'text', hint: 'The rest go behind a More tile that opens the sheet. 0 turns the second tier off.' },
      { key: 'groups', label: 'Group with separators', type: 'bool', hint: 'Home · Family · House · Systems. A view can name its own group in the Views tab.' },
      { key: 'idle', label: 'Auto-hide after (seconds, 0 = never)', type: 'text', hint: 'The dock slips away when the screen is idle and comes back on a touch, showing the page title while it is away.' },
    ],
  };

  // One idle clock for every nav card on the board, so they hide together.
  let lastTouch = Date.now();
</script>

<script>
  import Icon from '../components/Icon.svelte';
  import ViewIcon from '../components/ViewIcon.svelte';
  import { app, setView } from '../lib/config.svelte.js';
  import { groupViews } from '../lib/nav.js';
  let { props, w = 0, h = 0 } = $props();
  // A wide, short nav card lays out horizontally whatever its setting (e.g. on phones).
  const dir = $derived(w > h * 3 ? 'horizontal' : props.direction || 'vertical');
  const tiles = $derived(props.icon_style === 'tile');
  const bar = $derived(dir === 'horizontal');
  const primaryN = $derived(Math.max(0, Number(props.primary ?? 6) || 0));
  const grouped = $derived(props.groups !== false);
  const idleSec = $derived(Math.max(0, Number(props.idle ?? 60) || 0));

  const views = $derived(app.config.views);
  // First tier: the six (or N) views the dock always shows. Everything else is
  // one tap away in the sheet — a wall screen keeps a bottom bar you can hit.
  const primary = $derived(primaryN > 0 ? views.slice(0, primaryN) : views);
  const overflow = $derived(primaryN > 0 ? views.slice(primaryN) : []);
  const sections = $derived(grouped ? groupViews(primary) : [{ group: '', views: primary }]);

  // ---- auto-hide (item 18) ----
  $effect(() => {
    if (!idleSec) { app.dockHidden = false; return; }
    const wake = () => {
      lastTouch = Date.now();
      if (app.dockHidden) app.dockHidden = false;
    };
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'panalume-wake']) addEventListener(ev, wake, { capture: true, passive: true });
    const timer = setInterval(() => {
      if (app.editing || app.dockSheet) { lastTouch = Date.now(); return; }
      if (Date.now() - lastTouch > idleSec * 1000) app.dockHidden = true;
    }, 2000);
    return () => {
      for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'panalume-wake']) removeEventListener(ev, wake, { capture: true });
      clearInterval(timer);
    };
  });
  // A second nav card sharing the board must not fight the first: the hidden
  // state is global, so every dock slips away together.
  const hid = $derived(app.dockHidden);

  const title = $derived(views.find((v) => v.id === app.view)?.name || '');
  function pick(id) {
    setView(id);
    app.dockHidden = false;
    app.dockSheet = false;
    lastTouch = Date.now();
  }
</script>

<div class="dock" class:hidden={hid} class:bar data-stop>
  <nav class="nav {dir}" class:tiles aria-hidden={hid}>
    {#each sections as sec (sec.group)}
      {#if sec.group && bar}<span class="sep" aria-hidden="true"></span>{/if}
      {#if sec.group && !bar}<div class="microcaps glabel">{sec.group}</div>{/if}
      {#each sec.views as v (v.id)}
        <button class="press" class:sel={app.view === v.id} onclick={() => pick(v.id)} title={v.name}>
          {#if props.show_icons !== false && (v.icon || v.image)}
            {#if tiles && !v.image}
              <span class="tile"><ViewIcon view={v} size="1.15em" /></span>
            {:else if v.image}
              <span class="imgmark"><ViewIcon view={v} size="1.15em" /></span>
            {:else}
              <ViewIcon view={v} size="1.3em" />
            {/if}
          {/if}
          {#if props.show_names !== false}<span class="name">{v.name}</span>{/if}
        </button>
      {/each}
    {/each}
    {#if overflow.length}
      <button class="press more" onclick={() => { app.dockSheet = true; lastTouch = Date.now(); }} title="All views">
        <span class="tile"><Icon icon="mdi:dots-grid" size="1.15em" /></span>
        {#if props.show_names !== false}<span class="name">More</span>{/if}
        <span class="count num">{overflow.length}</span>
      </button>
    {/if}
  </nav>

  <!-- Item 20: the park screen shows where it is only when the dock is away. -->
  <button class="page-title" class:on={hid} onclick={() => { app.dockHidden = false; lastTouch = Date.now(); }} aria-label="Show navigation">
    <span class="pt-mark"><ViewIcon view={views.find((v) => v.id === app.view) || {}} size="1.1em" /></span>
    <span class="pt-name">{title}</span>
  </button>
</div>

<style>
  .dock { position: relative; height: 100%; container-type: size; }
  .nav { position: absolute; inset: 0; display: flex; justify-content: center; gap: 6px; overflow: hidden; transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
  .nav:not(.horizontal) { flex-direction: column; justify-content: center; gap: 4px; }
  .hidden .nav { opacity: 0; transform: translateY(38%); pointer-events: none; }
  .horizontal { flex-direction: row; align-items: center; }
  /* Rows share the height: they shrink together when the card is short instead of overflowing. */
  .nav:not(.horizontal) button { flex: 0 1 46px; min-height: 0; padding-block: 0; }
  button { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; border: 0; background: none; color: var(--muted); font: inherit; font-weight: 500; text-align: left; white-space: nowrap; min-width: 0; }
  .horizontal { gap: 4px; }
  .horizontal button { flex: 1 1 0; min-width: 0; justify-content: center; gap: 6px; padding: 10px 6px; font-size: .9em; }
  .horizontal button .name { overflow: hidden; text-overflow: ellipsis; }
  button.sel { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--text); }
  button.sel :global(svg) { color: var(--accent); }
  /* Item 17: press feedback — 0.96 at 120ms, on every dock button. */
  button.press:active { transform: scale(.96); }
  button.press { transition: transform var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }

  /* Android-style tiles: a rounded square of tint per icon, the view you are on
     in the accent colour with the glyph knocked out of it. */
  .nav { --tile: 1.9em; }
  .tiles { --tile: min(1.9em, 44cqh); }
  .tile { flex: none; display: grid; place-items: center; width: var(--tile); height: var(--tile); border-radius: 30%; background: rgba(255,255,255,.08); transition: background .2s; }
  .tiles :global(svg) { transition: color .2s; }
  .tiles button.sel .tile { background: var(--accent); }
  .tiles button.sel .tile :global(svg) { color: #0b0f16; }
  .tiles button.sel { background: none; }
  .tiles button:hover .tile { background: rgba(255,255,255,.14); }
  .tiles button.sel:hover .tile { background: var(--accent); }

  /* An image mark keeps the tile's height so rows stay aligned, without the square. */
  .imgmark { flex: none; display: inline-flex; align-items: center; justify-content: center; height: var(--tile); }

  /* Item 19: group separators. A hairline in a bar, a labelled rule in a column. */
  .sep { flex: none; align-self: center; width: 1px; height: 55%; background: linear-gradient(transparent, rgba(255,255,255,.22), transparent); margin: 0 3px; }
  .glabel { padding: 8px 10px 2px; }

  /* On a bar, the tile sits over its label the way an Android bottom bar does;
     the label steps aside when the bar is too narrow to hold one per item. */
  .tiles.horizontal button { flex-direction: column; gap: 2px; padding: 2px 4px; font-size: .82em; }
  .tiles.horizontal .name { font-size: 1.02em; line-height: 1.1; }
  @container (max-width: 340px) { .tiles.horizontal .name { display: none; } }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

  /* The second-tier trigger. */
  .more { position: relative; }
  .more .count { position: absolute; top: 2px; right: 6px; font-size: .62em; padding: 0 4px; border-radius: 8px; background: var(--accent); color: #08101c; font-weight: 700; }

  /* Item 20: the title, only while the dock is away. */
  .page-title {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
    border: 0; background: none; color: var(--text); font: inherit; font-weight: 600;
    opacity: 0; transform: translateY(-6px); pointer-events: none;
    transition: opacity var(--dur) var(--ease) 60ms, transform var(--dur) var(--ease) 60ms;
  }
  .page-title.on { opacity: 1; transform: none; pointer-events: auto; }
  .pt-name { font-size: 1.35em; letter-spacing: -.01em; }
  .pt-mark { display: inline-grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 30%; background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
</style>
