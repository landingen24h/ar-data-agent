#!/bin/sh
# Re-applies look.cube to before.mp4 and compares with after.mp4; reports black/white clipping per clip.
set -e
ffmpeg -v error -y -i before.mp4 -vf "lut3d=file=look.cube:interp=tetrahedral,format=yuv420p" -c:v libx264 -crf 21 -preset slow /tmp/relut.mp4
echo "PSNR after.mp4 vs before.mp4+look.cube:"; ffmpeg -i after.mp4 -i /tmp/relut.mp4 -lavfi psnr -f null - 2>&1 | grep -o "average:[0-9.inf]*"
echo "SSIM:"; ffmpeg -i after.mp4 -i /tmp/relut.mp4 -lavfi ssim -f null - 2>&1 | grep -o "All:[0-9.]*"
for f in before.mp4 after.mp4; do
  echo "$f luma stats (YMIN/YMAX lowest/highest over frames, mean YAVG):"
  ffmpeg -i $f -vf signalstats,metadata=print:file=/tmp/st.txt -f null - 2>/dev/null
  python3 - <<'PY'
import re
v={'YMIN':[],'YMAX':[],'YAVG':[],'UAVG':[],'VAVG':[]}
for l in open('/tmp/st.txt'):
    m=re.search(r'lavfi\.signalstats\.(YMIN|YMAX|YAVG|UAVG|VAVG)=([\d.]+)',l)
    if m: v[m.group(1)].append(float(m.group(2)))
avg=v['YAVG']; n=len(avg)
print(' frames',n,'YMIN min',min(v['YMIN']),'YMAX max',max(v['YMAX']),'YAVG mean %.1f'%(sum(avg)/n),
      'YAVG per second range %.1f-%.1f'%(min(sum(avg[i:i+30])/30 for i in range(0,n-29,30)),max(sum(avg[i:i+30])/30 for i in range(0,n-29,30))),
      'U/V mean %.1f/%.1f'%(sum(v['UAVG'])/n,sum(v['VAVG'])/n))
PY
done
