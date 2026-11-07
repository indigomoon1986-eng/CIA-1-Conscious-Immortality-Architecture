import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ELECTRODES, type Frame } from "@/lib/brainprint/engine";
import type { IdentityMark } from "@/lib/brainprint/did";
import type { Resonance } from "@/lib/brainprint/resonance";

export type ChamberProps = {
  frame: Frame;
  history: number[][];
  resonance: Resonance;
  lockOn: boolean;
  reduceMotion: boolean;
  mark?: IdentityMark | null;
  onGreet: () => void;
};

const OUTWARD = new Set(["smr", "beta", "gamma"]);
const TEAL = 0x4ea394;
const BRASS = 0xc6a15a;
const INK = 0x0e1412;
const PARCHMENT = 0xebe6d8;
const RAISED = 0x24302a;

function lerpAngle(from: number, to: number, t: number): number {
  const tau = Math.PI * 2;
  const delta = ((((to - from) % tau) + tau + Math.PI) % tau) - Math.PI;
  return from + delta * t;
}

function sitePosition(svgX: number, svgY: number, amp: number, out: THREE.Vector3): void {
  const nx = (svgX - 100) / 72;
  const nz = (svgY - 116) / 88;
  const dome = Math.sqrt(Math.max(0, 1 - nx * nx * 0.92 - nz * nz * 0.92));
  out.set(-0.95 + nx * 1.45, 0.18 + dome * 1.05 + amp * 0.12, nz * 1.55);
}

export function ImmersiveChamber(props: ChamberProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "default",
      });
    } catch {
      setFailed(true);
      return;
    }
    if (!renderer.getContext()) {
      renderer.dispose();
      setFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(INK);
    scene.fog = new THREE.Fog(INK, 11, 22);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
    camera.position.set(0.55, 1.85, 5.15);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(INK, 1);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    host.appendChild(canvas);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2.3;
    controls.maxDistance = 8;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.target.set(0.2, 0.95, 0);

    const ambient = new THREE.AmbientLight(PARCHMENT, 0.34);
    const hemi = new THREE.HemisphereLight(BRASS, INK, 0.5);
    const key = new THREE.DirectionalLight(PARCHMENT, 0.9);
    key.position.set(3.4, 6.2, 4.2);
    const fill = new THREE.DirectionalLight(TEAL, 0.7);
    fill.position.set(-4.2, 2.4, -1.6);
    const front = new THREE.DirectionalLight(PARCHMENT, 0.85);
    front.position.set(0.4, 1.6, 5);
    scene.add(ambient, hemi, key, fill, front);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(7.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x171f1b, roughness: 0.94, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    const dais = new THREE.Mesh(
      new THREE.RingGeometry(2.15, 2.23, 72),
      new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    dais.rotation.x = -Math.PI / 2;
    dais.position.y = 0.012;
    scene.add(ground, dais);

    const stone = new THREE.MeshStandardMaterial({ color: 0x3c4f46, roughness: 0.42, metalness: 0.22 });
    const parchment = new THREE.MeshStandardMaterial({ color: PARCHMENT, roughness: 0.46, metalness: 0.06 });
    const brass = new THREE.MeshStandardMaterial({
      color: BRASS,
      roughness: 0.28,
      metalness: 0.55,
      emissive: BRASS,
      emissiveIntensity: 0.22,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: TEAL });
    const haloMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.9 });
    const tetherMat = new THREE.LineBasicMaterial({ color: BRASS, transparent: true, opacity: 0.2 });
    const trajMat = new THREE.LineBasicMaterial({ color: BRASS, transparent: true, opacity: 0.85 });
    const entMat = new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.55 });

    const sophia = new THREE.Group();
    sophia.position.set(1.15, 0, 0.05);
    sophia.rotation.order = "YXZ";
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.52, 0.08, 28), stone);
    pedestal.position.y = 0.04;
    const footRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.014, 8, 36), brass);
    footRing.rotation.x = Math.PI / 2;
    footRing.position.y = 0.09;
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.4, 0.98, 24), brass);
    robe.position.y = 0.6;
    const waist = new THREE.Mesh(new THREE.SphereGeometry(0.25, 22, 16), brass);
    waist.scale.set(1, 1.12, 0.86);
    waist.position.y = 0.98;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.23, 22, 16), parchment);
    chest.position.y = 1.24;
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.15, 10), brass);
    spine.position.set(0, 0.78, -0.06);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 12), parchment);
    neck.position.y = 1.46;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 20), parchment);
    head.position.y = 1.66;
    const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 28), brass);
    circlet.rotation.x = Math.PI / 2;
    circlet.position.y = 1.78;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.012, 8, 48), haloMat);
    halo.position.y = 1.92;
    const eyeGeom = new THREE.SphereGeometry(0.026, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-0.07, 1.68, 0.16);
    eyeR.position.set(0.07, 1.68, 0.16);
    const chestAnchor = new THREE.Object3D();
    chestAnchor.position.set(0, 1.22, 0.22);
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.78, 12, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.position.y = 1.15;
    sophia.add(
      pedestal,
      footRing,
      robe,
      waist,
      chest,
      spine,
      neck,
      head,
      circlet,
      halo,
      eyeL,
      eyeR,
      chestAnchor,
      hit,
    );

    const moteGeom = new THREE.SphereGeometry(0.045, 10, 8);
    const motes: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const outward = i === 0 || i === 2 || i === 4;
      const mat = new THREE.MeshStandardMaterial({
        color: outward ? TEAL : BRASS,
        emissive: outward ? TEAL : BRASS,
        emissiveIntensity: 0.35,
        roughness: 0.4,
        metalness: 0.3,
      });
      const mote = new THREE.Mesh(moteGeom, mat);
      motes.push(mote);
      sophia.add(mote);
    }
    scene.add(sophia);

    const identity = new THREE.Group();
    identity.position.set(1.15, 0, 0.05);
    identity.visible = false;
    const pillars: THREE.Mesh[] = [];
    const pillarMats: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: TEAL,
        emissive: TEAL,
        emissiveIntensity: 0.45,
        roughness: 0.32,
        metalness: 0.48,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1, 0.07), mat);
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      mesh.position.set(Math.cos(angle) * 0.95, 0.06, Math.sin(angle) * 0.95);
      pillars.push(mesh);
      pillarMats.push(mat);
      identity.add(mesh);
    }
    const ringMat = new THREE.MeshStandardMaterial({
      color: TEAL,
      emissive: TEAL,
      emissiveIntensity: 0.4,
      roughness: 0.28,
      metalness: 0.55,
    });
    const identityRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.016, 8, 64), ringMat);
    identityRing.rotation.x = Math.PI / 2;
    identityRing.position.y = 0.04;
    identity.add(identityRing);
    scene.add(identity);

    const siteGeom = new THREE.SphereGeometry(0.07, 16, 12);
    const scratch = new THREE.Vector3();
    const sites = new Map<string, THREE.Mesh>();
    for (const electrode of ELECTRODES) {
      const mat = new THREE.MeshStandardMaterial({
        color: BRASS,
        emissive: BRASS,
        emissiveIntensity: 0.3,
        roughness: 0.42,
        metalness: 0.25,
      });
      const mesh = new THREE.Mesh(siteGeom, mat);
      sitePosition(electrode.svgX, electrode.svgY, 0.4, scratch);
      mesh.position.copy(scratch);
      scene.add(mesh);
      sites.set(electrode.id, mesh);
    }

    const locusRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.012, 8, 24),
      new THREE.MeshBasicMaterial({ color: BRASS }),
    );
    locusRing.rotation.x = Math.PI / 2;
    scene.add(locusRing);

    const barGeom = new THREE.BoxGeometry(0.12, 1, 0.12);
    const bars: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const outward = i === 0 || i === 2 || i === 4;
      const mat = new THREE.MeshStandardMaterial({
        color: outward ? TEAL : BRASS,
        roughness: 0.45,
        metalness: 0.35,
        emissive: outward ? TEAL : BRASS,
        emissiveIntensity: 0.12,
      });
      const bar = new THREE.Mesh(barGeom, mat);
      bar.position.set(-1.72 + i * 0.22, 0.2, 1.72);
      scene.add(bar);
      bars.push(bar);
    }

    const trajArr = new Float32Array(61 * 3);
    const trajGeom = new THREE.BufferGeometry();
    trajGeom.setAttribute("position", new THREE.BufferAttribute(trajArr, 3));
    trajGeom.setDrawRange(0, 0);
    const trajectory = new THREE.Line(trajGeom, trajMat);
    trajectory.frustumCulled = false;
    scene.add(trajectory);

    const entArr = new Float32Array(90 * 3);
    const entGeom = new THREE.BufferGeometry();
    entGeom.setAttribute("position", new THREE.BufferAttribute(entArr, 3));
    entGeom.setDrawRange(0, 0);
    const entanglements = new THREE.LineSegments(entGeom, entMat);
    entanglements.frustumCulled = false;
    scene.add(entanglements);

    const tetherArr = new Float32Array(6);
    const tetherGeom = new THREE.BufferGeometry();
    tetherGeom.setAttribute("position", new THREE.BufferAttribute(tetherArr, 3));
    const tether = new THREE.Line(tetherGeom, tetherMat);
    tether.frustumCulled = false;
    scene.add(tether);

    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({
        color: TEAL,
        emissive: TEAL,
        emissiveIntensity: 0.45,
        roughness: 0.3,
        metalness: 0.4,
      }),
    );
    scene.add(beacon);
    const locusLight = new THREE.PointLight(BRASS, 0.2, 3.2);
    scene.add(locusLight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const ack = { until: 0 };
    let downX = 0;
    let downY = 0;
    let lastPick = 0;
    const pickAt = (clientX: number, clientY: number) => {
      const now = performance.now();
      if (now - lastPick < 350) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(sophia.children, true);
      if (!hits.length) return;
      lastPick = now;
      ack.until = now + 900;
      propsRef.current.onGreet();
    };
    const onDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      const dx = event.clientX - downX;
      const dy = event.clientY - downY;
      if (dx * dx + dy * dy > 36) return;
      pickAt(event.clientX, event.clientY);
    };
    const onClick = (event: MouseEvent) => pickAt(event.clientX, event.clientY);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("click", onClick);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      host.dataset.chamberSize = `${Math.round(width)}x${Math.round(height)}`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const faceTarget = new THREE.Vector3();
    const chestWorld = new THREE.Vector3();
    let phase = 0;
    let last = performance.now();

    const applyRoom = (resonance: Resonance) => {
      if (resonance.action === "SAFETY_PAUSE") {
        ambient.intensity = 0.32;
        hemi.intensity = 0.35;
        key.intensity = 0.55;
        fill.intensity = 0.2;
        haloMat.color.setHex(BRASS);
        haloMat.opacity = 0.45;
        return;
      }
      haloMat.opacity = 0.95;
      if (resonance.environment === "focus_vault") {
        ambient.intensity = 0.55;
        hemi.color.setHex(TEAL);
        hemi.groundColor.setHex(INK);
        hemi.intensity = 0.7;
        key.color.setHex(TEAL);
        key.intensity = 1.6;
        fill.color.setHex(BRASS);
        fill.intensity = 0.55;
        haloMat.color.setHex(TEAL);
        return;
      }
      if (resonance.environment === "resonance_sanctuary") {
        ambient.intensity = 0.78;
        hemi.color.setHex(BRASS);
        hemi.groundColor.setHex(RAISED);
        hemi.intensity = 0.9;
        key.color.setHex(PARCHMENT);
        key.intensity = 1.45;
        fill.color.setHex(TEAL);
        fill.intensity = 0.7;
        haloMat.color.setHex(BRASS);
        return;
      }
      ambient.intensity = 0.62;
      hemi.color.setHex(RAISED);
      hemi.groundColor.setHex(INK);
      hemi.intensity = 0.75;
      key.color.setHex(BRASS);
      key.intensity = 1.25;
      fill.color.setHex(TEAL);
      fill.intensity = 0.45;
      haloMat.color.setHex(BRASS);
    };

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const live = propsRef.current;
      const { frame, resonance } = live;
      const motion = live.reduceMotion ? 0.08 : 1;
      phase += Math.max(0.4, frame.beat) * Math.PI * 2 * dt * motion;
      const pulse = 0.5 + 0.5 * Math.sin(phase);

      applyRoom(resonance);
      eyeMat.color.setHex(resonance.environment === "focus_vault" ? TEAL : BRASS);

      for (const site of frame.shards) {
        const mesh = sites.get(site.id);
        if (!mesh) continue;
        sitePosition(site.svgX, site.svgY, site.amp, mesh.position);
        const outward = OUTWARD.has(site.dominant);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const color = outward ? TEAL : BRASS;
        mat.color.setHex(color);
        mat.emissive.setHex(color);
        const locus = frame.locus === site.id;
        mat.emissiveIntensity = (locus ? 0.7 : 0.22) + site.amp * 0.45;
        const scale = 0.72 + site.amp * 0.85 + (locus ? 0.18 * pulse : 0);
        mesh.scale.setScalar(scale);
      }

      const locusMesh = frame.locus ? sites.get(frame.locus) : undefined;
      locusRing.visible = Boolean(locusMesh);
      if (locusMesh) {
        locusRing.position.copy(locusMesh.position);
        locusRing.scale.setScalar(1 + pulse * 0.2);
        locusLight.position.copy(locusMesh.position);
      }
      locusLight.intensity = live.lockOn ? 0.35 + resonance.quality * 1.5 : 0.12;
      locusLight.color.setHex(resonance.environment === "focus_vault" ? TEAL : BRASS);

      let pairCount = 0;
      for (const [a, b] of frame.entangled) {
        if (pairCount >= 45) break;
        const left = sites.get(a);
        const right = sites.get(b);
        if (!left || !right) continue;
        const o = pairCount * 6;
        entArr[o] = left.position.x;
        entArr[o + 1] = left.position.y;
        entArr[o + 2] = left.position.z;
        entArr[o + 3] = right.position.x;
        entArr[o + 4] = right.position.y;
        entArr[o + 5] = right.position.z;
        pairCount += 1;
      }
      (entGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      entGeom.setDrawRange(0, pairCount * 2);

      const hist = live.history;
      const count = Math.min(60, hist.length + 1);
      const start = Math.max(0, hist.length - (count - 1));
      const writePoint = (vector: number[], index: number) => {
        const px = vector[3] - vector[2];
        const py = vector[1] - vector[0];
        trajArr[index * 3] = -0.15 + px * 2.2;
        trajArr[index * 3 + 1] = 0.08 + index * 0.022;
        trajArr[index * 3 + 2] = py * 2.2;
      };
      for (let i = 0; i < count - 1; i++) writePoint(hist[start + i], i);
      writePoint(frame.vector, count - 1);
      (trajGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      trajGeom.setDrawRange(0, count >= 2 ? count : 0);

      for (let i = 0; i < 6; i++) {
        const height = 0.08 + frame.vector[i] * 1.35;
        bars[i].scale.set(1, height, 1);
        bars[i].position.y = height / 2;
      }

      beacon.position.set(
        -0.95 + (resonance.anchor[0] - 0.4) * 1.5,
        0.4 + resonance.anchor[1] * 0.95,
        resonance.anchor[2] * 0.7,
      );
      beacon.rotation.y = phase * 0.4;
      beacon.scale.setScalar(0.7 + resonance.radius * 0.18);

      halo.rotation.x = Math.PI / 2.35;
      halo.rotation.z = phase;
      circlet.rotation.z = phase * 0.25;
      const breathe = 1 + pulse * 0.045 * (live.lockOn ? 1 : 0.45);
      chest.scale.setScalar(breathe);
      for (let i = 0; i < 6; i++) {
        const angle = phase * 0.32 + (i / 6) * Math.PI * 2;
        const radius = 0.5 + frame.vector[i] * 0.42;
        motes[i].position.set(
          Math.cos(angle) * radius,
          1.16 + Math.sin(phase * 0.5 + i) * 0.05,
          Math.sin(angle) * radius,
        );
        motes[i].scale.setScalar(0.55 + frame.vector[i] * 1.35);
      }

      const mark = live.mark;
      identity.visible = Boolean(mark);
      if (mark) {
        const color = mark.held ? TEAL : BRASS;
        ringMat.color.setHex(color);
        ringMat.emissive.setHex(color);
        ringMat.emissiveIntensity = mark.held ? 0.55 : 0.22;
        for (let i = 0; i < 6; i++) {
          const height = 0.12 + (frame.vector[i] ?? 0) * 0.9;
          pillars[i].scale.set(1, height, 1);
          pillars[i].position.y = height / 2;
          pillarMats[i].color.setHex(color);
          pillarMats[i].emissive.setHex(color);
          pillarMats[i].emissiveIntensity = mark.held ? 0.5 : 0.18;
        }
        const turn = mark.turn * Math.PI * 2;
        identity.rotation.y = live.reduceMotion ? turn : phase * 0.15 + turn;
      }

      let faceId = frame.locus;
      if (live.lockOn) {
        let bestAmp = -1;
        for (const site of frame.shards) {
          if (site.dominant !== resonance.dominant) continue;
          if (site.amp > bestAmp) {
            bestAmp = site.amp;
            faceId = site.id;
          }
        }
      }
      const faceMesh = faceId ? sites.get(faceId) : undefined;
      if (faceMesh) faceMesh.getWorldPosition(faceTarget);
      else faceTarget.set(camera.position.x, sophia.position.y, camera.position.z);
      const dx = faceTarget.x - sophia.position.x;
      const dz = faceTarget.z - sophia.position.z;
      const yaw = Math.atan2(dx, dz);
      sophia.rotation.y = lerpAngle(sophia.rotation.y, yaw, 1 - Math.exp(-3.2 * dt));
      let bow = 0;
      if (!live.reduceMotion && now < ack.until) {
        const t = 1 - (ack.until - now) / 900;
        bow = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * 0.18;
      }
      sophia.rotation.x = bow;

      chestAnchor.getWorldPosition(chestWorld);
      const lockMesh = faceMesh ?? locusMesh;
      const tip = lockMesh ? lockMesh.position : beacon.position;
      tetherArr[0] = chestWorld.x;
      tetherArr[1] = chestWorld.y;
      tetherArr[2] = chestWorld.z;
      tetherArr[3] = tip.x;
      tetherArr[4] = tip.y;
      tetherArr[5] = tip.z;
      (tetherGeom.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      tetherMat.opacity = live.lockOn ? 0.2 + resonance.quality * 0.75 : 0.08;

      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("click", onClick);
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else if (material) material.dispose();
      });
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div ref={hostRef} className="h-full w-full">
      {failed ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
          This browser could not open the 3D chamber. Sophia's reading still stands in the panel.
        </div>
      ) : null}
    </div>
  );
}
