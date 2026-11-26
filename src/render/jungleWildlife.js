import * as THREE from 'three';

// Blue morphos lift out of fern patches as the camera passes. Both wings
// share an instanced draw and fold about the same local hinge.
export function butterflyFlight(road, world, random, time) {
  const geometry = new THREE.BufferGeometry();
  const vertices=[],colors=[],indices=[];
  for (const side of [-1,1]) {
    const first=vertices.length/3;
    for (const [x,z,shade] of [[0,-0.08,0x15150d],[0.18,-0.14,0x273638],[0.23,-0.05,0x147cab],
      [0.14,0.04,0x2fadb4],[0.14,0.13,0x173e52],[0.07,0.16,0x182627],[0,0.07,0x202419]]) {
      vertices.push(side*x,0,z);
      new THREE.Color(shade).toArray(colors,colors.length);
    }
    for(let i=1;i<6;i++)indices.push(first,first+i,first+i+1);
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,vertexColors:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.uFlight=time;
    shader.vertexShader='uniform float uFlight;\n'+shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      float phase=instanceMatrix[3].x*2.1;
      float beat=sin(uFlight*25.0+phase)*0.94;
      transformed.y+=abs(position.x)*sin(beat);
      transformed.x*=cos(beat);
      float startled=1.0-smoothstep(2.0,20.0,distance(cameraPosition.xz,instanceMatrix[3].xz));
      transformed += vec3(sin(uFlight*1.3+phase)*0.85,
        0.25*sin(uFlight*2.2+phase)+1.1*startled,0.65*cos(uFlight+phase));
    `);
  };
  const mesh=new THREE.InstancedMesh(geometry,material,64), dummy=new THREE.Object3D();
  for(let i=0;i<mesh.count;i++){
    const s=105+Math.floor(i/8)*610+random()*16, f=road.frameAt(s,{});
    const lateral=(i%2?-1:1)*(f.halfWidth+0.3+random()*2);
    const x=f.x+f.rx*lateral, z=f.z+f.rz*lateral;
    dummy.position.set(x,world.grid.heightAt(x,z)+0.8+random(),z);
    dummy.rotation.y=random()*Math.PI*2;
    dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
  }
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius+=3;
  return mesh;
}

// Dragonflies hold station over the warm puddles, darting a few centimetres
// and snapping their four wings. One instanced draw for the whole swarm.
export function dragonflySwarms(road, world, random, time) {
  const geometry = new THREE.BufferGeometry();
  const vertices = [], colors = [], indices = [];
  const wing = (side, back) => {
    const first = vertices.length / 3;
    const span = back ? 0.34 : 0.42;
    vertices.push(0, 0, 0, side * span, 0.02, back ? 0.08 : -0.1, side * span * 0.92, 0, back ? 0.28 : 0.18);
    for (let i = 0; i < 3; i++) colors.push(0.36, 0.62, 0.7);
    indices.push(first, first + 1, first + 2);
  };
  wing(-1, false); wing(1, false); wing(-1, true); wing(1, true);
  const bodyStart = vertices.length / 3;
  vertices.push(0, 0, -0.22, 0, 0.015, 0.24, 0.025, 0.015, 0.24);
  for (let i = 0; i < 3; i++) colors.push(0.16, 0.45, 0.24);
  indices.push(bodyStart, bodyStart + 1, bodyStart + 2);
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlight = time;
    shader.vertexShader = 'uniform float uFlight;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.9;
      float beat = sin(uFlight * 46.0 + phase);
      transformed.y += abs(position.x) * beat * 0.2;
      transformed += vec3(sin(uFlight * 0.9 + phase) * 0.35, 0.12 * sin(uFlight * 1.7 + phase), cos(uFlight * 1.1 + phase) * 0.3);
    `);
  };
  const spots = [260, 690, 1180, 1420, 1980, 2260, 2580, 3040, 3520, 4080, 4560];
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length * 4);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (const s of spots) {
    for (let k = 0; k < 4; k++) {
      const f = road.frameAt(s + k * 1.4, {});
      const lateral = (k % 2 ? -1 : 1) * (f.halfWidth + 0.7 + random() * 2.6);
      const x = f.x + f.rx * lateral, z = f.z + f.rz * lateral;
      dummy.position.set(x, world.grid.heightAt(x, z) + 0.55 + random() * 0.6, z);
      dummy.rotation.y = random() * Math.PI * 2;
      dummy.scale.setScalar(0.8 + random() * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(index++, dummy.matrix);
    }
  }
  mesh.computeBoundingSphere();
  return mesh;
}
