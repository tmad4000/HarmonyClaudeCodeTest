from PIL import Image, ImageDraw
from pathlib import Path
# Same restrained indigo accent as the approved Harmony web UI.
im=Image.new('RGB',(1024,1024),'#101218');d=ImageDraw.Draw(im)
import math
for offset,color in [(-155,'#6579df'),(0,'#b5c0ff'),(155,'#6579df')]:
 points=[(x,512+offset+int(65*math.sin((x-150)/724*math.pi*4))) for x in range(150,875)]
 d.line(points,fill=color,width=28)
im.save(Path(__file__).resolve().parents[1]/'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
