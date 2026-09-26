'use strict';
// =====================================================================
//  SPIN — first-person table tennis
// =====================================================================
(() => {
  const T = window.THREE;
  const { R, TABLE, NET, MAT, PADDLE, v3, dot, cross, len } = PHYS;
  const TOP = TABLE.top;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const scl = (a, k) => v3(a.x * k, a.y * k, a.z * k);
  const lerpV = (a, b, t) => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
  const norm = (a) => { const l = len(a) || 1; return scl(a, 1 / l); };
  const cp = (a) => v3(a.x, a.y, a.z);
  const rpm = (w) => (len(w) * 60) / (2 * Math.PI);

  // ===================================================================
  //  Audio (synthesized)
  // ===================================================================
  const Snd = {
    ac: null,
    init() {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ac = new AC();
        this.out = this.ac.createGain(); this.out.gain.value = 0.7; this.out.connect(this.ac.destination);
        const n = this.ac.sampleRate; this.nb = this.ac.createBuffer(1, n, n);
        const d = this.nb.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ac.state === 'suspended') this.ac.resume();
    },
    knock(f, dur, vol, nf, nvol, pan = 0) {
      if (!this.ac) return;
      const t = this.ac.currentTime, ac = this.ac;
      const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
      const dst = p ? (p.pan.value = clamp(pan, -1, 1), p.connect(this.out), p) : this.out;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dst); o.start(t); o.stop(t + dur + 0.02);
      const s = ac.createBufferSource(); s.buffer = this.nb;
      const bf = ac.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = nf; bf.Q.value = 1.2;
      const g2 = ac.createGain(); g2.gain.setValueAtTime(nvol, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.6);
      s.connect(bf).connect(g2).connect(dst); s.start(t, Math.random() * 0.5); s.stop(t + dur);
    },
    paddle(s, pan) { const k = clamp(s / 15, 0.15, 1); this.knock(700 + k * 500, 0.07, 0.35 * k + 0.1, 2600, 0.5 * k + 0.1, pan); },
    table(s, pan) { const k = clamp(s / 8, 0.1, 1); this.knock(1500, 0.05, 0.3 * k, 4200, 0.35 * k, pan); },
    net() { this.knock(260, 0.12, 0.15, 500, 0.3); },
    floor(s, pan) { const k = clamp(s / 6, 0.1, 1); this.knock(900, 0.06, 0.2 * k, 3000, 0.2 * k, pan); },
    point(win) {
      if (!this.ac) return;
      const notes = win ? [660, 880, 1100] : [440, 330];
      notes.forEach((f, i) => {
        const t = this.ac.currentTime + i * 0.09, o = this.ac.createOscillator(), g = this.ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.3);
      });
    },
  };

  // ===================================================================
  //  Scene
  // ===================================================================
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color('#0a0f1e');
  scene.fog = new T.Fog('#0a0f1e', 18, 45);
  const camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, 0.02, 60);

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function noise(g, w, h, n, cols) { for (let i = 0; i < n; i++) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }

  // lights
  scene.add(new T.HemisphereLight('#b8c8ff', '#402820', 0.55));
  const key = new T.DirectionalLight('#ffffff', 1.6);
  key.position.set(1.5, 6, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 12 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  for (const z of [-2.2, 2.2]) {
    const s = new T.SpotLight('#fff4e0', 18, 12, 0.6, 0.5, 1.5);
    s.position.set(0, 5, z); s.target.position.set(0, TOP, z * 0.2);
    scene.add(s, s.target);
  }

  // floor
  const floorTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8a2e22'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, ['#7e2a1f', '#963424', '#822b20']);
  }, [10, 10]);
  const floor = new T.Mesh(new T.PlaneGeometry(14, 18), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // court surround (darker)
  const out = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: '#141a2c', roughness: 1 }));
  out.rotation.x = -Math.PI / 2; out.position.y = -0.002; scene.add(out);

  // barriers around the court
  const barTex = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#0f2a6a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SPIN  •  TABLE TENNIS', w / 2, h / 2 + 2);
  });
  const barMat = new T.MeshStandardMaterial({ map: barTex, roughness: 0.6 });
  function barrier(x, z, rotY, width) {
    const m = new T.Mesh(new T.BoxGeometry(width, 0.7, 0.04), barMat);
    m.position.set(x, 0.35, z); m.rotation.y = rotY; m.castShadow = true; scene.add(m);
  }
  for (let i = -2; i <= 2; i++) { barrier(i * 1.4, -7, 0, 1.38); barrier(i * 1.4, 7, Math.PI, 1.38); }
  for (let i = -4; i <= 4; i++) { barrier(-5, i * 1.4 + 0.7 * 0, Math.PI / 2, 1.38); barrier(5, i * 1.4, -Math.PI / 2, 1.38); }

  // arena: walls, lights, scoreboards, Ma Long tribute
  const arena = buildArena(T, scene, renderer);

  // serve aim marker
  const aimMark = new T.Mesh(new T.RingGeometry(0.05, 0.075, 32), new T.MeshBasicMaterial({ color: '#ff9a2a', transparent: true, opacity: 0.9, depthWrite: false }));
  aimMark.rotation.x = -Math.PI / 2; aimMark.visible = false; scene.add(aimMark);

  // table
  const tableTop = canvasTex(610, 1096, (g, w, h) => {
    g.fillStyle = '#1b4a95'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 6000, ['#1a4690', '#1d4e9e', '#19438a']);
    g.fillStyle = '#f4f6fa';
    const lw = Math.round((0.02 / 1.525) * w);
    g.fillRect(0, 0, w, lw); g.fillRect(0, h - lw, w, lw); g.fillRect(0, 0, lw, h); g.fillRect(w - lw, 0, lw, h);
    g.fillRect(w / 2 - 1, 0, 2, h);
  });
  const topMat = new T.MeshStandardMaterial({ map: tableTop, roughness: 0.45, metalness: 0.0 });
  const edgeMat = new T.MeshStandardMaterial({ color: '#163c7a', roughness: 0.5 });
  const tableMesh = new T.Mesh(new T.BoxGeometry(TABLE.hw * 2, TABLE.thick, TABLE.hl * 2), [edgeMat, edgeMat, topMat, edgeMat, edgeMat, edgeMat]);
  tableMesh.position.y = TOP - TABLE.thick / 2; tableMesh.receiveShadow = true; tableMesh.castShadow = true; scene.add(tableMesh);
  const metal = new T.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.4, metalness: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new T.Mesh(new T.BoxGeometry(0.05, TOP - TABLE.thick, 0.05), metal);
    leg.position.set(sx * (TABLE.hw - 0.12), (TOP - TABLE.thick) / 2, sz * (TABLE.hl - 0.25)); leg.castShadow = true; scene.add(leg);
  }
  const tableFrame = new T.Mesh(new T.BoxGeometry(TABLE.hw * 2 - 0.2, 0.06, TABLE.hl * 2 - 0.3), metal);
  tableFrame.position.y = TOP - TABLE.thick - 0.05; scene.add(tableFrame);

  // net
  const netTex = canvasTex(512, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20,20,25,0.9)'; g.lineWidth = 1.2;
    for (let x = 0; x <= w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, w, 7);
  });
  const net = new T.Mesh(new T.PlaneGeometry(NET.hw * 2, NET.h), new T.MeshStandardMaterial({ map: netTex, transparent: true, side: T.DoubleSide, alphaTest: 0.1 }));
  net.position.set(0, TOP + NET.h / 2, 0); scene.add(net);
  for (const sx of [-1, 1]) {
    const post = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, NET.h + 0.03, 12), metal);
    post.position.set(sx * NET.hw, TOP + NET.h / 2 - 0.01, 0); post.castShadow = true; scene.add(post);
  }

  // ball
  const ballTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ff8c1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(0, h / 2 - 5, w, 10);
    g.fillStyle = '#1a1a1a'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('★', w * 0.25, h * 0.28); g.fillText('★', w * 0.75, h * 0.72);
  });
  const ballMesh = new T.Mesh(new T.SphereGeometry(R, 24, 16), new T.MeshStandardMaterial({ map: ballTex, roughness: 0.35, emissive: '#ff6a00', emissiveIntensity: 0.15 }));
  ballMesh.castShadow = true; scene.add(ballMesh);
  const blob = new T.Mesh(new T.CircleGeometry(R * 1.1, 20), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);
  const TRAIL_N = 26;
  const trailGeo = new T.BufferGeometry();
  trailGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: '#ffb060', transparent: true, opacity: 0.35 }));
  trail.frustumCulled = false; scene.add(trail);
  const trailPts = [];

  // paddles
  function makePaddle(front, back, opacity) {
    const gr = new T.Group();
    const mk = (color) => new T.MeshStandardMaterial({ color, roughness: 0.7, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    const disc = (r, h, m, z) => { const g = new T.CylinderGeometry(r, r, h, 40); g.rotateX(Math.PI / 2); const mesh = new T.Mesh(g, m); mesh.position.z = z; return mesh; };
    gr.add(disc(PADDLE.r, 0.006, mk('#c8a070'), 0));
    gr.add(disc(PADDLE.r - 0.001, 0.003, mk(front), 0.0045));
    gr.add(disc(PADDLE.r - 0.001, 0.003, mk(back), -0.0045));
    const handle = new T.Mesh(new T.BoxGeometry(0.026, 0.1, 0.024), mk('#8a5a2a'));
    handle.position.y = -PADDLE.r - 0.045; gr.add(handle);
    gr.traverse((o) => { if (o.isMesh) o.castShadow = opacity >= 1; });
    scene.add(gr);
    return gr;
  }
  const padMesh = makePaddle('#d0201a', '#141414', 0.5);
  const aiPadMesh = makePaddle('#d0201a', '#141414', 1);

  // your hand + forearm (shakehand grip), drawn from the handle to below the camera
  const skinMat = new T.MeshStandardMaterial({ color: '#e2b48e', roughness: 0.65 });
  const sleeveMat = new T.MeshStandardMaterial({ color: '#2a4a9a', roughness: 0.8 });
  const hand = new T.Mesh(new T.SphereGeometry(0.032, 16, 12), skinMat);
  hand.scale.set(1, 1.35, 0.9);
  const thumb = new T.Mesh(new T.CapsuleGeometry(0.009, 0.035, 4, 8), skinMat);
  const forearm = new T.Mesh(new T.CylinderGeometry(0.028, 0.036, 1, 12), skinMat);
  const sleeve = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 14), sleeveMat);
  scene.add(hand, thumb, forearm, sleeve);
  function limb(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.y = a.distanceTo(b);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }

  // opponent: articulated athlete (red national-team style kit)
  const athlete = buildAthlete(T, scene, { shirt: '#c8242a', trim: '#f4d03f', shorts: '#15161f', skin: '#e2b48c', hair: '#15100c' });
  const oppBody = { x: 0.3, z: -2.4, vx: 0, step: 0, stepPhase: 0, t: 0 };

  // ===================================================================
  //  Game state
  // ===================================================================
  const DIFFS = [
    { name: 'Rookie', move: 2.4, react: 0.3, err: 0.075, reach: 0.2, power: 0.45, spin: 0.55, pace: [3.5, 5.0] },
    { name: 'Club', move: 3.4, react: 0.2, err: 0.042, reach: 0.22, power: 0.72, spin: 0.8, pace: [4.2, 6.2] },
    { name: 'Pro', move: 4.6, react: 0.13, err: 0.02, reach: 0.25, power: 1.0, spin: 1.0, pace: [5.2, 8.5] },
  ];
  const G = {
    mode: 'menu', diff: 1, bestOf: 3, sens: 0.2, timeScale: 1, serveAim: { x: 0, z: -0.85 }, serveSpin: -0.4, autoServe: null, slowmo: false, angleMode: 'help', pace: 1,   // Helped paddle angle (Manual/Assisted code paths kept but not exposed)
    score: [0, 0], games: [0, 0], firstServer: 0, server: 0,
    phase: 'serve', phaseT: 0, rally: null, rallyLen: 0, lastEvent: 0, time: 0,
    matchOver: false, pointMsg: '',
  };
  const ball = PHYS.makeBall(v3(0, 1, 1.5));
  const pad = { p: v3(0, 1, 1.8), prev: v3(0, 1, 1.8), v: v3(), n: v3(0, 0, -1), mx: 0.2, mz: 1.8, y: 1.0, autoY: 1.0, yaw: 0, pitch: 0, pitchT: 0.15, angle: 0.06, angVel: 0, base: 0.06, hOff: 0, hShown: 0, lift: 0, stroke: 0, prevBase: null, bh: 0, bhSide: 0, lastWheel: 0, cd: 0, predT: 0 };
  const ai = { p: v3(0, 1, -1.9), prev: v3(0, 1, -1.9), v: v3(), n: v3(0, 0, 1), plan: null, reactT: 0, swing: 0, holdT: 0, cd: 0 };
  const mouse = { lmb: false, rmb: false, flick: 0 };
  let locked = false;

  // ===================================================================
  //  Rules
  // ===================================================================
  const sideOf = (z) => (z > 0 ? 0 : 1);   // 0 = you (near side), 1 = CPU
  const who = (i) => (i === 0 ? 'You' : 'CPU');

  function nextServer() {
    const total = G.score[0] + G.score[1];
    if (G.score[0] >= 10 && G.score[1] >= 10) return (G.firstServer + total) % 2;
    return (G.firstServer + Math.floor(total / 2)) % 2;
  }

  function award(winner, reason) {
    if (G.phase !== 'rally' && G.phase !== 'toss') return;
    G.phase = 'point'; G.phaseT = 0;
    G.score[winner]++;
    G.pointMsg = `${winner === 0 ? 'YOUR POINT' : 'CPU POINT'}`;
    showMsg(G.pointMsg, reason, winner === 0 ? '#7dffa0' : '#ff8a7a');
    Snd.point(winner === 0);
    ai.plan = null;
  }
  function letServe() {
    G.phase = 'point'; G.phaseT = 0;
    showMsg('LET', 'net on serve — replay', '#ffe07a');
  }

  function afterPoint() {
    const [a, b] = G.score;
    if ((a >= 11 || b >= 11) && Math.abs(a - b) >= 2) {
      const w = a > b ? 0 : 1;
      G.games[w]++;
      const need = Math.ceil(G.bestOf / 2);
      if (G.games[w] >= need) { endMatch(w); return; }
      showMsg(`GAME ${w === 0 ? 'YOU' : 'CPU'}`, `${a} – ${b}  ·  games ${G.games[0]} – ${G.games[1]}`, '#ffe07a');
      G.score = [0, 0];
      G.firstServer = 1 - G.firstServer;
    }
    G.server = nextServer();
    startServe();
  }

  function startServe() {
    G.phase = 'serve'; G.phaseT = 0; G.rally = null; G.rallyLen = 0;
    ai.holdT = 0; ai.plan = null; ai.serveX = rand(-0.35, 0.35);
    ball.v = v3(); ball.w = v3();
    trailPts.length = 0;
    updateHUD();
  }

  function toss(serverIdx) {
    G.phase = 'toss'; G.phaseT = 0;
    ball.v = v3(0, 3.0, 0); ball.w = v3();   // ~46 cm toss: more time to time your flick
    G.lastEvent = G.time;
  }

  function onPaddle(hitter) {
    G.lastEvent = G.time;
    if (G.phase === 'toss') {
      if (hitter !== G.server) return;
      G.phase = 'rally';
      G.rally = { server: hitter, isServe: true, lastHitter: hitter, bounces: [], recvBounces: 0, net: false };
      G.rallyLen = 1;
      return;
    }
    if (G.phase !== 'rally') return;
    const r = G.rally;
    if (r.lastHitter === hitter) { award(1 - hitter, 'double hit'); return; }
    if (r.recvBounces === 0) {
      const p = ball.p;
      const overOwnHalf = Math.abs(p.x) < TABLE.hw && (hitter === 0 ? p.z > 0 && p.z < TABLE.hl : p.z < 0 && p.z > -TABLE.hl);
      if (overOwnHalf) award(1 - hitter, 'hit before it bounced');
      else award(hitter, `${who(1 - hitter)} hit it out`);
      return;
    }
    r.lastHitter = hitter; r.recvBounces = 0; r.isServe = false; r.net = false; r.bounces = [];
    G.rallyLen++;
  }

  function onTable(side) {
    G.lastEvent = G.time;
    if (G.phase !== 'rally') return;
    const r = G.rally;
    if (r.isServe) {
      r.bounces.push(side);
      if (r.bounces.length === 1) {
        if (side !== r.server) award(1 - r.server, 'serve must bounce on your own side first');
      } else if (r.bounces.length === 2) {
        if (side === r.server) award(1 - r.server, 'serve fault');
        else if (r.net) letServe();
        else { r.isServe = false; r.recvBounces = 1; }
      }
      return;
    }
    const hitter = r.lastHitter, recv = 1 - hitter;
    if (r.recvBounces === 0) {
      if (side === hitter) { award(recv, `${who(hitter)} hit own side`); return; }
      r.recvBounces = 1;
    } else award(hitter, 'double bounce');
  }

  function onFloor() {
    if (G.phase !== 'rally') return;
    const r = G.rally;
    if (r.isServe) { award(1 - r.server, r.bounces.length === 0 ? 'serve missed the table' : 'serve fault'); return; }
    if (r.recvBounces === 0) award(1 - r.lastHitter, r.net ? 'into the net' : 'out');
    else award(r.lastHitter, `${who(1 - r.lastHitter)} missed`);
  }

  function worldEvent(type, b, s) {
    const pan = clamp(b.p.x / 1.5, -1, 1);
    if (type === 'table') { Snd.table(s, pan); onTable(sideOf(b.p.z)); }
    else if (type === 'net' || type === 'netcord') { Snd.net(); if (G.rally) G.rally.net = true; }
    else if (type === 'floor') { Snd.floor(s, pan); onFloor(); }
  }

  // ===================================================================
  //  Shot analysis (for the HUD)
  // ===================================================================
  function describeShot(b) {
    const h = norm(v3(b.v.x, 0, b.v.z));
    const topAxis = cross(v3(0, 1, 0), h);
    const top = dot(b.w, topAxis), side = b.w.y;
    const speed = len(b.v) * 3.6;
    const r = rpm(b.w);
    let kind = 'Flat';
    if (r > 400) {
      if (Math.abs(side) > Math.abs(top) * 0.9) kind = 'Sidespin';
      else kind = top > 0 ? 'Topspin' : 'Backspin';
    }
    return { speed, rpm: r, kind };
  }

  // ===================================================================
  //  Player paddle: position from the mouse, height + wrist angle assist
  // ===================================================================
  function faceNormal(yaw, pitch, dirZ) {
    const f = v3(Math.sin(yaw), 0, dirZ * Math.cos(yaw));
    return norm(add(scl(f, Math.cos(pitch)), v3(0, Math.sin(pitch), 0)));
  }
  // Face angle ("pitch", radians): + = open (face tilted up), − = closed (face tilted down).
  // Manual mode: you set it with the mouse buttons. Assisted mode: your setting is an
  // offset from the angle the physics says would land the ball on the table.
  const TUNE = { rest: 0.06, lift: 0.08 };   // resting face angle (rad, + open) · low-to-high arc per m/s of swing
  const REST_ANGLE = TUNE.rest;
  const ANGLE_SNAP = 0.42, ANGLE_MAX = 0.9, ANGLE_SPRING = 30;   // ~24° snap, settles in ~0.12 s
  const HELP = 0.65;
  const HELP_MAX = 0.14;   // Helped rallies: at most ~8° of correction, so closed stays closed and open stays open   // Helped mode: how far the face is nudged toward a landing angle at contact

  // Find the face angle that would put a nominal swing onto the table (used for the
  // gauge's "ghost" hint, and as the base angle in assisted mode).
  const SERVE_MAX = 3.8;
  const SERVE_Z = 1.48;   // where you toss from (end line is at 1.37)
  const SERVE_MIN = 3.3;   // Helped/Assisted serve pace floor (m/s): enough to clear the net from low contact
  const SWING_MAX = 4.2;       // m/s, top paddle speed a real forehand reaches
  const NOMINAL_SWING = 3.0;   // m/s; faster = deeper, slower = shorter
  function solvePitch(state, serve, vpExact) {
    let vp = vpExact;
    if (!vp) {
      const actual = Math.max(0, -pad.v.z);
      const fwd = actual > NOMINAL_SWING ? lerp(NOMINAL_SWING, actual, 0.75) : NOMINAL_SWING;
      vp = v3(clamp(pad.v.x, -3, 3), clamp(pad.v.y, -4, 4) * 0.6, -fwd);
    }
    let best = pad.pitchT, bestS = Infinity;
    for (let pitch = -1.3; pitch <= 1.05; pitch += 0.05) {
      const n = faceNormal(pad.yaw, pitch, -1);
      const b = PHYS.cloneBall(state);
      PHYS.surfaceHit(b, n, vp, MAT.paddle.e, MAT.paddle.mu);
      const o = PHYS.simulate(b, { bounces: serve ? 2 : 1, maxT: 1.6, dt: 0.004, stopOnNet: true });
      let s;
      if (o.net || !o.bounces.length) s = 50;
      else if (o.netcord || o.netClear < 0.006) s = 40;   // clipping the net = let / luck
      else if (serve) {
        const b1 = o.bounces[0], b2 = o.bounces[1];
        s = 0;
        if (!(b1.z > 0.15 && b1.z < TABLE.hl)) s += 10 + Math.abs(b1.z - 0.7);
        if (!b2) s += 8; else s += Math.abs(b2.z + 0.8) + (b2.z > 0 ? 10 : 0);
      } else {
        const b1 = o.bounces[0];
        s = Math.abs(b1.z + 0.95) + (b1.z > 0 ? 10 : 0) + (b1.z < -TABLE.hl ? 5 : 0);
      }
      if (s < bestS) { bestS = s; best = pitch; }
    }
    return best;
  }

  function predictContact() {
    const approaching = ball.v.z > 0.3 && ball.p.z < pad.p.z;
    if (G.phase === 'rally' && approaching && G.rally && G.rally.lastHitter === 1) {
      // where will the ball meet the paddle plane, given the paddle's current forward motion?
      const z0 = pad.p.z, vz = clamp(pad.v.z, -6, 1);
      const zAt = (t) => z0 + vz * Math.min(t, 0.18);
      const o = PHYS.simulate(ball, { maxT: 1.6, dt: 0.004, until: (b, out) => b.p.z >= zAt(out.t) });
      if (o.ball.p.z >= zAt(o.t) - 0.02 && o.ball.p.y > 0.3) {
        pad.autoY = clamp(o.ball.p.y, 0.8, 1.6);
        pad.pitchT = solvePitch(o.ball, false);
      }
    } else if (G.phase === 'serve' && G.server === 0) {
      pad.autoY = 1.06;
      const st = PHYS.makeBall(v3(pad.p.x, 1.06, SERVE_Z), v3(0, -2.4, 0));
      pad.pitchT = solvePitch(st, true);
    } else if (G.phase === 'toss' && G.server === 0) {
      pad.pitchT = solvePitch(PHYS.makeBall(v3(ball.p.x, 1.06, ball.p.z), v3(0, -2.4, 0)), true);
    } else if (!approaching) {
      pad.autoY = lerp(pad.autoY, 1.0, 0.05);
      pad.pitchT = lerp(pad.pitchT, 0.15, 0.05);
    }
  }

  function updatePlayerPaddle(dt) {
    pad.prev = cp(pad.p);
    if (G.phase === 'toss' && G.server === 0) pad.autoY = 1.06;   // hold steady, time the drop
    pad.y += (pad.autoY - pad.y) * (1 - Math.exp(-14 * dt));
    // face angle from the mouse buttons (gradual), wheel (fine), both buttons = back to square
    // buttons spring the face closed/open around a resting angle (wheel adjusts the rest)
    if (mouse.lmb && mouse.rmb) pad.base += (REST_ANGLE - pad.base) * (1 - Math.exp(-8 * dt));
    const snap = mouse.lmb && !mouse.rmb ? -ANGLE_SNAP : mouse.rmb && !mouse.lmb ? ANGLE_SNAP : 0;
    const aim = clamp(pad.base + snap, -ANGLE_MAX, ANGLE_MAX);
    const W = ANGLE_SPRING;
    pad.angVel += (W * W * (aim - pad.angle) - 2 * W * pad.angVel) * dt;   // critically damped
    pad.angle = clamp(pad.angle + pad.angVel * dt, -ANGLE_MAX, ANGLE_MAX);
    // a real stroke travels low to high: forward swings carry a natural upward arc
    const fwdNow = Math.max(0, -pad.v.z);
    pad.lift = clamp(pad.lift + fwdNow * TUNE.lift * dt, 0, 0.25) * Math.exp(-3 * dt);
    // Wheel = vertical stroke. Each notch gives the paddle a short burst of up/down speed
    // (that's what makes a chop or a brush at contact) and also moves it; the offset glides
    // back to auto height once you stop scrolling.
    pad.stroke *= Math.exp(-7 * dt);
    pad.hOff = clamp(pad.hOff + pad.stroke * dt, -0.4, 0.45);
    if (performance.now() - pad.lastWheel > 350) pad.hOff *= Math.exp(-2.2 * dt);
    pad.hShown += (pad.hOff - pad.hShown) * (1 - Math.exp(-22 * dt));
    // serve: after the toss the paddle's height rides with the falling ball (positional only,
    // not counted as paddle velocity, so it adds no spin) — you just time a forward flick
    if (G.server === 0 && G.phase === 'serve') pad.mz = clamp(pad.mz, SERVE_Z + 0.1, SERVE_Z + 0.45);
    if (G.server === 0 && G.phase === 'toss') {
      pad.mx += (ball.p.x - pad.mx) * (1 - Math.exp(-18 * dt));        // auto line-up behind the ball
      pad.mz = clamp(pad.mz, ball.p.z - 0.3, ball.p.z + 0.45);            // short forward lane only
    }
    const baseP = v3(pad.mx, pad.y + pad.lift, pad.mz);
    if (!pad.prevBase) pad.prevBase = baseP;
    pad.p = v3(baseP.x, clamp(baseP.y + pad.hShown, 0.78, 1.8), baseP.z);
    // velocity: swing + natural arc from real motion, vertical stroke from the wheel
    // (not lost when the paddle is already at its lowest point)
    // measured in *real* time: slowing the game (pace / slow-mo) must not make your swing
    // effectively harder relative to the slowed-down ball
    const raw = scl(sub(baseP, pad.prevBase), G.timeScale / Math.max(dt, 1e-4));
    raw.y += pad.stroke;
    pad.prevBase = baseP;
    const sp = len(raw);
    const lim = sp > 25 ? scl(raw, 25 / sp) : raw;
    pad.v = lerpV(pad.v, lim, 0.6);
    // mouse flicks can be absurdly fast; map them onto a human swing (soft cap ~5 m/s)
    const vs = len(pad.v);
    const cap = G.phase === 'toss' ? SERVE_MAX : SWING_MAX;   // serves are touch strokes
    if (vs > 1e-6) pad.v = scl(pad.v, (cap * Math.tanh(vs / cap)) / vs);
    pad.yaw = clamp(-pad.p.x * 0.22 + pad.v.x * 0.05, -0.5, 0.5);
    if (G.angleMode !== 'assist') pad.pitch = pad.angle;
    else pad.pitch += (clamp(pad.pitchT + pad.angle - REST_ANGLE, -1.3, 1.3) - pad.pitch) * (1 - Math.exp(-35 * dt));
    pad.n = faceNormal(pad.yaw, pad.pitch, -1);
    if (pad.bhSide === 0 && pad.mx < -0.12) pad.bhSide = 1;
    else if (pad.bhSide === 1 && pad.mx > 0.04) pad.bhSide = 0;
    pad.bh += (pad.bhSide - pad.bh) * (1 - Math.exp(-9 * dt));
    if (pad.cd > 0) pad.cd -= dt;
  }

  // swept paddle/ball contact for one physics sub-step
  function paddleContact(bPrev, a0, a1) {
    if (pad.cd > 0 || (G.phase === 'toss' && G.server === 0)) return;
    const n = pad.n, P0 = lerpV(pad.prev, pad.p, a0), P1 = lerpV(pad.prev, pad.p, a1);
    const d0 = dot(sub(bPrev, P0), n), d1 = dot(sub(ball.p, P1), n);
    const lim = R + PADDLE.ht;
    let s;
    if (Math.abs(d1) < lim) s = Math.sign(d0) || 1;
    else if (Math.sign(d0) !== Math.sign(d1)) s = Math.sign(d0);
    else return;
    const rel = sub(ball.p, P1);
    const inPlane = sub(rel, scl(n, dot(rel, n)));
    if (len(inPlane) > PADDLE.r + R * 0.4 + (G.phase === 'toss' ? 0.045 : 0.015)) return;
    if (dot(sub(ball.v, pad.v), scl(n, s)) >= 0) return;
    ball.p = add(P1, add(inPlane, scl(n, s * lim)));
    // Assisted: last-instant wrist correction from the exact contact state plus your offset.
    // Helped: your angle, nudged partway toward one that lands. Manual: exactly your angle.
    // the velocity the ball actually feels. Helped/Assisted serves get a minimum pace so a
    // gentle flick still carries over the net after the first bounce.
    const vHit = cp(pad.v);
    if (G.phase === 'toss' && G.angleMode !== 'manual' && -vHit.z < SERVE_MIN) vHit.z = -SERVE_MIN;
    if (G.angleMode !== 'manual') {
      const act = Math.max(0, -vHit.z);
      const serveTouch = G.phase === 'toss';   // serves: the wrist plans for your exact pace
      // serves and Helped mode plan for your exact swing; Assisted keeps a "nominal" swing so power still shows
      const fwd = serveTouch || G.angleMode === 'help' ? act : act > NOMINAL_SWING ? lerp(NOMINAL_SWING, act, 0.75) : lerp(act, NOMINAL_SWING, 0.5);
      const ideal = solvePitch(PHYS.cloneBall(ball), G.phase === 'toss', v3(vHit.x, vHit.y, -Math.max(fwd, 0.5)));
      pad.pitch = G.angleMode === 'assist' ? clamp(ideal + pad.angle - REST_ANGLE, -1.3, 1.3) : (G.phase === 'toss' ? ideal : pad.angle + clamp((ideal - pad.angle) * HELP, -HELP_MAX, HELP_MAX));   // Helped: serves get the landing angle; rallies only fine-tune yours
      pad.n = faceNormal(pad.yaw, pad.pitch, -1);
    }
    const ns = scl(pad.n, s);   // the face the ball approached (not re-decided after the wrist adjustment)
    const vin = len(sub(ball.v, vHit));
    PHYS.surfaceHit(ball, ns, vHit, MAT.paddle.e, MAT.paddle.mu);
    pad.cd = 0.1;
    Snd.paddle(vin, clamp(ball.p.x, -1, 1));
    showShot('You', describeShot(ball));
    onPaddle(0);
  }

  // ===================================================================
  //  CPU opponent
  // ===================================================================
  function spinVec(dir, kind, mag, side) {
    const h = norm(v3(dir.x, 0, dir.z));
    const topAxis = cross(v3(0, 1, 0), h);
    const s = kind === 'top' ? mag : kind === 'back' ? -mag : 0;
    return add(scl(topAxis, s), v3(0, side, 0));
  }

  // search speed/elevation so the ball lands at the target (full physics incl. spin)
  function solveShot(p, target, speed, kind, mag, side, serve) {
    const dir = norm(v3(target.x - p.x, 0, target.z - p.z));
    let best = null;
    const speeds = serve ? [] : [speed, speed - 1.5, speed - 3, speed - 4.5, 5, 4];
    if (serve) for (let s = 3; s <= 8.5; s += 0.5) speeds.push(s);
    for (const sp of speeds) {
      if (sp < 3) continue;
      for (let e = serve ? -45 : -18; e <= (serve ? 12 : 50); e += serve ? 2 : 1.5) {
        const er = (e * Math.PI) / 180;
        const v = add(scl(dir, sp * Math.cos(er)), v3(0, sp * Math.sin(er), 0));
        const b = PHYS.makeBall(p, v, spinVec(dir, kind, mag, side));
        const o = PHYS.simulate(b, { bounces: serve ? 2 : 1, maxT: 2, dt: 0.004, stopOnNet: true });
        if (o.net || !o.bounces.length) continue;
        let err;
        if (serve) {
          const [b1, b2] = o.bounces;
          const sg = p.z > 0 ? 1 : -1;   // server's side
          if (!b2 || !(sg * b1.z > 0.1 && sg * b1.z < TABLE.hl && Math.abs(b1.x) < TABLE.hw)) continue;
          if (o.netcord || o.netClear < 0.02) continue;
          if (!(-sg * b2.z > 0.05 && -sg * b2.z < TABLE.hl && Math.abs(b2.x) < TABLE.hw)) continue;
          err = Math.hypot(b2.x - target.x, b2.z - target.z) - (o.netClear < 0.08 ? 0.1 : 0);
        } else {
          const b1 = o.bounces[0];
          if (!(b1.z > 0.05 && b1.z < TABLE.hl && Math.abs(b1.x) < TABLE.hw)) continue;
          if (o.netClear < 0.015) continue;
          err = Math.hypot(b1.x - target.x, b1.z - target.z);
        }
        if (!best || err < best.err) best = { v, w: spinVec(dir, kind, mag, side), err, sp, e: er, dir };
      }
      if (best && best.err < 0.25 && !serve) break;
    }
    return best;
  }

  function aiPlan() {
    const o = PHYS.simulate(ball, { maxT: 2.2, dt: 0.004, sample: true });
    // a serve legally bounces on the server's side first — look past that bounce
    const serve = G.rally && G.rally.isServe && G.rally.bounces.length === 0;
    const b1 = serve ? (o.bounces[0] && o.bounces[0].z > 0 ? o.bounces[1] : null) : o.bounces[0];
    if (!b1 || b1.z > 0 || b1.z < -TABLE.hl || Math.abs(b1.x) > TABLE.hw) return { hit: false };
    // choose a comfortable contact point after the bounce: high, not too far over the table
    // must be taken before it bounces a second time (short balls stay over the table)
    const b2 = o.bounces[o.bounces.indexOf(b1) + 1];
    const cutoff = b2 ? b2.t - 0.03 : Infinity;
    let pick = null, bestScore = -Infinity;
    for (const s of o.samples) {
      if (s.t <= b1.t + 0.02) continue;
      if (s.t >= cutoff) break;
      if (s.p.y < TOP + R + 0.01) { if (pick) break; else continue; }
      const score = s.p.y - 0.8 * Math.max(0, s.p.z + 1.2) - 0.5 * Math.max(0, -2.1 - s.p.z);
      if (score > bestScore) { bestScore = score; pick = s; }
    }
    if (!pick) return { hit: false };
    return { hit: true, pt: cp(pick.p), t: pick.t };
  }

  function aiHit() {
    const D = DIFFS[G.diff];
    const inSpin = rpm(ball.w);
    const inSpeed = len(ball.v);
    const err = D.err * (1 + inSpin / 2500) * (1 + Math.max(0, inSpeed - 9) / 8);
    const aggression = D.power;
    const target = v3(rand(-0.6, 0.6) * (0.55 + 0.45 * aggression), 0, rand(0.45, 1.2));
    let kind = Math.random() < 0.62 ? 'top' : Math.random() < 0.6 ? 'back' : 'flat';
    let speed = rand(D.pace[0], D.pace[1]);
    const high = ball.p.y > TOP + 0.38;
    if (high && D.power > 0.6 && Math.random() < 0.3 + aggression * 0.4) { kind = 'top'; speed = 9.5 + 4 * aggression; }
    if (kind === 'back') speed = Math.min(speed, 6.5);
    const mag = kind === 'flat' ? 20 : (kind === 'top' ? rand(150, 380) : rand(110, 260)) * D.spin;
    const side = gauss() * 40 * D.spin;
    const shot = solveShot(cp(ball.p), target, speed, kind, mag, side, false);
    let v, w;
    if (shot) {
      const e = shot.e + gauss() * err;
      const az = gauss() * err * 0.8;
      const sp = shot.sp * (1 + gauss() * err * 0.7);
      const d = norm(v3(shot.dir.x * Math.cos(az) - shot.dir.z * Math.sin(az), 0, shot.dir.x * Math.sin(az) + shot.dir.z * Math.cos(az)));
      v = add(scl(d, sp * Math.cos(e)), v3(0, sp * Math.sin(e), 0));
      w = shot.w;
    } else {
      v = v3(rand(-0.5, 0.5), 3.2, 5.5); w = v3(); // desperate lob
    }
    ball.v = v; ball.w = w;
    ai.swing = 1; ai.cd = 0.3;
    Snd.paddle(len(v), clamp(ball.p.x, -1, 1));
    showShot('CPU', describeShot(ball));
    onPaddle(1);
  }

  // Your serve: click = short toss + automatic strike. Mouse aims (marker on their side),
  // wheel dials top/backspin, a sideways flick as you click adds sidespin.
  function startAutoServe() {
    const f = mouse.flick, dead = 15;   // ignore small accidental movement
    G.autoServe = { side: Math.abs(f) < dead ? 0 : clamp((f - Math.sign(f) * dead) / 80, -1, 1) };
    toss(0);
    ball.v = v3(0, 2.2, 0);   // quick ~25 cm toss
  }
  function playerAutoServe() {
    const a = G.autoServe; G.autoServe = null;
    const sp = G.serveSpin;
    const kind = sp > 0.08 ? 'top' : sp < -0.08 ? 'back' : 'flat';
    const mag = kind === 'flat' ? 25 : 60 + Math.abs(sp) * 240;
    const side = a.side * 150;
    const target = v3(G.serveAim.x, 0, G.serveAim.z);
    let shot = solveShot(cp(ball.p), target, 0, kind, mag, side, true);
    if (!shot) shot = solveShot(cp(ball.p), v3(target.x * 0.5, 0, -0.8), 0, kind, mag * 0.6, side * 0.5, true);
    if (shot) {
      const e = shot.e + gauss() * 0.006, spd = shot.sp * (1 + gauss() * 0.015);
      ball.v = add(scl(shot.dir, spd * Math.cos(e)), v3(0, spd * Math.sin(e), 0));
      ball.w = shot.w;
    } else { ball.v = v3(0, -1.2, -4.2); ball.w = v3(-80, 0, 0); }
    pad.mz = Math.max(pad.mz - 0.25, ball.p.z + 0.03);   // follow-through
    pad.cd = 0.3;
    Snd.paddle(len(ball.v), clamp(ball.p.x, -1, 1));
    showShot('You', describeShot(ball));
    onPaddle(0);
  }

  function aiServe() {
    const D = DIFFS[G.diff];
    const target = v3(rand(-0.55, 0.55), 0, rand(0.35, 1.15));
    const kind = Math.random() < 0.55 ? 'back' : Math.random() < 0.6 ? 'top' : 'flat';
    const mag = kind === 'flat' ? 30 : rand(120, 280) * D.spin;
    const side = gauss() * 90 * D.spin;
    const shot = solveShot(cp(ball.p), target, 0, kind, mag, side, true);
    if (shot) {
      const e = shot.e + gauss() * D.err * 0.25;
      const sp = shot.sp * (1 + gauss() * D.err * 0.2);
      ball.v = add(scl(shot.dir, sp * Math.cos(e)), v3(0, sp * Math.sin(e), 0));
      ball.w = shot.w;
    } else {
      ball.v = v3(0, -1, 4.5); ball.w = v3();
    }
    ai.swing = 1; ai.cd = 0.3;
    Snd.paddle(len(ball.v), 0);
    showShot('CPU', describeShot(ball));
    onPaddle(1);
  }

  function updateAI(dt) {
    const D = DIFFS[G.diff];
    ai.prev = cp(ai.p);
    let target = v3(clamp(ball.p.x * 0.5, -0.5, 0.5), 1.0, -1.95);
    let fast = false;
    if (G.phase === 'serve' && G.server === 1) {
      const sx = ai.serveX ?? 0.2;
      target = v3(sx - 0.05, 0.95, -1.7);                       // ready: paddle low beside the ball
      ai.holdT += dt;
      if (ai.holdT > 1.3) toss(1);
    } else if (G.phase === 'toss' && G.server === 1) {
      fast = true;
      if (ball.v.y > -0.6) target = v3(ball.p.x - 0.22, 1.12, ball.p.z - 0.42);   // backswing while the ball rises
      else target = v3(ball.p.x + 0.02, ball.p.y, ball.p.z - 0.06);            // swing in to strike
      if (ball.v.y < 0 && ball.p.y < 1.02 && ai.cd <= 0) aiServe();
    } else if (G.phase === 'rally' && G.rally.lastHitter === 0) {
      if (!ai.plan) { ai.reactT += dt; if (ai.reactT >= D.react) ai.plan = aiPlan(); }
      if (ai.plan && ai.plan.hit) target = v3(ai.plan.pt.x, ai.plan.pt.y, ai.plan.pt.z - 0.05);
    } else { ai.plan = null; ai.reactT = 0; }
    const d = sub(target, ai.p), dl = len(d);
    const step = (fast ? Math.max(D.move, 5) : D.move) * dt;
    ai.p = dl <= step ? target : add(ai.p, scl(d, step / dl));
    // forehand / backhand choice (AI's left = +x): hysteresis so it doesn't flicker
    if (G.server === 1 && (G.phase === 'serve' || G.phase === 'toss')) ai.bhSide = 0;
    else if (!ai.bhSide && ai.p.x > 0.2) ai.bhSide = 1;
    else if (ai.bhSide && ai.p.x < 0.02) ai.bhSide = 0;
    ai.bh = (ai.bh || 0) + ((ai.bhSide || 0) - (ai.bh || 0)) * (1 - Math.exp(-9 * dt));
    ai.v = scl(sub(ai.p, ai.prev), 1 / Math.max(dt, 1e-4));
    ai.swing = Math.max(0, ai.swing - dt * 4);
    if (ai.cd > 0) ai.cd -= dt;
  }

  function aiContactCheck() {
    if (ai.cd > 0 || G.phase !== 'rally' || !ai.plan || !ai.plan.hit) return;
    const r = G.rally;
    if (r.lastHitter !== 0 || r.recvBounces !== 1) return;
    if (Math.hypot(ball.p.x - ai.p.x, ball.p.y - ai.p.y, ball.p.z - ai.p.z) < DIFFS[G.diff].reach) aiHit();
  }

  // ===================================================================
  //  Simulation step
  // ===================================================================
  function update(dt) {
    if (G.matchOver) return;
    G.time += dt; G.phaseT += dt;
    updatePlayerPaddle(dt);
    updateAI(dt);
    pad.predT -= dt;
    if (pad.predT <= 0) { pad.predT = 0.03; predictContact(); }

    // holding the left button down also tosses (as soon as your serve is ready)
    if (G.phase === 'serve' && G.server === 0 && mouse.lmb && G.phaseT > 0.3) { mouse.lmb = false; startAutoServe(); }
    if (G.phase === 'toss' && G.server === 0 && G.autoServe && ball.v.y < 0 && ball.p.y < 1.08) playerAutoServe();
    mouse.flick *= Math.exp(-12 * dt);
    if (G.phase === 'serve') {
      if (G.server === 0) ball.p = v3(pad.p.x - 0.04, 0.98, SERVE_Z);   // tossed from just behind the end line
      else { ai.serveX = ai.serveX ?? 0.2; ball.p = v3(ai.serveX + 0.2, 0.98, -1.52); }
      ball.v = v3(); ball.w = v3();
    } else {
      const n = Math.max(1, Math.ceil(dt / 0.001));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const bPrev = cp(ball.p);
        PHYS.step(ball, h, worldEvent);
        paddleContact(bPrev, i / n, (i + 1) / n);
        aiContactCheck();
      }
    }
    if (G.phase === 'toss' && ball.v.y < 0 && ball.p.y < TOP + 0.05) {
      showMsg('Toss again', 'hit the ball before it drops below the table', '#ffe07a');
      startServe();
    }
    if (G.phase === 'rally' && G.time - G.lastEvent > 4) {
      const r = G.rally;
      if (r.recvBounces >= 1) award(r.lastHitter, 'ball not returned');
      else award(1 - r.lastHitter, 'ball dead');
    }
    if (G.phase === 'point' && G.phaseT > 1.8) afterPoint();

    trailPts.push(cp(ball.p));
    if (trailPts.length > TRAIL_N) trailPts.shift();
  }

  // ===================================================================
  //  Rendering
  // ===================================================================
  const q = new T.Quaternion(), axis = new T.Vector3();
  const camLook = { x: 0, z: -1.25 };
  function orientPaddle(mesh, p, n, roll) {
    const z = new T.Vector3(n.x, n.y, n.z);
    const x = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), z).normalize();
    const y = new T.Vector3().crossVectors(z, x);
    const m = new T.Matrix4().makeBasis(x, y, z);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.rotateZ(roll);
    mesh.position.set(p.x, p.y, p.z);
  }

  function render(dt) {
    // ball + spin
    ballMesh.position.set(ball.p.x, ball.p.y, ball.p.z);
    const wl = len(ball.w);
    if (wl > 0.01) {
      axis.set(ball.w.x / wl, ball.w.y / wl, ball.w.z / wl);
      q.setFromAxisAngle(axis, Math.min(wl * dt, 1.2));
      ballMesh.quaternion.premultiply(q);
    }
    const onTable = Math.abs(ball.p.x) < TABLE.hw && Math.abs(ball.p.z) < TABLE.hl && ball.p.y > TOP;
    const surf = onTable ? TOP + 0.001 : 0.002;
    blob.position.set(ball.p.x, surf, ball.p.z);
    const hgt = Math.max(0, ball.p.y - surf);
    blob.scale.setScalar(1 + hgt * 1.5);
    blob.material.opacity = clamp(0.5 - hgt * 0.35, 0.08, 0.5);
    const arr = trailGeo.attributes.position.array;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = trailPts[Math.max(0, trailPts.length - TRAIL_N + i)] || ball.p;
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trail.visible = G.phase === 'rally' || G.phase === 'point';

    // serve aim marker (your serve only)
    aimMark.visible = G.mode === 'play' && G.phase === 'serve' && G.server === 0;
    if (aimMark.visible) { aimMark.position.set(G.serveAim.x, TOP + 0.003, G.serveAim.z); aimMark.scale.setScalar(1 + Math.sin(performance.now() / 180) * 0.08); }

    // paddles
    for (const m of [hand, thumb, forearm, sleeve, padMesh]) m.visible = true;
    // shakehand grip. Forehand: blade leans right, handle down-left into your hand.
    // Backhand (left side): blade swings across, handle points back toward your body.
    const bh = pad.bh;
    orientPaddle(padMesh, pad.p, pad.n, lerp(0.85 - pad.p.x * 0.08, -0.95, bh));
    padMesh.updateMatrixWorld();
    const grip = padMesh.localToWorld(new T.Vector3(0, -PADDLE.r - 0.045, 0));
    const thumbTip = padMesh.localToWorld(new T.Vector3(0.012, -PADDLE.r + 0.008, -0.012));
    hand.position.copy(grip);
    hand.quaternion.copy(padMesh.quaternion);
    limb(thumb, grip, thumbTip);
    const elbow = new T.Vector3(lerp(0.1, 0.04, bh), lerp(-0.62, -0.5, bh), lerp(-0.22, -0.45, bh)).applyQuaternion(camera.quaternion).add(camera.position);
    const wrist = grip.clone().lerp(elbow, 0.08);
    limb(forearm, wrist, elbow);
    limb(sleeve, wrist.clone().lerp(elbow, 0.55), elbow.clone().lerp(wrist, -0.3));
    const swingOff = Math.sin(ai.swing * Math.PI) * 0.18;
    const aiShown = v3(ai.p.x, ai.p.y, ai.p.z + swingOff);
    const abh = ai.bh || 0;
    // shakehand grip: handle angled down toward the hand (forehand), swung across (backhand)
    orientPaddle(aiPadMesh, aiShown, norm(v3(-ai.p.x * 0.15, 0.15, 1)), lerp(0.85, -0.95, abh));

    // opponent body: shuffles sideways behind the paddle, arm IK reaches the grip
    aiPadMesh.updateMatrixWorld();
    const aiGrip = aiPadMesh.localToWorld(new T.Vector3(0, -PADDLE.r - 0.045, 0));
    const odt = Math.min(dt, 0.05);
    // free hand: holds the ball, tosses it, then drops back to the ready position
    const holding = G.server === 1 && (G.phase === 'serve' || (G.phase === 'toss' && ball.v.y > 1.2));
    const restL = new T.Vector3(oppBody.x + 0.22, 1.02, oppBody.z + 0.33);
    const wantL = holding ? new T.Vector3(ball.p.x, ball.p.y - 0.035, ball.p.z + 0.01) : restL;
    if (!oppBody.lh) oppBody.lh = restL.clone();
    oppBody.lh.lerp(wantL, holding ? 1 : 1 - Math.exp(-5 * odt));
    const oppLHand = oppBody.lh.clone();
    const prevX = oppBody.x;
    oppBody.x += (ai.p.x + lerp(0.34, -0.3, abh) - oppBody.x) * (1 - Math.exp(-6 * odt));
    oppBody.z += (ai.p.z - 0.5 - oppBody.z) * (1 - Math.exp(-6 * odt));
    oppBody.vx = (oppBody.x - prevX) / Math.max(odt, 1e-4);
    oppBody.step += (Math.min(1, Math.abs(oppBody.vx) / 1.2) - oppBody.step) * 0.2;
    oppBody.stepPhase += Math.abs(oppBody.vx) * odt * 14;
    oppBody.t += odt;
    athlete.update({
      dt: odt, x: oppBody.x, z: oppBody.z,
      twist: -Math.sin(ai.swing * Math.PI) * 0.5 * (1 - 2 * abh) + clamp((ai.p.x - oppBody.x + lerp(0.34, -0.3, abh)) * 0.4, -0.3, 0.3) + abh * 0.35,
      crouch: 0.1 + Math.sin(oppBody.t * 5) * 0.012,
      rHand: aiGrip, step: oppBody.step, stepPhase: oppBody.stepPhase,
      rPole: [lerp(-0.9, -0.2, abh), lerp(-1, -0.4, abh), lerp(-0.5, 1, abh)],
      lHand: oppLHand,
    });

    // camera: first person, gently follows your paddle
    // Loose, weight-shift style follow: the body only tracks ~60% of your sideways paddle
    // movement and eases in over ~0.4 s, so quick mouse flicks don't jerk the view.
    const cdt = Math.min(dt, 0.05);
    const ease = (k) => 1 - Math.exp(-k * cdt);
    const cx = pad.mx * 0.6 + lerp(-0.28, 0.22, pad.bh);   // left of a forehand, right of a backhand
    camera.position.x += (cx - camera.position.x) * ease(2.6);
    // lean in over the table when you reach forward
    const camZ = clamp(pad.mz + 1.1, 1.25, 2.85);
    camera.position.z += (camZ - camera.position.z) * ease(2.2);
    camera.position.y = 1.55;
    camLook.x += (camera.position.x * 0.3 + (pad.mx - camera.position.x) * 0.15 - camLook.x) * ease(2.0);
    camLook.z = Math.min(-1.25, camera.position.z - 4.1);
    camera.lookAt(camLook.x, 0.72, camLook.z);

    renderer.render(scene, camera);
  }

  // ===================================================================
  //  HUD / UI
  // ===================================================================
  const $ = (id) => document.getElementById(id);
  let msgTimer = 0;
  function showMsg(title, sub, color) {
    $('msg-title').textContent = title;
    $('msg-title').style.color = color || '#fff';
    $('msg-sub').textContent = sub || '';
    $('msg').classList.add('show');
    msgTimer = 1.7;
  }
  function showShot(by, s) {
    $('shot').innerHTML = `<b>${by}</b> ${s.kind} · ${Math.round(s.speed)} km/h · ${Math.round(s.rpm).toLocaleString()} rpm`;
  }
  let lastBoard = '';
  function updateHUD() {
    const key = G.score.join() + G.games.join() + G.server;
    if (key !== lastBoard) { lastBoard = key; arena.setScore(G); }
    $('s-you').textContent = G.score[0];
    $('s-cpu').textContent = G.score[1];
    $('g-you').textContent = G.games[0];
    $('g-cpu').textContent = G.games[1];
    $('srv-you').style.visibility = G.server === 0 ? 'visible' : 'hidden';
    $('srv-cpu').style.visibility = G.server === 1 ? 'visible' : 'hidden';
  }
  // side view of your paddle: current face angle + ghost of the angle that would land it
  const gcv = $('gauge'), gg = gcv.getContext('2d');
  function drawGauge() {
    const W = gcv.width, H = gcv.height, cx = W * 0.56, cy = H * 0.46, L = 34;
    gg.clearRect(0, 0, W, H);
    const deg = Math.round(pad.pitch * 57.3);
    const drawPaddle = (pitch, style, width, dash) => {
      // opponent is to the left: face normal points left (+ up when open)
      const nx = -Math.cos(pitch), ny = -Math.sin(pitch);
      const tx = -ny, ty = nx;
      gg.setLineDash(dash || []); gg.strokeStyle = style; gg.lineWidth = width; gg.lineCap = 'round';
      gg.beginPath(); gg.moveTo(cx - tx * L, cy - ty * L); gg.lineTo(cx + tx * L, cy + ty * L); gg.stroke();
      gg.setLineDash([]);
      return [nx, ny];
    };
    // table + net reference
    gg.fillStyle = '#1b4a95'; gg.fillRect(6, H - 22, W - 12, 5);
    gg.fillStyle = '#ddd'; gg.fillRect(20, H - 34, 2, 12);
    const showGhost = (G.phase === 'rally' && ball.v.z > 0 && G.rally && G.rally.lastHitter === 1) || (G.server === 0 && (G.phase === 'serve' || G.phase === 'toss'));
    if (showGhost) {
      const idealDisp = G.angleMode === 'manual' ? pad.pitchT : pad.pitchT;
      drawPaddle(idealDisp, 'rgba(255,255,255,0.45)', 3, [4, 4]);
    }
    const col = deg < -4 ? '#7dffa0' : deg > 4 ? '#7ac8ff' : '#ffffff';
    const [nx, ny] = drawPaddle(pad.pitch, '#e2382e', 6);
    // arrow showing where the face points
    gg.strokeStyle = col; gg.lineWidth = 2;
    gg.beginPath(); gg.moveTo(cx + nx * 6, cy + ny * 6); gg.lineTo(cx + nx * 26, cy + ny * 26); gg.stroke();
    gg.fillStyle = col; gg.beginPath(); gg.arc(cx + nx * 28, cy + ny * 28, 3, 0, 7); gg.fill();
    const label = deg < -4 ? `CLOSED ${-deg}°` : deg > 4 ? `OPEN ${deg}°` : 'SQUARE';
    const spin = deg < -4 ? 'topspin' : deg > 4 ? 'backspin' : 'flat';
    gg.fillStyle = col; gg.font = 'bold 13px Segoe UI, sans-serif'; gg.textAlign = 'right';
    gg.fillText(label, W - 8, 16);
    gg.fillStyle = '#9aa6c8'; gg.font = '11px Segoe UI, sans-serif';
    gg.fillText(spin, W - 8, 30);
    gg.textAlign = 'left';
    gg.fillText('L close · R open · wheel rest', 8, H - 6);
  }

  function hudTick(dt) {
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.remove('show'); }
    drawGauge();
    let hint = '';
    if (G.phase === 'serve' && G.server === 0) {
      const sp = G.serveSpin, spinTxt = sp > 0.08 ? `topspin ${Math.round(sp * 100)}%` : sp < -0.08 ? `backspin ${Math.round(-sp * 100)}%` : 'no spin';
      hint = `Your serve — mouse aims · wheel: ${spinTxt} · flick sideways as you click for sidespin · CLICK to serve`;
    }
    else if (G.phase === 'serve' || (G.phase === 'toss' && G.server === 1)) hint = 'CPU serving…';
    else if (G.phase === 'toss') hint = 'Swing!';
    $('hint').textContent = hint;
    $('rally').textContent = G.rallyLen > 2 ? `rally ${G.rallyLen}` : '';
    $('slowmo').style.display = G.slowmo ? 'block' : 'none';
    updateHUD();
  }

  function endMatch(w) {
    G.matchOver = true; G.mode = 'over'; G.phase = 'over';
    document.exitPointerLock && document.exitPointerLock();
    $('over-title').textContent = w === 0 ? 'YOU WIN!' : 'CPU WINS';
    $('over-sub').textContent = `Games ${G.games[0]} – ${G.games[1]}  ·  ${DIFFS[G.diff].name}`;
    $('over').classList.add('show');
  }

  function newMatch() {
    G.score = [0, 0]; G.games = [0, 0]; G.matchOver = false;
    G.firstServer = Math.random() < 0.5 ? 0 : 1;
    G.server = G.firstServer;
    pad.mx = 0.2; pad.mz = 1.8;
    startServe();
    showMsg(G.server === 0 ? 'YOU SERVE FIRST' : 'CPU SERVES FIRST', `first to 11 · best of ${G.bestOf}`, '#ffe07a');
  }

  function startGame() {
    Snd.init();
    $('menu').classList.remove('show');
    $('over').classList.remove('show');
    G.mode = 'play';
    newMatch();
    renderer.domElement.requestPointerLock();
  }

  // ---- Ma Long tribute photo ----
  function useTributeImage(img, save) {
    // downscale into a data URL so it can be saved and never taints WebGL
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    try {
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.88);
      if (save) { try { localStorage.setItem('spin_tribute', url); } catch (e) {} }
      const clean = new Image(); clean.onload = () => arena.drawTribute(clean); clean.src = url;
    } catch (e) { /* blocked by file:// security: keep the artwork */ }
  }
  function loadTributeFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => useTributeImage(img, true); img.src = r.result; };
    r.readAsDataURL(file);
  }
  (function initTribute() {
    let saved = null; try { saved = localStorage.getItem('spin_tribute'); } catch (e) {}
    if (saved) { const img = new Image(); img.onload = () => arena.drawTribute(img); img.src = saved; return; }
    for (const name of ['assets/ma-long.jpg']) {
      const img = new Image();
      img.onload = () => useTributeImage(img, false);
      img.src = name;
    }
  })();
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); loadTributeFile(e.dataTransfer.files[0]); });
  const tribInput = document.getElementById('tribute-file');
  if (tribInput) tribInput.addEventListener('change', () => loadTributeFile(tribInput.files[0]));

  // menu wiring
  document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    G.diff = +b.dataset.diff;
    document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll('[data-pace]').forEach((b) => b.addEventListener('click', () => {
    G.pace = +b.dataset.pace;
    document.querySelectorAll('[data-pace]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll('[data-best]').forEach((b) => b.addEventListener('click', () => {
    G.bestOf = +b.dataset.best;
    document.querySelectorAll('[data-best]').forEach((x) => x.classList.toggle('on', x === b));
  }));

  function setSens(v, toast) {
    G.sens = clamp(Math.round(v * 100) / 100, 0.05, 1);
    $('sens').value = G.sens; $('sens-v').textContent = G.sens.toFixed(2) + '×';
    try { localStorage.setItem('spin_sens', G.sens); } catch (e) {}
    if (toast) showMsg('Mouse speed ' + G.sens.toFixed(2) + '×', '[ slower · ] faster', '#fff');
  }
  try { const sv = parseFloat(localStorage.getItem('spin_sens')); if (sv > 0) G.sens = sv; } catch (e) {}
  setSens(G.sens, false);
  $('sens').addEventListener('input', (e) => setSens(+e.target.value, false));
  $('start').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);
  $('tomenu').addEventListener('click', () => { $('over').classList.remove('show'); $('menu').classList.add('show'); G.mode = 'menu'; });
  $('resume').addEventListener('click', () => renderer.domElement.requestPointerLock());
  $('quit').addEventListener('click', () => { $('pause').classList.remove('show'); $('menu').classList.add('show'); G.mode = 'menu'; });

  // input
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (G.mode === 'play') $('pause').classList.toggle('show', !locked);
  });
  renderer.domElement.addEventListener('click', () => { if (G.mode === 'play' && !locked) renderer.domElement.requestPointerLock(); });
  addEventListener('mousemove', (e) => {
    if (!locked || G.mode !== 'play') return;
    const k = 0.0026 * G.sens;
    mouse.flick += e.movementX;
    if (G.phase === 'serve' && G.server === 0) {
      G.serveAim.x = clamp(G.serveAim.x + e.movementX * k * 0.6, -0.62, 0.62);
      G.serveAim.z = clamp(G.serveAim.z + e.movementY * k * 0.6, -1.25, -0.3);   // push forward = longer serve
      return;
    }
    pad.mx = clamp(pad.mx + e.movementX * k, -1.3, 1.3);
    pad.mz = clamp(pad.mz + e.movementY * k * 1.15, 0.1, 2.5);   // all the way up to the net
  });
  addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      if (G.mode === 'play' && locked && G.phase === 'serve' && G.server === 0 && G.phaseT > 0.3) { startAutoServe(); return; }
      mouse.lmb = true;
    }
    if (e.button === 2) mouse.rmb = true;
    if (e.button === 1) { e.preventDefault(); pad.base = REST_ANGLE; }
  });
  addEventListener('wheel', (e) => {
    if (G.mode !== 'play' || !locked) return;
    if (G.phase === 'serve' && G.server === 0) { G.serveSpin = clamp(G.serveSpin - Math.sign(e.deltaY) * 0.2, -1, 1); return; }
    if (e.shiftKey) { pad.base = clamp(pad.base - Math.sign(e.deltaY || e.deltaX) * 0.035, -ANGLE_MAX, ANGLE_MAX); return; }
    pad.base = clamp(pad.base - Math.sign(e.deltaY) * 0.035, -ANGLE_MAX, ANGLE_MAX);   // wheel = resting face angle
    pad.lastWheel = performance.now();
  }, { passive: true });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.lmb = false; if (e.button === 2) mouse.rmb = false; });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => {
    if (G.mode !== 'play') return;
    if (e.code === 'Space') { e.preventDefault(); if (G.phase === 'serve' && G.server === 0 && G.phaseT > 0.3) startAutoServe(); }
    if (e.code === 'KeyQ') G.slowmo = !G.slowmo;
    if (e.code === 'BracketLeft' || e.code === 'Minus' || e.code === 'NumpadSubtract') setSens(G.sens - 0.02, true);
    if (e.code === 'BracketRight' || e.code === 'Equal' || e.code === 'NumpadAdd') setSens(G.sens + 0.02, true);
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ===================================================================
  //  Loop
  // ===================================================================
  let last = performance.now();
  let demoT = 0;
  function frame(now) {
    const rdt = Math.min(0.05, (now - last) / 1000);
    last = now;
    G.timeScale = (G.slowmo ? 0.3 : 1) * G.pace;
    const dt = rdt * G.timeScale;
    if (G.mode === 'play' && locked) { update(dt); hudTick(rdt); }
    else if (G.mode === 'menu') {
      // idle attract: slow camera drift
      for (const m of [hand, thumb, forearm, sleeve, padMesh]) m.visible = false;
      demoT += rdt;
      camera.position.set(Math.sin(demoT * 0.15) * 3.2, 1.9, Math.cos(demoT * 0.15) * 3.6);
      camera.lookAt(0, 0.8, 0);
      ball.p = v3(0, TOP + 0.25 + Math.abs(Math.sin(demoT * 3)) * 0.25, 0.6);
      renderer.render(scene, camera);
      ballMesh.position.set(ball.p.x, ball.p.y, ball.p.z);
      requestAnimationFrame(frame);
      return;
    }
    render(dt);
    requestAnimationFrame(frame);
  }
  startServe();
  requestAnimationFrame(frame);

  // exposed for debugging / automated tests
  window.__spin = { G, ball, pad, ai, update, render, startGame, newMatch, toss, mouse, DIFFS, solvePitch, faceNormal, camera, renderer, scene, TUNE, setLocked: (v) => (locked = v) };
})();
