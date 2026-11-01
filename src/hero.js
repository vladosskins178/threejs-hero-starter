import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createFrameLimiter, createGovernor, pickQuality } from './quality.js';

const LOAD_TIMEOUT_MS = 12000;

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function readEnv() {
  const nav = navigator;
  return {
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    saveData: Boolean(nav.connection && nav.connection.saveData),
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
  ]);
}

/** Scale and centre a model so it fits a sphere of the given radius at the origin. */
function frameModel(object, radius) {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const scale = radius / (sphere.radius || 1);
  object.scale.multiplyScalar(scale);
  object.position.sub(sphere.center.multiplyScalar(scale));
}

/**
 * Mount a 3D hero inside `container`.
 *
 * Markup:
 *   <div class="hero-3d" data-model="model.glb">
 *     <img class="hero-3d__poster" src="poster.webp" alt="...">
 *   </div>
 *
 * The poster stays visible until the first 3D frame is drawn, and remains the
 * final result whenever 3D is skipped (no WebGL, Save-Data, load error).
 * Returns a controller with destroy(), or null when 3D was skipped.
 */
export async function mountHero(container, options = {}) {
  const modelUrl = options.model ?? container.dataset.model;
  const debug = options.debug ?? new URLSearchParams(location.search).has('debug');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

  const quality = pickQuality(readEnv());
  container.dataset.tier = quality.tier;
  if (quality.tier === 'off' || !webglAvailable()) {
    container.dataset.state = 'fallback';
    return null;
  }

  container.dataset.state = 'loading';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: quality.antialias,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    console.warn('[hero] WebGL renderer failed, keeping the poster.', err);
    container.dataset.state = 'fallback';
    return null;
  }

  renderer.setPixelRatio(quality.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  canvas.className = 'hero-3d__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 0.3, 6);
  camera.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight(0x8a7dff, 2.2);
  rim.position.set(-4, 2, -3);
  scene.add(key, rim, new THREE.HemisphereLight(0xbfd4ff, 0x1a1530, 0.5));

  const pivot = new THREE.Group();
  scene.add(pivot);

  let model;
  try {
    const gltf = await withTimeout(new GLTFLoader().loadAsync(modelUrl), LOAD_TIMEOUT_MS);
    model = gltf.scene;
  } catch (err) {
    console.warn('[hero] model failed to load, keeping the poster.', err);
    renderer.dispose();
    envMap.dispose();
    container.dataset.state = 'fallback';
    return null;
  }
  frameModel(model, 1.85);
  pivot.add(model);
  container.appendChild(canvas);

  // --- sizing -------------------------------------------------------------
  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the model fully visible on tall, narrow phone screens.
    camera.position.z = camera.aspect < 0.8 ? 6 / Math.max(camera.aspect, 0.45) * 0.8 : 6;
    camera.updateProjectionMatrix();
    requestFrame();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // --- pointer parallax ---------------------------------------------------
  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 }; // smoothed pointer
  const onPointerMove = (e) => {
    const r = container.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  // --- render loop --------------------------------------------------------
  const governor = createGovernor({
    pixelRatio: quality.pixelRatio,
    maxPixelRatio: quality.maxPixelRatio,
    targetFps: quality.maxFps,
  });
  const shouldDraw = createFrameLimiter(quality.maxFps);
  let prevNow = 0; // timestamp of the previous drawn frame, 0 = restart timing
  let reducedMotion = motionQuery.matches;
  let visible = true;
  let rafId = 0;
  let lastDraw = 0;
  let elapsed = 0;
  let firstFrame = true;
  let debugEl = null;
  if (debug) {
    debugEl = document.createElement('output');
    debugEl.className = 'hero-3d__debug';
    container.appendChild(debugEl);
  }

  function draw(now) {
    const dt = prevNow ? Math.min((now - prevNow) / 1000, 0.1) : 0;
    prevNow = now;
    if (!reducedMotion) elapsed += dt;

    // Idle motion: slow turn, a gentle float and a soft pointer tilt.
    // With reduced motion the model holds a still three-quarter pose.
    const ease = Math.min(1, dt * 4);
    tilt.x += ((reducedMotion ? 0 : pointer.x) - tilt.x) * ease;
    tilt.y += ((reducedMotion ? 0 : pointer.y) - tilt.y) * ease;
    pivot.rotation.y = 0.6 + elapsed * 0.25 + tilt.x * 0.35;
    pivot.rotation.x = tilt.y * 0.12;
    pivot.position.y = Math.sin(elapsed * 1.1) * 0.06;
    renderer.render(scene, camera);

    if (firstFrame) {
      firstFrame = false;
      container.dataset.state = 'ready';
    }
    if (lastDraw) {
      const next = governor.sample(now - lastDraw);
      if (next !== null) renderer.setPixelRatio(next);
    }
    lastDraw = now;
    if (debugEl) {
      debugEl.textContent = `${quality.tier} · ${renderer.getPixelRatio().toFixed(2)}x · ${renderer.info.render.triangles} tris`;
    }
  }

  function loop(now) {
    rafId = 0;
    if (!visible || document.hidden) return;
    if (shouldDraw(now)) draw(now);
    // With reduced motion we only draw on demand (resize, visibility).
    if (!reducedMotion) rafId = requestAnimationFrame(loop);
  }

  function requestFrame() {
    if (!rafId && visible && !document.hidden) {
      lastDraw = 0; // the gap since the last frame is not a slow frame
      rafId = requestAnimationFrame(loop);
    }
  }

  // Stop rendering while the hero is scrolled away or the tab is hidden.
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      prevNow = 0;
      requestFrame();
    }
  });
  io.observe(container);
  const onVisibility = () => {
    if (!document.hidden) {
      prevNow = 0;
      requestFrame();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onMotionChange = (e) => {
    reducedMotion = e.matches;
    requestFrame();
  };
  motionQuery.addEventListener('change', onMotionChange);

  resize();

  return {
    renderer,
    scene,
    camera,
    destroy() {
      cancelAnimationFrame(rafId);
      io.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        for (const m of [].concat(obj.material ?? [])) {
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose();
        }
      });
      envMap.dispose();
      renderer.dispose();
      canvas.remove();
      debugEl?.remove();
      container.dataset.state = 'destroyed';
    },
  };
}
