<script module>
  // Imported here because autofill below reads the live states; the instance script
  // shares this one module scope and uses the same import.
  import { states } from '../lib/ha.svelte.js';
  export const meta = {
    type: 'music-hub', name: 'Music hub', icon: 'mdi:speaker-multiple', category: 'Media',
    size: { w: 420, h: 320 }, tap: 'none', hold: 'none',
    defaults: { players: [], max: 6, show_volume: true, artwork: false },
    sections: [
      { key: 'now', label: 'Now playing' }, { key: 'art', label: 'Cover' },
      { key: 'players', label: 'Players' }, { key: 'volume', label: 'Volume' },
    ],
    watch: (p) => p.players || [],
    // Every player the house has, Music Assistant's own first: it names its players
    // with mass_player_type, so they can be picked out of a house full of cast sinks.
    autofill: () => {
      const all = [...states.keys()].filter((k) => k.startsWith('media_player.'));
      const mass = all.filter((k) => states.get(k)?.attributes?.mass_player_type);
      const live = all.filter((k) => !['unavailable', 'unknown'].includes(states.get(k)?.state));
      return { players: (mass.length ? mass : live).slice(0, 8) };
    },
    fields: [
      { key: 'name', label: 'Title', type: 'text' },
      { key: 'players', label: 'Players (in this order)', type: 'entities', domain: 'media_player' },
      { key: 'target', label: 'Now playing from (blank = whichever is playing)', type: 'entity', domain: 'media_player', section: 'now' },
      { key: 'artwork', label: 'Cover art (fetches artwork)', type: 'bool', section: 'art' },
      { key: 'max', label: 'Most players listed', type: 'number' },
      { key: 'show_volume', label: 'Volume per player', type: 'bool', section: 'volume' },
    ],
  };
</script>

<script>
  // The whole house in one card: what is playing, every speaker with its own cover,
  // its own volume and its own colour, and the groups Music Assistant keeps.
  import Icon from '../components/Icon.svelte';
  import Slider from '../components/Slider.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { callService, haImage } from '../lib/ha.svelte.js';
  import { hueFor } from '../lib/design.svelte.js';
  let { props, w = 420, h = 320 } = $props();
  const show = (k) => !props.hide?.[k];
  const cut = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

  const ids = $derived((props.players || []).map((p) => String(t(p) ?? '').trim()).filter(Boolean));
  const rows = $derived(ids.map((id) => ({ id, e: ent(id) })).filter((r) => r.e));
  const cap = $derived(Math.max(1, Number(props.max) || 6));
  // Only draw the rows the card has height for: a shrunk flex row overlaps its
  // neighbours instead of clipping, which reads as a broken card. Room is worked
  // out from the measured header and row heights, less the "and N more" line.
  const tight = $derived(h < 200);
  const rowH = $derived(tight ? 27 : 34);
  const heroH = $derived(rowH + 8);
  const nowH = $derived(show('now') && rows.length ? (tight ? 44 : 58) : 0);
  const headH = $derived(show('players') && !tight ? 19 : 0);
  // h counts the card's own padding; the header and the gaps sit above the list.
  const avail = $derived(Math.max(heroH, h - 26 - nowH - headH));
  const perRow = $derived(rowH + 3);
  const maxRows = $derived(Math.max(1, Math.floor((avail + 3) / perRow)));
  const shownCount = $derived(Math.min(cap, rows.length, maxRows));
  const shownRows = $derived(rows.slice(0, shownCount));
  const hidden = $derived(Math.max(0, rows.length - shownRows.length));
  // The "and N more" line only goes in when it can be read; a half line looks broken.
  const moreFits = $derived(hidden > 0 && avail - (shownCount * perRow - 3) >= 16);

  const sf = (e) => Number(e?.attributes?.supported_features) || 0;
  const has = (e, bit) => (sf(e) & bit) !== 0;
  const off = (e) => !e || ['off', 'unavailable', 'unknown'].includes(e.state);
  const playing = (e) => e?.state === 'playing';
  const trackOf = (e) => e?.attributes?.media_title || '';
  const isGroup = (e) =>
    e?.attributes?.mass_player_type === 'group' || (Array.isArray(e?.attributes?.group_members) && e.attributes.group_members.length > 1);
  const members = (e) => (Array.isArray(e?.attributes?.group_members) ? e.attributes.group_members : []);
  // Each speaker gets a stable hue of its own, so its tile, its volume bar and its
  // glow all agree with each other with or without a cover.
  const hueOf = (e, id) => hueFor(e?.attributes?.friendly_name || id || '');
  // The cover the entity already carries, through Home Assistant's own proxy.
  const artOf = (e) => haImage(e?.attributes?.entity_picture_local || e?.attributes?.entity_picture) || '';

  // The header follows whoever is playing, unless a player is pinned.
  const focusId = $derived(
    String(t(props.target) ?? '').trim() ||
      rows.find((r) => playing(r.e) || r.e.state === 'paused')?.id ||
      rows[0]?.id ||
      '',
  );
  const focus = $derived(ent(focusId));
  const fa = $derived(focus?.attributes || {});
  const art = $derived(props.artwork ? haImage(fa.entity_picture_local || fa.entity_picture) : '');
  const title = $derived(trackOf(focus) || (focus ? (off(focus) ? 'Off' : focus.state === 'idle' ? 'Idle' : focus.state) : 'No players'));
  const sub = $derived(
    [fa.media_artist, fa.media_album_name].filter(Boolean).join(' — ') || fa.app_name || fa.source || '',
  );
  const focusHue = $derived(hueOf(focus, focusId));

  const svc = (id, service, data = {}) => callService('media_player', service, data, { entity_id: id });
  function press(r) {
    const e = r.e;
    if (off(e) && has(e, 128)) svc(r.id, 'turn_on');
    else if (has(e, 16384) || has(e, 1)) svc(r.id, 'media_play_pause');
  }
  const names = (e) => members(e).map((m) => ent(m)?.attributes?.friendly_name || m.split('.')[1]).join(', ');
</script>

<div class="hub" class:small={h < 240} class:tight={tight}
  style="--row-h:{rowH}px;--hero-h:{heroH}px;--hue:{focusHue}">
  {#if show('now') && rows.length}
    <div class="now">
      {#if art}<div class="art" style="background-image:url('{art}')\"></div>{/if}
      <div class="txt">
        <div class="eyebrow">
          <span class="microcaps">Now playing</span>
          <span class="who-line">
            <Icon icon={isGroup(focus) ? 'mdi:speaker-multiple' : 'mdi:speaker'} size=".9em" />
            <span class="src">{t(props.name) || focus?.attributes?.friendly_name || 'Nothing playing'}</span>
          </span>
        </div>
        <div class="title">{cut(title, 80)}</div>
        {#if sub}<div class="sub">{cut(sub, 90)}</div>{/if}
      </div>
      <div class="ctl" data-stop>
        {#if has(focus, 16)}<button onclick={() => svc(focusId, 'media_previous_track')} aria-label="Previous"><Icon icon="mdi:skip-previous" size="1.4em" /></button>{/if}
        <button class="play" onclick={() => focus && press({ id: focusId, e: focus })} aria-label={playing(focus) ? 'Pause' : 'Play'}>
          <Icon icon={off(focus) ? 'mdi:power' : playing(focus) ? 'mdi:pause' : 'mdi:play'} size="1.5em" />
        </button>
        {#if has(focus, 32)}<button onclick={() => svc(focusId, 'media_next_track')} aria-label="Next"><Icon icon="mdi:skip-next" size="1.4em" /></button>{/if}
      </div>
    </div>
  {/if}

  {#if show('players')}
    {#if !rows.length}
      <div class="empty"><Icon icon="mdi:speaker-off" size="1.5em" />Pick the players to show</div>
    {:else}
      {#if !tight}<div class="head"><span class="microcaps">Players</span><span class="count num">{shownRows.length}<span class="of">/{rows.length}</span></span></div>{/if}
      <div class="list">
        {#each shownRows as r (r.id)}
          {@const e = r.e}
          {@const st = off(e) ? 'off' : playing(e) ? 'playing' : e.state}
          {@const hh = hueOf(e, r.id)}
          {@const cover = artOf(e)}
          <div class="row" class:gone={st === 'off' || st === 'unavailable'} class:hero={playing(e)} style="--ph:{hh}">
            <button class="thumb" class:tint={!cover} onclick={() => press(r)} aria-label={playing(e) ? 'Pause' : 'Play'} data-stop
              style={cover ? `background-image:url('${cover}')` : ''}>
              <span class="glyph"><Icon icon={playing(e) ? 'mdi:pause' : off(e) ? 'mdi:power' : 'mdi:play'} size=".85em" /></span>
            </button>
            <div class="who">
              <div class="nm">
                {#if isGroup(e)}<span class="tag"><Icon icon="mdi:speaker-multiple" size=".95em" />{members(e).length > 1 ? `Group of ${members(e).length}` : 'Group'}</span>{/if}
                <span class="n">{e.attributes.friendly_name || r.id.split('.')[1]}</span>
              </div>
              <div class="st">
                {#if (playing(e) || e.state === 'paused') && trackOf(e)}<Icon icon="mdi:music" size=".9em" />{cut(trackOf(e), 46)}{:else}{st}{#if members(e).length > 1} · {cut(names(e), 40)}{/if}{/if}
              </div>
            </div>
            {#if props.show_volume !== false && has(e, 4)}
              <div class="vol" data-stop>
                <button class="mute" onclick={() => svc(r.id, 'volume_mute', { is_volume_muted: !e.attributes.is_volume_muted })} aria-label="Mute">
                  <Icon icon={e.attributes.is_volume_muted || !e.attributes.volume_level ? 'mdi:volume-off' : e.attributes.volume_level < 0.4 ? 'mdi:volume-low' : 'mdi:volume-high'} size="1em" />
                </button>
                <div class="bar">
                  <Slider value={Math.round((e.attributes.volume_level ?? 0) * 100)} height={tight ? 12 : 15} unit="%" color={hh}
                    onchange={(v) => svc(r.id, 'volume_set', { volume_level: v / 100 })} />
                </div>
              </div>
            {/if}
          </div>
        {/each}
        {#if moreFits}<div class="more">and {hidden} more</div>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .hub { height: 100%; display: flex; flex-direction: column; gap: 9px; container-type: size; min-height: 0; }
  .now { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .art { flex: none; width: 54px; height: 54px; border-radius: 12px; background-size: cover; background-position: center;
    box-shadow: 0 6px 18px rgba(0,0,0,.45); transition: background-image .5s ease; }
  .small .art { width: 40px; height: 40px; border-radius: 10px; }
  .txt { flex: 1; min-width: 0; }
  .eyebrow { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .eyebrow :global(.microcaps) { flex: none; }
  .who-line { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; color: var(--muted); font-size: .74em; }
  .who-line :global(svg) { color: var(--hue); }
  .src { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title { font-weight: 650; font-size: 1.06em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .sub { color: var(--muted); font-size: .8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ctl { flex: none; display: flex; align-items: center; gap: 2px; }
  button { background: none; border: 0; color: inherit; display: grid; place-items: center; padding: 4px; border-radius: 50%; }
  button:active { background: rgba(255,255,255,.12); }
  .play { width: 40px; height: 40px; background: rgba(255,255,255,.92); color: #111; }
  .small .play { width: 34px; height: 34px; }
  .head { display: flex; align-items: baseline; gap: 8px; }
  .count { margin-left: auto; font-size: .68em; color: var(--muted); letter-spacing: .04em; }
  .of { opacity: .45; }
  .list { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 3px; }
  .row { display: flex; align-items: center; gap: 9px; flex: none; height: var(--row-h); min-width: 0; border-radius: 10px;
    padding: 0 4px; margin: 0 -4px; transition: height var(--dur-slow) var(--ease), background-color var(--dur) var(--ease); }
  .row.gone { opacity: .5; }
  /* The speaker that is actually playing leads the list: taller, lit by its hue. */
  .row.hero { height: var(--hero-h); background: color-mix(in srgb, var(--ph) 12%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ph) 26%, transparent), 0 6px 20px color-mix(in srgb, var(--ph) 20%, transparent); }
  .thumb { flex: none; width: 28px; height: 28px; border-radius: 8px; overflow: hidden; position: relative;
    background-size: cover; background-position: center; padding: 0;
    box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset; }
  .hero .thumb { width: 34px; height: 34px; border-radius: 9px; }
  .thumb.tint { display: grid; place-items: center;
    background: radial-gradient(120% 120% at 30% 20%, color-mix(in srgb, var(--ph) 44%, transparent), color-mix(in srgb, var(--ph) 14%, transparent)); }
  .glyph { position: absolute; right: 1px; bottom: 1px; width: 15px; height: 15px; border-radius: 50%;
    display: grid; place-items: center; background: rgba(8,11,18,.78); color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
  .hero .glyph { width: 17px; height: 17px; }
  .who { flex: 1 1 auto; min-width: 0; }
  .nm { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .n { font-size: .86em; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hero .n { font-size: .95em; font-weight: 650; }
  .tag { display: inline-flex; align-items: center; gap: 3px; flex: none; font-size: .68em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); border-radius: 6px; padding: 1px 5px; }
  .st { display: flex; align-items: center; gap: 4px; font-size: .74em; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st :global(svg) { color: color-mix(in srgb, var(--ph) 80%, #fff); }
  .vol { flex: none; display: flex; align-items: center; gap: 5px; width: min(36%, 138px); }
  .bar { flex: 1; min-width: 0; }
  .bar :global(.slider) { border-radius: 999px; }
  .bar :global(.fill) { border-radius: 999px; opacity: .9; }
  .mute { color: var(--muted); padding: 2px; }
  .more { font-size: .72em; color: var(--muted); padding-top: 2px; }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--muted); font-size: .85em; }
  /* A short card keeps the roster but drops the second line of each row. */
  @container (max-height: 210px) { .st { display: none; } .row.hero .st { display: flex; } }
</style>
