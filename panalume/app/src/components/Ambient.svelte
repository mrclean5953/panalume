<script>
  // The ground behind the glass. Four layers, bottom to top:
  //   1. the photo of the day from the Immich album (6%)            — item 5
  //   2. the time-of-day aurora, drifting on a 90s loop             — items 2, 3
  //   3. a weather-reactive tint (rain cool, snow soft, clear warm)  — item 4
  // Nothing here takes a pointer event, and every animation stops under
  // prefers-reduced-motion (the global stylesheet collapses them as well).
  import { app } from '../lib/config.svelte.js';
  import { states, conn } from '../lib/ha.svelte.js';
  import { t } from '../lib/tpl.js';
  import { periodOf, PERIODS, weatherLook } from '../lib/design.svelte.js';

  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 60e3);
    return () => clearInterval(timer);
  });
  const period = $derived(periodOf(now));
  const pal = $derived(PERIODS[period] || PERIODS.night);

  // The weather entity: whichever one the theme names, else the first one HA has.
  let wxId = $state('');
  $effect(() => {
    if (!conn.connected) return;
    const named = String(t(app.config?.theme?.weather) || '').trim();
    if (named) { wxId = named; return; }
    const scan = () => {
      if (!wxId) wxId = [...states.keys()].find((k) => k.startsWith('weather.')) || '';
    };
    scan();
    const timer = setInterval(scan, 20e3);
    return () => clearInterval(timer);
  });
  const wxState = $derived(wxId ? states.get(wxId)?.state : '');
  const look = $derived(weatherLook(wxState));

  // Photo of the day. theme.photo may be a template; otherwise the Immich-backed
  // album slideshow camera is used. theme.photo = 'off' turns it off entirely.
  const photo = $derived.by(() => {
    const set = String(t(app.config?.theme?.photo) ?? '').trim();
    if (set === 'off' || set === '0') return '';
    if (set) return set.startsWith('/') ? `ha${set}` : set;
    return 'ha/api/camera_proxy/camera.album_slideshow_portrait_hoas';
  });
  const photoOp = $derived(Number(app.config?.theme?.photoOpacity ?? 0.06));
  const showPhoto = $derived(!!photo && photoOp > 0 && app.config?.theme?.ambient !== false);
  const showGround = $derived(app.config?.theme?.ambient !== false);
</script>

{#if showGround}
  <div class="ambient" aria-hidden="true" data-period={period} data-wx={look.kind}
    style="--p-a:{pal.a};--p-b:{pal.b};--p-c:{pal.c};--p-wash:{pal.wash};--wx:{look.tint};--wx-a:{look.alpha}">
    {#if showPhoto}
      <div class="photo" style="background-image:url('{photo}');opacity:{photoOp}"></div>
    {/if}
    <div class="blob a"></div>
    <div class="blob b"></div>
    <div class="blob c"></div>
    <div class="tint"></div>
    <div class="vignette"></div>
  </div>
{/if}

<style>
  .ambient {
    position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden;
    /* The period's wash sits over the theme's own aurora, so a page keeps its
       identity while the whole board warms and cools through the day. */
    background: var(--p-wash);
    transition: background-color 3s linear;
  }
  .photo {
    position: absolute; inset: -2%;
    background-size: cover; background-position: center;
    filter: saturate(1.15) contrast(1.05) blur(1px);
    transition: opacity 2s ease;
  }
  .blob {
    position: absolute; border-radius: 50%;
    filter: blur(70px);
    will-change: transform;
    animation: drift 90s ease-in-out infinite alternate;
  }
  /* Three saturated blobs, one per palette stop, each drifting on its own
     phase so the loop never visibly repeats (item 2). */
  .blob.a { width: 62vmax; height: 62vmax; left: -18vmax; top: -24vmax; background: radial-gradient(circle, var(--p-a) 0%, transparent 68%); opacity: .34; animation-duration: 90s; }
  .blob.b { width: 54vmax; height: 54vmax; right: -16vmax; bottom: -20vmax; background: radial-gradient(circle, var(--p-b) 0%, transparent 68%); opacity: .32; animation-duration: 112s; animation-direction: alternate-reverse; }
  .blob.c { width: 44vmax; height: 44vmax; left: 38%; top: 26%; background: radial-gradient(circle, var(--p-c) 0%, transparent 70%); opacity: .22; animation-duration: 137s; }
  .tint {
    position: absolute; inset: 0;
    background: radial-gradient(120% 90% at 50% 120%, var(--wx) 0%, transparent 62%);
    opacity: var(--wx-a);
    mix-blend-mode: screen;
    transition: background-color 2s linear, opacity 2s linear;
  }
  .vignette {
    position: absolute; inset: 0;
    background: radial-gradient(130% 100% at 50% 40%, transparent 46%, rgba(4,6,12,.55) 100%);
  }
  /* An opaque ground is the theme's own choice: honour it by drawing nothing. */
  @keyframes drift {
    0%   { transform: translate3d(0, 0, 0) scale(1); }
    35%  { transform: translate3d(4vmax, -3vmax, 0) scale(1.08); }
    70%  { transform: translate3d(-3vmax, 5vmax, 0) scale(.96); }
    100% { transform: translate3d(2vmax, 2vmax, 0) scale(1.05); }
  }
  @media (prefers-reduced-motion: reduce) {
    .blob { animation: none; }
  }
</style>
