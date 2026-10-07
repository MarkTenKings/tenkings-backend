import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { KioskDoor, VaultDoorId } from "../types";
import type { SceneMetrics } from "../cinematic/experience";
import { CABINET, doorPosition, rowPitchForWidth } from "./layout";

interface Props {
  productView: RefObject<HTMLDivElement>;
  doorView: RefObject<HTMLDivElement>;
  scrollView: RefObject<HTMLDivElement>;
  doors: KioskDoor[];
  productId: string | null;
  categories: Record<string, "SPORTS" | "POKEMON" | undefined>;
  pokemon: boolean;
  shopping: boolean;
  revealIds: VaultDoorId[];
  focused: string | null;
  reducedMotion: boolean;
  light: boolean;
  onMetrics: (metrics: SceneMetrics) => void;
}

export function PortraitWorld(props: Props) {
  const ref = useRef<HTMLDivElement>(null),
    current = useRef(props);
  current.current = props;
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const host = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setStatus("fallback");
      return;
    }
    let alive = true,
      frame = 0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x080b0f, 0);
    renderer.autoClear = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.prepend(renderer.domElement);
    const lost = (e: Event) => {
      e.preventDefault();
      setStatus("fallback");
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const productScene = new THREE.Scene(),
      doorScene = new THREE.Scene();
    const room = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    productScene.environment = doorScene.environment = env.texture;
    productScene.environmentIntensity = 0.7;
    doorScene.environmentIntensity = 0.9;
    const mats = new Set<THREE.Material>(),
      geos = new Set<THREE.BufferGeometry>(),
      texs = new Set<THREE.Texture>();
    const mat = (p: THREE.MeshStandardMaterialParameters) => {
      const m = new THREE.MeshStandardMaterial(p);
      mats.add(m);
      return m;
    };
    const grainCanvas = document.createElement("canvas");
    grainCanvas.width = grainCanvas.height = 256;
    const ctx = grainCanvas.getContext("2d")!;
    ctx.fillStyle = "#888";
    ctx.fillRect(0, 0, 256, 256);
    let seed = 87;
    for (let i = 0; i < 2500; i++) {
      seed = (seed * 16807) % 2147483647;
      ctx.fillStyle = `rgba(${i % 2 ? "255,255,255" : "0,0,0"},.08)`;
      ctx.fillRect(seed % 256, (seed >> 8) % 256, 40 + (seed % 160), 0.4);
    }
    const grain = new THREE.CanvasTexture(grainCanvas);
    texs.add(grain);
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    const dark = mat({
      color: 0x121b23,
      metalness: 0.78,
      roughness: 0.36,
      bumpMap: grain,
      bumpScale: 0.009,
    });
    const black = mat({ color: 0x030609, metalness: 0.5, roughness: 0.46 });
    const titanium = mat({
      color: 0x6e7780,
      metalness: 0.92,
      roughness: 0.27,
      bumpMap: grain,
      bumpScale: 0.012,
    });
    const gold = mat({
      color: 0xb69a59,
      metalness: 0.93,
      roughness: 0.27,
      bumpMap: grain,
      bumpScale: 0.006,
    });
    const light = mat({
      color: 0xffe9ba,
      emissive: 0xffd9a1,
      emissiveIntensity: 2.8,
    });
    const blueLight = mat({
      color: 0x83a4b7,
      emissive: 0x597f9b,
      emissiveIntensity: 1.3,
    });
    const geoCache = new Map<string, THREE.BufferGeometry>();
    function box(
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
      bevel = 0,
    ) {
      const k = [w, h, d, bevel].join(":");
      let g = geoCache.get(k);
      if (!g) {
        g = bevel
          ? new RoundedBoxGeometry(w, h, d, 1, bevel)
          : new THREE.BoxGeometry(w, h, d);
        geoCache.set(k, g);
        geos.add(g);
      }
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    function frameBox(
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      t: number,
      x: number,
      y: number,
      z: number,
      m: THREE.Material,
    ) {
      box(parent, w, t, d, x, y + h / 2 - t / 2, z, m, 0.02);
      box(parent, w, t, d, x, y - h / 2 + t / 2, z, m, 0.02);
      box(parent, t, h - 2 * t, d, x - w / 2 + t / 2, y, z, m, 0.02);
      box(parent, t, h - 2 * t, d, x + w / 2 - t / 2, y, z, m, 0.02);
    }
    function texture(path: string) {
      const t = new THREE.TextureLoader().load(path, () => {
        if (!alive) t.dispose();
      });
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      texs.add(t);
      return t;
    }
    const wideMetal = texture("./art/vault/door-wide-titanium.png");
    const packSports = texture("./art/vault/pack-front.png");
    const packPokemon = texture("./art/vault/pack-pokemon.png");
    const packFace = mat({ map: packSports, metalness: 0.55, roughness: 0.32 });
    const insideSports = mat({
        map: packSports,
        metalness: 0.4,
        roughness: 0.4,
      }),
      insidePokemon = mat({ map: packPokemon, metalness: 0.4, roughness: 0.4 });
    function pack(parent: THREE.Object3D, scale: number) {
      const g = new THREE.Group();
      parent.add(g);
      g.scale.setScalar(scale);
      box(g, 1.5, 2.25, 0.09, 0, 0, 0, gold, 0.035);
      const geo = new THREE.PlaneGeometry(1.45, 2.18, 10, 16);
      geos.add(geo);
      const positions = geo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i),
          y = positions.getY(i);
        positions.setZ(
          i,
          0.015 * Math.cos(x * 35 + y * 4) * (Math.abs(x) / 0.75) ** 5 +
            0.007 * Math.sin(y * 34),
        );
      }
      geo.computeVertexNormals();
      const face = new THREE.Mesh(geo, packFace);
      face.position.z = 0.06;
      g.add(face);
      for (const y of [-1.115, 1.115]) {
        box(g, 1.48, 0.07, 0.025, 0, y, 0.065, gold);
        for (let i = 0; i < 40; i++)
          box(g, 0.012, 0.065, 0.01, -0.71 + i * 0.036, y, 0.082, titanium);
      }
      return g;
    }
    const heroPack = pack(productScene, 1.02);
    heroPack.position.set(0, 1.55, 0.2);
    heroPack.rotation.set(-0.045, -0.15, -0.08);
    const companionA = pack(productScene, 0.93),
      companionB = pack(productScene, 0.91);
    companionA.position.set(-0.37, 1.49, -0.14);
    companionA.rotation.set(0, -0.3, 0.09);
    companionB.position.set(0.4, 1.47, -0.23);
    companionB.rotation.set(0.05, 0.18, -0.2);
    box(
      productScene,
      30,
      0.15,
      20,
      0,
      -0.05,
      0,
      mat({ color: 0x03060a, metalness: 0.18, roughness: 0.62 }),
      0.02,
    );
    const cylinder = new THREE.CylinderGeometry(1.27, 1.4, 0.22, 80);
    geos.add(cylinder);
    const plinth = new THREE.Mesh(cylinder, titanium);
    plinth.position.y = 0.14;
    plinth.receiveShadow = true;
    productScene.add(plinth);
    const ringGeo = new THREE.TorusGeometry(1.26, 0.012, 8, 96);
    geos.add(ringGeo);
    const ring = new THREE.Mesh(ringGeo, light);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.26;
    productScene.add(ring);
    box(productScene, 12, 8, 0.2, 0, 3, -2.8, black);
    for (let i = -8; i <= 8; i++)
      box(productScene, 0.025, 7, 0.12, i * 0.49, 3, -2.63, titanium);
    for (const x of [-2.1, 2.1]) {
      box(productScene, 0.12, 6, 0.22, x, 2.5, -1.75, dark, 0.015);
      box(productScene, 0.025, 5.1, 0.03, x, 2.3, -1.6, blueLight);
    }
    const key = new THREE.SpotLight(0xffe3b2, 85, 20, 0.67, 0.8, 1.4);
    key.position.set(-3, 5, 5);
    key.target.position.set(0, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.normalBias = 0.02;
    productScene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xafc9e7, 2.3);
    rim.position.set(3, 3, -0.5);
    productScene.add(rim);
    const fill = new THREE.DirectionalLight(0xffedc9, 1.4);
    fill.position.set(1, 4, 5);
    productScene.add(fill);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    const doorCamera = new THREE.OrthographicCamera(-13, 13, 7, -7, 0.1, 80);
    const doorKey = new THREE.DirectionalLight(0xffe6b7, 3.5);
    doorKey.position.set(-7, 8, 15);
    doorScene.add(doorKey);
    const doorFill = new THREE.DirectionalLight(0xafc9e5, 1.7);
    doorFill.position.set(8, -5, 10);
    doorScene.add(doorFill);
    doorScene.add(new THREE.HemisphereLight(0xd9e4ed, 0x0c0b0b, 0.8));
    interface Rig {
      root: THREE.Group;
      pivot: THREE.Group;
      face: THREE.MeshStandardMaterial;
      edge: THREE.MeshStandardMaterial;
      lamp: THREE.MeshStandardMaterial;
      inside: THREE.Group;
      insidePack: THREE.Mesh;
      index: number;
    }
    const rigs: Rig[] = [];
    for (let i = 0; i < 68; i++) {
      const pos = doorPosition(i),
        root = new THREE.Group();
      root.position.set(pos.x + 3 - 13, -pos.y - 1.25, 0);
      doorScene.add(root);
      const face = mat({
        map: wideMetal,
        color: 0xb6a270,
        metalness: 0.72,
        roughness: 0.33,
        bumpMap: grain,
        bumpScale: 0.015,
      });
      const edge = mat({ color: 0xa7905d, metalness: 0.95, roughness: 0.25 });
      const lamp = mat({
        color: 0x9e7c3e,
        emissive: 0xffbc52,
        emissiveIntensity: 0.2,
      });
      box(root, 6.26, 2.73, 0.25, 0, 0, -0.72, black, 0.07);
      frameBox(root, 6.14, 2.63, 0.38, 0.075, 0, 0, -0.16, titanium);
      box(root, 5.88, 2.4, 0.025, 0, 0, -0.48, dark);
      const inside = new THREE.Group();
      root.add(inside);
      inside.position.x = 1;
      box(inside, 1.35, 1.8, 0.05, 0, 0, -0.33, gold, 0.025);
      const faceGeo = new THREE.PlaneGeometry(1.3, 1.74);
      geos.add(faceGeo);
      const insidePack = new THREE.Mesh(faceGeo, insideSports);
      insidePack.position.set(0, 0, -0.295);
      inside.add(insidePack);
      const pivot = new THREE.Group();
      pivot.position.x = -3;
      root.add(pivot);
      box(pivot, 6, 2.5, 0.17, 3, 0, 0, face, 0.055);
      frameBox(pivot, 5.82, 2.33, 0.035, 0.024, 3, 0, 0.092, edge);
      box(pivot, 4.92, 0.022, 0.015, 3.04, -0.91, 0.105, lamp);
      // Actual raised hinges and inset finger pull, separate geometry catches grazing light.
      for (const y of [-0.78, 0.78]) {
        box(pivot, 0.13, 0.33, 0.19, 0.13, y, 0.085, titanium, 0.025);
        box(pivot, 0.023, 0.24, 0.016, 0.13, y, 0.19, black);
      }
      box(pivot, 0.16, 0.55, 0.022, 5.66, 0, 0.097, black, 0.045);
      box(pivot, 0.047, 0.39, 0.07, 5.7, 0, 0.13, edge, 0.01);
      // Fine machined corner fasteners; no fake labels or inferred hardware mappings.
      for (const x of [0.27, 5.73])
        for (const y of [-1.03, 1.03])
          box(pivot, 0.052, 0.052, 0.012, x, y, 0.103, titanium, 0.014);
      rigs.push({
        root,
        pivot,
        face,
        edge,
        lamp,
        inside,
        insidePack,
        index: i,
      });
    }
    // Batch fixed details by material while preserving every animated hinge group.
    function batch(group: THREE.Object3D) {
      for (const child of [...group.children])
        if (child instanceof THREE.Group) batch(child);
      const buckets = new Map<THREE.Material, THREE.Mesh[]>();
      for (const child of [...group.children])
        if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
          const list = buckets.get(child.material) ?? [];
          list.push(child);
          buckets.set(child.material, list);
        }
      for (const [material, meshes] of buckets) {
        if (meshes.length < 2) continue;
        const copies = meshes.map((mesh) => {
          mesh.updateMatrix();
          return mesh.geometry.clone().applyMatrix4(mesh.matrix);
        });
        const merged = mergeGeometries(copies, false);
        copies.forEach((g) => g.dispose());
        if (!merged) continue;
        geos.add(merged);
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        meshes.forEach((old) => group.remove(old));
        group.add(mesh);
      }
    }
    batch(productScene);
    rigs.forEach((rig) => batch(rig.root));
    const width = 26;
    let last = performance.now(),
      windowStart = last,
      frames: number[] = [],
      slow = 0,
      autoLight = false,
      ratio = 0,
      oldSize = "";
    let oldProduct: string | null = null,
      changeAt = last;
    function viewport(el: HTMLElement, hostRect: DOMRect) {
      const r = el.getBoundingClientRect();
      const x = r.left - hostRect.left,
        y = hostRect.bottom - r.bottom;
      renderer.setViewport(x, y, r.width, r.height);
      renderer.setScissor(x, y, r.width, r.height);
      renderer.setScissorTest(true);
      renderer.clear(true, true, true);
      return r;
    }
    function tick(now: number) {
      if (!alive) return;
      frame = requestAnimationFrame(tick);
      if (document.hidden) {
        last = now;
        frames = [];
        windowStart = now;
        return;
      }
      const p = current.current,
        dt = Math.min(0.05, (now - last) / 1000);
      frames.push(now - last);
      last = now;
      const h = host.getBoundingClientRect();
      const nextRatio =
        p.light || autoLight ? 1 : Math.min(1.5, window.devicePixelRatio);
      const size = `${h.width}:${h.height}:${nextRatio}`;
      if (size !== oldSize) {
        renderer.setPixelRatio(nextRatio);
        renderer.setSize(h.width, h.height, false);
        oldSize = size;
        ratio = nextRatio;
      }
      renderer.shadowMap.enabled = !(p.light || autoLight);
      renderer.info.reset();
      renderer.info.autoReset = false;
      renderer.setScissorTest(false);
      renderer.clear();
      if (p.productId !== oldProduct) {
        oldProduct = p.productId;
        changeAt = now;
        packFace.map = p.pokemon ? packPokemon : packSports;
        packFace.needsUpdate = true;
      }
      if (p.productView.current) {
        const r = viewport(p.productView.current, h);
        camera.aspect = r.width / r.height;
        camera.position.set(1.3, 2.1, 6.2);
        camera.lookAt(0, 1.45, 0);
        camera.updateProjectionMatrix();
        const t = (now - changeAt) / 1000;
        heroPack.rotation.y =
          -0.14 +
          (p.reducedMotion
            ? 0
            : Math.sin(now * 0.00045) * 0.1 + Math.exp(-t * 5) * 0.42);
        heroPack.position.y =
          1.57 + (p.reducedMotion ? 0 : Math.sin(now * 0.00075) * 0.027);
        renderer.render(productScene, camera);
      }
      if (p.doorView.current && p.scrollView.current) {
        const r = viewport(p.doorView.current, h),
          scale = r.width / width,
          scroll = p.scrollView.current.scrollTop;
        const center = -(scroll + r.height / 2) / scale;
        doorCamera.left = -13;
        doorCamera.right = 13;
        doorCamera.top = r.height / scale / 2;
        doorCamera.bottom = -r.height / scale / 2;
        doorCamera.position.set(0, center, 30);
        doorCamera.lookAt(0, center, 0);
        doorCamera.updateProjectionMatrix();
        rigs.forEach((rig, i) => {
          const d = p.doors[i];
          if (!d) {
            rig.root.visible = false;
            return;
          }
          const pos = doorPosition(i, rowPitchForWidth(r.width));
          rig.root.position.y = -pos.y - 1.25;
          rig.root.visible =
            pos.y * scale + 2.9 * scale > scroll &&
            pos.y * scale < scroll + r.height;
          if (!rig.root.visible) return;
          const paid = p.revealIds.includes(d.doorId),
            selected = d.selected && !d.conflict;
          const matching =
              p.shopping &&
              d.productId === p.productId &&
              d.state === "AVAILABLE",
            hover = p.focused === d.doorId && matching;
          const active = selected || paid;
          const color = active ? 0xffdf91 : matching ? 0xc6a75e : 0x707a85;
          rig.face.color.lerp(new THREE.Color(color), Math.min(1, dt * 12));
          rig.edge.color.lerp(
            new THREE.Color(active ? 0xffdda0 : matching ? 0x998047 : 0x505862),
            Math.min(1, dt * 12),
          );
          rig.lamp.emissiveIntensity = active
            ? 3.2
            : hover
              ? 2
              : matching
                ? 1.1
                : 0.02;
          const target = paid ? -1.1 : 0;
          rig.pivot.rotation.y = p.reducedMotion
            ? target
            : THREE.MathUtils.damp(rig.pivot.rotation.y, target, 7, dt);
          rig.pivot.position.z = THREE.MathUtils.damp(
            rig.pivot.position.z,
            hover ? 0.045 : active ? 0.025 : 0,
            14,
            dt,
          );
          rig.inside.visible = paid;
          rig.insidePack.material =
            p.categories[d.doorId] === "POKEMON" ? insidePokemon : insideSports;
        });
        renderer.render(doorScene, doorCamera);
      }
      if (now - windowStart > 2500) {
        const sorted = frames.slice().sort((a, b) => a - b),
          p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        if (p95 > 28) slow++;
        else slow = 0;
        if (slow >= 2) autoLight = true;
        const metrics = {
          fps: Math.round(
            1000 / (frames.reduce((a, b) => a + b, 0) / frames.length),
          ),
          p95: Math.round(p95 * 10) / 10,
          draws: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          scale: ratio,
          quality: p.light || autoLight ? "Light" : "Rich",
        };
        p.onMetrics(metrics);
        Object.assign(host.dataset, {
          fps: metrics.fps,
          p95: metrics.p95,
          draws: metrics.draws,
          triangles: metrics.triangles,
          scale: ratio,
        });
        frames = [];
        windowStart = now;
      }
    }
    setStatus("ready");
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      env.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`portrait-world portrait-world-${status}`}
      aria-hidden="true"
    />
  );
}
