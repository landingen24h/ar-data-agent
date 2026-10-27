# Step 3: composite the title on the horizon, behind posts and walkers, coloured by the haze behind it.
# Integrated title: NORTH SEA standing on the sea horizon, behind the posts and the walkers.
import cv2,numpy as np,json,subprocess
F=np.load('/tmp/frames.npy'); N=len(F)
H=json.load(open('horizon_raw.json')); P=json.load(open('pan.json'))
m=np.array([h[1] for h in H]); c=np.array([h[2] for h in H]); cum=np.array(P['cum'])
def smooth(a,k=1):
  # centred window that shrinks at the ends, so it never lags the camera
  b=a.copy()
  for i in range(N):
    r=min(k,i,N-1-i); b[i]=a[i-r:i+r+1].mean()
  return b
yc=c+m*640; m=smooth(m,2); yc=smooth(yc,1); c=yc-m*640; cum=smooth(cum,1)
TEXT='NORTH SEA'; S=4  # render at 4x for clean edges
font=cv2.FONT_HERSHEY_DUPLEX; scale=2.4*S; th=int(5*S)
(tw,tht),base=cv2.getTextSize(TEXT,font,scale,th)
pad=20*S; mask=np.zeros((tht+2*pad,tw+2*pad),np.uint8)
cv2.putText(mask,TEXT,(pad,pad+tht),font,scale,255,th,cv2.LINE_AA)
mask=cv2.resize(mask,(mask.shape[1]//S,mask.shape[0]//S),interpolation=cv2.INTER_AREA).astype(np.float32)/255
mh,mw=mask.shape; base_y=float(np.nonzero(mask.max(axis=1)>0.5)[0].max())  # lowest solid row of the letters
X0=700.0  # screen x of title left edge at frame 0
rng=np.random.default_rng(7)
def place(i):
  ang=np.degrees(np.arctan(m[i])); x=X0+cum[i]; hy=c[i]+m[i]*(x+mw/2)
  M=cv2.getRotationMatrix2D((mw/2,base_y),-ang,1.0); M[0,2]+=x; M[1,2]+=hy+12-base_y
  return cv2.warpAffine(mask,M,(1280,720),flags=cv2.INTER_LINEAR)
HAZE=[]
for i in range(N):
  a=place(i); g=cv2.cvtColor(F[i],cv2.COLOR_BGR2GRAY)
  sel=(a>0.05)&(g>0.75*np.median(g[a>0.05]))
  HAZE.append(F[i][sel].astype(np.float32).mean(axis=0))
HAZE=np.array(HAZE); HAZE=np.array([HAZE[max(0,i-6):i+7].mean(axis=0) for i in range(N)])
out=[]; touched=[]
for i in range(N):
  f=F[i].astype(np.float32)
  ang=np.degrees(np.arctan(m[i])); x=X0+cum[i]
  hy=c[i]+m[i]*(x+mw/2)
  # affine: rotate mask about its baseline point, place baseline 1 px above horizon
  M=cv2.getRotationMatrix2D((mw/2,base_y),-ang,1.0)
  M[0,2]+=x; M[1,2]+=hy+12-base_y
  a=cv2.warpAffine(mask,M,(1280,720),flags=cv2.INTER_LINEAR)
  if a.max()<=0: out.append(F[i]); continue
  # lit like the scene: letter colour comes from the haze just above the horizon behind it
  g=cv2.cvtColor(F[i],cv2.COLOR_BGR2GRAY).astype(np.float32)
  bgblur=cv2.GaussianBlur(f,(0,0),12)
  haze=HAZE[i]
  rows=np.arange(720,dtype=np.float32)[:,None]
  hyline=c[i]+m[i]*np.arange(1280,dtype=np.float32)[None,:]
  grad=np.clip((hyline-rows)/60.0,0,1)[:,:,None]   # 0 at horizon, 1 at letter tops
  col=haze*0.80*(0.92+0.14*grad)  # distant mass a bit darker than haze, brighter toward the top (sun from above)
  # occlusion: dark foreground (posts, walkers) stays in front
  hl=float(cv2.cvtColor(haze.reshape(1,1,3).astype(np.uint8),cv2.COLOR_BGR2GRAY)[0,0]); lo,hi=0.30*hl,0.52*hl
  occ=np.clip((g-lo)/(hi-lo),0,1); occ=occ*occ*(3-2*occ)
  occ=cv2.GaussianBlur(occ,(0,0),0.6)
  above=np.clip(hyline+2.5-rows,0,1)  # the sea horizon hides the foot of the letters
  a2=cv2.GaussianBlur(a,(0,0),0.7)*0.92*occ*above
  touched.append(int((a2>0).sum()))
  grain=rng.normal(0,2.2,(720,1280,1)).astype(np.float32)
  comp=f*(1-a2[:,:,None])+(col+grain)*a2[:,:,None]
  out.append(np.clip(comp+0.5,0,255).astype(np.uint8))
p=subprocess.Popen(['ffmpeg','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1280x720','-r','25','-i','-','-c:v','libx264','-crf','26','-preset','veryslow','-pix_fmt','yuv420p','after.mp4'],stdin=subprocess.PIPE)
for o in out: p.stdin.write(o.tobytes())
p.stdin.close(); p.wait()
np.save('/tmp/after.npy',np.array(out))
print('title box',mw,mh,'max pixels touched per frame',max(touched),'of',1280*720)
