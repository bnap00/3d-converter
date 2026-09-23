/* Lazy-loaded 3D preview. three.js is only fetched when someone opens a preview. */
import * as THREE from "three";
import { OrbitControls } from "/vendor/three@0.186.0/addons/OrbitControls.js";
import { STLLoader } from "/vendor/three@0.186.0/addons/STLLoader.js";

export function mountPreview(stage, buffers) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const css = getComputedStyle(document.documentElement);
  const accent = new THREE.Color(css.getPropertyValue("--accent").trim() || "#c2410c");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222226 : 0xbbbbc0, dark ? 1.6 : 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  camera.add(key);
  key.position.set(1, 2, 3);
  scene.add(camera);

  // CAD is usually Z-up; three.js is Y-up. Rotate so parts sit the way they will on the print bed.
  const model = new THREE.Group();
  model.rotation.x = -Math.PI / 2;
  scene.add(model);

  const loader = new STLLoader();
  const material = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  const geometries = buffers.map((buf) => {
    const g = loader.parse(buf);
    model.add(new THREE.Mesh(g, material));
    return g;
  });

  // Frame the model.
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(r * 2.8));
  camera.near = r / 100;
  camera.far = r * 100;
  camera.updateProjectionMatrix();

  const grid = new THREE.GridHelper(r * 4, 20, dark ? 0x3f3f46 : 0xd4d4d8, dark ? 0x27272a : 0xe4e4e7);
  grid.position.set(sphere.center.x, box.min.y, sphere.center.z);
  scene.add(grid);

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

  return () => {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    geometries.forEach((g) => g.dispose());
    material.dispose();
    grid.geometry.dispose();
    grid.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
