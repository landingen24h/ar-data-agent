"""Beat tracking with numpy only: spectral-flux onset envelope, tempo by autocorrelation, beat grid by dynamic programming (Ellis 2007)."""
import numpy as np, subprocess, json, sys
SR=22050; HOP=256
def load(path):
    raw=subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(raw,np.float32)
def onset_env(x):
    n=1024; w=np.hanning(n)
    fr=np.lib.stride_tricks.sliding_window_view(x,n)[::HOP]*w
    S=np.log1p(100*np.abs(np.fft.rfft(fr,axis=1)))
    f=np.maximum(0,np.diff(S,axis=0)).sum(1)
    f=np.concatenate([[0],f]); f-=np.convolve(f,np.ones(16)/16,'same'); f=np.maximum(f,0)
    return f/(f.std()+1e-9)
def tempo(env,lo=60,hi=180):
    fps=SR/HOP; ac=np.correlate(env,env,'full')[len(env)-1:]
    lags=np.arange(len(ac)); bpm=60*fps/np.maximum(lags,1)
    wgt=np.exp(-0.5*(np.log2(bpm/110))**2/0.9**2)
    m=(bpm>=lo)&(bpm<=hi); sc=np.where(m,ac*wgt,0)
    L=int(np.argmax(sc)); return 60*fps/L, L
def track(env,period,tight=100):
    N=len(env); score=env.copy(); back=np.full(N,-1)
    for i in range(N):
        a,b=i-int(2*period),i-int(period/2)
        if b<=0: continue
        a=max(a,0); prev=np.arange(a,b)
        pen=-tight*np.log((i-prev)/period)**2
        c=score[prev]+pen; k=int(np.argmax(c)); score[i]=env[i]+c[k]; back[i]=prev[k]
    i=int(np.argmax(score[-int(2*period):]))+N-int(2*period); out=[]
    while i>=0: out.append(i); i=back[i]
    return np.array(out[::-1])
if __name__=='__main__':
    x=load(sys.argv[1]); env=onset_env(x); fps=SR/HOP
    bpm,L=tempo(env); b=track(env,L)
    times=(b*HOP/SR).round(4).tolist()
    ibi=np.diff(times)
    json.dump({'bpm':round(bpm,2),'beats':times},open(sys.argv[2],'w'))
    print('bpm',round(bpm,2),'beats',len(times),'ibi mean',ibi.mean().round(4),'sd',ibi.std().round(4))
