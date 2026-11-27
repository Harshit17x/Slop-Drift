"""Convert the four generated tree plates into mip-safe RGBA game textures."""
from pathlib import Path
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im.thumbnail((1024,1024),Image.Resampling.LANCZOS)
pixels = []
for rgb in im.getdata():
    # The source carries a photographed light backing through its edge pixels.
    # Remove that matte before mip generation so distant crowns have dark edges.
    light = min(rgb)
    alpha = min(1, max(0, (223-light)/70))
    if alpha < .10:
        pixels.append((45,58,35,0))
        continue
    color = [max(0,min(255,round((c-(1-alpha)*248)/alpha))) for c in rgb]
    pixels.append((*color,round(255*alpha)))
out=Image.new("RGBA",im.size)
out.putdata(pixels)
out.save(Path(__file__).resolve().parents[2]/"src/assets/maps/apex-woodland.webp",quality=88,method=3,exact=True)

