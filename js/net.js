'use strict';
// =====================================================================
//  NET — two-player link with two transports:
//   1. direct  : WebRTC data channel (PeerJS). Lowest latency, but some
//                routers / mobile carriers block direct connections.
//   2. relay   : messages relayed through a public MQTT broker over a
//                secure WebSocket. Works on practically any network.
//  The guest tries direct first and falls back to the relay after a few
//  seconds. The host listens on both and uses whichever connects first.
// =====================================================================
const Net = (() => {
  const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const DIRECT_TIMEOUT = 4000;   // ms before the guest falls back to the relay
  const GIVE_UP = 45000;         // ms before reporting failure (keeps trying quietly after)

  let peer = null, conn = null, mq = null, role = null, id = null;
  let transport = null;          // 'direct' | 'relay' | null
  let pingTimer = null, helloTimer = null, fallbackTimer = null, giveUpTimer = null;
  let rtt = 0.08, lastRx = 0;
  let relayState = 'none';        // guest: 'none' | 'reached' | 'unreachable'
  const handlers = {};
  const T0 = performance.now(), log = [];
  const L = (msg) => { log.push(Math.round(performance.now() - T0) + 'ms ' + msg); if (log.length > 200) log.shift(); };

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function emit(type, msg) { for (const fn of handlers[type] || []) fn(msg); }

  function makeId() {
    const c = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += c[(Math.random() * c.length) | 0];
    return 'spintt-' + s;
  }
  const topic = (dir) => `spin-tt/v1/${id}/${dir}`;          // dir: 'h2g' (host → guest) or 'g2h'

  // ---------- incoming messages (either transport) ----------
  function receive(m, via) {
    if (!m || !m.t) return;
    if (via === transport) lastRx = performance.now();
    if (via !== transport && !(m.t === 'hello' || m.t === 'welcome')) return;   // ignore the unused transport
    if (m.t === 'ping') { send({ t: 'pong', ts: m.ts }); return; }
    if (m.t === 'pong') { rtt = rtt * 0.8 + ((performance.now() - m.ts) / 1000) * 0.2; return; }
    emit(m.t, m);
  }

  function becomeConnected(kind) {
    if (transport) return;
    L('CONNECTED ' + kind);
    transport = kind;
    clearTimeout(fallbackTimer); clearTimeout(giveUpTimer); clearInterval(helloTimer);
    if (kind === 'relay') rtt = 0.2;
    else { for (const c of mqAll) { try { c.end(true); } catch (e) {} } mqAll = []; mq = null; }   // direct: relays not needed
    clearInterval(pingTimer);
    lastRx = performance.now();
    pingTimer = setInterval(() => {
      send({ t: 'ping', ts: performance.now() });
      if (performance.now() - lastRx > 8000) lost();   // nothing heard for 8 s: friend is gone
    }, 1000);
    emit('connected', { transport: kind });
  }

  // ---------- direct (WebRTC) ----------
  function setupDirect(c) {
    c.on('open', () => {
      if (transport && transport !== 'direct') { try { c.close(); } catch (e) {} return; }
      conn = c;
      becomeConnected('direct');
    });
    c.on('data', (m) => receive(m, 'direct'));
    c.on('close', () => { if (conn === c) { conn = null; if (transport === 'direct') lost(); } });
    c.on('error', () => {});
  }

  // ---------- relay (MQTT over WebSocket) ----------
  let mqAll = [];                // host: one client per broker, so the guest can't miss us
  let bestBroker = 0;            // host: index of the fastest broker (sent in the invite link)

  function openBroker(idx, listenDir) {
    return new Promise((resolve, reject) => {
      if (typeof mqtt === 'undefined') { reject(new Error('relay library missing')); return; }
      L('relay connecting ' + BROKERS[idx].split('/')[2]);
      const client = mqtt.connect(BROKERS[idx], {
        clientId: 'spintt_' + Math.random().toString(36).slice(2, 12),
        clean: true, connectTimeout: 5000, reconnectPeriod: 2000, keepalive: 120,
      });
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; try { client.end(true); } catch (e) {} reject(new Error('timeout')); } }, 6000);
      client.on('connect', () => {
        L('relay connected ' + BROKERS[idx].split('/')[2]);
        if (settled) return;
        client.subscribe(topic(listenDir), { qos: 0 }, (err) => {
          if (settled) return;
          settled = true; clearTimeout(t);
          L('relay subscribed ' + BROKERS[idx].split('/')[2] + ' ' + topic(listenDir));
          if (err) { try { client.end(true); } catch (e) {} reject(err); return; }
          resolve(client);
        });
      });
      client.on('message', (_t, payload) => {
        let m; try { m = JSON.parse(payload.toString()); } catch (e) { return; }
        if (m.t === 'hello' || m.t === 'welcome') L('relay got ' + m.t + ' via ' + BROKERS[idx].split('/')[2]);
        if (m.t === 'hello' && role === 'host') {          // a guest reached us through this broker
          if (!transport) { mq = client; relayPublish({ t: 'welcome' }); becomeConnected('relay'); dropOtherBrokers(); }
          else if (mq === client) relayPublish({ t: 'welcome' });
          return;
        }
        if (m.t === 'welcome' && role === 'guest') { becomeConnected('relay'); return; }
        if (client !== mq) return;
        if (m.t === 'bye' && transport === 'relay') { lost('bye'); return; }
        receive(m, 'relay');
      });
      client.on('error', () => {});
    });
  }
  function dropOtherBrokers() {
    for (const c of mqAll) if (c !== mq) { try { c.end(true); } catch (e) {} }
    mqAll = mq ? [mq] : [];
  }
  // host: listen on every broker at once; remember which answered first
  function hostRelays() {
    mqAll = [];
    let first = true;
    return Promise.allSettled(BROKERS.map((_, i) => openBroker(i, 'g2h').then((c) => {
      mqAll.push(c);
      if (first) { first = false; bestBroker = i; }
    })));
  }
  // guest: preferred broker first (from the invite link), then the others
  async function guestRelay(preferred) {
    const order = [preferred, ...BROKERS.map((_, i) => i).filter((i) => i !== preferred)];
    for (const i of order) {
      try { mq = await openBroker(i, 'h2g'); mqAll = [mq]; return; } catch (e) {}
    }
    throw new Error('no relay reachable');
  }
  function relayPublish(m) {
    if (!mq) return;
    mq.publish(topic(role === 'host' ? 'h2g' : 'g2h'), JSON.stringify(m), { qos: 0 });
  }

  // ---------- public API ----------
  // Host: create a table, listen on both transports. Resolves with the invite id.
  function host() {
    close();
    role = 'host';
    return new Promise((resolve, reject) => {
      const tryOpen = (attempt) => {
        id = makeId();
        peer = new Peer(id, { debug: 1 });
        peer.on('open', () => {
          // wait briefly so the invite link can name the fastest broker
          hostRelays();
          const t0 = performance.now();
          const ready = () => (mqAll.length || performance.now() - t0 > 2500) ? resolve(id) : setTimeout(ready, 100);
          ready();
        });
        peer.on('connection', (c) => { if (transport) { c.on('open', () => c.close()); return; } setupDirect(c); });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 3) { peer.destroy(); tryOpen(attempt + 1); return; }
          if (!transport && e.type !== 'peer-unavailable') { // broker for direct links down → relay-only table
            id = id || makeId();
            hostRelays().then(() => (mqAll.length ? resolve(id) : reject(e)));
          }
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (err) {} });
      };
      tryOpen(0);
    });
  }

  // Guest: try a direct link; if it hasn't opened after a few seconds, use the relay.
  function join(hostId, preferredBroker = 0) {
    close();
    role = 'guest'; id = hostId;
    L('join ' + hostId + ' broker ' + preferredBroker);
    emit('status', 'Connecting directly…');
    // connect to the relay broker right away (in the background) so a fallback is instant
    relayState = 'none';
    const relayReady = guestRelay(Math.min(BROKERS.length - 1, Math.max(0, preferredBroker | 0)));
    relayReady.then(() => { relayState = 'reached'; }, () => { relayState = 'unreachable'; L('relay unreachable'); });
    let relayStarted = false;
    const startRelay = () => {
      if (transport || relayStarted) return;
      relayStarted = true;
      emit('status', 'Direct connection blocked by the network — switching to relay…');
      relayReady.then(() => {
        const hello = () => { if (!transport) { L('hello sent'); relayPublish({ t: 'hello' }); } };
        hello(); clearInterval(helloTimer); helloTimer = setInterval(hello, 500);
      }).catch(() => {});
    };
    if (/[?&]relay\b/.test(location.search)) {   // ?relay forces the relay (testing / stubborn networks)
      startRelay();
      giveUpTimer = setTimeout(() => { if (!transport) emit('failed', { relay: relayState }); }, GIVE_UP);
      return;
    }
    try {
      peer = new Peer({ debug: 1 });
      peer.on('open', () => setupDirect(peer.connect(hostId, { reliable: true })));
      peer.on('error', (e) => { if (e.type === 'peer-unavailable') emit('status', 'Direct link unavailable — trying relay…'); startRelay(); });
    } catch (e) { startRelay(); }
    fallbackTimer = setTimeout(startRelay, DIRECT_TIMEOUT);
    giveUpTimer = setTimeout(() => { if (!transport) emit('failed', { relay: relayState }); }, GIVE_UP);
  }

  function send(m) {
    if (transport === 'direct' && conn && conn.open) conn.send(m);
    else if (transport === 'relay') relayPublish(m);
  }

  function lost(reason) {
    const was = transport;
    transport = null;
    clearInterval(pingTimer);
    if (was) emit(reason === 'bye' ? 'bye' : 'closed');
  }

  function close() {
    clearInterval(pingTimer); clearInterval(helloTimer); clearTimeout(fallbackTimer); clearTimeout(giveUpTimer);
    const t = transport; transport = null;
    try { if (t) { if (t === 'direct' && conn && conn.open) conn.send({ t: 'bye' }); else relayPublish({ t: 'bye' }); } } catch (e) {}
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    const clients = mqAll.length ? mqAll : (mq ? [mq] : []); mq = null; mqAll = [];
    for (const c of clients) setTimeout(() => { try { c.end(true); } catch (e) {} }, 300);
    conn = null; peer = null; role = null;
  }

  return {
    host, join, send, on, close,
    get role() { return role; },
    get rtt() { return rtt; },
    get transport() { return transport; },
    get broker() { return bestBroker; },
    get log() { return log.slice(); },
    get connected() { return !!transport; },
  };
})();
