# Step 1: find the sea horizon in every frame (signed vertical edge, searched near last frame's line, RANSAC line fit).
import cv2,numpy as np,json
cap=cv2.VideoCapture('before.mp4'); F=[]
while True:
  ok,f=cap.read()
  if not ok: break
  F.append(f)
F=np.array(F); np.save('/tmp/frames.npy',F); res=[]; m,c=0.0,272.0
rng=np.random.default_rng(0)
for i,f in enumerate(F):
  g=cv2.GaussianBlur(cv2.cvtColor(f,cv2.COLOR_BGR2GRAY).astype(np.float32),(0,0),1.5)
  gy=-cv2.Sobel(g,cv2.CV_32F,0,1,ksize=5)
  pts=[]
  for x in range(8,1280,16):
    yc=m*x+c; y0=int(max(0,yc-30)); y1=int(min(719,yc+30))
    col=gy[y0:y1,x-4:x+4].mean(axis=1)
    if g[y0:y1,x].min()<70: continue  # post in column
    y=int(np.argmax(col))+y0; pts.append((x,y))
  pts=np.array(pts,float); best=None
  for _ in range(400):
    a,b=pts[rng.choice(len(pts),2,replace=False)]
    if a[0]==b[0]:continue
    mm=(b[1]-a[1])/(b[0]-a[0]); cc=a[1]-mm*a[0]
    inl=np.abs(pts[:,1]-(mm*pts[:,0]+cc))<2
    if best is None or inl.sum()>best[0]: best=(inl.sum(),inl)
  inl=best[1]; m,c=np.polyfit(pts[inl,0],pts[inl,1],1)
  res.append((i,float(m),float(c),int(inl.sum()),len(pts)))
json.dump(res,open('horizon_raw.json','w'))
for r in res[::6]: print(r[0],round(np.degrees(np.arctan(r[1])),2),round(r[2]+r[1]*640,1),r[3],r[4])
