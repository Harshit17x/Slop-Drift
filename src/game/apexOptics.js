import {Vector2} from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

// Allocate the extra depth and colour buffers only when the photographer requests them.
export function photoOptics(game,camera) {
  const composer=new EffectComposer(game.renderer), render=new RenderPass(game.scene,camera);
  const bokeh=new BokehPass(game.scene,camera,{focus:20,aperture:.00006,maxblur:.008}),output=new OutputPass();
  composer.addPass(render);composer.addPass(bokeh);composer.addPass(output);
  const size=new Vector2();let width=0,height=0,ratio=0;
  return {
    render(cam,aperture,focus) {
      game.renderer.getSize(size);
      const nextRatio=game.renderer.getPixelRatio();
      if(width!==size.x || height!==size.y || ratio!==nextRatio){
        width=size.x;height=size.y;ratio=nextRatio;composer.setPixelRatio(ratio);composer.setSize(width,height);
      }
      render.camera=bokeh.camera=cam;
      bokeh.uniforms.aspect.value=cam.aspect;bokeh.uniforms.focus.value=Math.max(1,focus);bokeh.uniforms.aperture.value=aperture;
      composer.render();
    },
    dispose(){bokeh.dispose();output.dispose();composer.dispose();}
  };
}
