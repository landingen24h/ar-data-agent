"""Rebuilds film.mp4 from edit.json with ffmpeg only. Usage: python3 render.py [edit.json]"""
import json, subprocess, sys, os, tempfile
E_=json.load(open(sys.argv[1] if len(sys.argv)>1 else 'edit.json'))
W,H,FPS=E_['width'],E_['height'],E_['fps']; ax,ay,aw,ah=E_['crop']['source_active_area']; cw,ch=E_['crop']['crop_w'],E_['crop']['crop_h']
tmp=tempfile.mkdtemp(); parts=[]
for i,c in enumerate(E_['cuts']):
    x=ax+int(round((aw-cw)*c['crop_x']))
    g=(c.get("grade") or "")
    vf=(f"fps={FPS},crop={cw}:{ch}:{x}:{ay},"+(g+"," if g else "")+f"scale={W}:{H}:flags=lanczos,unsharp=5:5:0.4,format=yuv420p")
    p=os.path.join(tmp,f"{i:03d}.mp4"); parts.append(p)
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(c['source_in']),'-i',c['source'],'-an','-vf',vf,'-frames:v',str(c['frames']),
                    '-c:v','libx264','-preset','medium','-crf','14','-r',str(FPS),p],check=True)
lst=os.path.join(tmp,'list.txt'); open(lst,'w').write(''.join(f"file '{p}'\n" for p in parts))
m=E_['music']; dur=m['out']-m['in']; lim=10**(m['limit_dbfs']/20)
af=(f"atrim={m['in']}:{m['out']},asetpts=PTS-STARTPTS,aresample=48000,volume={m['gain_db']}dB,"
    f"alimiter=limit={lim:.4f}:level=false:attack=1:release=50,afade=t=out:st={dur-m['fade_out_s']}:d={m['fade_out_s']},volume=-0.3dB")
subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',lst,'-i',m['source'],'-filter_complex',f"[1:a]{af}[a]",
                '-map','0:v','-map','[a]','-c:v','libx264','-preset','slow','-crf','23','-maxrate','3000k','-bufsize','6000k','-profile:v','high','-pix_fmt','yuv420p','-r',str(FPS),
                '-c:a','aac','-b:a','192k','-ar','48000','-t',str(dur),'-movflags','+faststart',E_['output']],check=True)
print('wrote',E_['output'])
