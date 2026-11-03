<script module>
  import { states } from '../lib/ha.svelte.js';

  export const meta = {
    type: 'upcoming', name: 'Upcoming media', icon: 'mdi:movie-open-star', category: 'Media',
    size: { w: 520, h: 360 }, tap: 'none',
    defaults: { title: '', entities: [], layout: 'list', days: 30, max: 6, show_source: true, show_rating: true, release: true },
    // Sensors from the Upcoming Media integration: their items live in the data attribute.
    autofill: () => ({
      entities: [...states.keys()]
        .filter((id) => Array.isArray(states.get(id)?.attributes?.data) && /upcoming/.test(id))
        .sort()
        .slice(0, 2),
    }),
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'entities', label: 'Upcoming media sensors', type: 'entities', domain: 'sensor', hint: 'From the Upcoming Media integration: Sonarr, Radarr, Lidarr or Readarr. Add several to mix film and TV in one card.' },
      { key: 'layout', label: 'Layout', type: 'select', options: [{ value: 'list', label: 'List' }, { value: 'posters', label: 'Posters (pictures load from the internet, e.g. TMDB)' }] },
      { key: 'days', label: 'Days ahead', type: 'number' },
      { key: 'max', label: 'Most items shown', type: 'number' },
      { key: 'show_source', label: 'Where it comes from (Sonarr / Radarr)', type: 'bool' },
      { key: 'show_rating', label: 'Rating', type: 'bool' },
      { key: 'release', label: 'How it is released (in cinemas, online, on disc)', type: 'bool', hint: 'Uses the release text the integration publishes: “Available Online”, “In Cinemas”, or the air day and time.' },
    ],
  };
</script>

<script>
  // Upcoming films and episodes from the Upcoming Media integration, as posters
  // or a list. The sensors already carry the artwork, dates and links, so the
  // card only reads their data attribute; tapping an item opens it in Sonarr,
  // Radarr or whichever app the sensor came from.
  //
  // Item 47: one hero per card. In the poster layout the next thing to arrive is
  // a wide banner tile, everything after it is a secondary poster tile. Item 32:
  // a secondary tile zooms its artwork ~6% on pointer hover, inside its own
  // overflow-hidden frame, and its title is painted white → source accent.
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/tpl.js';
  import { haImage } from '../lib/ha.svelte.js';
  let { props, w = 520, h = 360 } = $props();

  const SOURCES = {
    sonarr: { name: 'Sonarr', color: '#35c5f0' },
    radarr: { name: 'Radarr', color: '#ffc230' },
    lidarr: { name: 'Lidarr', color: '#4fd1a5' },
    readarr: { name: 'Readarr', color: '#e8a33d' },
  };
  const ids = $derived((props.entities || []).map((id) => String(t(id) || '').trim()).filter(Boolean));
  const layout = $derived(props.layout === 'list' ? 'list' : 'posters');
  const tight = $derived(h < 230);

  function source(id, e) {
    const key = Object.keys(SOURCES).find((k) => id.toLowerCase().includes(k));
    if (key) return SOURCES[key];
    const friend = String(e?.attributes?.friendly_name || '').replace(/\bupcoming\b.*$/i, '').trim();
    return { name: friend || 'Upcoming', color: 'var(--accent)' };
  }

  // Films are listed at midnight UTC, so their day is the UTC day; episodes
  // carry a real time, and that one is local.
  function when(iso, dateOnly) {
    if (!iso) return null;
    if (dateOnly) {
      const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
      const x = new Date(y, m - 1, d);
      return isNaN(x) ? null : x;
    }
    const x = new Date(iso);
    return isNaN(x) ? null : x;
  }

  const items = $derived.by(() => {
    const out = [];
    for (const id of ids) {
      const e = states.get(id);
      const data = e?.attributes?.data;
      if (!Array.isArray(data)) continue;
      const src = source(id, e);
      for (const raw of data) {
        if (!raw || typeof raw !== 'object' || raw.title_default) continue;
        const title = String(raw.title || '').trim();
        if (!title) continue;
        const dateOnly = !raw.number;
        out.push({
          key: `${id}|${title}|${raw.airdate || ''}`,
          title,
          episode: String(raw.episode || ''),
          number: String(raw.number || ''),
          date: when(raw.airdate, dateOnly),
          release: String(raw.release || ''),
          poster: String(raw.poster || ''),
          rating: String(raw.rating || ''),
          runtime: Number(raw.runtime) || 0,
          genres: String(raw.genres || ''),
          fanart: String(raw.fanart || ''),
          summary: String(raw.summary || ''),
          link: String(raw.deep_link || ''),
          src,
        });
      }
    }
    const days = Math.min(365, Math.max(1, Number(props.days) || 30));
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + days);
    out.sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) || a.title.localeCompare(b.title));
    return out.filter((it) => !it.date || (it.date >= from && it.date < to)).slice(0, Math.max(1, Number(props.max) || 6));
  });
  const hero = $derived(items[0] || null);
  const rest = $derived(items.slice(1));
  const configured = $derived(ids.length > 0);
  const down = $derived(configured && ids.every((id) => states.get(id)?.state === 'unavailable'));
  // A poster URL that 404s paints a broken-image glyph and nothing else — the
  // picture is remembered per item and the tile falls back to its own artwork.
  let failed = $state(new Set());
  const backdrop = (it) => it.fanart || it.poster || '';
  const showArt = (it) =>
    !!it.poster && !failed.has(it.key) && (layout === 'posters' || it.poster.startsWith('/'));

  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  function dayLabel(d) {
    if (!d) return '';
    const today = midnight(new Date());
    const diff = Math.round((midnight(d) - today) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  const timeLabel = (d) => (d && (d.getHours() || d.getMinutes()) ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
  const whenLabel = (it) => [dayLabel(it.date), timeLabel(it.date)].filter(Boolean).join(' · ');
  // The integration publishes the release line as a template: "$day, $date" for
  // a film's release, "$day, $time" for an episode. Fill it in from the air date,
  // so the card says how it arrives as well as when.
  function releaseLine(it) {
    if (!it.release || !it.date) return '';
    // How it arrives is the words around the placeholders: a film's "Available
    // Online $day, $date" says something the date does not, an episode's plain
    // "$day, $time" says nothing, and that keeps the day-and-time label.
    if (!String(it.release).replace(/\$(day|date|time)\b/g, '').replace(/[^A-Za-z]/g, '')) return '';
    const day = it.date.toLocaleDateString(undefined, { weekday: 'short' });
    const date = it.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const time = timeLabel(it.date);
    return String(it.release)
      .replace(/\$day\b/g, day)
      .replace(/\$date\b/g, date)
      .replace(/\$time\b/g, time)
      .replace(/\s+/g, ' ')
      .trim();
  }
  const dateLine = (it) => (props.release !== false ? releaseLine(it) || whenLabel(it) : whenLabel(it));
  const subLabel = (it) => [it.number, it.episode].filter(Boolean).join(' · ');
  const extraLabel = (it) =>
    [it.runtime ? `${it.runtime} min` : '', it.genres.split(',')[0], props.show_rating !== false ? it.rating : '']
      .filter(Boolean)
      .join(' · ');
  const tip = (it) => [it.title, it.number, it.episode, it.summary].filter(Boolean).join('\n');
</script>

<div class="up {layout}" class:tight>
  <div class="head microcaps">{t(props.title) || 'Upcoming'}</div>

  {#if !configured}
    <div class="none">
      <Icon icon="mdi:movie-open-off-outline" size="2em" />
      <div>Pick your Sonarr or Radarr upcoming media sensors.</div>
    </div>
  {:else if !items.length}
    <div class="none">
      <Icon icon={down ? 'mdi:cloud-off-outline' : 'mdi:movie-open-check-outline'} size="2em" />
      <div>{down ? 'Sensor unavailable.' : 'Nothing coming up.'}</div>
    </div>
  {:else if layout === 'posters'}
    <div class="posters">
      <!-- Item 47: the next release is the hero — a wide banner with the fanart
           behind it and the poster itself as an upright thumbnail. -->
      <a class="it hero" href={hero.link || undefined} target={hero.link ? '_blank' : undefined} rel="noopener"
         title={tip(hero)} style="--src:{hero.src.color}" aria-label={[hero.title, whenLabel(hero)].filter(Boolean).join(', ')}>
        {#if backdrop(hero)}
          <div class="hfan" style="background-image:url('{haImage(backdrop(hero))}')" aria-hidden="true"></div>
        {/if}
        <div class="hshade" aria-hidden="true"></div>
        {#if showArt(hero)}
          <img class="hposter" src={haImage(hero.poster)} alt="" loading="lazy" decoding="async"
               onerror={() => (failed = new Set([...failed, hero.key]))} />
        {:else}
          <div class="hposter blank"><Icon icon="mdi:movie-open-outline" size="1.6em" /></div>
        {/if}
        <div class="htxt">
          {#if props.show_source !== false}<span class="chip src">{hero.src.name}</span>{/if}
          <div class="t grad">{hero.title}</div>
          {#if subLabel(hero)}<div class="s num">{subLabel(hero)}</div>{/if}
          <div class="d num">{dateLine(hero)}</div>
        </div>
        {#if props.show_rating !== false && hero.rating}<span class="rate num">{hero.rating}</span>{/if}
      </a>

      {#if rest.length}
        <div class="strip">
          {#each rest as it (it.key)}
            <a class="it tile" href={it.link || undefined} target={it.link ? '_blank' : undefined} rel="noopener"
               title={tip(it)} style="--src:{it.src.color}" aria-label={[it.title, whenLabel(it)].filter(Boolean).join(', ')}>
              <div class="art">
                {#if backdrop(it)}
                  <div class="fan" style="background-image:url('{haImage(backdrop(it))}')" aria-hidden="true"></div>
                {/if}
                {#if showArt(it)}
                  <img src={haImage(it.poster)} alt="" loading="lazy" decoding="async"
                       onerror={() => (failed = new Set([...failed, it.key]))} />
                {:else}
                  <div class="blank"><Icon icon="mdi:movie-open-outline" size="1.4em" /></div>
                {/if}
                {#if props.show_source !== false}<span class="chip src">{it.src.name}</span>{/if}
                {#if props.show_rating !== false && it.rating}<span class="rate num">{it.rating}</span>{/if}
              </div>
              <div class="txt">
                <div class="t grad">{it.title}</div>
                {#if subLabel(it)}<div class="s num">{subLabel(it)}</div>{/if}
                {#if !tight}<div class="d num">{dateLine(it)}</div>{/if}
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="grid list">
      {#each items as it (it.key)}
        <a class="it row" href={it.link || undefined} target={it.link ? '_blank' : undefined} rel="noopener"
           title={tip(it)} style="--src:{it.src.color}" aria-label={[it.title, whenLabel(it)].filter(Boolean).join(', ')}>
          <div class="art">
            {#if showArt(it)}
              <img src={haImage(it.poster)} alt="" loading="lazy" decoding="async"
                   onerror={() => (failed = new Set([...failed, it.key]))} />
            {:else}
              <div class="blank"><Icon icon="mdi:movie-open-outline" size="1.4em" /></div>
            {/if}
          </div>
          <div class="txt">
            <div class="t">{it.title}</div>
            {#if subLabel(it)}<div class="s num">{subLabel(it)}</div>{/if}
            <div class="d num">{dateLine(it)}{#if extraLabel(it)} · {extraLabel(it)}{/if}</div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Item 60: the card is its own size container, so type and gaps answer to the
     card rather than the page, and a small tile never overflows. */
  .up { height: 100%; display: flex; flex-direction: column; gap: min(9px, 2.6cqh); min-height: 0; container-type: size; }
  .head { flex: none; } /* .microcaps from app.css (item 46) */
  .none { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); text-align: center; font-size: .92em; }

  .it { min-width: 0; min-height: 0; display: flex; color: inherit; text-decoration: none; -webkit-tap-highlight-color: transparent; }
  .it:active { opacity: .85; }

  /* ---- poster layout: hero banner over a strip of secondary tiles ---- */
  .posters { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: min(8px, 2.2cqh); }

  .hero { position: relative; flex: 1.35 1 0; min-height: 0; border-radius: min(16px, 4cqh); overflow: hidden; align-items: flex-end; isolation: isolate; background: rgba(255,255,255,.05); }
  .hfan { position: absolute; inset: -12%; background-size: cover; background-position: center; filter: blur(18px) brightness(.5) saturate(1.35); z-index: -2; }
  .hshade { position: absolute; inset: 0; z-index: -1; background: linear-gradient(90deg, rgba(5,7,12,.86) 0%, rgba(5,7,12,.5) 48%, rgba(5,7,12,.18) 100%), linear-gradient(180deg, transparent 40%, rgba(5,7,12,.72)); }
  .hposter { flex: none; height: calc(100% - min(20px, 5cqh)); margin: min(10px, 2.6cqh); aspect-ratio: 2 / 3; object-fit: cover; border-radius: min(10px, 2.2cqh); box-shadow: 0 8px 22px rgba(0,0,0,.5); background: rgba(255,255,255,.06); }
  .hposter.blank { display: grid; place-items: center; color: var(--muted); }
  .htxt { flex: 1; min-width: 0; padding: 0 min(12px, 2.6cqw) min(10px, 2.4cqh) 0; display: flex; flex-direction: column; gap: min(4px, 1cqh); }
  .hero .t { font-size: min(1.5em, 5.4cqw, 14cqh); line-height: 1.12; font-weight: 650; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; letter-spacing: -.01em; }
  .hero .s { color: rgba(255,255,255,.82); font-size: min(.84em, 3cqw, 6.4cqh); }
  .hero .d { color: rgba(255,255,255,.72); font-size: min(.8em, 2.9cqw, 6cqh); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .chip { font-size: min(.68em, 2.4cqw); font-weight: 650; padding: 1px 6px; border-radius: 7px; line-height: 1.6; letter-spacing: .02em; }
  .hero .chip { align-self: flex-start; background: var(--src); color: #071018; }

  /* Secondary tiles: artwork fills the tile, title under a bottom scrim.
     Item 32: the artwork scales inside an overflow-hidden rounded frame. */
  .strip { flex: 1 1 0; min-height: 0; display: flex; gap: min(8px, 1.9cqw); overflow: hidden; }
  .tile { position: relative; flex: 1 1 0; min-width: min(58px, 15cqw); flex-direction: column; justify-content: flex-end; border-radius: min(12px, 3cqh); overflow: hidden; background: rgba(255,255,255,.05); }
  .tile .art { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
  .fan { position: absolute; inset: -18%; background-size: cover; background-position: center; filter: blur(18px) brightness(.42) saturate(1.5); }
  .tile .art img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: 50% 42%; }
  .tile .blank { position: relative; z-index: 1; width: 100%; height: 100%; display: grid; place-items: center; color: var(--muted); background: radial-gradient(120% 90% at 50% 12%, rgba(255,255,255,.08), transparent 72%); border: 1px solid rgba(255,255,255,.07); border-radius: inherit; }
  .tile .txt { position: relative; padding: min(22px, 6cqh) min(8px, 1.8cqw) min(7px, 1.8cqh); background: linear-gradient(180deg, transparent, rgba(6,8,14,.6) 36%, rgba(6,8,14,.94)); }
  .tile .t { font-size: min(.84em, 2.7cqw, 4.4cqh); line-height: 1.2; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tile .s { color: rgba(255,255,255,.8); font-size: min(.74em, 2.4cqw); line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .d { color: rgba(255,255,255,.72); font-size: min(.72em, 2.3cqw); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  .chip.src { position: absolute; top: min(6px, 1.6cqh); left: min(6px, 1.6cqw); background: var(--src); color: #071018; max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rate { position: absolute; top: min(6px, 1.6cqh); right: min(6px, 1.6cqw); font-size: min(.7em, 2.5cqw); font-weight: 600; padding: 1px 6px; border-radius: 7px; line-height: 1.6; background: rgba(6,8,14,.62); color: #fff; }
  .hero .rate { top: min(10px, 2.6cqh); right: min(10px, 2.6cqw); font-size: min(.78em, 2.6cqw); }

  /* Item 52: numbers that stack (ratings, S1·E2, dates) hold their column. */
  .num, .rate, .d, .s { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

  /* Item 32: white → accent title, with a flat colour underneath for engines
     that cannot clip text to a background. */
  .t.grad { color: #fff; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .t.grad {
      background-image: linear-gradient(96deg, #fff 22%, var(--src, var(--accent)) 118%);
      -webkit-background-clip: text; background-clip: text;
      color: transparent; -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
    }
  }

  /* Hover zoom is pointer-only: on a touch screen :hover sticks after a tap. */
  .tile .art img { transition: transform var(--dur) var(--ease); }
  .tile:focus-visible .art img { transform: scale(1.06); }
  @media (hover: hover) {
    .tile:hover .art img { transform: scale(1.06); }
  }

  /* ---- list layout: a small poster on the left, one row per item ---- */
  .grid { flex: 1; min-height: 0; display: grid; gap: min(10px, 2.4cqh); overflow: hidden; }
  .grid.list { grid-template-columns: 1fr; grid-auto-rows: min-content; align-content: start; overflow: auto; }
  .list .row { align-items: center; gap: min(11px, 3cqw); padding: min(6px, 1.6cqh) min(4px, 1cqw); border-radius: 12px; }
  .list .row:active { background: rgba(255,255,255,.06); }
  .list .art { position: relative; flex: none; width: min(44px, 11cqw); aspect-ratio: 2 / 3; border-radius: 9px; overflow: hidden; background: rgba(255,255,255,.06); }
  .list .art img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform var(--dur) var(--ease); }
  .list .row:focus-visible .art img { transform: scale(1.06); }
  @media (hover: hover) {
    .list .row:hover .art img { transform: scale(1.06); }
  }
  .list .blank { width: 100%; height: 100%; display: grid; place-items: center; color: var(--muted); }
  .list .txt { min-width: 0; flex: 1; }
  .list .t { font-weight: 600; font-size: min(1em, 2.9cqw); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list .s { color: var(--muted); font-size: min(.86em, 2.5cqw); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list .d { color: var(--muted); font-size: min(.82em, 2.4cqw); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .tight .none { font-size: .85em; }
  .tight .hero .t { -webkit-line-clamp: 2; }
</style>
