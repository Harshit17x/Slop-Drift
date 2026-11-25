"""Bake the hatch's side graphics, wheel-thrown mud and gravel tyre texture tiles."""
from pathlib import Path
import math
import random

from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np


def bake(out):
    rng=random.Random(217)
    w,h=1024,384
    layers=[Image.new('L',(w,h)) for _ in range(4)]
    def pixels(points):
        return [((z+2.3)*w/4.6,(1-y/1.5)*h) for z,y in points]
    red=ImageDraw.Draw(layers[0])
    upper=ImageDraw.Draw(layers[1])
    red.polygon(pixels([(-1.87,.18),(.33,.62),(1.65,1.14),(2.23,.95),(2.23,.16)]),fill=246)
    upper.polygon(pixels([(-.99,.39),(.53,.56),(1.76,.96),(.58,.49)]),fill=244)
    red.polygon(pixels([(-1.44,.77),(-1.04,.76),(.28,.52)]),fill=240)
    dry,clay=[ImageDraw.Draw(layer) for layer in layers[2:]]
    for _ in range(32000):
        z=rng.uniform(-2.31,2.31)
        rearward=max(math.exp(-((z-axle-.36)/.43)**2) for axle in [-1.28,1.27])
        y=.11+abs(rng.gauss(0,.077+rearward*.135))
        x0,y0=pixels([(z,y)])[0]
        r=rng.uniform(.4,2.15)*(1.2 if y<.30 else .72)
        stretch=r*(1+rng.random()*2.3)
        strength=rng.randrange(62,229)
        brush=clay if rng.random()<.4 else dry
        brush.ellipse([x0-stretch,y0-r,x0+stretch,y0+r],fill=strength)
    Image.merge('RGB',(layers[0],layers[1],ImageChops.lighter(layers[2],layers[3]))).save(out/'rally-livery.png',optimize=True)
    # U wraps the circumference, V runs from one bead over the tread to the other.
    w,h=512,128
    y,x=np.mgrid[:h,:w]
    u,v=x/w,y/h
    crown=np.exp(-((v-.5)/.26)**4)
    zig=(u*32+np.abs(v-.5)*3.8)%1
    blocks=(zig>.17)&(zig<.84)&(np.cos(v*math.tau*6)<.84)
    coarse=np.sin(2*np.pi*(u*7+v*3))*.15 + np.cos(2*np.pi*(u*11-v*2))*.13
    noise=np.random.default_rng(27).uniform(0,1,(h,w))
    mud=np.clip((coarse+.58*noise-.17)*1.65,0,1)*(.72-.41*crown*blocks)
    base=np.array([50,49,47])+(crown*blocks*12)[:,:,None]
    rgb=base*(1-mud[:,:,None])+np.array([135,97,61])*mud[:,:,None]
    Image.fromarray(rgb.astype('uint8')).save(out/'rally-tyre.png')
    height=Image.fromarray((blocks*crown*175+noise*19).astype('uint8')).filter(ImageFilter.GaussianBlur(1))
    field=np.asarray(height,dtype=float)/255
    normal=np.stack([np.roll(field,1,1)-np.roll(field,-1,1),np.roll(field,1,0)-np.roll(field,-1,0),np.full_like(field,.54)],2)
    normal/=np.linalg.norm(normal,axis=2)[:,:,None]
    Image.fromarray(((normal*.5+.5)*255).astype('uint8')).save(out/'rally-tyre-normal.png')


if __name__=='__main__':
    bake(Path(__file__).resolve().parents[3]/'src/assets/cars')
