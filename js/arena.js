'use strict';
// =====================================================================
//  ARENA — walls, ceiling lights, scoreboards and the framed
//  Ma Long tribute photo (whatever image you drop onto the game).
// =====================================================================
function buildArena(T, scene, renderer) {
  const canvasTex = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return { c, g: c.getContext('2d'), t };
  };

  // ---------------- walls ----------------
  const wallTex = canvasTex(64, 512);
  { const g = wallTex.g, grd = g.createLinearGradient(0, 0, 0, 512); grd.addColorStop(0, '#05070f'); grd.addColorStop(1, '#141c33'); g.fillStyle = grd; g.fillRect(0, 0, 64, 512); }
  const wallMat = new T.MeshStandardMaterial({ map: wallTex.t, roughness: 1 });
  const back = new T.Mesh(new T.PlaneGeometry(34, 14), wallMat); back.position.set(0, 7, -13.4); scene.add(back);
  for (const s of [-1, 1]) {
    const w = new T.Mesh(new T.PlaneGeometry(30, 14), wallMat); w.position.set(s * 11.5, 7, -1); w.rotation.y = -s * Math.PI / 2; scene.add(w);
  }

  // ---------------- ceiling rig + lights ----------------
  const trussMat = new T.MeshStandardMaterial({ color: '#2a2e3a', metalness: 0.6, roughness: 0.4 });
  const lampMat = new T.MeshBasicMaterial({ color: '#fff6dc' });
  for (const z of [-5.5, -1.5, 2.5]) {
    const truss = new T.Mesh(new T.BoxGeometry(12, 0.12, 0.12), trussMat); truss.position.set(0, 7.2, z); scene.add(truss);
    for (let x = -5; x <= 5; x += 2.5) {
      const lamp = new T.Mesh(new T.BoxGeometry(0.9, 0.08, 0.35), lampMat); lamp.position.set(x, 7.1, z); scene.add(lamp);
    }
  }
  const standLight = new T.PointLight('#ffe8c8', 22, 16, 1.6); standLight.position.set(0, 6, -9); scene.add(standLight);
  for (const s of [-1, 1]) { const l = new T.PointLight('#ffe8c8', 14, 14, 1.6); l.position.set(s * 8, 6, -1); scene.add(l); }

  // ---------------- scoreboards ----------------
  const boards = [];
  for (const s of [-1, 1]) {
    const tx = canvasTex(512, 288);
    const frame = new T.Mesh(new T.BoxGeometry(3.3, 1.95, 0.12), new T.MeshStandardMaterial({ color: '#111', roughness: 0.5 }));
    frame.position.set(s * 6.3, 4.0, -13.1); scene.add(frame);
    const screen = new T.Mesh(new T.PlaneGeometry(3.1, 1.75), new T.MeshBasicMaterial({ map: tx.t }));
    screen.position.set(s * 6.3, 4.0, -13.03); scene.add(screen);
    boards.push(tx);
  }
  function setScore(d) {
    for (const { g, t, c } of boards) {
      g.fillStyle = '#05060c'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = '#c8242a'; g.lineWidth = 6; g.strokeRect(3, 3, c.width - 6, c.height - 6);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#9aa6c8'; g.font = 'bold 30px Arial'; g.fillText('YOU', 128, 46); g.fillText('CPU', 384, 46);
      g.fillStyle = '#ffffff'; g.font = 'bold 120px Arial';
      g.fillText(String(d.score[0]), 128, 150); g.fillText(String(d.score[1]), 384, 150);
      g.fillStyle = '#f4d03f'; g.font = 'bold 30px Arial';
      g.fillText(`GAMES ${d.games[0]} – ${d.games[1]}`, 256, 250);
      g.fillStyle = '#ff8c1a';
      g.beginPath(); g.arc(d.server === 0 ? 60 : 452, 46, 10, 0, 7); g.fill();
      t.needsUpdate = true;
    }
  }

  // ---------------- Ma Long tribute: just a framed photo ----------------
  // The frame takes the photo's own shape (height fixed, width follows the aspect ratio).
  const PHOTO_H = 2.6, PHOTO_Y = 4.0;
  const tribFrame = new T.Mesh(new T.BoxGeometry(1, 1, 0.12), new T.MeshStandardMaterial({ color: '#b8902a', metalness: 0.7, roughness: 0.35 }));
  tribFrame.position.set(0, PHOTO_Y, -13.15); scene.add(tribFrame);
  const tribMat = new T.MeshBasicMaterial();
  const tribMesh = new T.Mesh(new T.PlaneGeometry(1, 1), tribMat);
  tribMesh.position.set(0, PHOTO_Y, -13.08); scene.add(tribMesh);
  const tribLight = new T.SpotLight('#fff0d0', 30, 12, 0.45, 0.6, 1.2);
  tribLight.position.set(0, 7, -9); tribLight.target = tribMesh; scene.add(tribLight);
  let trib = null;

  function drawTribute(img) {
    let aspect = 0.8;   // placeholder panel shape
    if (img && img.width && img.height) aspect = Math.min(1.9, Math.max(0.55, img.width / img.height));
    const H = 900, W = Math.round(H * aspect);
    if (trib) trib.t.dispose();
    trib = canvasTex(W, H);
    const g = trib.g;
    let drewPhoto = false;
    if (img) {
      try {
        const s = Math.max(W / img.width, H / img.height), sw = W / s, sh = H / s;
        g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
        g.getImageData(0, 0, 1, 1);   // throws if the image taints the canvas (file:// security)
        drewPhoto = true;
      } catch (e) { drewPhoto = false; }
    }
    if (!drewPhoto) {   // placeholder until a photo is added
      const pg = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
      pg.addColorStop(0, '#d8342c'); pg.addColorStop(1, '#4a0508');
      g.fillStyle = pg; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f2cf6a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 520px "KaiTi", "STKaiti", "Microsoft YaHei", serif';
      g.fillText('龍', W / 2, H / 2);
    }
    trib.t.needsUpdate = true;
    tribMat.map = trib.t; tribMat.needsUpdate = true;
    const w = PHOTO_H * aspect;
    tribMesh.scale.set(w, PHOTO_H, 1);
    tribFrame.scale.set(w + 0.24, PHOTO_H + 0.24, 1);
  }
  drawTribute(null);

  function update() {}

  return { update, setScore, drawTribute };
}
