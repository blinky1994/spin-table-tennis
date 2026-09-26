'use strict';
// =====================================================================
//  NET — two-player peer-to-peer link (WebRTC data channel via PeerJS).
//  PeerJS's free public broker is only used to introduce the two browsers;
//  after that, game data goes directly between them.
// =====================================================================
const Net = (() => {
  let peer = null, conn = null, role = null, pingTimer = null;
  let rtt = 0.08;                 // seconds, smoothed round-trip time
  const handlers = {};

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function emit(type, msg) { for (const fn of handlers[type] || []) fn(msg); }

  function makeId() {
    const c = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += c[(Math.random() * c.length) | 0];
    return 'spintt-' + s;
  }

  function setup(c) {
    conn = c;
    c.on('open', () => {
      emit('connected');
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 1000);
    });
    c.on('data', (m) => {
      if (!m || !m.t) return;
      if (m.t === 'ping') { send({ t: 'pong', ts: m.ts }); return; }
      if (m.t === 'pong') { rtt = rtt * 0.8 + ((performance.now() - m.ts) / 1000) * 0.2; return; }
      emit(m.t, m);
    });
    c.on('close', () => { clearInterval(pingTimer); if (conn === c) { conn = null; emit('closed'); } });
    c.on('error', (e) => emit('error', e));
  }

  // Host: create a table and wait for one friend to connect. Resolves with the invite id.
  function host() {
    close();
    role = 'host';
    return new Promise((resolve, reject) => {
      const tryOpen = (attempt) => {
        peer = new Peer(makeId(), { debug: 1 });
        peer.on('open', (id) => resolve(id));
        peer.on('connection', (c) => { if (conn && conn.open) { c.on('open', () => c.close()); return; } setup(c); });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 3) { peer.destroy(); tryOpen(attempt + 1); return; }
          emit('error', e); reject(e);
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (err) {} });
      };
      tryOpen(0);
    });
  }

  // Guest: connect to a host's invite id.
  function join(hostId) {
    close();
    role = 'guest';
    return new Promise((resolve, reject) => {
      peer = new Peer({ debug: 1 });
      peer.on('open', () => {
        const c = peer.connect(hostId, { reliable: true });
        setup(c);
        c.on('open', () => resolve());
      });
      peer.on('error', (e) => { emit('error', e); reject(e); });
    });
  }

  function send(m) { if (conn && conn.open) conn.send(m); }

  function close() {
    clearInterval(pingTimer);
    const c = conn; conn = null;
    try { if (c && c.open) { c.send({ t: 'bye' }); c.close(); } } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null; role = null;
  }

  return {
    host, join, send, on, close,
    get role() { return role; },
    get rtt() { return rtt; },
    get connected() { return !!(conn && conn.open); },
  };
})();
