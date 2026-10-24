/* The fins editor's 3D view. The part and its fins, on a bed grid; click to select or add a fin. */
import * as THREE from "three";
import { OrbitControls } from "/vendor/three@0.186.0/addons/OrbitControls.js";

function geometryOf(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(tris, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * handlers.onPick({ point: [x, y, z], normal: [x, y, z] }) when the part is clicked,
 * handlers.onSelect(index | null) when a fin or empty space is clicked.
 */
export function mountView(stage, handlers) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const css = getComputedStyle(document.documentElement);
  const accent = new THREE.Color(css.getPropertyValue("--accent").trim() || "#c2410c");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222226 : 0xbbbbc0, dark ? 1.6 : 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  camera.add(key);
  key.position.set(1, 2, 3);
  scene.add(camera);

  // Print space is Z-up; three.js is Y-up.
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  const partMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  const finMat = new THREE.MeshStandardMaterial({ color: dark ? 0xa1a1aa : 0x71717a, roughness: 0.7, side: THREE.DoubleSide });
  const selMat = new THREE.MeshStandardMaterial({ color: dark ? 0xf4f4f5 : 0x27272a, roughness: 0.6, side: THREE.DoubleSide });
  let part = null, grid = null, radius = 50;
  let fins = [];
  let selected = null;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  function setPart(tris, { frame = true } = {}) {
    if (part) { world.remove(part); part.geometry.dispose(); }
    part = new THREE.Mesh(geometryOf(tris), partMat);
    world.add(part);
    world.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(part);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    radius = sphere.radius || 1;
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    const size = Math.ceil((radius * 3) / 10) * 10;
    grid = new THREE.GridHelper(size, size / 10, dark ? 0x3f3f46 : 0xd4d4d8, dark ? 0x27272a : 0xe4e4e7);
    scene.add(grid);
    if (frame) {
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1.3).normalize().multiplyScalar(radius * 3.2));
    }
    camera.near = radius / 100;
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
  }

  function setFins(list) {
    for (const m of fins) { world.remove(m); m.geometry.dispose(); }
    fins = list.map((tris, i) => {
      const m = new THREE.Mesh(geometryOf(tris), i === selected ? selMat : finMat);
      m.userData.index = i;
      world.add(m);
      return m;
    });
  }

  function select(index) {
    selected = index;
    fins.forEach((m, i) => { m.material = i === index ? selMat : finMat; });
  }

  // A click is a press and release without much movement; anything else is an orbit.
  const raycaster = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || e.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects([...fins, ...(part ? [part] : [])], false)[0];
    if (!hit) return handlers.onSelect(null);
    if (hit.object !== part) return handlers.onSelect(hit.object.userData.index);
    const p = world.worldToLocal(hit.point.clone());
    const n = hit.face.normal.clone(); // already in the part's (print) space
    handlers.onPick({ point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] });
  });

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = stage;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setPart,
    setFins,
    select,
    setCursor: (c) => { renderer.domElement.style.cursor = c; },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      setFins([]);
      if (part) part.geometry.dispose();
      if (grid) { grid.geometry.dispose(); grid.material.dispose(); }
      [partMat, finMat, selMat].forEach((m) => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
