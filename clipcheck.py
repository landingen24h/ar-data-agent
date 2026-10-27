# Fraction of luma pixels at the limited-range floor (<=16) or ceiling (>=235), every 15th frame.
import subprocess, numpy as np, sys
W,H=1280,720
for f in ('before.mp4','after.mp4'):
    raw=subprocess.run(['ffmpeg','-v','error','-i',f,'-vf',"select='not(mod(n,15))'",'-vsync','0','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
    y=np.frombuffer(raw,np.uint8).reshape(-1,H,W)
    print(f,'frames sampled',len(y),'crushed(<=16) %.3f%%'%(100*(y<=16).mean()),'clipped(>=235) %.3f%%'%(100*(y>=235).mean()),
          'p1 %d p99 %d'%(np.percentile(y,1),np.percentile(y,99)))
