<script module>
  import { states } from '../lib/ha.svelte.js';

  const OFF = ['off', 'unavailable', 'unknown', 'idle', 'standby'];

  export const meta = {
    type: 'now-playing', name: 'Now playing', icon: 'mdi:music-box-outline', category: 'Media',
    size: { w: 300, h: 300 }, tap: 'more-info', hold: 'more-info',
    defaults: { entity: '', art: 'fill' },
    sections: [
      { key: 'art', label: 'Artwork' },
      { key: 'source', label: 'Player name' },
      { key: 'title', label: 'Track' },
      { key: 'artist', label: 'Artist and album' },
      { key: 'progress', label: 'Progress' },
      { key: 'controls', label: 'Controls' },
    ],
    // Something playing now, else the first player that could play something.
    autofill: () => ({ entity: pick() }),
    fields: [
      { key: 'entity', label: 'Media player', type: 'entity', domain: 'media_player' },
      { key: 'name', label: 'Name (blank = the player’s own name)', type: 'text' },
      { key: 'art', label: 'Artwork', type: 'select', options: ['fill', 'cover', 'none'], hint: 'fill and cover both put a square tile beside the text over a blurred copy of it. none is text only, for players that never have artwork.' },
    ],
  };

  function pick() {
    const ids = [...states.keys()].filter((id) => id.startsWith('media_player.'));
    const playing = ids.find((id) => states.get(id)?.state === 'playing');
    const usable = ids.find((id) => !OFF.includes(states.get(id)?.state));
    return playing || usable || ids[0] || '';
  }
</script>

<script>
  // The tile an Android phone opens its media player with: the artwork large on
  // the left, what is playing at hero weight beside it, a waveform that moves
  // with the track, and three buttons.
  import { fade } from 'svelte/transition';
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { name } from '../lib/entity.js';
  import { callService, haImage } from '../lib/ha.svelte.js';
  import { hueFor, MOTION, reducedMotion, mmss } from '../lib/design.svelte.js';

  let { props, w = 300, h = 300 } = $props();
  const show = (k) => !props.hide?.[k];
  const e = $derived(ent(props.entity));
  const a = $derived(e?.attributes || {});
  const sf = $derived(Number(a.supported_features) || 0);
  const has = (bit) => (sf & bit) !== 0;
  const playing = $derived(e?.state === 'playing');
  const mode = $derived(show('art') ? props.art || 'fill' : 'none');
  // Artwork goes through Home Assistant's own image proxy and is drawn as a
  // background, so a player with no picture (or a dead URL) leaves a tinted tile
  // rather than a broken image. Nothing is fetched from outside the house.
  const art = $derived(mode === 'none' ? '' : haImage(a.entity_picture_local || a.entity_picture));
  const title = $derived.by(() => {
    if (!e) return 'Nothing playing';
    if (e.state === 'unavailable' || e.state === 'unknown') return 'Player unavailable';
    if (a.media_title) return a.media_title;
    if (e.state === 'off') return 'Off';
    if (e.state === 'idle') return 'Nothing playing';
    if (e.state === 'paused') return 'Paused';
    return a.media_series_title || e.state;
  });
  const artist = $derived(a.media_artist || '');
  // The album only when it is not just the track's own name again.
  const album = $derived(a.media_album_name && a.media_album_name !== a.media_title ? a.media_album_name : '');
  const device = $derived(t(props.name) || name(e) || '');
  const app = $derived(a.app_name && a.app_name !== device ? a.app_name : '');
  // Crossfade: the previous cover is kept underneath while the new one fades in,
  // so a track change does not flash the tinted tile in between.
  let shown = $state('');
  let before = $state('');
  $effect(() => {
    if (art !== shown) { before = shown; shown = art; }
  });
  // The card's own hue, so a player with no artwork still gets a colour of its
  // own rather than the same grey tile on every card.
  const hue = $derived(hueFor(device || props.entity || 'music'));
  const dur = $derived(Number(a.media_duration) || 0);
  // media_position is a snapshot from media_position_updated_at; while it plays,
  // keep it moving so the bar and the wave are not a second out of date.
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!playing) return;
    const i = setInterval(() => { nowMs = Date.now(); }, 1000);
    return () => clearInterval(i);
  });
  const pos = $derived.by(() => {
    const base = Number(a.media_position);
    if (!Number.isFinite(base)) return null;
    const started = Date.parse(a.media_position_updated_at || '');
    if (!playing || Number.isNaN(started)) return base;
    return Math.min(dur || Infinity, base + (nowMs - started) / 1000);
  });
  const pct = $derived(dur > 0 && pos != null ? Math.max(0, Math.min(100, (pos / dur) * 100)) : 0);
  // mm:ss, zero-padded, in tabular figures — a clock that does not shuffle its
  // digits as it counts. Long things (audiobooks) just grow the minutes.
  const clock = (s) => mmss(s).replace(/^(\d):/, '0$1:');
  const svc = (s, d = {}) => callService('media_player', s, d, { entity_id: e?.entity_id });
  const landscape = $derived(w > h * 1.5);
  const small = $derived(h < 200 || w < 200);
  const showWave = $derived(!small && dur > 0 && pos != null);

  // ---- waveform (item 34) ----
  // 40 bars whose heights are a pure function of (bar index, playback position):
  // no randomness, so the same instant of the track always draws the same wave,
  // it sweeps as the position advances, and it freezes exactly where it was when
  // the player pauses.
  const BARS = 40;
  const shape = (i) => 0.22 + 0.78 * ((Math.sin(i * 0.55) * 0.5 + 0.5) * 0.6 + (Math.sin(i * 1.7 + 1.2) * 0.5 + 0.5) * 0.4);
  const bars = $derived.by(() => {
    const at = pos ?? 0;
    const lit = Math.round((pct / 100) * BARS);
    return Array.from({ length: BARS }, (_, i) => {
      const wob = Math.sin(i * 0.7 + at * 1.9) * 0.5 + 0.5;
      return { h: Math.max(0.14, Math.min(1, shape(i) * (0.55 + 0.45 * wob))), lit: i < lit };
    });
  });
</script>

<div class="np" class:over={!!art} class:landscape class:small style="--hue:{hue}">
  {#if art}
    <div class="ground" class:soft={mode === 'cover'} style="background-image:url('{art}')\"></div>
    <div class="veil"></div>
  {/if}

  {#if show('source') && device && !small}
    <div class="top">
      <span class="microcaps">Now playing</span>
      <span class="src">
        <Icon icon="mdi:speaker" size=".95em" />
        <span class="dev">{device}</span>
        {#if app}<span class="app">· {app}</span>{/if}
      </span>
    </div>
  {/if}

  <div class="mid">
    {#if show('art')}
      <div class="art" class:empty={!art}>
        {#if art}
          {#if before && before !== art}<img class="pic prev" src={before} alt="" />{/if}
          {#key art}
            <img class="pic" src={art} alt="" in:fade={{ duration: reducedMotion() ? 0 : MOTION.slow }} />
          {/key}
        {:else}
          <Icon icon="mdi:music-box-outline" size="1.7em" />
        {/if}
      </div>
    {/if}
    <div class="text">
      {#if show('title')}<div class="title" class:muted={!a.media_title}>{title}</div>{/if}
      {#if show('artist') && artist}<div class="artist">{artist}</div>{/if}
      {#if show('artist') && album && !small}<div class="album">{album}</div>{/if}
    </div>
  </div>

  {#if showWave}
    <div class="wave" class:frozen={!playing} aria-hidden="true">
      {#each bars as b, i}
        <span class="bar" class:lit={b.lit} style="height:{Math.round(b.h * 100)}%"></span>
      {/each}
    </div>
  {/if}

  {#if show('progress') && dur > 0 && pos != null}
    <div class="prog">
      <span class="times num">{clock(pos)}</span>
      <div class="track"><div class="done" style="width:{pct}%"></div></div>
      <span class="times num">{clock(dur)}</span>
    </div>
  {/if}

  {#if show('controls') && e}
    <div class="controls" data-stop>
      {#if has(16)}<button onclick={() => svc('media_previous_track')} aria-label="Previous"><Icon icon="mdi:skip-previous" size="1.5em" /></button>{:else}<span class="gap"></span>{/if}
      <button class="play" onclick={() => (e.state === 'off' && has(128) ? svc('turn_on') : svc('media_play_pause'))} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon icon={e.state === 'off' ? 'mdi:power' : playing ? 'mdi:pause' : 'mdi:play'} size="1.6em" />
      </button>
      {#if has(32)}<button onclick={() => svc('media_next_track')} aria-label="Next"><Icon icon="mdi:skip-next" size="1.5em" /></button>{:else}<span class="gap"></span>{/if}
    </div>
  {/if}
</div>

<style>
  .np { position: relative; height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: 6px;
    isolation: isolate; container-type: size; min-height: 0; }
  /* The ground: the same artwork, blown up and thrown out of focus, so the card
     takes its colour from the record instead of from the theme. */
  .ground { position: absolute; inset: -20%; background-size: cover; background-position: center; z-index: -2;
    filter: blur(28px) saturate(1.6) brightness(.5); }
  .ground.soft { filter: blur(24px) saturate(1.3) brightness(.58); }
  .veil { position: absolute; inset: calc(var(--pad) * -1); border-radius: inherit; z-index: -1;
    background: linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.12) 26%, rgba(0,0,0,.42) 54%, rgba(0,0,0,.72) 80%, rgba(0,0,0,.88) 100%); }
  .over { color: #fff; }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .over .top :global(.microcaps) { color: rgba(255,255,255,.6); }
  .src { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; font-size: .76em; color: var(--muted); }
  .over .src { color: rgba(255,255,255,.7); }
  .dev, .app { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mid { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; gap: min(14px, 4cqw);
    overflow: hidden; }
  .art { flex: none; position: relative; height: min(58cqh, 46cqw); max-height: 100%; aspect-ratio: 1; border-radius: 16px; overflow: hidden;
    box-shadow: 0 10px 28px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset; background: color-mix(in srgb, var(--hue) 30%, transparent); }
  /* No artwork: a tinted tile in the player's own hue, never a hole in the card. */
  .art.empty { display: grid; place-items: center; color: color-mix(in srgb, var(--hue) 70%, #fff);
    background: radial-gradient(120% 120% at 30% 20%, color-mix(in srgb, var(--hue) 42%, transparent), rgba(0,0,0,.28)); }
  .pic { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; justify-content: center; }
  .title { font-size: min(1.6em, 6.4cqw, 9cqh); font-weight: 700; line-height: 1.12; letter-spacing: -.02em;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 1px 10px rgba(0,0,0,.4); }
  .title.muted { font-weight: 500; opacity: .82; }
  .artist { font-size: .84em; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .over .artist { color: rgba(255,255,255,.86); }
  .album { font-size: .74em; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .over .album { color: rgba(255,255,255,.6); }
  /* Waveform: bars grow from the centre; the played part is the accent, the rest
     sits back. Heights transition so the once-a-second position reads as motion. */
  .wave { flex: none; height: min(34px, 10cqh); display: flex; align-items: center; justify-content: space-between;
    gap: 2px; opacity: .95; }
  .bar { flex: 1 1 0; min-width: 0; border-radius: 2px; background: rgba(255,255,255,.2);
    transition: height 900ms linear, background-color 400ms ease; }
  .over .bar { background: rgba(255,255,255,.26); }
  .bar.lit { background: var(--accent); }
  .over .bar.lit { background: rgba(255,255,255,.92); }
  .frozen .bar { opacity: .72; }
  .prog { display: flex; align-items: center; gap: 8px; }
  .track { flex: 1; height: 4px; border-radius: 2px; background: rgba(127,127,127,.35); overflow: hidden; }
  .over .track { background: rgba(255,255,255,.26); }
  .done { height: 100%; border-radius: 2px; background: var(--accent); transition: width 1s linear; }
  .over .done { background: rgba(255,255,255,.92); }
  .times { font-size: .68em; color: var(--muted); white-space: nowrap; letter-spacing: .02em; }
  .over .times { color: rgba(255,255,255,.72); }
  .controls { display: flex; align-items: center; justify-content: center; gap: 6px; }
  button { background: none; border: 0; color: inherit; padding: 7px; border-radius: 50%; display: grid; place-items: center; }
  button:active { background: rgba(127,127,127,.25); }
  .over .controls button:not(.play) { background: rgba(255,255,255,.16); }
  .over .controls button:not(.play):active { background: rgba(255,255,255,.3); }
  .play { width: min(52px, 17cqh); height: min(52px, 17cqh); background: rgba(255,255,255,.94); color: #111;
    box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .play:active { background: #fff; }
  .gap { width: 2.4em; }
  .small .play { width: min(40px, 20cqh); height: min(40px, 20cqh); }
  .small .art { height: min(62cqh, 34cqw); border-radius: 12px; }
  .small .title { font-size: min(1.05em, 7cqw, 14cqh); }
  .small .album { display: none; }
  .landscape .mid { align-items: center; }
  .landscape .art { height: min(76cqh, 30cqw); }
  .landscape .title { font-size: min(1.8em, 4.4cqw, 12cqh); }
</style>
