<script module>
  import { states } from '../lib/ha.svelte.js';

  export const meta = {
    type: 'media-history', name: 'Recently watched', icon: 'mdi:history', category: 'Media',
    size: { w: 480, h: 300 }, tap: 'none',
    defaults: { title: 'Recently watched', entities: [], entity: '', max: 8, poster: 'art', show_user: true, show_player: true },
    // Any sensor that carries recent plays in an `items` or `data` attribute (Tautulli history).
    autofill: () => ({
      // Only lists that look like plays (a title plus who / when / how much), so other sensors
      // with a list (e.g. Upcoming Media's `data`) aren't picked up.
      entities: [...states.keys()].filter((id) => id.startsWith('sensor.')).filter((id) => {
        const a = states.get(id)?.attributes || {};
        const list = Array.isArray(a.items) ? a.items : Array.isArray(a.data) ? a.data : null;
        const x = list?.find((r) => r && typeof r === 'object' && r.title);
        return !!x && ('user' in x || 'friendly_name' in x) && ('date' in x || 'percent_complete' in x || 'watched_status' in x);
      }).sort().slice(0, 4),
    }),
    fields: [
      { key: 'entities', label: 'Sensors', type: 'entities', domain: 'sensor', hint: "One or more sensors whose `items` (or `data`) attribute lists recent plays — Tautulli's `get_history` answer, raw or trimmed. A play seen by two sensors is listed once. The poster is whatever image URL a row carries; a bare server path needs a template sensor in Home Assistant, not a key in this card." },
      { key: 'title', label: 'Title (blank = hidden)', type: 'text' },
      { key: 'max', label: 'Most rows shown', type: 'number' },
      { key: 'show_user', label: 'Who watched', type: 'bool' },
      { key: 'show_player', label: 'Player', type: 'bool' },
      { key: 'poster', label: 'Poster', type: 'select', options: [{ value: 'art', label: 'Poster beside each row' }, { value: 'none', label: 'Icon only' }] },
    ],
  };
</script>

<script>
  // Recently watched, newest first: what, who, when and how much of it. Reads a
  // sensor's history list, so it takes Tautulli's own rows or a trimmed template
  // sensor in front of them.
  //
  // Item 47: the most recent play is the card's one hero — its poster, title and
  // numbers step up a size; everything below it is secondary. Item 32: rows zoom
  // their artwork on pointer hover only.
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { haImage } from '../lib/ha.svelte.js';
  import { hueFor, hueWash } from '../lib/design.svelte.js';
  let { props, h = 300 } = $props();

  const pad = (n) => String(Number(n) || 0).padStart(2, '0');
  const num = (v) => Number(v) || 0;

  function norm(x) {
    const mt = x.media_type || 'movie';
    if (x.watched != null && x.percent != null) {
      return {
        title: x.title || 'Unknown',
        subtitle: x.subtitle || '',
        user: x.user || 'Someone',
        watched: num(x.watched),
        percent: num(x.percent),
        duration: num(x.duration),
        poster: x.poster || x.grandparent_thumb || x.parent_thumb || x.thumb || '',
        player: x.player || '',
        media_type: mt,
      };
    }
    const title = mt === 'episode' ? (x.grandparent_title || x.title) : x.title;
    let sub = '';
    if (mt === 'episode') sub = `S${pad(x.parent_media_index)}E${pad(x.media_index)}` + (x.title ? ` · ${x.title}` : '');
    else if (mt === 'track') sub = [x.grandparent_title, x.parent_title].filter(Boolean).join(' · ');
    else sub = x.year ? String(x.year) : '';
    return {
      title: title || 'Unknown',
      subtitle: sub,
      user: x.friendly_name || x.user || 'Someone',
      watched: num(x.date),
      percent: num(x.percent_complete),
      duration: num(x.duration),
      poster: x.poster || x.grandparent_thumb || x.parent_thumb || x.thumb || '',
      player: x.player || '',
      media_type: mt,
    };
  }

  // One sensor or several, merged into one list by when it was watched.
  const ids = $derived(
    [...(Array.isArray(props.entities) ? props.entities : []), props.entity]
      .map((v) => String(t(v) || '').trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
  );
  const all = $derived.by(() => {
    const seen = new Set();
    const out = [];
    for (const id of ids) {
      const e = ent(id);
      if (!e || e.state === 'unavailable') continue;
      const a = e.attributes || {};
      const list = Array.isArray(a.items) ? a.items : Array.isArray(a.data) ? a.data : [];
      for (const x of list) {
        const row = norm(x);
        const key = `${row.title}|${row.subtitle}|${row.user}|${row.watched}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out.sort((p, q) => q.watched - p.watched);
  });
  const rows = $derived(all.slice(0, Math.max(1, Number(props.max) || 8)));
  const waiting = $derived(!ids.length);
  const down = $derived(ids.length > 0 && ids.every((id) => ent(id)?.state === 'unavailable'));

  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  function when(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const days = Math.round((midnight(new Date()) - midnight(d)) / 864e5);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (days <= 0) return `Today ${time}`;
    if (days === 1) return `Yesterday ${time}`;
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  const icon = (r) => (r.media_type === 'track' ? 'mdi:music' : r.media_type === 'episode' ? 'mdi:television-classic' : 'mdi:movie-open');
  // The picture the row carries, or none. The sensor publishes a URL the browser can fetch:
  // HA serves it under /api, or an integration may give a full URL. A bare server path is not
  // resolvable here, and the card does not ask for a token to make one - no keys in settings.
  const art = (path) => {
    const p = String(path || '').trim();
    if (!p || props.poster === 'none') return '';
    return p.startsWith('http') || p.startsWith('/api/') ? haImage(p) : '';
  };
  const pct = (r) => Math.max(0, Math.min(100, r.percent));
  const tight = $derived(h < 230);
  // Item 46: the section is named in small caps, whether or not a title is set.
  const headLabel = $derived(t(props.title) || 'Recently watched');
</script>

<div class="hist" class:tight>
  {#if props.title !== ''}<div class="head microcaps">{headLabel}</div>{/if}

  {#if waiting}
    <div class="none"><Icon icon="mdi:history" size="1.8em" /><div>Pick a sensor with a history attribute.</div></div>
  {:else if !rows.length}
    <div class="none">
      <Icon icon={down ? 'mdi:cloud-off-outline' : 'mdi:movie-open-check-outline'} size="1.8em" />
      <div>{down ? 'Sensor unavailable.' : 'Nothing watched yet.'}</div>
    </div>
  {:else}
    <div class="rows">
      {#each rows as r, i (r.watched + r.title + i)}
        <div class="row" class:lead={i === 0}>
          {#if art(r.poster)}
            <img class="art" src={art(r.poster)} alt="" loading="lazy" decoding="async" />
          {:else}
            <div class="ic"><Icon icon={icon(r)} size={i === 0 ? '1.4em' : '1.15em'} /></div>
          {/if}
          <div class="main">
            <div class="line">
              <span class="t">{r.title}</span>
              {#if props.show_user !== false}<span class="u" style="--uh:{hueFor(r.user)};background:{hueWash(r.user, 0.15)}">{r.user}</span>{/if}
            </div>
            {#if r.subtitle}<div class="s">{r.subtitle}</div>{/if}
            {#if !tight}
              <div class="bar"><div class="fill" style="width:{pct(r)}%"></div></div>
            {/if}
          </div>
          <div class="side">
            <div class="when">{when(r.watched)}</div>
            <div class="pct"><span class="num">{pct(r)}%</span>{#if props.show_player !== false && r.player && !tight}{' · ' + r.player}{/if}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Item 60: size container — the lead row can be a size larger without the
     eight rows under it overflowing a short card. */
  .hist { height: 100%; display: flex; flex-direction: column; gap: min(8px, 2.4cqh); min-height: 0; container-type: size; }
  .head { flex: none; }
  .rows { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .row { display: flex; align-items: center; gap: min(11px, 2.8cqw); padding: min(5px, 1.4cqh) 0; min-width: 0; }
  .row + .row { border-top: 1px solid rgba(255,255,255,.06); }
  .ic { flex: none; width: 2em; height: 2em; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.07); color: var(--muted); }
  .art { flex: none; width: min(2.1em, 6cqw); height: min(3.1em, 9cqh); object-fit: cover; border-radius: 5px; background: rgba(255,255,255,.06); transition: transform var(--dur) var(--ease); }

  /* Item 47: the newest play is the hero of this card. */
  .lead { padding-bottom: min(8px, 2cqh); }
  .lead .art { width: min(3em, 9cqw); height: min(4.4em, 14cqh); border-radius: 8px; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
  .lead .ic { width: 2.8em; height: 2.8em; }
  .lead .t { font-size: min(1.12em, 3.2cqw); }
  .lead .bar { height: 5px; margin-top: min(7px, 1.8cqh); }

  /* Item 32: artwork zooms inside its own rounded frame; pointer devices only. */
  .row:focus-visible .art { transform: scale(1.06); }
  @media (hover: hover) {
    .row:hover .art { transform: scale(1.06); }
  }

  .main { flex: 1; min-width: 0; }
  .line { display: flex; align-items: baseline; gap: 8px; }
  .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Item 21: a person keeps the colour they have everywhere else on the board. */
  .u { color: var(--uh, var(--muted)); font-size: .76em; font-weight: 600; white-space: nowrap; margin-left: auto; padding: 1px 7px; border-radius: 999px; }
  .s { color: var(--muted); font-size: .86em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 4px; border-radius: 2px; background: rgba(255,255,255,.14); margin-top: 5px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); border-radius: 2px; }
  .side { flex: none; text-align: right; max-width: 42%; }
  .when { font-size: .84em; color: var(--muted); white-space: nowrap; }
  .pct { font-size: .8em; color: var(--muted); opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .none { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: .9em; text-align: center; }

  /* Item 52: dates, percentages and episode numbers hold their column. */
  .num, .when, .pct, .s { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
  .tight .lead .art { width: 2.4em; height: 3.5em; }
</style>
