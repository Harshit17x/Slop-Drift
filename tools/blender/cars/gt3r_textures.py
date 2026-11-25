"""Bake a race skin into the original scan UVs; build seamless slick and cockpit maps."""
from pathlib import Path
import argparse
import io
import json
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def font(size):
    for path in ['C:/Windows/Fonts/arialbd.ttf', 'DejaVuSans-Bold.ttf']:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def bake(source, out):
    out.mkdir(parents=True, exist_ok=True)
    raw = source.read_bytes()
    n = struct.unpack_from('<I', raw, 12)[0]
    doc, data = json.loads(raw[20:20+n]), memoryview(raw)[28+n:]

    def view(index):
        v = doc['bufferViews'][index]
        offset = v.get('byteOffset', 0)
        return data[offset:offset+v['byteLength']]

    def attribute(index, components):
        a = doc['accessors'][index]
        dtype = {5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]
        return np.frombuffer(view(a['bufferView']), dtype, a['count']*components,
                             a.get('byteOffset', 0)).reshape(-1, components)

    p = doc['meshes'][0]['primitives'][0]
    pos = attribute(p['attributes']['POSITION'], 3)
    uv = attribute(p['attributes']['TEXCOORD_0'], 2)
    tris = attribute(p['indices'], 1).reshape(-1, 3)
    body = doc['materials'][p['material']]
    tex = body['pbrMetallicRoughness']['baseColorTexture']['index']
    source_img = doc['images'][doc['textures'][tex]['source']]
    atlas = np.array(Image.open(io.BytesIO(view(source_img['bufferView']))).convert('RGBA'))
    height, width = atlas.shape[:2]
    uv = uv * [width, height]
    for ids in tris:
        pts = pos[ids]
        a,b,c = uv[ids]
        lo = np.maximum(0, np.floor(np.minimum(np.minimum(a,b),c)).astype(int))
        hi = np.minimum([width,height], np.ceil(np.maximum(np.maximum(a,b),c)).astype(int)+1)
        if np.any(hi<=lo):
            continue
        y,x = np.mgrid[lo[1]:hi[1],lo[0]:hi[0]]
        x = x+.5-a[0]; y = y+.5-a[1]
        ab, ac = b-a, c-a
        det = ab[0]*ac[1]-ab[1]*ac[0]
        if abs(det)<1e-5:
            continue
        s = (x*ac[1]-y*ac[0])/det
        t = (ab[0]*y-ab[1]*x)/det
        world = pts[0]+s[:,:,None]*(pts[1]-pts[0])+t[:,:,None]*(pts[2]-pts[0])
        xx, yy, zz = world.transpose(2,0,1)
        section = np.s_[lo[1]:hi[1],lo[0]:hi[0]]
        dst = atlas[section]
        # Repaint the scan in chassis space. The original road-car atlas has baked
        # highlights and shadows that would otherwise fight the movable race lighting.
        inside = (s>=-.007)&(t>=-.007)&(s+t<=1.007)
        ax = np.abs(xx)
        wheel = np.minimum(np.hypot(zz+1.12,yy-.335),np.hypot(zz-1.125,yy-.335))
        panel = inside & (yy>.156) & ((ax>.57)|(yy>.48)) & ~((wheel<.345)&(ax>.63))
        # Retain recessed nose/tail openings and the longitudinal lower sills.
        panel &= ~((zz< -1.68)&(yy<.48)) & ~((zz>1.64)&(yy<.66))
        # Smooth glass cut lines follow the rake of the stamped roof and pillars.
        wind = (zz>-.70+.31*ax**2)&(zz<-.115+.14*ax**2)&(ax<.635-.13*(zz+.7))&(yy>.854)
        sideglass = (ax>.575) & (zz>-.48+(yy-.845)*1.42)&(zz<1.13-(yy-.845)*1.9)&(yy>.844)&(yy<1.177-.40*np.maximum(ax-.57,0))
        back = (zz>.63+.18*ax**2)&(zz<1.45-.28*ax**2)&(ax<.615)&(yy>.867)
        glass = panel & (wind|sideglass|back)
        # Body RGB stores neutral unlit albedo, alpha enables the garage's paint.
        dst[panel] = [222,222,219,255]
        dst[glass] = [26,38,45,0]
        pillar = glass & sideglass & (zz>.236)&(zz<.278)
        dst[pillar] = [34,36,37,0]
        edge = .37+.34*(zz+.23)
        active = panel & ~glass & (ax>.655) & (yy<edge) & (yy>.15) & (zz>-.98)
        dst[active] = [12,91,94,0]
        dst[active & (yy>edge-.021)] = [219,64,40,0]
    Image.fromarray(atlas).save(out/'race-skin.png')
    rng = np.random.default_rng(992)
    h,w=256,1024
    y,x=np.mgrid[:h,:w]
    u,v=x/w,y/h
    shoulder=np.clip((np.abs(v-.50)-.17)*4,0,1)
    grain=rng.normal(0,1,(h,w))
    scrub=2.2*np.sin(2*np.pi*(v*61+0.20*np.sin(2*np.pi*u*5)))+grain*4
    marbles=np.maximum(0,grain-1.5)*shoulder
    rgb=np.clip(45+scrub+7*marbles,21,81)
    tyre=Image.fromarray(np.stack([rgb+1,rgb,rgb-1],axis=2).astype('uint8'))
    d=ImageDraw.Draw(tyre)
    for line in [16,23,232,239]:
        d.line((0,line,w,line),fill=(63,61,57))
    for x0 in [42,553]:
        d.text((x0,24),'RACING   •   SLICK',font=font(15),fill=(173,159,122))
        d.rectangle((x0+164,28,x0+193,32), fill=(181,145,63))
    for suffix,size in [('front','30 / 68 - 18'),('rear','31 / 71 - 18')]:
        side=tyre.copy()
        ImageDraw.Draw(side).text((317,26),size,font=font(12),fill=(126,122,112))
        side.save(out/f'slick-{suffix}.png')
    def normal(height, strength, name):
        dx=(np.roll(height,1,1)-np.roll(height,-1,1))*strength
        dy=(np.roll(height,1,0)-np.roll(height,-1,0))*strength
        n=np.stack([dx,dy,np.ones_like(dx)],axis=2)
        n/=np.linalg.norm(n,axis=2)[:,:,None]
        Image.fromarray(((n*.5+.5)*255).astype('uint8')).save(out/name)
    normal(scrub+marbles*7,.014,'rubber-normal.png')
    Image.fromarray(np.clip(199+scrub*2-23*marbles,120,238).astype('uint8')).save(out/'slick-rough.png')
    y,x=np.mgrid[:128,:128]
    weave=np.sin((x+y)*np.pi/4)*np.cos((x-y)*np.pi/8)
    fibres=weave*8+rng.normal(0,2,weave.shape)
    Image.fromarray(np.clip(54+fibres,30,78).astype('uint8')).save(out/'twill.png')
    normal(fibres,.026,'twill-normal.png')
    number=Image.new('RGB',(384,256),(235,237,229))
    d=ImageDraw.Draw(number)
    d.rectangle((0,0,384,40),fill=(9,75,77))
    d.text((192,21),'GT   /   ENDURANCE',anchor='mm',font=font(24),fill='white')
    d.text((192,144),'92',anchor='mm',font=font(203),fill=(17,21,24))
    number.save(out/'roundel.png')


if __name__=='__main__':
    args=argparse.ArgumentParser()
    args.add_argument('source',type=Path)
    args.add_argument('output',type=Path)
    a=args.parse_args()
    bake(a.source,a.output)
