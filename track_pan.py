# Step 2: camera pan from the clouds (Lucas Kanade on sky corners above the horizon, dark posts masked out).
import cv2,numpy as np,json
F=np.load('/tmp/frames.npy'); H=json.load(open('horizon_raw.json'))
G=[cv2.cvtColor(f,cv2.COLOR_BGR2GRAY) for f in F]
dx=[0.0];dy=[0.0];nfeat=[]
for i in range(1,len(F)):
  _,m,c,_,_=H[i-1]
  mask=np.zeros((720,1280),np.uint8)
  for x in range(0,1280,8): mask[:max(0,int(m*x+c)-15),x:x+8]=255
  mask[G[i-1]<90]=0
  mask=cv2.erode(mask,np.ones((15,15),np.uint8))
  p=cv2.goodFeaturesToTrack(G[i-1],400,0.005,10,mask=mask,blockSize=9)
  q,st,_=cv2.calcOpticalFlowPyrLK(G[i-1],G[i],p,None,winSize=(31,31),maxLevel=3)
  ok=st[:,0]==1; d=(q-p)[ok,0]
  med=np.median(d,axis=0); keep=np.linalg.norm(d-med,axis=1)<1.0
  mv=d[keep].mean(axis=0) if keep.sum()>=20 else np.array([dx[-1],dy[-1]]); dx.append(float(mv[0])); dy.append(float(mv[1])); nfeat.append(int(keep.sum()))
cum=np.cumsum(dx); cumy=np.cumsum(dy)
json.dump({'dx':dx,'dy':dy,'cum':cum.tolist(),'cumy':cumy.tolist()},open('pan.json','w'))
print('feat min/med',min(nfeat),int(np.median(nfeat)))
hz=[h[2]+h[1]*640 for h in H]
for i in range(0,150,10): print(i,round(cum[i],1),round(cumy[i],1),'hz',round(hz[i]-hz[0],1))
