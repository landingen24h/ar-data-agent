"""Checks film.mp4 against the audition acceptance list. Usage: python3 qc.py"""
import json,subprocess,re
e=json.load(open('edit.json')); b=json.load(open('beats.json'))['beats']
def ff(args): return subprocess.run(['ffmpeg','-hide_banner','-nostats']+args,capture_output=True,text=True).stderr
pr=json.loads(subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json','film.mp4'],capture_output=True,text=True).stdout)
v=[s for s in pr['streams'] if s['codec_type']=='video'][0]
out=[f"format: {v['codec_name']} {v['width']}x{v['height']} {v['r_frame_rate']} fps, {float(pr['format']['duration']):.3f} s, {v.get('nb_frames')} frames"]
log=ff(['-i','film.mp4','-vf','blackdetect=d=0.03:pix_th=0.10,freezedetect=n=0.001:d=0.5','-af','ebur128=peak=true','-f','null','-'])
out.append(f"black segments (>=1 frame, pix_th 0.10): {len(re.findall('black_start',log))}")
out.append(f"frozen segments (>=0.5 s, noise 0.001): {len(re.findall('freeze_start',log))}")
tp=re.findall(r'Peak:\s+(-?[0-9.]+) dBFS',log); out.append(f"true peak: {tp[-1]} dBFS (limit -1.0)")
sc=ff(['-i','film.mp4','-an','-vf','scale=160:-1,scdet=threshold=8,metadata=print:key=lavfi.scd.time','-f','null','-'])
det=[float(x) for x in re.findall(r'lavfi.scd.time=([0-9.]+)',sc)]
planned=[c['timeline_in'] for c in e['cuts'][1:]]
err=[]
for p in planned:
    near=min(det,key=lambda d:abs(d-p)) if det else None
    beat=min(b,key=lambda x:abs(x-p))
    err.append((p,near,round((near-p)*1000) if near is not None else None,round((p-beat)*1000)))
hit=sum(1 for x in err if x[2] is not None and abs(x[2])<=34)
out.append(f"planned cuts found in the film by scene detection (within 1 frame): {hit}/{len(planned)}")
out.append(f"cut to nearest detected beat: max {max(abs(x[3]) for x in err)} ms (frame grid 33 ms)")
open('check.txt','w').write('\n'.join(out)+'\n'); print('\n'.join(out))
