<script module>
  import { states, send as haSend } from '../lib/ha.svelte.js';

  // ---- motion (item 44) ---------------------------------------------------
  // Which motion sensor belongs to which camera. Home Assistant knows: the
  // sensor normally shares the camera's device, so its own related-entity list
  // is asked once per camera. Nothing found means no badge — never an invented
  // one. The answer is a module state so the dashboard re-subscribes to it.
  let motionOf = $state({}); // camera id -> motion entity id ('' = looked, none)
  const pending = new Set();
  const looksMotion = (id) => id.startsWith('binary_sensor.') && (/_motion\b/.test(id) || /motion/i.test(id));

  async function ensureMotion(camId) {
    if (!camId || motionOf[camId] != null || pending.has(camId)) return;
    pending.add(camId);
    let found = '';
    try {
      const rel = await haSend({ type: 'search/related', item_type: 'entity', item_id: camId });
      const list = Array.isArray(rel?.entity) ? rel.entity : [];
      found = list.find(looksMotion) || '';
    } catch {}
    if (!found) {
      // Fall back to a sibling already in the state map, matched on the camera's
      // own words (driveway camera → "Driveway Camera Motion").
      const words = new Set(String(camId.split('.')[1] || '').split('_').filter((w) => w && !/^(camera|cam|reolink|poe|duo|clear|\d+)$/.test(w)));
      for (const id of states.keys()) {
        if (!looksMotion(id)) continue;
        const s = states.get(id);
        if (s?.attributes?.device_class && s.attributes.device_class !== 'motion' && s.attributes.device_class !== 'moving') continue;
        if ([...words].some((w) => id.includes(w))) { found = id; break; }
      }
    }
    motionOf[camId] = found;
    pending.delete(camId);
  }

  export const meta = {
    type: 'camera', name: 'Camera', icon: 'mdi:cctv', category: 'Media',
    size: { w: 400, h: 240 }, tap: 'fullscreen',
    defaults: { entity: '', mode: 'snapshot', refresh: 5, fit: 'auto', show_name: true },
    // The motion sensor isn't a setting, so tell the dashboard to watch it.
    watch: (props) => {
      const id = String(props.entity || '').trim();
      const own = String(props.motion || '').trim();
      if (/^camera\./.test(id)) ensureMotion(id);
      const m = own || motionOf[id];
      return m ? [m] : [];
    },
    // The first camera that is actually there, rather than a wall of blanks.
    autofill: () => {
      const ids = [...states.keys()].filter((id) => id.startsWith('camera.') && states.get(id)?.state !== 'unavailable');
      return ids.length ? { entity: ids[0] } : {};
    },
    fields: [
      { key: 'entity', label: 'Camera', type: 'entity', domain: ['camera', 'image'] },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'motion', label: 'Motion sensor (blank = found on the camera’s device)', type: 'entity', domain: 'binary_sensor' },
      { key: 'show_name', label: 'Show name', type: 'bool' },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'snapshot', label: 'Snapshot' }, { value: 'live', label: 'Live' }, { value: 'video', label: 'Video stream (for cameras whose pictures fail)' }] },
      { key: 'refresh', label: 'Snapshot refresh (s)', type: 'number' },
      { key: 'trigger', label: 'Take a new picture each refresh (Blink: on unless unticked; uses the camera battery)', type: 'bool' },
      { key: 'sound', label: 'Speaker button (live video from cameras with sound; full screen always has it)', type: 'bool' },
      { key: 'fit', label: 'Fit', type: 'select', options: [{ value: 'auto', label: 'Auto' }, { value: 'crop', label: 'Fill the card (crops edges)' }, { value: 'contain', label: 'Whole picture' }] },
    ],
  };
</script>

<script>
  import Icon from '../components/Icon.svelte';
  import { t, ent } from '../lib/tpl.js';
  import { name } from '../lib/entity.js';
  import { haImage, send, callService, subscribe, history, conn } from '../lib/ha.svelte.js';
  let { props, w = 0, h = 0 } = $props();
  const e = $derived(ent(props.entity));
  // Just the id, so attribute updates (e.g. the rotating access token) don't restart streams.
  const camId = $derived(e?.entity_id.startsWith('camera.') ? e.entity_id : null);
  // Some cameras (e.g. Tapo) can't give Home Assistant a still picture in time,
  // so snapshots and live pictures fail. Those that can stream are switched to
  // HA's video stream (HLS, as HA's own dashboard plays it) after two failures.
  const canStream = $derived(((e?.attributes.supported_features ?? 0) & 2) === 2);

  // ---- motion badge + last motion (item 44) -------------------------------
  const motionId = $derived.by(() => {
    const own = props.motion ? String(t(props.motion) ?? '').trim() : '';
    return own || motionOf[camId] || '';
  });
  const motion = $derived(motionId ? ent(motionId) : null);
  const motionOn = $derived(motion?.state === 'on');
  let seen = 0; // newest motion time known (plain, so the effects don't loop)
  let lastAt = $state(0); // what the card draws
  let nowAt = $state(Date.now());
  const mark = (t) => {
    if (!Number.isFinite(t) || t <= seen) return;
    seen = t;
    lastAt = t;
  };
  // History seeds the last-motion time, so a card opened after the fact still
  // knows when it happened rather than waiting for the next visitor.
  $effect(() => {
    const id = motionId;
    seen = 0;
    lastAt = 0;
    if (!id || !conn.connected) return;
    let alive = true;
    history([id], 24)
      .then((res) => {
        if (!alive) return;
        const rows = (res[id] || []).filter((p) => p.s === 'on');
        const p = rows[rows.length - 1];
        if (p) mark(((p.lc ?? p.lu) || 0) * 1000);
      })
      .catch(() => {});
    return () => { alive = false; };
  });
  $effect(() => {
    if (motionOn) mark(Date.parse(motion.last_changed));
  });
  // The words age on their own: "4m ago" becomes "5m ago" without a state change.
  $effect(() => {
    if (!motionId) return;
    const iv = setInterval(() => (nowAt = Date.now()), 15e3);
    return () => clearInterval(iv);
  });
  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  const motionLine = $derived.by(() => {
    if (!motion || /^(unavailable|unknown)$/.test(motion.state)) return '';
    nowAt; // re-render on the timer
    const at = motionOn ? Date.parse(motion.last_changed) : lastAt;
    return Number.isFinite(at) && at ? `last motion ${ago(at)}` : '';
  });
  let failed = $state(0);
  // What the camera can stream to a browser (HA's camera/capabilities):
  // 'web_rtc' (near-instant, what HA's own dashboard uses) and / or 'hls'.
  // null while asking; [] for cameras that can't stream.
  let caps = $state(null);
  let noStream = $state(false);
  $effect(() => {
    const id = camId;
    caps = null; noStream = false;
    if (!id || !canStream) return void (caps = []);
    send({ type: 'camera/capabilities', entity_id: id }).then((r) => (caps = r?.frontend_stream_types || []), () => (caps = []));
  });
  // Live uses the camera's real video stream when it has one; otherwise (or if
  // that fails) a stream of pictures. Video mode always uses the stream.
  const video = $derived(!!camId && (props.mode === 'video' || (canStream && failed >= 2) || (props.mode === 'live' && !!caps?.length && !noStream)));
  const live = $derived(props.mode === 'live' && !!camId && !video && caps != null);
  let broken = $state(false);
  let vid = $state();
  let tick = $state(0);
  // Screen back on (tab visible again, or Fully Kiosk's screen-on): start the
  // camera afresh. Streams and pictures that failed while it was off are
  // forgotten, and a camera that fell back to video tries pictures again.
  let wake = $state(0);
  let lastOk = Date.now();
  $effect(() => {
    let hiddenAt = 0;
    const back = () => { failed = 0; broken = false; tick++; wake++; };
    const vis = () => { if (document.visibilityState === 'hidden') hiddenAt = Date.now(); else if (hiddenAt) { hiddenAt = 0; back(); } };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('panalume-wake', back);
    // Watchdog: some kiosks keep the page "visible" with the screen off, so also
    // start afresh if nothing new has shown for 90 s.
    const dog = setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastOk > Math.max(90, 3 * (Number(props.refresh) || 5)) * 1000) { lastOk = Date.now(); back(); } }, 15e3);
    return () => { clearInterval(dog); document.removeEventListener('visibilitychange', vis); window.removeEventListener('panalume-wake', back); };
  });
  let shown = $state('');
  let ratio = $state(0);
  // Auto (also older cards saved as 'cover'): fill the card unless the picture's
  // shape is very different (e.g. a 32:9 dual-lens camera in a 2:1 card), then show it whole.
  const fit = $derived.by(() => {
    if (props.fit === 'crop') return 'cover';
    if (props.fit === 'contain') return 'contain';
    if (!ratio || !w || !h) return 'cover';
    const r = ratio / (w / h);
    return Math.max(r, 1 / r) > 1.25 ? 'contain' : 'cover';
  });
  const trigger = $derived(!!camId && (props.trigger ?? e?.attributes.brand === 'Blink'));
  // Snapshots: poll, double-buffered so the picture never flashes blank.
  $effect(() => {
    if (live || video) return;
    // Blink (and similar) cameras only keep the last picture they took: ask for
    // a new one, then fetch it once it's had time to arrive.
    const trig = trigger, id = camId;
    const later = [];
    const i = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      tick++;
      if (!trig) return;
      callService('blink', 'trigger_camera', {}, { entity_id: id });
      later.push(setTimeout(() => tick++, 6000), setTimeout(() => tick++, 15000));
    }, Math.max(trig ? 30 : 1, Number(props.refresh) || 5) * 1000);
    return () => { clearInterval(i); later.forEach(clearTimeout); };
  });
  const src = $derived.by(() => {
    if (!e) return '';
    if (e.entity_id.startsWith('image.')) return haImage(e.attributes.entity_picture);
    return `ha/api/camera_proxy/${e.entity_id}?t=${tick}`;
  });
  $effect(() => {
    const s = src;
    if (!s || live || video) return;
    const img = new Image();
    img.onload = () => { shown = s; failed = 0; lastOk = Date.now(); };
    img.onerror = () => failed++;
    img.src = s;
    return () => (img.onload = img.onerror = null);
  });
  // Live: JPEG frames over a websocket (see server camStream), reconnecting if
  // the stream drops and pausing while the screen is hidden.
  $effect(() => {
    if (!live) return;
    wake;
    const id = camId;
    const base = location.pathname.replace(/[^/]*$/, '');
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}api/camera?entity=${encodeURIComponent(id)}`;
    let ws, timer, url0 = '', stopped = false, backoff = 1000;
    shown = `ha/api/camera_proxy/${id}?t=${Date.now()}`;
    const open = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      ws = new WebSocket(url);
      ws.binaryType = 'blob';
      ws.onmessage = (ev) => {
        backoff = 1000;
        failed = 0;
        lastOk = Date.now();
        clearTimeout(none);
        const u = URL.createObjectURL(new Blob([ev.data], { type: 'image/jpeg' }));
        shown = u;
        if (url0) URL.revokeObjectURL(url0);
        url0 = u;
      };
      ws.onclose = () => {
        ws = null;
        if (stopped) return;
        timer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
    };
    const vis = () => {
      if (document.visibilityState === 'visible') { if (!ws) { clearTimeout(timer); open(); } }
      else if (ws) { ws.onclose = null; ws.close(); ws = null; }
    };
    document.addEventListener('visibilitychange', vis);
    open();
    // No picture at all after 12 s: treat as failed (switches to video if it can).
    const none = setTimeout(() => (failed = 2), 12000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(none);
      document.removeEventListener('visibilitychange', vis);
      if (ws) { ws.onclose = null; ws.close(); }
      if (url0) setTimeout(() => URL.revokeObjectURL(url0), 1000);
    };
  });
  // Video: WebRTC where the camera offers it, else HLS. Each is tried in turn;
  // if neither plays, Live drops back to pictures and Video mode retries,
  // waiting a little longer each time (HA stops streams nobody's watching,
  // e.g. while the screen was off).
  let vidErr = $state(''), playing = $state(false);
  // Sound: video starts muted (browsers only autoplay muted video); the speaker
  // button turns it on for streams that carry audio (null = can't tell yet).
  let muted = $state(true), hasAudio = $state(null);
  const toggleSound = () => { muted = !muted; if (vid) { vid.muted = muted; if (!muted) vid.play?.().catch(() => {}); } };
  $effect(() => {
    if (!video || !vid) return;
    wake;
    const id = camId, el = vid, kinds = caps;
    const order = kinds?.length ? ['web_rtc', 'hls'].filter((k) => kinds.includes(k)) : ['hls'];
    let stop = null, stopped = false, retry, tries = 0, slow, step = 0;
    vidErr = '';
    playing = false;
    hasAudio = null;
    const end = () => { stop?.(); stop = null; clearTimeout(slow); el.srcObject = null; el.removeAttribute('src'); el.load?.(); };
    const next = (why) => {
      end();
      if (stopped) return;
      playing = false;
      if (++step < order.length) return start();
      step = 0;
      if (props.mode === 'live' && failed < 2) return void (noStream = true);
      vidErr = tries >= 2 ? why : '';
      retry = setTimeout(start, Math.min(15, 3 * 2 ** tries++) * 1000);
    };
    const start = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      const kind = order[step];
      slow = setTimeout(() => { if (!playing) next("The camera's video didn't start"); }, kind === 'web_rtc' ? 12000 : 45000);
      (kind === 'web_rtc' ? webrtc : hlsPlay)(id, el, (why) => { if (!stopped) next(why); }).then((fn) => { if (stopped) fn?.(); else stop = fn; });
    };
    // Only a picture counts: a WebRTC stream can "play" with no video in it.
    const ok = () => { if (!el.videoWidth) return; tries = 0; vidErr = ''; playing = true; clearTimeout(slow); if (el.srcObject) hasAudio = el.srcObject.getAudioTracks().length > 0; };
    const progress = () => { if (el.videoWidth) lastOk = Date.now(); };
    el.addEventListener('timeupdate', progress);
    el.addEventListener('playing', ok);
    el.addEventListener('resize', ok);
    start();
    return () => { stopped = true; clearTimeout(retry); el.removeEventListener('playing', ok); el.removeEventListener('resize', ok); el.removeEventListener('timeupdate', progress); end(); };
  });

  // WebRTC, as Home Assistant's own dashboard plays cameras: offer, answer and
  // ICE candidates over the websocket; the video comes straight from HA.
  async function webrtc(id, el, fail) {
    let pc, unsub, session = null, done = false;
    const queued = [];
    const close = () => { done = true; unsub?.(); pc?.close(); };
    try {
      const cfg = await send({ type: 'camera/webrtc/get_client_config', entity_id: id }).catch(() => ({}));
      pc = new RTCPeerConnection(cfg?.configuration || {});
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      if (cfg?.dataChannel) pc.createDataChannel(cfg.dataChannel);
      const ms = new MediaStream();
      pc.ontrack = (ev) => { ms.addTrack(ev.track); if (ev.track.kind === 'audio') hasAudio = true; el.srcObject = ms; el.play?.().catch(() => {}); };
      const sendCand = (c) => send({ type: 'camera/webrtc/candidate', entity_id: id, session_id: session, candidate: c }).catch(() => {});
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        const c = { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex };
        session ? sendCand(c) : queued.push(c);
      };
      pc.onconnectionstatechange = () => { if (!done && pc.connectionState === 'failed') { close(); fail('WebRTC connection failed'); } };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      unsub = subscribe({ type: 'camera/webrtc/offer', entity_id: id, offer: offer.sdp }, async (ev) => {
        if (done) return;
        if (ev.type === 'session') { session = ev.session_id; queued.splice(0).forEach(sendCand); }
        else if (ev.type === 'answer') await pc.setRemoteDescription({ type: 'answer', sdp: ev.answer }).catch((e) => { close(); fail(e.message); });
        else if (ev.type === 'candidate' && ev.candidate) await pc.addIceCandidate(ev.candidate).catch(() => {});
        else if (ev.type === 'error') { close(); fail(ev.message || 'WebRTC refused'); }
      });
    } catch (e) {
      close();
      fail(e?.message || 'WebRTC not available');
    }
    return close;
  }

  // HLS: hls.js wherever it works; older iPhones / iPads only play it natively.
  async function hlsPlay(id, el, fail) {
    let hls, done = false;
    try {
      const r = await send({ type: 'camera/stream', entity_id: id });
      const src = 'ha' + r.url;
      const { default: Hls } = await import('hls.js');
      if (!Hls.isSupported()) el.src = src;
      else {
        hls = new Hls({ liveSyncDurationCount: 2 });
        hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => { hasAudio = (d.levels || []).some((l) => l.audioCodec) || (d.audioTracks || []).length > 0 ? true : null; });
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal && !done) { done = true; hls.destroy(); fail('Video stream failed, retrying…'); } });
        hls.loadSource(src);
        hls.attachMedia(el);
      }
      el.play?.().catch(() => {});
    } catch (e) {
      fail(e?.message || 'This camera has no video stream');
    }
    return () => { done = true; hls?.destroy(); };
  }
</script>

<div class="cam" class:motion={motionOn}>
  {#if video}
    <video bind:this={vid} {muted} autoplay playsinline poster={camId ? `ha/api/camera_proxy/${camId}` : undefined} style="object-fit:{fit}" onloadedmetadata={(ev) => (ratio = ev.currentTarget.videoWidth / ev.currentTarget.videoHeight || 0)}></video>
    {#if vidErr}<div class="msg">{vidErr}</div>{:else if !playing}<div class="msg starting">Starting video…</div>{/if}
    {#if props.sound && playing && hasAudio !== false}
      <button class="snd" data-stop onclick={toggleSound} aria-label={muted ? 'Turn sound on' : 'Mute'} title={muted ? 'Turn sound on' : 'Mute'}><Icon icon={muted ? 'mdi:volume-off' : 'mdi:volume-high'} size="1.3em" /></button>
    {/if}
  {:else if shown}<img src={shown} alt="" style="object-fit:{fit}" class:broken onerror={() => { broken = true; failed++; }} onload={(ev) => { broken = false; ratio = ev.currentTarget.naturalWidth / ev.currentTarget.naturalHeight || 0; }} />{/if}
  {#if !e}<div class="msg">Pick a camera in the card's settings.</div>{:else if !video && (broken || (!shown && failed >= 2))}<div class="msg">No picture from this camera</div>{/if}
  {#if props.show_name || motionLine}
    <div class="lbl">
      {#if props.show_name}<span class="nm">{t(props.name) || name(e)}</span>{/if}
      {#if motionLine}<span class="lm">{motionLine}</span>{/if}
    </div>
  {/if}
  {#if motionOn}
    <div class="mo" role="status" aria-label="Motion detected"><span class="pip"></span>Motion</div>
  {/if}
</div>

<style>
  .cam { position: absolute; inset: 0; background: #000; overflow: hidden; border-radius: inherit; container-type: size; }
  .cam.motion { box-shadow: inset 0 0 0 2px rgba(244, 63, 94, .6), inset 0 0 46px rgba(244, 63, 94, .22); }
  img, video { width: 100%; height: 100%; display: block; }
  img.broken { visibility: hidden; }
  .msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: .85em; padding: 12px; text-align: center; }
  .msg.starting { place-items: end center; padding-bottom: 2.4em; text-shadow: 0 1px 4px #000; }
  .snd { position: absolute; right: 12px; bottom: 12px; z-index: 2; width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(0,0,0,.5); color: #fff; display: grid; place-items: center; backdrop-filter: blur(6px); }
  .lbl { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 14px 10px; background: linear-gradient(transparent, rgba(0,0,0,.66)); display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .nm { font-weight: 600; font-size: .9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lm { font-size: .72em; color: rgba(255, 255, 255, .78); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mo { position: absolute; left: 10px; top: 10px; z-index: 3; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border-radius: 999px; background: rgba(244, 63, 94, .94); color: #fff; font-size: .64em; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; box-shadow: 0 2px 16px rgba(244, 63, 94, .55); }
  .mo .pip { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: pip 1.6s ease-in-out infinite; }
  @keyframes pip { 50% { opacity: .3; transform: scale(.65); } }
  @media (prefers-reduced-motion: reduce) { .mo .pip { animation: none; } }
  @container (max-height: 130px) { .lm { display: none; } }
</style>
