"""
Shrink the textures embedded in a GLB without touching its geometry, node names or materials:
images larger than MAX px are downsized, opaque ones re-encoded as JPEG (core glTF, no extension
needed), ones with real alpha kept as optimised PNG. Usage: python3 tools/shrink_glb_textures.py in.glb [out.glb]
"""
import io
import json
import struct
import sys

from PIL import Image

MAX = 1024
JPEG_QUALITY = 88


def read_glb(path):
    raw = open(path, 'rb').read()
    magic, _version, _length = struct.unpack_from('<III', raw, 0)
    assert magic == 0x46546C67, 'not a GLB'
    jlen, jtype = struct.unpack_from('<II', raw, 12)
    doc = json.loads(raw[20:20 + jlen])
    off = 20 + jlen
    blen, _btype = struct.unpack_from('<II', raw, off)
    return doc, raw[off + 8:off + 8 + blen]


def write_glb(path, doc, binary):
    j = json.dumps(doc, separators=(',', ':')).encode()
    j += b' ' * (-len(j) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(j) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A) + j)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)


def shrink(data, mime):
    im = Image.open(io.BytesIO(data))
    im.load()
    if max(im.size) > MAX:
        k = MAX / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    has_alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 255
    out = io.BytesIO()
    if has_alpha:
        im.convert('RGBA').save(out, 'PNG', optimize=True)
        new = (out.getvalue(), 'image/png')
    else:
        im.convert('RGB').save(out, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        new = (out.getvalue(), 'image/jpeg')
    return new if len(new[0]) < len(data) else (data, mime)


def main(src, dst):
    doc, binary = read_glb(src)
    views = doc['bufferViews']
    replaced = {}
    for img in doc.get('images', []):
        if 'bufferView' not in img:
            continue
        v = views[img['bufferView']]
        data = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        new, mime = shrink(data, img.get('mimeType', 'image/png'))
        replaced[img['bufferView']] = new
        img['mimeType'] = mime
    out = bytearray()
    for i, v in enumerate(views):
        data = replaced.get(i) or binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(data)
        out += data
    doc['buffers'][0]['byteLength'] = len(out) + (-len(out) % 4)
    write_glb(dst, doc, bytes(out))
    return len(binary), len(out)


if __name__ == '__main__':
    before, after = main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
    print(f'{sys.argv[1]}: {before // 1024} KB -> {after // 1024} KB')
