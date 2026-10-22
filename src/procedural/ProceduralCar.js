import * as THREE from 'three';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

export class ProceduralCar extends THREE.Group {
  constructor(options = {}) {
    super();
    this.name = options.name || 'ProceduralCar';
    this.color = new THREE.Color(options.color ?? 0xd62828);
    this.scale.setScalar(options.scale ?? 1);
    this.dimensions = {
      length: options.length ?? 4.45,
      width: options.width ?? 1.84,
      height: options.height ?? 1.18,
      wheelbase: options.wheelbase ?? 2.55,
      track: options.track ?? 1.58,
      wheelRadius: options.wheelRadius ?? 0.34,
      wheelWidth: options.wheelWidth ?? 0.22,
    };
    this.wheels = new Map();
    this.wheelPivots = new Map();
    this.wheelSpin = new Map();
    this.steering = 0;
    this.materials = [];
    this.paintMeshes = [];
    this.build();
  }

  material(parameters) {
    const material = new THREE.MeshStandardMaterial(parameters);
    this.materials.push(material);
    return material;
  }

  mesh(geometry, material, name, position = null, parent = this) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    if (position) object.position.copy(position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }

  build() {
    const bodyMaterial = this.material({ color: this.color, metalness: 0.58, roughness: 0.3 });
    const trimMaterial = this.material({ color: 0x15171a, metalness: 0.32, roughness: 0.58 });
    const glassMaterial = this.material({ color: 0x102333, metalness: 0.16, roughness: 0.18, transparent: true, opacity: 0.78 });
    const tireMaterial = this.material({ color: 0x121315, metalness: 0.03, roughness: 0.9 });
    const rimMaterial = this.material({ color: 0xb7bdc6, metalness: 0.85, roughness: 0.28 });
    const lampMaterial = this.material({ color: 0xfff3ca, emissive: 0xffd36b, emissiveIntensity: 1.4, roughness: 0.22 });
    const tailMaterial = this.material({ color: 0x5c0808, emissive: 0xff1010, emissiveIntensity: 0.5, roughness: 0.3 });
    const wheelPositions = {
      frontLeft: new THREE.Vector3(-this.dimensions.track * 0.5, 0.37, -this.dimensions.wheelbase * 0.5),
      frontRight: new THREE.Vector3(this.dimensions.track * 0.5, 0.37, -this.dimensions.wheelbase * 0.5),
      rearLeft: new THREE.Vector3(-this.dimensions.track * 0.5, 0.37, this.dimensions.wheelbase * 0.5),
      rearRight: new THREE.Vector3(this.dimensions.track * 0.5, 0.37, this.dimensions.wheelbase * 0.5),
    };

     const stripeMaterial = this.material({ color: 0xe84a57, metalness: 0.18, roughness: 0.34 });
    const accentMaterial = this.material({ color: 0x1c5da8, metalness: 0.44, roughness: 0.3 });
    const dashboardMaterial = this.material({ color: 0x292d33, metalness: 0.16, roughness: 0.68 });
    const gaugeMaterial = this.material({ color: 0x78d6ff, emissive: 0x145f91, emissiveIntensity: 1.3, metalness: 0.12, roughness: 0.3 });
    const warningMaterial = this.material({ color: 0xff9d2e, emissive: 0x8b2d05, emissiveIntensity: 0.9, roughness: 0.3 });

    const addPart = (geometry, material, name, position = null, parent = this, rotation = null) => {
      const object = this.mesh(geometry, material, name, position, parent);
      if (rotation) object.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
      return object;
    };
    const addPaintPart = (geometry, name, position = null, rotation = null) => {
      const object = addPart(geometry, bodyMaterial, name, position, this, rotation);
      this.paintMeshes.push(object);
      return object;
    };

    this.body = addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.98, 0.44, this.dimensions.length * 0.76), 'CarBody', new THREE.Vector3(0, 0.6, 0.02));
    this.hood = addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.88, 0.17, this.dimensions.length * 0.24), 'CarHood', new THREE.Vector3(0, 0.84, -this.dimensions.length * 0.25));
    this.rearDeck = addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.86, 0.17, this.dimensions.length * 0.2), 'CarRearDeck', new THREE.Vector3(0, 0.83, this.dimensions.length * 0.32));
    this.lowerBody = addPart(new THREE.BoxGeometry(this.dimensions.width * 1.01, 0.18, this.dimensions.length * 0.72), trimMaterial, 'CarLowerBody', new THREE.Vector3(0, 0.4, 0.02));
    this.sideSkirt = addPart(new THREE.BoxGeometry(this.dimensions.width * 1.02, 0.12, this.dimensions.length * 0.58), trimMaterial, 'CarSideSkirt', new THREE.Vector3(0, 0.36, 0.08));
    this.cabin = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.68, 0.38, this.dimensions.length * 0.31), trimMaterial, 'CarCabin', new THREE.Vector3(0, 1.04, 0.1));
    this.roof = addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.71, 0.1, this.dimensions.length * 0.28), 'CarRoof', new THREE.Vector3(0, 1.24, 0.1));
    this.windshield = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.63, 0.28, 0.075), glassMaterial, 'CarWindshield', new THREE.Vector3(0, 1.09, -0.2), this, { x: 0.28 });
    this.rearGlass = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.61, 0.26, 0.07), glassMaterial, 'CarRearGlass', new THREE.Vector3(0, 1.09, 0.4), this, { x: -0.28 });
    addPart(new THREE.BoxGeometry(0.045, 0.23, this.dimensions.length * 0.18), glassMaterial, 'SideWindowLeft', new THREE.Vector3(-this.dimensions.width * 0.365, 1.08, 0.08));
    addPart(new THREE.BoxGeometry(0.045, 0.23, this.dimensions.length * 0.18), glassMaterial, 'SideWindowRight', new THREE.Vector3(this.dimensions.width * 0.365, 1.08, 0.08));
    addPart(new THREE.BoxGeometry(0.06, 0.3, 0.08), trimMaterial, 'APillarLeft', new THREE.Vector3(-this.dimensions.width * 0.31, 1.08, -0.2), this, { x: 0.28 });
    addPart(new THREE.BoxGeometry(0.06, 0.3, 0.08), trimMaterial, 'APillarRight', new THREE.Vector3(this.dimensions.width * 0.31, 1.08, -0.2), this, { x: 0.28 });
    addPart(new THREE.BoxGeometry(0.06, 0.27, 0.08), trimMaterial, 'BPillarLeft', new THREE.Vector3(-this.dimensions.width * 0.365, 1.08, 0.27));
    addPart(new THREE.BoxGeometry(0.06, 0.27, 0.08), trimMaterial, 'BPillarRight', new THREE.Vector3(this.dimensions.width * 0.365, 1.08, 0.27));

    WHEEL_KEYS.forEach((key) => {
      const position = wheelPositions[key];
      addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.22, 0.16, 0.7), `Fender_${key}`, new THREE.Vector3(position.x, 0.72, position.z));
      const outside = position.x + Math.sign(position.x) * this.dimensions.wheelWidth * 0.56;
      addPart(new THREE.TorusGeometry(this.dimensions.wheelRadius * 1.07, 0.035, 6, 14), trimMaterial, `WheelArch_${key}`, new THREE.Vector3(outside, position.y, position.z), this, { y: Math.PI * 0.5 });
    });

    addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.2, 0.16, this.dimensions.length * 0.24), 'HoodShoulderLeft', new THREE.Vector3(-this.dimensions.width * 0.34, 0.85, -this.dimensions.length * 0.25));
    addPaintPart(new THREE.BoxGeometry(this.dimensions.width * 0.2, 0.16, this.dimensions.length * 0.24), 'HoodShoulderRight', new THREE.Vector3(this.dimensions.width * 0.34, 0.85, -this.dimensions.length * 0.25));
    this.frontBumper = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.99, 0.16, 0.2), trimMaterial, 'CarFrontBumper', new THREE.Vector3(0, 0.45, -this.dimensions.length * 0.5));
    this.rearBumper = addPart(new THREE.BoxGeometry(this.dimensions.width * 1.0, 0.16, 0.2), trimMaterial, 'CarRearBumper', new THREE.Vector3(0, 0.45, this.dimensions.length * 0.5));
    addPart(new THREE.BoxGeometry(this.dimensions.width * 0.82, 0.055, 0.12), trimMaterial, 'FrontSplitter', new THREE.Vector3(0, 0.36, -this.dimensions.length * 0.52));
    addPart(new THREE.BoxGeometry(this.dimensions.width * 0.8, 0.055, 0.12), trimMaterial, 'RearDiffuser', new THREE.Vector3(0, 0.38, this.dimensions.length * 0.52));
    addPart(new THREE.BoxGeometry(this.dimensions.width * 0.58, 0.13, 0.06), trimMaterial, 'FrontGrille', new THREE.Vector3(0, 0.57, -this.dimensions.length * 0.535));
    for (let index = 0; index < 3; index += 1) {
      addPart(new THREE.BoxGeometry(this.dimensions.width * 0.48, 0.018, 0.075), accentMaterial, `FrontGrilleSlat${index}`, new THREE.Vector3(0, 0.525 + index * 0.035, -this.dimensions.length * 0.57));
    }
    const fogLightGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10);
    addPart(fogLightGeometry, lampMaterial, 'FogLightLeft', new THREE.Vector3(-this.dimensions.width * 0.34, 0.52, -this.dimensions.length * 0.56), this, { x: Math.PI * 0.5 });
    addPart(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10), lampMaterial, 'FogLightRight', new THREE.Vector3(this.dimensions.width * 0.34, 0.52, -this.dimensions.length * 0.56), this, { x: Math.PI * 0.5 });

    this.headlightLeft = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.21, 0.12, 0.06), lampMaterial, 'HeadlightLeft', new THREE.Vector3(-this.dimensions.width * 0.34, 0.72, -this.dimensions.length * 0.535), this, { z: -0.08 });
    this.headlightRight = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.21, 0.12, 0.06), lampMaterial, 'HeadlightRight', new THREE.Vector3(this.dimensions.width * 0.34, 0.72, -this.dimensions.length * 0.535), this, { z: 0.08 });
    this.tailLightLeft = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.19, 0.12, 0.06), tailMaterial, 'TailLightLeft', new THREE.Vector3(-this.dimensions.width * 0.36, 0.71, this.dimensions.length * 0.535), this, { z: 0.08 });
    this.tailLightRight = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.19, 0.12, 0.06), tailMaterial, 'TailLightRight', new THREE.Vector3(this.dimensions.width * 0.36, 0.71, this.dimensions.length * 0.535), this, { z: -0.08 });
    addPart(new THREE.BoxGeometry(this.dimensions.width * 0.32, 0.06, 0.05), tailMaterial, 'RearLightBar', new THREE.Vector3(0, 0.73, this.dimensions.length * 0.538));
    addPart(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), trimMaterial, 'ExhaustLeft', new THREE.Vector3(-this.dimensions.width * 0.37, 0.44, this.dimensions.length * 0.56), this, { z: Math.PI * 0.5 });
    addPart(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), trimMaterial, 'ExhaustRight', new THREE.Vector3(this.dimensions.width * 0.37, 0.44, this.dimensions.length * 0.56), this, { z: Math.PI * 0.5 });

    const addRallyStripe = (centerZ, topY, depth, name) => {
      addPart(new THREE.BoxGeometry(this.dimensions.width * 0.06, 0.026, depth), stripeMaterial, `${name}Left`, new THREE.Vector3(-this.dimensions.width * 0.11, topY, centerZ));
      addPart(new THREE.BoxGeometry(this.dimensions.width * 0.06, 0.026, depth), stripeMaterial, `${name}Right`, new THREE.Vector3(this.dimensions.width * 0.11, topY, centerZ));
      addPart(new THREE.BoxGeometry(this.dimensions.width * 0.035, 0.03, depth * 0.98), accentMaterial, `${name}Center`, new THREE.Vector3(0, topY + 0.002, centerZ));
    };
    addRallyStripe(-this.dimensions.length * 0.25, 0.94, this.dimensions.length * 0.23, 'HoodStripe');
    addRallyStripe(0.1, 1.295, this.dimensions.length * 0.27, 'RoofStripe');
    addRallyStripe(this.dimensions.length * 0.32, 0.93, this.dimensions.length * 0.17, 'RearStripe');
    [-1, 1].forEach((side) => {
      addPart(new THREE.BoxGeometry(0.04, 0.13, this.dimensions.length * 0.42), stripeMaterial, `SideLivery_${side}_Primary`, new THREE.Vector3(side * this.dimensions.width * 0.502, 0.68, -0.05));
      addPart(new THREE.BoxGeometry(0.045, 0.16, 0.72), accentMaterial, `SideLivery_${side}_Accent`, new THREE.Vector3(side * this.dimensions.width * 0.505, 0.78, 0.38), this, { y: side * 0.48 });
    });

    this.spoiler = addPart(new THREE.BoxGeometry(this.dimensions.width * 0.84, 0.08, 0.16), trimMaterial, 'CarSpoiler', new THREE.Vector3(0, 1.35, this.dimensions.length * 0.44));
    [-1, 1].forEach((side) => {
      addPart(new THREE.BoxGeometry(0.07, 0.34, 0.08), trimMaterial, `RearWingSupport_${side}`, new THREE.Vector3(side * this.dimensions.width * 0.3, 1.18, this.dimensions.length * 0.42), this, { z: side * 0.08 });
      addPart(new THREE.BoxGeometry(0.05, 0.24, 0.2), accentMaterial, `RearWingEndplate_${side}`, new THREE.Vector3(side * this.dimensions.width * 0.43, 1.35, this.dimensions.length * 0.44));
      addPart(new THREE.BoxGeometry(0.08, 0.06, 0.14), trimMaterial, `MirrorMount_${side}`, new THREE.Vector3(side * this.dimensions.width * 0.49, 0.99, -0.3), this, { z: side * 0.18 });
      addPart(new THREE.BoxGeometry(0.14, 0.08, 0.2), accentMaterial, `SideMirror_${side}`, new THREE.Vector3(side * this.dimensions.width * 0.56, 1.02, -0.3), this, { y: side * 0.2 });
    });

    for (let index = 0; index < 2; index += 1) {
      const offset = index === 0 ? -0.08 : 0.08;
      addPart(new THREE.BoxGeometry(this.dimensions.width * 0.07, 0.03, 0.07), trimMaterial, `HoodVentLeft${index}`, new THREE.Vector3(-this.dimensions.width * 0.26, 0.95, -this.dimensions.length * 0.27 + offset));
      addPart(new THREE.BoxGeometry(this.dimensions.width * 0.07, 0.03, 0.07), trimMaterial, `HoodVentRight${index}`, new THREE.Vector3(this.dimensions.width * 0.26, 0.95, -this.dimensions.length * 0.27 + offset));
    }

    this.cockpit = new THREE.Group();
    this.cockpit.name = 'RallyCockpit';
    this.add(this.cockpit);
    addPart(new THREE.BoxGeometry(this.dimensions.width * 0.68, 0.13, 0.38), dashboardMaterial, 'Dashboard', new THREE.Vector3(0, 0.92, -0.58), this.cockpit);
    addPart(new THREE.BoxGeometry(this.dimensions.width * 0.64, 0.045, 0.31), trimMaterial, 'DashboardTop', new THREE.Vector3(0, 1.0, -0.62), this.cockpit);
    const instrumentCluster = new THREE.Group();
    instrumentCluster.name = 'InstrumentCluster';
    instrumentCluster.position.set(-0.27, 1.04, -0.7);
    this.cockpit.add(instrumentCluster);
    addPart(new THREE.BoxGeometry(0.3, 0.12, 0.16), trimMaterial, 'InstrumentBinnacle', new THREE.Vector3(), instrumentCluster);
    addPart(new THREE.CylinderGeometry(0.055, 0.055, 0.018, 12), gaugeMaterial, 'GaugeLeft', new THREE.Vector3(-0.075, 0, 0.09), instrumentCluster, { x: Math.PI * 0.5 });
    addPart(new THREE.CylinderGeometry(0.055, 0.055, 0.018, 12), gaugeMaterial, 'GaugeRight', new THREE.Vector3(0.075, 0, 0.09), instrumentCluster, { x: Math.PI * 0.5 });
    addPart(new THREE.BoxGeometry(0.025, 0.04, 0.02), warningMaterial, 'GaugeWarning', new THREE.Vector3(0, -0.03, 0.101), instrumentCluster);

    this.steeringWheel = new THREE.Group();
    this.steeringWheel.name = 'ProceduralSteeringWheel';
    this.steeringWheel.position.set(-0.42, 1.0, -0.38);
    this.cockpit.add(this.steeringWheel);
    addPart(new THREE.TorusGeometry(0.18, 0.028, 8, 20), trimMaterial, 'SteeringWheelRim', new THREE.Vector3(), this.steeringWheel);
    addPart(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 10), rimMaterial, 'SteeringWheelHub', new THREE.Vector3(0, 0, 0.01), this.steeringWheel, { x: Math.PI * 0.5 });
    addPart(new THREE.BoxGeometry(0.025, 0.14, 0.025), rimMaterial, 'SteeringSpokeTop', new THREE.Vector3(0, 0.07, 0), this.steeringWheel);
    addPart(new THREE.BoxGeometry(0.12, 0.025, 0.025), rimMaterial, 'SteeringSpokeLeft', new THREE.Vector3(-0.055, -0.04, 0), this.steeringWheel, { z: -0.22 });
    addPart(new THREE.BoxGeometry(0.12, 0.025, 0.025), rimMaterial, 'SteeringSpokeRight', new THREE.Vector3(0.055, -0.04, 0), this.steeringWheel, { z: 0.22 });
    addPart(new THREE.BoxGeometry(0.22, 0.1, 0.48), dashboardMaterial, 'CenterConsole', new THREE.Vector3(0.22, 0.82, -0.16), this.cockpit);
    addPart(new THREE.BoxGeometry(0.13, 0.04, 0.18), trimMaterial, 'GearSelectorBase', new THREE.Vector3(0.22, 0.89, -0.23), this.cockpit);
    addPart(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 8), rimMaterial, 'GearSelector', new THREE.Vector3(0.22, 0.95, -0.23), this.cockpit);
    addPart(new THREE.SphereGeometry(0.04, 8, 6), trimMaterial, 'GearKnob', new THREE.Vector3(0.22, 1.02, -0.23), this.cockpit);
    addPart(new THREE.BoxGeometry(0.28, 0.3, 0.18), dashboardMaterial, 'SeatLeft', new THREE.Vector3(-0.37, 0.82, 0.29), this.cockpit);
    addPart(new THREE.BoxGeometry(0.28, 0.3, 0.18), dashboardMaterial, 'SeatRight', new THREE.Vector3(0.37, 0.82, 0.29), this.cockpit);

    WHEEL_KEYS.forEach((key) => {
      const pivot = new THREE.Group();
      pivot.name = `${key}_pivot`;
      pivot.position.copy(wheelPositions[key]);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(this.dimensions.wheelRadius, this.dimensions.wheelRadius, this.dimensions.wheelWidth, 16), tireMaterial);
      wheel.name = `${key}_tire`;
      wheel.rotation.z = Math.PI * 0.5;
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(this.dimensions.wheelRadius * 0.52, this.dimensions.wheelRadius * 0.52, this.dimensions.wheelWidth * 1.03, 12), rimMaterial);
      rim.name = `${key}_rim`;
      rim.rotation.z = Math.PI * 0.5;
      rim.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(this.dimensions.wheelRadius * 0.13, this.dimensions.wheelRadius * 0.13, this.dimensions.wheelWidth * 1.08, 10), trimMaterial);
      hub.name = `${key}_hub`;
      hub.rotation.z = Math.PI * 0.5;
      hub.castShadow = true;
      pivot.add(wheel, rim, hub);
      this.add(pivot);
      this.wheels.set(key, wheel);
      this.wheelPivots.set(key, pivot);
      this.wheelSpin.set(key, 0);
    });
    return this;
  }

  setColor(color) {
    this.color.set(color);
    if (this.paintMeshes?.length) this.paintMeshes.forEach((mesh) => mesh.material?.color?.copy(this.color));
    if (!this.paintMeshes?.length) {
      if (this.body?.material?.color) this.body.material.color.copy(this.color);
      if (this.hood?.material?.color) this.hood.material.color.copy(this.color);
      if (this.rearDeck?.material?.color) this.rearDeck.material.color.copy(this.color);
    }
    return this;
  }

  setSteering(value) {
    this.steering = value;
    this.wheelPivots.get('frontLeft').rotation.y = value;
    this.wheelPivots.get('frontRight').rotation.y = value;
    this.steeringWheel.rotation.z = value * 2.8;
  }

  setWheelSpin(key, value) {
    if (!this.wheels.has(key)) return;
    this.wheelSpin.set(key, value);
    this.wheels.get(key).rotation.x = value;
  }

  addWheelSpin(key, delta) {
    const value = (this.wheelSpin.get(key) || 0) + delta;
    this.setWheelSpin(key, value);
    return value;
  }

  setSuspension(key, compression = 0) {
    const pivot = this.wheelPivots.get(key);
    if (!pivot) return;
    pivot.position.y = 0.37 - Math.max(-0.16, Math.min(0.18, compression)) * 0.12;
  }

  getMountPoints() {
    return WHEEL_KEYS.map((key) => ({ key, position: this.wheelPivots.get(key).position.clone(), steer: key.startsWith('front'), drive: key.startsWith('rear') }));
  }

  dispose() {
    this.traverse((node) => {
      if (node.geometry?.dispose) node.geometry.dispose();
    });
    const unique = new Set(this.materials.map((material) => material));
    unique.forEach((material) => material.dispose?.());
    this.materials.length = 0;
  }
}
