<script module>
  export const meta = {
    type: 'media', name: 'Media player', icon: 'mdi:music', category: 'Media',
    size: { w: 420, h: 220 }, tap: 'none', hold: 'more-info',
    defaults: { entity: '', artwork: 'background', show_volume: true, show_source: true, show_group: true },
    fields: [
      { key: 'entity', label: 'Media player', type: 'entity', domain: 'media_player' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'artwork', label: 'Artwork', type: 'select', options: ['background', 'cover', 'none'] },
      { key: 'show_volume', label: 'Volume', type: 'bool' },
      { key: 'show_source', label: 'Source picker', type: 'bool' },
      { key: 'show_group', label: 'Grouping', type: 'bool' },
      { key: 'group_players', label: 'Players for grouping', type: 'entities', domain: 'media_player' },
    ],
  };
</script>

<script>
  // A media player, its artwork, and the transport under it.
  //
  // Item 47: the track's title is this card's one hero — it carries the size and
  // the gradient. Item 32: in the cover layout the artwork zooms inside its own
  // rounded frame on a pointer hover (and on keyboard focus) only. The state line
  // above it is a micro-caps label in the board's status colours (item 46 / 25).
  import Icon from '../components/Icon.svelte';
  import Slider from '../components/Slider.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { name } from '../lib/entity.js';
  import { callService, haImage, states } from '../lib/ha.svelte.js';
  import { STATUS } from '../lib/design.svelte.js';
  let { props, h } = $props();
  const e = $derived(ent(props.entity));
  const a = $derived(e?.attributes || {});
  const id = $derived(e?.entity_id);
  const sf = $derived(a.supported_features || 0);
  const has = (bit) => (sf & bit) !== 0;
  const playing = $derived(e?.state === 'playing');
  const off = $derived(!e || ['off', 'unavailable', 'unknown'].includes(e.state));
  const art = $derived(haImage(a.entity_picture_local || a.entity_picture));
  const title = $derived(a.media_title || (off ? 'Off' : e?.state === 'idle' ? 'Idle' : 'Nothing playing'));
  const sub = $derived([a.media_artist, a.media_album_name].filter(Boolean).join(' — ') || a.app_name || a.source || '');
  const svc = (s, d = {}) => callService('media_player', s, d, { entity_id: id });
  let groupOpen = $state(false);
  const members = $derived(a.group_members || [id]);
  const groupable = $derived(has(524288));
  const candidates = $derived.by(() => {
    const list = props.group_players?.length ? props.group_players : [...states.keys()].filter((k) => k.startsWith('media_player.') && (states.get(k).attributes.supported_features & 524288));
    return list.filter((k) => k !== id);
  });
  function toggleMember(m) {
    if (members.includes(m)) callService('media_player', 'unjoin', {}, { entity_id: m });
    else callService('media_player', 'join', { group_members: [m] }, { entity_id: id });
  }
  const compact = $derived(h < 170);

  // What the player is doing, said in the same words the room would use, and in
  // the board's status colours rather than the player's own.
  const stateLabel = $derived(
    !e ? 'No player'
      : e.state === 'playing' ? 'Playing'
      : e.state === 'paused' ? 'Paused'
      : e.state === 'unavailable' ? 'Unavailable'
      : e.state === 'off' ? 'Off'
      : 'Idle'
  );
  const stateTone = $derived(
    !e || e.state === 'unavailable' ? STATUS.idle
      : playing ? STATUS.good
      : e.state === 'paused' ? STATUS.warn
      : STATUS.idle
  );
</script>

<div class="media {props.artwork}" class:compact>
  {#if art && props.artwork === 'background'}<div class="bg" style="background-image:url('{art}')"></div><div class="shade"></div>{/if}
  {#if !props.entity}
    <div class="none"><Icon icon="mdi:speaker-off" size="1.8em" /><div>Pick a media player.</div></div>
  {:else}
    <div class="main">
      {#if art && props.artwork === 'cover' && !compact}
        <div class="coverwrap"><img class="cover" src={art} alt="" /></div>
      {/if}
      <div class="info">
        <div class="who">
          <span class="microcaps st" style="color:{stateTone}">{stateLabel}</span>
          <span class="dev"><Icon icon="mdi:speaker" size="1em" /> {t(props.name) || name(e)}</span>
          {#if members.length > 1}<span class="badge num">+{members.length - 1}</span>{/if}
        </div>
        <div class="title">{title}</div>
        <div class="sub">{sub}</div>
      </div>
    </div>
    <div class="controls" data-stop>
      {#if has(32768)}<button class:act={a.shuffle} onclick={() => svc('shuffle_set', { shuffle: !a.shuffle })}><Icon icon="mdi:shuffle" size="1.2em" /></button>{/if}
      {#if has(16)}<button onclick={() => svc('media_previous_track')}><Icon icon="mdi:skip-previous" size="1.6em" /></button>{/if}
      <button class="play" onclick={() => (off && has(128) ? svc('turn_on') : svc('media_play_pause'))}>
        <Icon icon={off ? 'mdi:power' : playing ? 'mdi:pause' : 'mdi:play'} size="1.8em" />
      </button>
      {#if has(32)}<button onclick={() => svc('media_next_track')}><Icon icon="mdi:skip-next" size="1.6em" /></button>{/if}
      {#if has(262144)}<button class:act={a.repeat && a.repeat !== 'off'} onclick={() => svc('repeat_set', { repeat: a.repeat === 'off' ? 'all' : a.repeat === 'all' ? 'one' : 'off' })}><Icon icon={a.repeat === 'one' ? 'mdi:repeat-once' : 'mdi:repeat'} size="1.2em" /></button>{/if}
    </div>
    <div class="bottom" data-stop>
      {#if props.show_volume && has(4)}
        <button class="mini" onclick={() => svc('volume_mute', { is_volume_muted: !a.is_volume_muted })}><Icon icon={a.is_volume_muted ? 'mdi:volume-off' : 'mdi:volume-high'} size="1.2em" /></button>
        <div class="vol"><Slider value={Math.round((a.volume_level ?? 0) * 100)} unit="%" height={30} color="rgba(255,255,255,.85)" onchange={(v) => svc('volume_set', { volume_level: v / 100 })} /></div>
      {/if}
      {#if props.show_source && a.source_list?.length}
        <select value={a.source} onchange={(ev) => svc('select_source', { source: ev.currentTarget.value })}>
          {#if !a.source}<option value="">Source</option>{/if}
          {#each a.source_list as s}<option value={s}>{s}</option>{/each}
        </select>
      {/if}
      {#if props.show_group && groupable}
        <button class="mini" class:act={members.length > 1} onclick={() => (groupOpen = !groupOpen)}><Icon icon="mdi:speaker-multiple" size="1.2em" /></button>
      {/if}
    </div>
    {#if groupOpen}
      <div class="group" data-stop>
        <div class="ghead">Group with <button class="mini" onclick={() => (groupOpen = false)}><Icon icon="mdi:close" size="1.1em" /></button></div>
        {#each candidates as m}
          {@const me = states.get(m)}
          <label class="gm"><input type="checkbox" checked={members.includes(m)} onchange={() => toggleMember(m)} /> {me?.attributes.friendly_name || m}<span class="gs">{me?.state}</span></label>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Item 60: the card is a size container, so a 220-high card and a 120-high one
     scale the same markup instead of clipping the transport. */
  .media { position: relative; height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: min(8px, 2.4cqh); isolation: isolate; container-type: size; }
  .bg { position: absolute; inset: calc(var(--pad) * -1); background-size: cover; background-position: center; filter: blur(2px) saturate(1.2); transform: scale(1.05); z-index: -2; border-radius: inherit; transition: background-image .5s, transform .4s ease; }
  .shade { position: absolute; inset: calc(var(--pad) * -1); background: linear-gradient(90deg, rgba(0,0,0,.8), rgba(0,0,0,.45)), linear-gradient(180deg, transparent 40%, rgba(0,0,0,.6)); z-index: -1; }
  .main { display: flex; gap: min(14px, 3.6cqw); min-height: 0; flex: 1 1 auto; }
  .coverwrap { flex: none; height: min(100%, 42cqh); aspect-ratio: 1; border-radius: min(12px, 3.4cqh); overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
  .cover { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform var(--dur) var(--ease); }
  .coverwrap:focus-within .cover { transform: scale(1.06); }
  @media (hover: hover) {
    .coverwrap:hover .cover { transform: scale(1.06); }
  }
  .info { min-width: 0; display: flex; flex-direction: column; }
  .who { font-size: .8em; color: var(--muted); display: flex; align-items: center; gap: min(7px, 1.8cqw); min-width: 0; }
  .st { flex: none; letter-spacing: .14em; }
  .dev { display: inline-flex; align-items: center; gap: 5px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { flex: none; background: var(--accent); color: #000; border-radius: 8px; padding: 0 6px; font-size: .85em; font-weight: 650; }
  /* The one hero: the track title, white → accent (flat white if text cannot be
     clipped to a background — the fallback keeps it legible either way). */
  .title { color: #fff; font-size: min(1.25em, 8cqw, 12cqh); font-weight: 650; margin-top: min(6px, 1.6cqh); line-height: 1.14; letter-spacing: -.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title {
      background-image: linear-gradient(96deg, #fff 34%, var(--accent) 132%);
      -webkit-background-clip: text; background-clip: text;
      color: transparent; -webkit-text-fill-color: transparent;
    }
  }
  .sub { color: var(--muted); font-size: min(.9em, 3.4cqw); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .controls { display: flex; align-items: center; justify-content: center; gap: min(6px, 1.6cqw); }
  .compact .controls { justify-content: flex-end; position: absolute; right: 0; top: 0; }
  button { background: none; border: 0; color: inherit; padding: 6px; border-radius: 50%; display: grid; place-items: center; }
  button:active { background: rgba(255,255,255,.12); }
  .act { color: var(--accent); }
  .play { width: min(52px, 15cqh); height: min(52px, 15cqh); background: rgba(255,255,255,.92); color: #111; }
  .compact .play { width: min(42px, 22cqh); height: min(42px, 22cqh); }
  .bottom { display: flex; align-items: center; gap: min(8px, 2cqw); }
  .vol { flex: 1; min-width: 0; }
  select { background: rgba(255,255,255,.1); color: inherit; border: 0; border-radius: 10px; padding: 6px 8px; max-width: 40%; font: inherit; font-size: .85em; }
  .group { position: absolute; inset: 0; background: rgba(15,18,28,.96); border-radius: 12px; padding: 10px; overflow: auto; z-index: 5; }
  .ghead { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 6px; }
  .gm { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .gm input { width: 20px; height: 20px; accent-color: var(--accent); }
  .gs { margin-left: auto; color: var(--muted); font-size: .85em; }
  .none { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: .9em; text-align: center; }
  /* Item 52: the member count and the volume reading sit in fixed columns. */
  .num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
  .compact .title { font-size: min(1.05em, 7cqw, 15cqh); }
</style>
