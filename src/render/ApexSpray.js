import * as T from 'three';
// Short-lived wheel spray; a single bounded point buffer serves the whole grid.
export class ApexSpray{
  constructor(scene){
    this.offset=new T.Vector3();this.count=160;this.pos=new Float32Array(this.count*3);this.age=new Float32Array(this.count).fill(2);this.cursor=0;this.clock=0;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(this.pos,3).setUsage(T.DynamicDrawUsage));g.setAttribute('age',new T.BufferAttribute(this.age,1).setUsage(T.DynamicDrawUsage));
    this.mesh=new T.Points(g,new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{intensity:{value:0}},vertexShader:`
      attribute float age; varying float fade;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.);fade=max(0.,1.-age);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.6+3.*age)*290./max(1.,-mv.z),1.,80.);}
    `,fragmentShader:`varying float fade; uniform float intensity;void main(){float a=max(0.,1.-length(gl_PointCoord-.5)*2.);gl_FragColor=vec4(.72,.77,.78,a*a*fade*intensity*.19);}`}));
    this.mesh.frustumCulled=false;scene.add(this.mesh);
  }
  update(dt,wet,player,grid){
    this.mesh.visible=wet>.12;this.mesh.material.uniforms.intensity.value=wet;if(!this.mesh.visible)return;
    for(let i=0;i<this.count;i++){this.age[i]+=dt;this.pos[i*3+1]+=dt*1.45;}
    this.clock+=dt;
    if(this.clock>.065){
      this.clock=0;
      const emit=(p,q,speed)=>{if(speed<6)return;const width=1.5+Math.sin(this.cursor*5.7)*.42;
        for(const side of [-1,1]){const i=this.cursor++%this.count,off=this.offset.set(side*width,.22,2.8).applyQuaternion(q);
          this.pos.set([p.x+off.x,p.y+off.y,p.z+off.z],i*3);this.age[i]=.03;}};
      emit(player.position,player.quaternion,player.speed);
      for(const b of grid)if(b.car.visible)emit(b.car.position,b.car.quaternion,b.speed);
    }
    for(const attr of Object.values(this.mesh.geometry.attributes))attr.needsUpdate=true;
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}

