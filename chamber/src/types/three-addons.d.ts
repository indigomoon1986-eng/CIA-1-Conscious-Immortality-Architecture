declare module "three/addons/controls/OrbitControls.js" {
  import { Camera, Vector3 } from "three";
  export class OrbitControls {
    constructor(camera: Camera, domElement?: HTMLElement);
    enabled: boolean;
    enableDamping: boolean;
    dampingFactor: number;
    enablePan: boolean;
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    target: Vector3;
    update(): boolean;
    dispose(): void;
  }
}
