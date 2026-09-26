'use strict';
// =====================================================================
//  PHYSICS — SI units (m, s, kg). Regulation 40mm / 2.7g ball.
//  Air: gravity + quadratic drag + Magnus lift (spin × velocity).
//  Contacts: rigid-body impulse model for a hollow sphere with
//  restitution + Coulomb friction that can switch to rolling (stick).
//  Spin is never faked: it only ever comes out of contact friction.
// =====================================================================
const PHYS = (() => {
  const G = 9.81;
  const R = 0.02;                 // ball radius
  const M = 0.0027;               // ball mass
  const I = (2 / 3) * M * R * R;  // hollow sphere inertia
  const RHO = 1.2, AREA = Math.PI * R * R;
  const CD = 0.40, CL = 0.6;
  const KD = (0.5 * RHO * CD * AREA) / M;           // drag:   a = -KD |v| v
  const KM = (0.5 * RHO * AREA * R * CL) / M;       // Magnus: a =  KM (w × v)
  const SPIN_DECAY = 0.12;                          // air torque on spin, 1/s

  const TABLE = { top: 0.76, hw: 0.7625, hl: 1.37, thick: 0.03 };
  const NET = { h: 0.1525, hw: 0.915 };
  const MAT = {
    table:  { e: 0.89, mu: 0.25 },
    floor:  { e: 0.62, mu: 0.45 },
    paddle: { e: 0.86, mu: 0.95 },   // tacky inverted rubber
  };
  const PADDLE = { r: 0.078, ht: 0.006 };

  const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = (a) => Math.hypot(a.x, a.y, a.z);
  const UP = v3(0, 1, 0), ZERO = v3();

  function makeBall(p, v, w) {
    return { p: Object.assign(v3(), p), v: Object.assign(v3(), v || ZERO), w: Object.assign(v3(), w || ZERO) };
  }
  function cloneBall(b) { return makeBall(b.p, b.v, b.w); }

  function airStep(b, dt) {
    const v = b.v, w = b.w;
    const sp = Math.hypot(v.x, v.y, v.z);
    const ax = -KD * sp * v.x + KM * (w.y * v.z - w.z * v.y);
    const ay = -G - KD * sp * v.y + KM * (w.z * v.x - w.x * v.z);
    const az = -KD * sp * v.z + KM * (w.x * v.y - w.y * v.x);
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    b.p.x += v.x * dt; b.p.y += v.y * dt; b.p.z += v.z * dt;
    const k = Math.exp(-SPIN_DECAY * dt);
    w.x *= k; w.y *= k; w.z *= k;
  }

  // Impulse against a surface with normal n (pointing at the ball) moving at velocity vs.
  // Returns the normal approach speed (0 if not approaching).
  function surfaceHit(b, n, vs, e, mu) {
    const vr = v3(b.v.x - vs.x, b.v.y - vs.y, b.v.z - vs.z);
    const vn = dot(vr, n);
    if (vn >= 0) return 0;
    const Jn = -(1 + e) * vn * M;
    const r = v3(-R * n.x, -R * n.y, -R * n.z);          // centre → contact point
    const wr = cross(b.w, r);
    const c = v3(vr.x + wr.x, vr.y + wr.y, vr.z + wr.z); // contact point slip velocity
    const cn = dot(c, n);
    const ct = v3(c.x - cn * n.x, c.y - cn * n.y, c.z - cn * n.z);
    const ctl = len(ct);
    let Jt = v3();
    if (ctl > 1e-7) {
      const Jstick = (M * ctl) / (1 + (M * R * R) / I);   // impulse that makes it roll
      const mag = Math.min(mu * Jn, Jstick);
      Jt = v3((-ct.x / ctl) * mag, (-ct.y / ctl) * mag, (-ct.z / ctl) * mag);
    }
    b.v.x += (Jn * n.x + Jt.x) / M;
    b.v.y += (Jn * n.y + Jt.y) / M;
    b.v.z += (Jn * n.z + Jt.z) / M;
    const dw = cross(r, Jt);
    b.w.x += dw.x / I; b.w.y += dw.y / I; b.w.z += dw.z / I;
    return -vn;
  }

  // One integration step with the static world (table, net, floor, room).
  // ev(type, ball, speed) is called for contacts.
  function step(b, dt, ev) {
    const px = b.p.x, py = b.p.y, pz = b.p.z;
    airStep(b, dt);
    const T = TABLE, p = b.p;
    const overTable = Math.abs(p.x) <= T.hw + R * 0.3 && Math.abs(p.z) <= T.hl + R * 0.3;

    // table top
    if (b.v.y < 0 && overTable && p.y - R < T.top && py - R >= T.top - 0.006) {
      p.y = T.top + R;
      const s = surfaceHit(b, UP, ZERO, MAT.table.e, MAT.table.mu);
      if (ev && s > 0.05) ev('table', b, s);
    }
    // underside of the table
    const under = T.top - T.thick;
    if (b.v.y > 0 && overTable && p.y + R > under && py + R <= under + 0.002) {
      p.y = under - R; b.v.y = -b.v.y * 0.5;
    }
    // table side edges (ball clipping the side of the slab)
    if (p.y < T.top + R * 0.2 && p.y > under - R) {
      if (Math.abs(p.z) <= T.hl && Math.abs(px) > T.hw + R && Math.abs(p.x) < T.hw + R) {
        p.x = Math.sign(px) * (T.hw + R); b.v.x = -b.v.x * 0.5;
      }
      if (Math.abs(p.x) <= T.hw && Math.abs(pz) > T.hl + R && Math.abs(p.z) < T.hl + R) {
        p.z = Math.sign(pz) * (T.hl + R); b.v.z = -b.v.z * 0.5;
      }
    }
    // net
    if ((pz > 0) !== (p.z > 0) && Math.abs(p.x) < NET.hw) {
      const top = T.top + NET.h;
      if (p.y - R < top && p.y > T.top) {
        if (p.y > top - R * 0.35) {          // net cord: rolls / pops over
          b.v.y = Math.abs(b.v.y) * 0.35 + 0.35;
          b.v.z *= 0.5; b.v.x *= 0.8;
          b.w.x *= 0.5; b.w.y *= 0.5; b.w.z *= 0.5;
          if (ev) ev('netcord', b, Math.abs(b.v.z));
        } else {                             // into the mesh
          p.z = pz > 0 ? R * 1.05 : -R * 1.05;
          b.v.z *= -0.12; b.v.x *= 0.3; b.v.y *= 0.3;
          b.w.x *= 0.3; b.w.y *= 0.3; b.w.z *= 0.3;
          if (ev) ev('net', b, Math.abs(pz - p.z) / dt);
        }
      }
    }
    // floor
    if (p.y - R < 0 && b.v.y < 0) {
      p.y = R;
      const s = surfaceHit(b, UP, ZERO, MAT.floor.e, MAT.floor.mu);
      if (ev && s > 0.08) ev('floor', b, s);
    }
    // arena barriers
    if (Math.abs(p.x) > 5.5) { p.x = Math.sign(p.x) * 5.5; b.v.x *= -0.4; }
    if (Math.abs(p.z) > 7.5) { p.z = Math.sign(p.z) * 7.5; b.v.z *= -0.4; }
  }

  // Fast-forward a copy of the ball and report what happens.
  function simulate(b0, opts = {}) {
    const b = cloneBall(b0);
    const dt = opts.dt || 0.002, maxT = opts.maxT || 2.0;
    const out = { bounces: [], net: false, floor: false, samples: [], ball: b, t: 0 };
    let stop = false;
    const ev = (type, bb) => {
      if (type === 'table') { out.bounces.push({ x: bb.p.x, z: bb.p.z, t: out.t, v: Object.assign({}, bb.v) }); if (opts.bounces && out.bounces.length >= opts.bounces) stop = true; }
      else if (type === 'net') { out.net = true; if (opts.stopOnNet) stop = true; }
      else if (type === 'netcord') out.netcord = true;
      else if (type === 'floor') { out.floor = true; stop = true; }
    };
    let minNetClear = Infinity;
    for (out.t = 0; out.t < maxT && !stop; out.t += dt) {
      const pz = b.p.z;
      step(b, dt, ev);
      if ((pz > 0) !== (b.p.z > 0)) minNetClear = Math.min(minNetClear, b.p.y - R - (TABLE.top + NET.h));
      if (opts.sample) { out.samples.push({ t: out.t, p: Object.assign({}, b.p), v: Object.assign({}, b.v), w: Object.assign({}, b.w) }); }
      if (opts.until && opts.until(b, out)) break;
    }
    out.netClear = minNetClear;
    return out;
  }

  return { G, R, M, I, TABLE, NET, MAT, PADDLE, v3, dot, cross, len, UP, ZERO, makeBall, cloneBall, airStep, surfaceHit, step, simulate };
})();
