import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { KioskDoor, VaultDoorId } from "../types";
import type { RenderQuality, SceneMetrics } from "./experience";

interface SceneDoor extends KioskDoor {
  label: string;
}
interface Props {
  doors: SceneDoor[];
  focused: VaultDoorId | null;
  revealIds: VaultDoorId[];
  disabled: boolean;
  review: boolean;
  reducedMotion: boolean;
  quality: RenderQuality;
  onSelect: (door: KioskDoor) => void;
  onFocus: (id: VaultDoorId | null) => void;
  onMetrics: (metrics: SceneMetrics) => void;
}
interface DoorRig {
  root: THREE.Group;
  pivot: THREE.Group;
  face: THREE.MeshStandardMaterial;
  light: THREE.MeshStandardMaterial;
  number: THREE.Mesh;
  label: string;
  pack: THREE.Group;
  halo: THREE.Mesh;
  anchor: THREE.Vector3;
}

const GOLD = 0xbca16b;
const clamp = THREE.MathUtils.clamp;

// Deterministic microscopic tooling marks. These are material data, not product artwork.
function brushedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#888";
  ctx.fillRect(0, 0, 256, 256);
  let seed = 61;
  for (let i = 0; i < 2300; i++) {
    seed = (seed * 16807) % 2147483647;
    const y = seed % 256,
      x = (seed >> 8) % 256;
    ctx.strokeStyle = `rgba(${i % 2 ? "255,255,255" : "0,0,0"},${0.03 + (seed % 8) / 100})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 30 + (seed % 180), y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  return texture;
}
function labelTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.fillStyle = "#e7e0d0";
  ctx.font = "400 126px Arial";
  ctx.fillText(label, 256, 126);
  ctx.fillStyle = "#a6977b";
  ctx.font = "500 16px Arial";
  ctx.letterSpacing = "5px";
  ctx.fillText("TEN KINGS  /  THE VAULT", 256, 179);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function haloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!,
    g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(240,196,109,.5)");
  g.addColorStop(0.3, "rgba(197,143,61,.15)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function VaultScene(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const host: HTMLDivElement = hostRef.current;
    let disposed = false,
      frame = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0b0d10, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.prepend(renderer.domElement);
    const lost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0c10, 0.045);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 70);
    camera.position.set(3.5, 3.3, 12.7);
    const target = new THREE.Vector3(0, 1.8, 0);
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(environment, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.75;
    environment.dispose();
    pmrem.dispose();
    const grain = brushedTexture(),
      glowTexture = haloTexture();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>([grain, glowTexture]);
    const geometries = new Set<THREE.BufferGeometry>();
    const material = (config: THREE.MeshStandardMaterialParameters) => {
      const mat = new THREE.MeshStandardMaterial(config);
      materials.add(mat);
      return mat;
    };
    const titanium = material({
      color: 0x666b6c,
      metalness: 0.92,
      roughness: 0.32,
      bumpMap: grain,
      bumpScale: 0.009,
    });
    const dark = material({
      color: 0x20252a,
      metalness: 0.72,
      roughness: 0.4,
      bumpMap: grain,
      bumpScale: 0.006,
    });
    const black = material({
      color: 0x070a0e,
      metalness: 0.55,
      roughness: 0.5,
    });
    const brass = material({
      color: GOLD,
      metalness: 0.95,
      roughness: 0.24,
      bumpMap: grain,
      bumpScale: 0.008,
    });
    const whiteLight = material({
      color: 0xf9e3bc,
      emissive: 0xffdca4,
      emissiveIntensity: 4,
      roughness: 0.3,
    });
    const coolLight = material({
      color: 0xa8b9c6,
      emissive: 0xa8c5e1,
      emissiveIntensity: 2.5,
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
      mat: THREE.Material,
      bevel = 0,
    ) {
      const key = [w, h, d, bevel].join(":");
      let geo = geoCache.get(key);
      if (!geo) {
        geo = bevel
          ? new RoundedBoxGeometry(w, h, d, 2, bevel)
          : new THREE.BoxGeometry(w, h, d);
        geoCache.set(key, geo);
        geometries.add(geo);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    function cylinder(
      parent: THREE.Object3D,
      r: number,
      height: number,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material,
    ) {
      const key = `c:${r}:${height}`;
      let geo = geoCache.get(key);
      if (!geo) {
        geo = new THREE.CylinderGeometry(r, r, height, 32);
        geoCache.set(key, geo);
        geometries.add(geo);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    }
    // Recessed gallery architecture: concrete shell, black ribs, titanium reveals, luminous coves.
    box(
      scene,
      26,
      0.22,
      24,
      0,
      -0.15,
      0,
      material({
        color: 0x111921,
        metalness: 0.72,
        roughness: 0.27,
        bumpMap: grain,
        bumpScale: 0.014,
      }),
    );
    box(scene, 22, 9, 0.8, 0, 4, -2.3, dark);
    box(scene, 8.8, 4.9, 0.4, 0, 2.22, -1.76, black, 0.05);
    for (const x of [-4.25, 4.25]) {
      box(scene, 0.14, 5.1, 1.5, x, 2.35, -1.15, titanium, 0.025);
      box(
        scene,
        0.025,
        4.75,
        0.03,
        x + (x < 0 ? 0.085 : -0.085),
        2.25,
        -0.36,
        whiteLight,
      );
    }
    box(scene, 8.7, 0.15, 1.5, 0, 4.85, -1.15, titanium, 0.02);
    box(scene, 8.2, 0.025, 0.07, 0, 4.73, -0.37, whiteLight);
    box(scene, 8.7, 0.2, 1.7, 0, 0.12, -0.95, titanium, 0.025);
    box(scene, 8.2, 0.02, 0.05, 0, 0.24, -0.08, whiteLight);
    for (let i = -8; i <= 8; i++) {
      if (Math.abs(i) > 4)
        box(scene, 0.055, 8, 0.24, i * 0.64, 3.5, -1.7, titanium);
      box(scene, 0.012, 0.012, 21, i * 1.3, -0.029, 2, black);
    }
    for (let i = -2; i < 7; i++)
      box(scene, 24, 0.012, 0.012, 0, -0.028, i * 1.9, black);
    // Overhead light tracks, seen in perspective and reflected by the brushed metals.
    for (const x of [-3.65, 3.65]) {
      box(scene, 0.14, 0.15, 10, x, 5.4, 1, black);
      box(scene, 0.045, 0.012, 10, x, 5.31, 1, coolLight);
    }
    const key = new THREE.SpotLight(0xffe3b0, 155, 23, 0.72, 0.8, 1.5);
    key.position.set(-3, 7, 5);
    key.target.position.set(0, 1.8, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.025;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xb6cce3, 1.6);
    fill.position.set(5, 3, 4);
    scene.add(fill);
    const rim = new THREE.PointLight(0xffcc87, 35, 12, 2);
    rim.position.set(-3, 3, -0.2);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xd3d7db, 0x15100c, 0.65));
    // The foil art remains local and works without internet access.
    const packTexture = new THREE.TextureLoader().load(
      "./art/vault/pack-front.png",
      () => {
        if (disposed) packTexture.dispose();
      },
    );
    packTexture.colorSpace = THREE.SRGBColorSpace;
    packTexture.anisotropy = Math.min(
      4,
      renderer.capabilities.getMaxAnisotropy(),
    );
    textures.add(packTexture);
    const doorTexture = new THREE.TextureLoader().load(
      "./art/vault/door-surface.png",
      () => {
        if (disposed) doorTexture.dispose();
      },
    );
    doorTexture.colorSpace = THREE.SRGBColorSpace;
    doorTexture.anisotropy = packTexture.anisotropy;
    textures.add(doorTexture);
    const packMaterial = material({
      map: packTexture,
      color: 0xffffff,
      metalness: 0.46,
      roughness: 0.36,
    });
    function makePack(parent: THREE.Object3D, scale = 1) {
      const group = new THREE.Group();
      parent.add(group);
      group.scale.setScalar(scale);
      box(group, 0.77, 1.16, 0.07, 0, 0, 0, brass, 0.025);
      const geometry = new THREE.PlaneGeometry(0.75, 1.12);
      geometries.add(geometry);
      const face = new THREE.Mesh(geometry, packMaterial);
      face.position.z = 0.041;
      group.add(face);
      for (const y of [-0.6, 0.6]) {
        box(group, 0.8, 0.07, 0.04, 0, y, 0, brass, 0.01);
        for (let i = 0; i < 25; i++)
          box(
            group,
            0.012,
            0.048,
            0.012,
            -0.37 + i * 0.031,
            y,
            0.025,
            titanium,
          );
      }
      return group;
    }
    function frameBox(
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      t: number,
      y: number,
      z: number,
      mat: THREE.Material,
    ) {
      box(parent, t, h, d, -w / 2 + t / 2, y, z, mat, 0.015);
      box(parent, t, h, d, w / 2 - t / 2, y, z, mat, 0.015);
      box(parent, w - 2 * t, t, d, 0, y - h / 2 + t / 2, z, mat, 0.015);
      box(parent, w - 2 * t, t, d, 0, y + h / 2 - t / 2, z, mat, 0.015);
    }
    const rigs: DoorRig[] = [];
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      root.position.set((i - 1) * 2.46, 0.43, 0);
      scene.add(root);
      box(root, 2.3, 3.94, 0.7, 0, 1.97, -0.72, black, 0.065);
      frameBox(root, 2.24, 3.82, 0.22, 0.07, 1.97, -0.28, brass);
      frameBox(root, 2.13, 3.71, 0.28, 0.065, 1.97, -0.17, titanium);
      frameBox(root, 1.96, 3.52, 0.16, 0.035, 1.97, -0.12, black);
      // Interior remains a deep cavity; the pack is revealed by the preview hinge animation.
      box(root, 1.8, 3.36, 0.09, 0, 1.98, -0.45, dark);
      box(root, 1.8, 0.05, 0.7, 0, 0.64, -0.06, titanium);
      box(root, 1.55, 0.018, 0.035, 0, 3.58, -0.2, whiteLight);
      const pack = makePack(root, 1.1);
      pack.position.set(0, 1.51, -0.08);
      const pivot = new THREE.Group();
      pivot.position.set(-0.97, 0, 0);
      root.add(pivot);
      const faceMat = material({
        color: 0xc4c8c8,
        map: doorTexture,
        metalness: 0.62,
        roughness: 0.35,
        bumpMap: grain,
        bumpScale: 0.012,
      });
      box(pivot, 1.97, 3.53, 0.16, 0.985, 1.97, 0.09, titanium, 0.045);
      box(pivot, 1.81, 3.35, 0.035, 0.985, 1.97, 0.187, dark, 0.02);
      box(pivot, 1.7, 3.22, 0.027, 0.985, 1.97, 0.207, dark, 0.025);
      const surfaceGeo = new THREE.PlaneGeometry(1.7, 3.22);
      geometries.add(surfaceGeo);
      const surface = new THREE.Mesh(surfaceGeo, faceMat);
      surface.position.set(0.985, 1.97, 0.226);
      surface.receiveShadow = true;
      pivot.add(surface);
      for (const y of [0.55, 3.39]) {
        box(pivot, 1.7, 0.035, 0.017, 0.985, y, 0.231, brass);
        for (const x of [0.23, 1.74]) {
          cylinder(pivot, 0.027, 0.015, x, y + 0.09, 0.237, titanium);
          box(pivot, 0.023, 0.006, 0.003, x, y + 0.09, 0.247, black);
        }
      }
      const numberGeo = new THREE.PlaneGeometry(1.45, 0.725);
      geometries.add(numberGeo);
      const numberMat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      materials.add(numberMat);
      const number = new THREE.Mesh(numberGeo, numberMat);
      number.position.set(0.985, 2.03, 0.235);
      pivot.add(number);
      // Handle, shadow gap, hinge barrels, small certification plate.
      for (const y of [1.04, 1.71])
        cylinder(pivot, 0.068, 0.08, 1.62, y, 0.26, titanium);
      box(pivot, 0.095, 0.75, 0.095, 1.62, 1.375, 0.36, brass, 0.03);
      for (const y of [0.95, 2.9]) {
        box(root, 0.15, 0.36, 0.21, -1.025, y, 0.14, titanium, 0.035);
        box(root, 0.17, 0.04, 0.24, -1.025, y, 0.14, brass, 0.015);
      }
      box(pivot, 0.63, 0.2, 0.015, 0.985, 0.94, 0.233, black, 0.015);
      const light = material({
        color: GOLD,
        emissive: 0xb7904e,
        emissiveIntensity: 0.65,
      });
      box(pivot, 0.42, 0.022, 0.02, 0.985, 0.96, 0.25, light);
      box(root, 0.034, 3.34, 0.018, 1.05, 1.97, 0.085, light);
      const haloMat = new THREE.MeshBasicMaterial({
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
      });
      materials.add(haloMat);
      const haloGeo = new THREE.PlaneGeometry(2.2, 2.2);
      geometries.add(haloGeo);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(0, -0.445, 0.6);
      scene.add(halo);
      halo.position.x = root.position.x;
      rigs.push({
        root,
        pivot,
        face: faceMat,
        light,
        number,
        label: "",
        pack,
        halo,
        anchor: new THREE.Vector3(root.position.x, 2.4, 0.22),
      });
    }
    // A restrained product plinth gives the room a believable foreground and sense of scale.
    const display = new THREE.Group();
    display.position.set(-4.2, 0.05, 2);
    display.rotation.y = 0.38;
    scene.add(display);
    box(display, 1.4, 0.55, 1.1, 0, 0.275, 0, black, 0.03);
    box(display, 1.43, 0.035, 1.13, 0, 0.565, 0, titanium, 0.014);
    box(display, 1.38, 0.01, 0.025, 0, 0.55, 0.565, whiteLight);
    const heroPack = makePack(display, 1.05);
    heroPack.position.set(0, 1.26, 0);
    heroPack.rotation.x = -0.09;
    const sidePack = makePack(display, 0.95);
    sidePack.position.set(-0.24, 1.2, -0.2);
    sidePack.rotation.y = -0.2;
    sidePack.rotation.z = 0.16;

    let w = 1,
      h = 1,
      pixelRatio = 1.35,
      quality: RenderQuality | "" = "",
      slowWindows = 0;
    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let last = performance.now(),
      sampleStart = last,
      samples: number[] = [],
      warmup = last + 1800;
    let elapsed = 0;
    const proj = new THREE.Vector3(),
      camGoal = new THREE.Vector3(),
      lookGoal = new THREE.Vector3();
    function render(now: number) {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const frameMs = now - last;
      const dt = Math.min(frameMs / 1000, 0.1);
      last = now;
      if (document.hidden) {
        samples = [];
        sampleStart = now;
        return;
      }
      elapsed += dt;
      const p = propsRef.current;
      if (quality !== p.quality) {
        quality = p.quality;
        pixelRatio =
          quality === "light" ? 0.85 : Math.min(devicePixelRatio, 1.5);
        renderer.setPixelRatio(pixelRatio);
        renderer.shadowMap.enabled = quality !== "light";
        key.shadow.mapSize.set(
          quality === "rich" ? 1024 : 768,
          quality === "rich" ? 1024 : 768,
        );
        resize();
        slowWindows = 0;
        samples = [];
        sampleStart = now;
        warmup = now + 1500;
      }
      // Move the camera only after the service confirms a selection, so hover cannot move a touch target.
      const focusIndex = p.doors.findIndex((d) => d.selected);
      const focusX = focusIndex < 0 ? 0 : (focusIndex - 1) * 2.46;
      const reveal = p.revealIds.length > 0;
      camGoal.set(2.45 + focusX * 0.09, 3.14, p.review ? 11.3 : 12.15);
      if (w / h < 1.1) camGoal.z = 14.2;
      if (reveal) camGoal.set(1.4, 3.15, 11.7);
      lookGoal.set(focusX * 0.08, 2.03, p.review ? 0.1 : 0);
      const amount = p.reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(camGoal, amount);
      target.lerp(lookGoal, amount);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      for (let i = 0; i < rigs.length; i++) {
        const rig = rigs[i],
          door = p.doors[i];
        rig.root.visible = Boolean(door);
        rig.halo.visible = Boolean(door);
        const button = overlayRef.current?.children[i] as
          | HTMLElement
          | undefined;
        if (!door) {
          if (button) button.style.visibility = "hidden";
          continue;
        }
        if (door.label !== rig.label) {
          const mat = rig.number.material as THREE.MeshBasicMaterial;
          if (mat.map) {
            textures.delete(mat.map);
            mat.map.dispose();
          }
          mat.map = labelTexture(door.label);
          textures.add(mat.map);
          mat.needsUpdate = true;
          rig.label = door.label;
        }
        const open = p.revealIds.includes(door.doorId);
        const selected = door.selected || open,
          focused = door.doorId === p.focused;
        const available = door.state === "AVAILABLE" || door.selected || open;
        rig.face.color.lerp(
          new THREE.Color(
            selected ? 0xffe6b4 : available ? 0xc4c8c8 : 0x5e6871,
          ),
          amount,
        );
        rig.light.emissiveIntensity = selected
          ? 4
          : focused
            ? 2
            : available
              ? 0.75
              : 0.08;
        rig.light.emissive.setHex(selected ? 0xffd491 : 0xb7904e);
        rig.pivot.rotation.y = THREE.MathUtils.lerp(
          rig.pivot.rotation.y,
          open ? -1.18 : 0,
          p.reducedMotion ? 1 : 1 - Math.exp(-dt * 2.7),
        );
        rig.pivot.position.z = THREE.MathUtils.lerp(
          rig.pivot.position.z,
          focused && !open ? 0.045 : 0,
          amount,
        );
        (rig.halo.material as THREE.MeshBasicMaterial).opacity = selected
          ? 0.7
          : 0.2;
        rig.pack.visible = open;
        if (button) {
          // DOM controls follow the projected geometry; screen readers/keyboard need no raycaster.
          const corners = [
            [-1.06, 0.58, 0.4],
            [1.06, 0.58, 0.4],
            [-1.06, 4.12, 0.4],
            [1.06, 4.12, 0.4],
          ].map(([x, y, z]) => {
            proj.set(rig.root.position.x + x, y, z).project(camera);
            return [(proj.x * 0.5 + 0.5) * w, (-proj.y * 0.5 + 0.5) * h];
          });
          const xs = corners.map((c) => c[0]),
            ys = corners.map((c) => c[1]);
          const left = Math.min(...xs),
            top = Math.min(...ys);
          button.style.left = `${left.toFixed(2)}px`;
          button.style.top = `${top.toFixed(2)}px`;
          button.style.width = `${Math.max(44, Math.max(...xs) - left)}px`;
          button.style.height = `${Math.max(44, Math.max(...ys) - top)}px`;
          button.style.visibility = "visible";
        }
      }
      renderer.render(scene, camera);
      if (now > warmup) samples.push(frameMs);
      if (now - sampleStart > 2500 && samples.length > 10) {
        const sorted = [...samples].sort((a, b) => a - b),
          p95 = sorted[Math.floor(sorted.length * 0.95)];
        const fps = Math.round(
          1000 / (samples.reduce((sum, n) => sum + n, 0) / samples.length),
        );
        const metrics = {
          fps,
          p95: Math.round(p95 * 10) / 10,
          draws: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          scale: pixelRatio,
          quality:
            quality === "auto"
              ? `auto / ${pixelRatio < 1 ? "light" : "balanced"}`
              : quality,
        };
        propsRef.current.onMetrics(metrics);
        host.dataset.fps = String(fps);
        host.dataset.p95 = String(metrics.p95);
        host.dataset.draws = String(metrics.draws);
        host.dataset.triangles = String(metrics.triangles);
        host.dataset.scale = String(pixelRatio);
        if (quality === "auto" && p95 > 28) slowWindows++;
        else slowWindows = 0;
        if (slowWindows >= 2 && pixelRatio > 0.85) {
          pixelRatio = 0.85;
          renderer.setPixelRatio(pixelRatio);
          renderer.shadowMap.enabled = false;
          resize();
          slowWindows = 0;
          warmup = now + 1000;
        }
        samples = [];
        sampleStart = now;
      }
    }
    frame = requestAnimationFrame(render);
    setReady(true);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      envTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      className={`vault-world ${failed ? "world-fallback" : ""} ${ready ? "world-ready" : ""}`}
      ref={hostRef}
      data-testid="vault-world"
    >
      {!ready && !failed && (
        <div className="world-loading">
          <span />
          Lighting the vault…
        </div>
      )}
      {failed && (
        <div className="world-unavailable">
          3D rendering is unavailable. Your exact door selections are available
          below.
        </div>
      )}
      <div
        className="world-door-controls"
        ref={overlayRef}
        role="group"
        aria-label="Choose an exact door from the gallery"
      >
        {props.doors.map((door) => (
          <button
            key={door.doorId}
            type="button"
            className={`world-door ${door.selected ? "is-selected" : ""} ${door.conflict ? "has-conflict" : ""}`}
            disabled={
              props.disabled || !(door.state === "AVAILABLE" || door.selected)
            }
            data-door-id={door.doorId}
            aria-pressed={door.selected}
            aria-label={`${door.label}, ${props.revealIds.includes(door.doorId) ? "paid" : door.conflict ? "needs replacement" : door.selected ? "selected" : door.state === "AVAILABLE" ? "available" : "unavailable"}`}
            onPointerDown={() => props.onFocus(door.doorId)}
            onPointerEnter={() => props.onFocus(door.doorId)}
            onPointerLeave={() => props.onFocus(null)}
            onFocus={() => props.onFocus(door.doorId)}
            onBlur={() => props.onFocus(null)}
            onClick={() => props.onSelect(door)}
          >
            <span className="world-door-tag">
              <b>{door.label}</b>
              <span>
                {props.revealIds.includes(door.doorId)
                  ? "PAID"
                  : door.conflict
                    ? "REPLACE"
                    : door.selected
                      ? "✓ SELECTED"
                      : door.state === "AVAILABLE"
                        ? "SELECT DOOR"
                        : "UNAVAILABLE"}
              </span>
              <i aria-hidden="true">{door.selected ? "−" : "+"}</i>
            </span>
          </button>
        ))}
      </div>
      <div className="world-vignette" />
    </div>
  );
}
