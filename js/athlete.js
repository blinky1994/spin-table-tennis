'use strict';
// =====================================================================
//  ATHLETE — articulated opponent. Joints are placed each frame and
//  limbs are solved with two-bone IK (elbows, knees), so the paddle
//  arm genuinely reaches for wherever the paddle is.
// =====================================================================
function buildAthlete(T, scene, colors) {
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const M = (c, r = 0.7) => new T.MeshStandardMaterial({ color: c, roughness: r });
  const shirt = M(colors.shirt, 0.75), shirt2 = M(colors.trim || '#f4d03f', 0.6), shorts = M(colors.shorts, 0.8);
  const skin = M(colors.skin, 0.6), shoe = M('#f4f4f4', 0.5), sole = M('#222', 0.8), sock = M('#ffffff', 0.9);
  const hairM = M(colors.hair, 0.95), dark = M('#141414', 0.3);
  const parts = [];
  const add = (geo, mat, shadow = true) => { const m = new T.Mesh(geo, mat); m.castShadow = shadow; scene.add(m); parts.push(m); return m; };
  // tube from point a (radius ra) to point b (radius rb); unit height, stretched by `limb`
  const tube = (ra, rb, mat) => add(new T.CylinderGeometry(rb, ra, 1, 14), mat);
  const ball = (r, mat, shadow) => add(new T.SphereGeometry(r, 16, 12), mat, shadow);

  const UP = V(0, 1, 0);
  function limb(m, a, b) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.y = Math.max(1e-3, a.distanceTo(b));
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  }
  // two-bone IK: returns [joint, reachedEnd]
  function ik(A, target, a, b, pole) {
    const d = target.clone().sub(A);
    const L = Math.min(Math.max(d.length(), 1e-3), a + b - 1e-3);
    const dir = d.normalize();
    const x = (a * a - b * b + L * L) / (2 * L);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const J = A.clone().add(dir.clone().multiplyScalar(x)).add(p.multiplyScalar(h));
    return [J, A.clone().add(dir.multiplyScalar(L))];
  }

  // --- body ---
  const pelvis = ball(0.15, shorts); pelvis.scale.set(1.05, 0.72, 0.82);
  const torso = tube(0.13, 0.165, shirt);
  const chest = ball(0.165, shirt); chest.scale.set(1.12, 0.78, 0.74);
  const collar = tube(0.07, 0.07, shirt2);
  const neck = tube(0.048, 0.045, skin);
  const head = ball(0.102, skin); head.scale.set(0.93, 1.1, 1.0);
  const hair = add(new T.SphereGeometry(0.109, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hairM);
  const eyes = [ball(0.012, dark, false), ball(0.012, dark, false)];
  const nose = ball(0.016, skin, false);
  const ears = [ball(0.022, skin, false), ball(0.022, skin, false)];

  const side = () => ({
    shoulder: ball(0.066, shirt),
    sleeve: tube(0.064, 0.058, shirt),
    upper: tube(0.05, 0.043, skin),
    elbow: ball(0.043, skin),
    fore: tube(0.04, 0.032, skin),
    hand: ball(0.04, skin),
    shortLeg: tube(0.095, 0.085, shorts),
    thigh: tube(0.078, 0.058, skin),
    knee: ball(0.058, skin),
    shin: tube(0.054, 0.04, skin),
    sock: tube(0.044, 0.042, sock),
    shoe: add(new T.BoxGeometry(0.1, 0.07, 0.27), shoe),
    sole: add(new T.BoxGeometry(0.104, 0.02, 0.28), sole),
  });
  const R = side(), L = side();

  const state = { t: 0 };

  // inputs: x,z (floor position), twist (upper body yaw), crouch, rHand (world Vector3), step (0..1 sideways shuffle)
  function update(o) {
    state.t += o.dt || 0.016;
    const root = V(o.x, 0, o.z);
    const c = o.crouch;
    const W = (x, y, z, rot) => {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      return V(x * cs + z * sn, y, -x * sn + z * cs).add(root);
    };
    const tw = o.twist || 0;

    const pelvisP = W(0, 0.93 - c, 0, tw * 0.3);
    const chestP = W(0, 1.33 - c, 0.1, tw);
    const neckB = W(0, 1.45 - c, 0.12, tw), neckT = W(0, 1.52 - c, 0.13, tw);
    const headP = W(0, 1.61 - c, 0.15, tw);
    const shR = W(-0.2, 1.39 - c, 0.08, tw), shL = W(0.2, 1.39 - c, 0.08, tw);
    const hipR = W(-0.1, 0.9 - c, 0, tw * 0.3), hipL = W(0.1, 0.9 - c, 0, tw * 0.3);

    // feet: wide ready stance, shuffling when moving sideways
    const ph = o.stepPhase || 0, amt = o.step || 0;
    const fR = W(-0.3 + Math.sin(ph) * 0.06 * amt, 0.07 + Math.max(0, Math.sin(ph)) * 0.05 * amt, 0.06, 0);
    const fL = W(0.3 - Math.sin(ph) * 0.06 * amt, 0.07 + Math.max(0, -Math.sin(ph)) * 0.05 * amt, -0.04, 0);

    pelvis.position.copy(pelvisP); pelvis.rotation.set(0, tw * 0.3, 0);
    limb(torso, pelvisP, chestP);
    chest.position.copy(chestP); chest.rotation.set(0.15, tw, 0);
    limb(collar, W(0, 1.43 - c, 0.115, tw), W(0, 1.46 - c, 0.12, tw));
    limb(neck, neckB, neckT);
    head.position.copy(headP); head.rotation.set(0.1, tw * 0.6, 0);
    hair.position.copy(W(0, 1.625 - c, 0.14, tw * 0.6)); hair.rotation.set(-0.35, tw * 0.6, 0);
    const hl = (x, y, z) => W(x, y - c, z, tw * 0.6);
    eyes[0].position.copy(hl(-0.034, 1.625, 0.238)); eyes[1].position.copy(hl(0.034, 1.625, 0.238));
    nose.position.copy(hl(0, 1.595, 0.252));
    ears[0].position.copy(hl(-0.095, 1.61, 0.15)); ears[1].position.copy(hl(0.095, 1.61, 0.15));

    // arms
    const armLen = [0.29, 0.27];
    const rHand = o.rHand;
    // free hand: resting in front, or wherever the caller puts it (e.g. holding / tossing the ball)
    const lHand = o.lHand || W(0.23, 1.12 - c + Math.sin(state.t * 2) * 0.01, 0.33, tw);
    // playing-arm elbow direction: out to the side on the forehand, forward across the body on the backhand
    const rp = o.rPole || [-0.9, -1, -0.5];
    for (const [S, sh, hand, pole] of [[R, shR, rHand, W(rp[0], rp[1], rp[2], tw).sub(root)], [L, shL, lHand, W(0.9, -1, -0.5, tw).sub(root)]]) {
      const [E, H] = ik(sh, hand, armLen[0], armLen[1], pole);
      S.shoulder.position.copy(sh);
      limb(S.upper, sh, E);
      limb(S.sleeve, sh, sh.clone().lerp(E, 0.45));
      S.elbow.position.copy(E);
      limb(S.fore, E, H);
      S.hand.position.copy(H);
    }
    // legs
    for (const [S, hip, foot, out] of [[R, hipR, fR, -0.35], [L, hipL, fL, 0.35]]) {
      const [K, A] = ik(hip, foot, 0.45, 0.44, V(out, 0, 1));
      limb(S.thigh, hip, K);
      limb(S.shortLeg, hip, hip.clone().lerp(K, 0.42));
      S.knee.position.copy(K);
      limb(S.shin, K, A);
      limb(S.sock, K.clone().lerp(A, 0.72), A);
      S.shoe.position.set(A.x, A.y - 0.035, A.z + 0.05);
      S.sole.position.set(A.x, A.y - 0.07, A.z + 0.05);
      S.shoe.rotation.y = S.sole.rotation.y = out * -0.25;
    }
  }

  return { update, parts };
}
