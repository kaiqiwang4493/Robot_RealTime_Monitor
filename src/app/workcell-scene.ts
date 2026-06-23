import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  input,
  output,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TelemetryFrame } from './models';

interface RobotRig {
  root: THREE.Group;
  joints: THREE.Group[];
  meshes: THREE.Mesh[];
  toolMount: THREE.Group;
  fingers: THREE.Mesh[];
  gripperRoll: THREE.Group;
}

@Component({
  selector: 'app-workcell-scene',
  template: '<canvas #canvas aria-label="Interactive 3D digital twin of the assembly cell"></canvas>',
  styles: `
    :host, canvas { display: block; width: 100%; height: 100%; }
    canvas { outline: none; }
  `,
})
export class WorkcellScene implements AfterViewInit, OnDestroy {
  readonly telemetry = input<TelemetryFrame | null>(null);
  readonly resetRequest = input(0);
  readonly fps = output<number>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly zone: NgZone;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private resizeObserver?: ResizeObserver;
  private animationId = 0;
  private armA?: RobotRig;
  private armB?: RobotRig;
  private baseMesh?: THREE.Group;
  private componentMesh?: THREE.Mesh;
  private assemblyRing?: THREE.Mesh;
  private lastReset = 0;
  private frameCount = 0;
  private fpsStarted = performance.now();
  private currentBaseId?: string;
  private respawnVisibleAt = 0;

  constructor(zone: NgZone) {
    this.zone = zone;
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.initialize());
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.scene?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer?.dispose();
  }

  private initialize(): void {
    const canvas = this.canvas().nativeElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#edf4f2');
    this.scene.fog = new THREE.Fog('#edf4f2', 22, 42);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 24;
    this.resetCamera();
    this.buildEnvironment();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.animate();
  }

  private buildEnvironment(): void {
    if (!this.scene) return;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8c7c3', 2.7));
    const key = new THREE.DirectionalLight('#ffffff', 4.2);
    key.position.set(-7, 12, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#b9e8df', 2.4);
    fill.position.set(8, 7, -6);
    this.scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 16),
      new THREE.MeshStandardMaterial({ color: '#dfe8e5', roughness: 0.9, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(24, 24, '#9eb6b0', '#c8d6d2');
    grid.position.y = 0.01;
    this.scene.add(grid);

    this.addConveyor();
    this.addSupplyRack();
    this.addCompletedZone();
    this.addSafetyZone();
    this.armA = this.createRobot(
      new THREE.Vector3(-3.8, 0.2, -2.45),
      '#f7faf9',
      '#00a884',
      0.39,
      0.7,
      1.42,
      3.0,
      2.3,
    );
    this.armB = this.createRobot(
      new THREE.Vector3(3.8, 0.2, 2.45),
      '#f7faf9',
      '#e99a13',
      0.62,
      1.18,
      1.9,
      2.95,
      2.45,
    );
    this.baseMesh = this.createBaseWorkpiece();
    this.scene.add(this.baseMesh);
    this.componentMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.32, 8),
      new THREE.MeshStandardMaterial({ color: '#f2a51a', roughness: 0.35, metalness: 0.35 }),
    );
    this.componentMesh.castShadow = true;
    this.scene.add(this.componentMesh);
  }

  private addConveyor(): void {
    if (!this.scene) return;
    const frameMaterial = new THREE.MeshStandardMaterial({ color: '#647772', roughness: 0.45, metalness: 0.65 });
    const beltMaterial = new THREE.MeshStandardMaterial({ color: '#34443f', roughness: 0.72 });
    const belt = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.28, 2.1), beltMaterial);
    belt.position.set(0, 0.72, 0);
    belt.receiveShadow = true;
    this.scene.add(belt);
    for (const z of [-1.13, 1.13]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.42, 0.13), frameMaterial);
      rail.position.set(0, 0.9, z);
      rail.castShadow = true;
      this.scene.add(rail);
    }
    for (const x of [-3.8, -1.3, 1.3, 3.8]) {
      for (const z of [-0.85, 0.85]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.16), frameMaterial);
        leg.position.set(x, 0.35, z);
        this.scene.add(leg);
      }
    }
    this.assemblyRing = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.78, 40),
      new THREE.MeshBasicMaterial({ color: '#32e6bd', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    this.assemblyRing.rotation.x = -Math.PI / 2;
    this.assemblyRing.position.set(0, 1.025, 0);
    this.scene.add(this.assemblyRing);
  }

  private addSupplyRack(): void {
    if (!this.scene) return;
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.32, 2.2),
      new THREE.MeshStandardMaterial({ color: '#aebdb9', metalness: 0.5, roughness: 0.4 }),
    );
    platform.position.set(-5.1, 0.18, -1.15);
    this.scene.add(platform);
    for (let x = -0.45; x <= 0.45; x += 0.45) {
      const spare = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.25, 8),
        new THREE.MeshStandardMaterial({ color: '#e1a331', roughness: 0.45 }),
      );
      spare.position.set(-5.1 + x, 0.48, -1.15);
      this.scene.add(spare);
    }
  }

  private addCompletedZone(): void {
    if (!this.scene) return;
    const zone = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.12, 2.2),
      new THREE.MeshStandardMaterial({ color: '#d5efe8', emissive: '#62d2ba', emissiveIntensity: 0.18 }),
    );
    zone.position.set(5.5, 0.08, 0.3);
    this.scene.add(zone);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.2, 0.15, 2.2)),
      new THREE.LineBasicMaterial({ color: '#32e6bd' }),
    );
    edges.position.copy(zone.position);
    this.scene.add(edges);
  }

  private addSafetyZone(): void {
    if (!this.scene) return;
    const shape = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 4.4),
      new THREE.MeshBasicMaterial({ color: '#f2b84b', transparent: true, opacity: 0.045, side: THREE.DoubleSide }),
    );
    shape.rotation.x = -Math.PI / 2;
    shape.position.y = 0.025;
    this.scene.add(shape);
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(5.2, 4.4)),
      new THREE.LineDashedMaterial({ color: '#f2b84b', dashSize: 0.25, gapSize: 0.15 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = 0.03;
    border.computeLineDistances();
    this.scene.add(border);
  }

  private createRobot(
    position: THREE.Vector3,
    bodyColor: string,
    accentColor: string,
    closedGripHalfSpan: number,
    fingerLength: number,
    toolMountOffset: number,
    upperLength: number,
    foreLength: number,
  ): RobotRig {
    if (!this.scene) throw new Error('Scene not initialized');
    const root = new THREE.Group();
    root.position.copy(position);
    this.scene.add(root);
    const body = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.35, roughness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.06 });
    const dark = new THREE.MeshStandardMaterial({ color: '#344742', metalness: 0.65, roughness: 0.25 });
    const joint = new THREE.MeshStandardMaterial({ color: '#d7e0dd', metalness: 0.6, roughness: 0.25 });
    const meshes: THREE.Mesh[] = [];
    const fingers: THREE.Mesh[] = [];
    const addMesh = (mesh: THREE.Mesh, parent: THREE.Object3D) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as THREE.MeshStandardMaterial;
      mesh.userData['baseEmissive'] = material.emissive?.clone();
      mesh.userData['baseEmissiveIntensity'] = material.emissiveIntensity;
      meshes.push(mesh);
      parent.add(mesh);
    };
    // helper: rounded box (r = corner radius, s = bevel segments)
    const rbox = (w: number, h: number, d: number, r = 0.06, s = 4) =>
      new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));

    const foundation = new THREE.Mesh(
      rbox(2.25, 0.16, 2.25, 0.04),
      new THREE.MeshStandardMaterial({ color: '#b8c8c4', metalness: 0.15, roughness: 0.72 }),
    );
    foundation.position.y = -0.2;
    addMesh(foundation, root);
    const mountingPlate = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.18, 32), dark);
    mountingPlate.position.y = -0.1;
    addMesh(mountingPlate, root);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.92, 0.72, 28), body);
    pedestal.position.y = 0.35;
    addMesh(pedestal, root);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.74, 0.42, 28), accent);
    base.position.y = 0.88;
    addMesh(base, root);
    const turret = new THREE.Group();
    turret.position.y = 1.08;
    root.add(turret);
    const shoulderHousing = new THREE.Mesh(rbox(1.08, 0.86, 0.9, 0.09), body);
    shoulderHousing.position.y = 0.18;
    addMesh(shoulderHousing, turret);
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 1.08, 24), accent);
    shoulder.rotation.x = Math.PI / 2;
    addMesh(shoulder, turret);
    const upperPivot = new THREE.Group();
    turret.add(upperPivot);
    const upper = new THREE.Mesh(rbox(0.68, upperLength + 0.07, 0.72, 0.07), body);
    upper.position.y = upperLength / 2;
    addMesh(upper, upperPivot);
    const upperAccent = new THREE.Mesh(rbox(0.72, 0.18, 0.76, 0.05), accent);
    upperAccent.position.y = upperLength * 0.68;
    addMesh(upperAccent, upperPivot);
    const elbow = new THREE.Group();
    elbow.position.y = upperLength;
    upperPivot.add(elbow);
    const elbowMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.88, 24), accent);
    elbowMesh.rotation.x = Math.PI / 2;
    addMesh(elbowMesh, elbow);
    const forePivot = new THREE.Group();
    elbow.add(forePivot);
    const fore = new THREE.Mesh(rbox(0.58, foreLength + 0.1, 0.62, 0.07), body);
    fore.position.y = foreLength / 2;
    addMesh(fore, forePivot);
    const wrist = new THREE.Group();
    wrist.position.y = foreLength;
    forePivot.add(wrist);
    const wristMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 20), joint);
    wristMesh.rotation.x = Math.PI / 2;
    addMesh(wristMesh, wrist);
    const wristCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.48, 20), dark);
    wristCuff.position.y = 0.44;
    addMesh(wristCuff, wrist);
    const toolFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 20), accent);
    toolFlange.position.y = 0.73;
    addMesh(toolFlange, wrist);
    // gripperRoll sits between the wrist and the gripper so the whole gripper
    // assembly can spin around the forearm axis independently of the wrist pitch.
    const gripperRoll = new THREE.Group();
    wrist.add(gripperRoll);
    const gripperPalm = new THREE.Mesh(
      rbox(closedGripHalfSpan * 2 + 0.34, 0.32, 0.52, 0.06),
      dark,
    );
    gripperPalm.position.y = 0.94;
    addMesh(gripperPalm, gripperRoll);
    const toolMount = new THREE.Group();
    toolMount.position.y = toolMountOffset;
    gripperRoll.add(toolMount);
    for (const direction of [-1, 1]) {
      const x = direction * (closedGripHalfSpan + 0.18);
      const finger = new THREE.Mesh(rbox(0.14, fingerLength, 0.2, 0.04), accent);
      finger.position.set(x, 1 + fingerLength / 2, 0);
      finger.userData['openX'] = x;
      finger.userData['closedX'] = direction * closedGripHalfSpan;
      fingers.push(finger);
      addMesh(finger, gripperRoll);
    }
    return { root, joints: [turret, upperPivot, forePivot, wrist], meshes, toolMount, fingers, gripperRoll };
  }

  private createBaseWorkpiece(): THREE.Group {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.34, 0.82),
      new THREE.MeshStandardMaterial({ color: '#f8faf9', roughness: 0.36, metalness: 0.4 }),
    );
    base.castShadow = true;
    group.add(base);
    const inset = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.08, 0.5),
      new THREE.MeshStandardMaterial({ color: '#71847f', roughness: 0.5 }),
    );
    inset.position.y = 0.2;
    group.add(inset);
    return group;
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const frame = this.telemetry();
    if (frame) this.applyTelemetry(frame);
    if (this.resetRequest() !== this.lastReset) {
      this.lastReset = this.resetRequest();
      this.resetCamera();
    }
    this.controls?.update();
    if (this.scene && this.camera) this.renderer?.render(this.scene, this.camera);
    this.measureFps();
  };

  // IK-computed joint angles (degrees) for robot B to place the assembled
  // workpiece at the completed zone center (5.5, 0.31, 0.3).
  // J1=51.6° aims turret; J2=-21.7° shoulder tilt; J3=-116° elbow bend; J4=-42.3° wrist down.
  private readonly DEPOSIT_JOINTS_DEG = [51.6, -21.7, -116.0, -42.3];
  /** Per-joint angular velocities (rad/frame) used during the deposit phase. */
  private depositVelocities = [0, 0, 0, 0];

  private applyTelemetry(frame: TelemetryFrame): void {
    const armAState = frame.robots.find((robot) => robot.id === 'arm-a');
    const armBState = frame.robots.find((robot) => robot.id === 'arm-b');
    // During the deposit step, override robot B's joint targets so it physically
    // carries the workpiece to the completed zone instead of the backend drop point.
    const isDepositing = frame.processStep === 'placing-completed';
    if (!isDepositing) this.depositVelocities = [0, 0, 0, 0]; // reset on mode exit
    const armBAngles  = isDepositing ? this.DEPOSIT_JOINTS_DEG : (armBState?.jointAngles  ?? []);
    const armBGripper = isDepositing ? true                    : (armBState?.gripperClosed ?? false);
    this.updateRobot(this.armA, armAState?.jointAngles ?? [], armAState?.gripperClosed ?? false, frame);
    this.updateRobot(this.armB, armBAngles, armBGripper, frame, isDepositing);
    this.scene?.updateMatrixWorld(true);
    // Spin Robot B's gripper so its fingers stay aligned with the conveyor axis (world X).
    if (this.armB) this.alignGripperRoll(this.armB, new THREE.Vector3(1, 0, 0));
    // Robot A's gripper doesn't need roll — cylinder is symmetric; reset to zero.
    if (this.armA) {
      this.armA.gripperRoll.rotation.y = THREE.MathUtils.lerp(this.armA.gripperRoll.rotation.y, 0, 0.1);
    }
    const base = frame.baseWorkpieces[0];
    const component = frame.components[0];
    if (base && base.id !== this.currentBaseId) {
      this.respawnAssets(base, component);
    }
    if (this.baseMesh && base && this.armB) {
      this.baseMesh.visible = performance.now() >= this.respawnVisibleAt;
      if (base.state === 'held-by-arm-b') {
        this.attachToTool(this.baseMesh, this.armB.toolMount, true);
      } else if (base.state === 'completed') {
        // attachToScene preserves world position so the object doesn't jump
        // when detaching from the tool mount, then gently settle to zone center.
        this.attachToScene(this.baseMesh);
        this.baseMesh.position.lerp(new THREE.Vector3(5.5, 0.31, 0.3), 0.06);
        this.baseMesh.quaternion.slerp(new THREE.Quaternion(), 0.06);
      } else {
        this.attachToScene(this.baseMesh);
        this.baseMesh.position.lerp(new THREE.Vector3(...base.position), 0.18);
        this.baseMesh.quaternion.slerp(new THREE.Quaternion(), 0.18);
      }
    }
    if (this.componentMesh && component && this.armA && this.baseMesh) {
      this.componentMesh.visible = performance.now() >= this.respawnVisibleAt;
      if (component.state === 'held-by-arm-a' || component.state === 'being-placed') {
        this.attachToTool(this.componentMesh, this.armA.toolMount, true);
      } else if (component.state === 'attached') {
        this.attachComponentToBase(this.componentMesh, this.baseMesh);
      } else {
        this.attachToScene(this.componentMesh);
        this.componentMesh.position.lerp(new THREE.Vector3(...component.position), 0.18);
        this.componentMesh.quaternion.slerp(new THREE.Quaternion(), 0.18);
      }
    }
    if (this.assemblyRing) {
      const color = frame.cellState === 'faulted' ? '#ff4f4f' : frame.activeAlert?.severity === 'warning' ? '#ffbd4a' : '#32e6bd';
      (this.assemblyRing.material as THREE.MeshBasicMaterial).color.set(color);
      this.assemblyRing.rotation.z += 0.004;
    }
  }

  private updateRobot(
    rig: RobotRig | undefined,
    angles: number[],
    gripperClosed: boolean,
    frame: TelemetryFrame,
    depositMode = false,
  ): void {
    if (!rig) return;
    const target = angles.map(THREE.MathUtils.degToRad);
    // Deposit phase: velocity-damped trapezoidal profile.
    //   MAX_SPEED  – cruise speed (0.7°/frame ≈ 42°/s at 60 fps)
    //   ACCEL_RATE – fraction by which velocity lerps toward desired each frame (ramp-in)
    //   DECEL_DIST – within this angular distance we start braking (smooth stop)
    const MAX_SPEED  = THREE.MathUtils.degToRad(0.7);
    const ACCEL_RATE = 0.06;   // ~16 frames to reach cruise speed → gentle ramp-up
    const DECEL_DIST = THREE.MathUtils.degToRad(8);
    rig.joints.forEach((joint, index) => {
      const axis = index === 0 ? 'y' : 'z';
      const cur = joint.rotation[axis];
      const tgt = target[index] ?? 0;
      if (depositMode) {
        const diff = tgt - cur;
        const absDiff = Math.abs(diff);
        // Desired velocity: cruise toward target, but scale down when close (braking zone)
        const desiredSpeed = absDiff < DECEL_DIST
          ? MAX_SPEED * (absDiff / DECEL_DIST)  // proportionally slow down
          : MAX_SPEED;
        const desiredVel = Math.abs(diff) < 0.0001 ? 0 : Math.sign(diff) * desiredSpeed;
        // Smooth the velocity (ease-in at start, ease-out near target)
        this.depositVelocities[index] = THREE.MathUtils.lerp(
          this.depositVelocities[index], desiredVel, ACCEL_RATE,
        );
        joint.rotation[axis] = cur + this.depositVelocities[index];
      } else {
        joint.rotation[axis] = THREE.MathUtils.lerp(cur, tgt, 0.12);
      }
    });
    rig.fingers.forEach((finger) => {
      const targetX = gripperClosed
        ? (finger.userData['closedX'] as number)
        : (finger.userData['openX'] as number);
      finger.position.x = THREE.MathUtils.lerp(finger.position.x, targetX, 0.2);
    });
    const fault = frame.cellState === 'faulted';
    const warningA = frame.activeAlert?.severity === 'warning' && rig === this.armA;
    rig.meshes.forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (fault) material.emissive?.set('#7a1010');
      else if (warningA) material.emissive?.set('#5e3a05');
      else if (material.emissive) {
        const baseEmissive = mesh.userData['baseEmissive'] as THREE.Color | undefined;
        if (baseEmissive) material.emissive.copy(baseEmissive);
        material.emissiveIntensity = (mesh.userData['baseEmissiveIntensity'] as number | undefined) ?? 1;
      }
    });
  }

  private attachToTool(object: THREE.Object3D, toolMount: THREE.Group, keepUpright = false): void {
    if (object.parent !== toolMount) {
      toolMount.attach(object);
    }
    object.position.lerp(new THREE.Vector3(0, 0, 0), 0.22);
    if (keepUpright) {
      // Keep the object visually level in world space — the gripper aligns to the object,
      // not the other way around. Target local quat = inverse of toolMount's world quat.
      const mountWorldQuat = new THREE.Quaternion();
      toolMount.getWorldQuaternion(mountWorldQuat);
      const targetLocalQuat = mountWorldQuat.clone().invert();
      object.quaternion.slerp(targetLocalQuat, 0.22);
    } else {
      const graspOrientation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        Math.PI,
      );
      object.quaternion.slerp(graspOrientation, 0.22);
    }
  }

  /**
   * Rotates `rig.gripperRoll` around the wrist's local Y axis (the forearm longitudinal
   * axis) so that the gripper fingers align with `desiredWorldDir` in the horizontal plane.
   *
   * Math: express the desired world direction in wrist-local space, project it onto
   * the XZ plane (perpendicular to the roll axis Y), then compute the signed angle.
   */
  private alignGripperRoll(rig: RobotRig, desiredWorldDir: THREE.Vector3): void {
    const wristWorldQ = new THREE.Quaternion();
    rig.joints[3].getWorldQuaternion(wristWorldQ);
    // Bring the desired world direction into the wrist's local frame.
    const desiredLocal = desiredWorldDir.clone().normalize().applyQuaternion(wristWorldQ.clone().invert());
    // Project onto the XZ plane (Y is the roll axis).
    const len = Math.sqrt(desiredLocal.x * desiredLocal.x + desiredLocal.z * desiredLocal.z);
    if (len < 0.01) return; // degenerate: desired dir is parallel to roll axis
    const targetRoll = Math.atan2(-desiredLocal.z / len, desiredLocal.x / len);
    rig.gripperRoll.rotation.y = THREE.MathUtils.lerp(rig.gripperRoll.rotation.y, targetRoll, 0.12);
  }

  private attachComponentToBase(component: THREE.Object3D, base: THREE.Group): void {
    if (component.parent !== base) {
      base.attach(component);
    }
    component.position.lerp(new THREE.Vector3(0, 0.43, 0), 0.28);
    component.quaternion.slerp(new THREE.Quaternion(), 0.28);
  }

  private attachToScene(object: THREE.Object3D): void {
    if (this.scene && object.parent !== this.scene) {
      this.scene.attach(object);
    }
  }

  private respawnAssets(
    base: TelemetryFrame['baseWorkpieces'][number],
    component: TelemetryFrame['components'][number] | undefined,
  ): void {
    if (!this.baseMesh || !this.componentMesh || !this.scene) return;
    const isFirstAsset = this.currentBaseId === undefined;
    this.currentBaseId = base.id;
    this.scene.attach(this.baseMesh);
    this.scene.attach(this.componentMesh);
    this.baseMesh.position.set(...base.position);
    this.baseMesh.quaternion.identity();
    if (component) this.componentMesh.position.set(...component.position);
    this.componentMesh.quaternion.identity();
    this.baseMesh.visible = isFirstAsset;
    this.componentMesh.visible = isFirstAsset;
    this.respawnVisibleAt = isFirstAsset ? 0 : performance.now() + 180;
  }

  private placeCompletedAsset(object: THREE.Object3D, position: THREE.Vector3): void {
    if (!this.scene) return;
    if (object.parent !== this.scene) {
      this.scene.attach(object);
    }
    object.position.copy(position);
    object.quaternion.identity();
  }

  private resetCamera(): void {
    this.camera?.position.set(17.2, 13.2, 22.2);
    this.controls?.target.set(0, 1.8, 0);
    this.controls?.update();
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const canvas = this.canvas().nativeElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  private measureFps(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsStarted >= 1000) {
      const value = Math.round((this.frameCount * 1000) / (now - this.fpsStarted));
      this.zone.run(() => this.fps.emit(value));
      this.frameCount = 0;
      this.fpsStarted = now;
    }
  }
}
