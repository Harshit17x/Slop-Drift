import {Color,MathUtils,Vector3} from 'three';
import {resolveAtmospherePreset} from '../render/Atmosphere.js';

const sequence=['day','sunset','night','dawn'];
const lights={day:1.2,sunset:.46,night:.09,dawn:.70};
const tints={day:0xb6c9d6,sunset:0xa09187,night:0x172233,dawn:0xb4a4a7};
const a=new Color(),b=new Color(),direction=new Vector3();
function bearing(azimuth,elevation,out){
  const az=MathUtils.degToRad(azimuth),el=MathUtils.degToRad(elevation);
  return out.set(Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el));
}
export function daylight(meeting,elapsed){
  const g=meeting.g,sky=g.atmosphere,stage=Math.floor(elapsed/150)%4,key=sequence[stage],next=sequence[(stage+1)%4];
  if(stage!==meeting.clockStage){meeting.clockStage=stage;meeting.setLight(key);}
  const blend=MathUtils.smoothstep(elapsed%150,94,150),from=sky.preset,to=resolveAtmospherePreset(next,'apex');
  const lerp=(x,y)=>MathUtils.lerp(x,y,blend);
  if(blend){
    meeting.lightBlended=true;
    const uniforms=sky.sky.material.uniforms;
    for(const [uniform,property] of [['rayleigh','rayleigh'],['mieCoefficient','mie'],['turbidity','turbidity'],['mieDirectionalG','mieG']])uniforms[uniform].value=lerp(from[property],to[property]);
    bearing(from.azimuth,from.lightElevation,sky.sunDirection).lerp(bearing(to.azimuth,to.lightElevation,direction),blend).normalize();
    bearing(from.azimuth+(from.moon?180:0),from.skyElevation,uniforms.sunPosition.value)
      .lerp(bearing(to.azimuth+(to.moon?180:0),to.skyElevation,direction),blend).normalize();
    const color=(target,x,y)=>target.copy(a.setHex(x)).lerp(b.setHex(y),blend);
    color(sky.sun.color,from.sun,to.sun);color(sky.hemisphere.color,from.hemiSky,to.hemiSky);
    color(sky.hemisphere.groundColor,from.hemiGround,to.hemiGround);
    sky.hemisphere.intensity=lerp(from.hemiIntensity,to.hemiIntensity);
    sky.stars.material.opacity=lerp(from.stars,to.stars);sky.stars.visible=sky.stars.material.opacity>.02;
    sky.fog.color.copy(sky.fogColor).lerp(b.setHex(tints[next]),blend);
    sky.scene.environmentIntensity=lerp(from.envIntensity,to.envIntensity);
    g.scenery.skyLight=lerp(lights[key],lights[next]);
  }
  return lerp(from.sunIntensity,to.sunIntensity);
}
