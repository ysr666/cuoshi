from PIL import Image,ImageDraw
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
out=root/'src/static/tab'
out.mkdir(parents=True,exist_ok=True)
S=4
for kind in ['today','calendar','stats','settings']:
 for active in [False,True]:
  image=Image.new('RGBA',(81*S,81*S),(0,0,0,0))
  dr=ImageDraw.Draw(image)
  color=('#302c27' if active else '#898780')
  color=tuple(bytes.fromhex(color[1:]))+(255,)
  w=4*S
  def L(coords,width=w):dr.line([(int(x*S),int(y*S)) for x,y in coords],fill=color,width=width,joint='curve')
  def box(coords,r=7):dr.rounded_rectangle(tuple(int(v*S) for v in coords),radius=r*S,outline=color,width=w)
  def oval(coords,fill=False):
   dr.ellipse(tuple(int(v*S) for v in coords),fill=color if fill else None,outline=None if fill else color,width=w)
  if kind=='today':
   box((20,17,61,67),5)
   L([(29,32),(50,32)])
   L([(29,43),(53,43)])
   if active:oval((30,53,36,59),True)
   else:L([(29,56),(47,56)])
  if kind=='calendar':
   box((16,23,65,66),6)
   L([(17,36),(65,36)])
   L([(30,16),(30,30)])
   L([(51,16),(51,30)])
   if active:oval((35,44,45,54),True)
   else:box((35,44,45,54),2)
  if kind=='stats':
   L([(20,66),(62,66)])
   box((23,48,30,65),2)
   box((37,34,44,65),2)
   box((51,21,58,65),2)
  if kind=='settings':
   for y,knob in [(25,32),(43,51),(61,36)]:
    L([(18,y),(65,y)],width=3*S)
    oval((knob-6,y-6,knob+6,y+6),fill=True)
    dr.ellipse(tuple(int(v*S) for v in (knob-2.5,y-2.5,knob+2.5,y+2.5)),fill=(255,255,255,255))
  image.resize((81,81),resample=Image.Resampling.LANCZOS).save(out/(kind+('-active' if active else '')+'.png'))
p=root/'src/pages.json'
o=json.loads(p.read_text())
for tab,kind in zip(o['tabBar']['list'],['today','calendar','stats','settings']):
 tab['iconPath']='static/tab/'+kind+'.png'
 tab['selectedIconPath']='static/tab/'+kind+'-active.png'
o['tabBar'].update(color='#898780',selectedColor='#302c27',backgroundColor='#f6f2eb',borderStyle='white')
o['globalStyle']['backgroundColor']='#f6f2eb'
p.write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n')
print('Generated',len(list(out.glob('*.png'))),'retina tab icons and synchronized tabbar configuration')