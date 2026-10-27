"""Writes edit.json: picks shots from Manhatta (1921) and snaps every cut to a detected beat of the Maple Leaf Rag (Joplin 1916 roll)."""
import json
beats=json.load(open('beats.json'))['beats']
FPS=30
# (label, source in seconds, length in beats, crop x position 0..1)
plan=[
 ("sun over the harbour at dawn",585.0,8,0.5),
 ("waterfront seen from the water",17.5,4,0.5),
 ("ferry docks, crowd waiting",50.0,4,0.5),
 ("ferry gangway opens",72.0,4,0.5),
 ("commuters pour out",88.0,4,0.5),
 ("crowd on the ramp",97.0,2,0.5),
 ("crowd crosses the street",102.0,2,0.5),
 ("churchyard from above",110.0,4,0.5),
 ("walkers under a facade",125.0,4,0.6),
 ("chimneys start smoking",283.0,4,0.4),
 ("steam over the rooftops",254.0,4,0.5),
 ("smoke clouds",344.0,2,0.5),
 ("locomotive",355.0,2,0.45),
 ("crane lifts a girder",201.0,4,0.5),
 ("workers on the site",184.5,2,0.5),
 ("steam shovel at work",190.0,2,0.3),
 ("tugboat sets out",384.0,4,0.6),
 ("tug passes a liner",401.0,4,0.3),
 ("steamship smoke",448.0,4,0.5),
 ("bridge cables",484.0,4,0.5),
 ("street canyon from above",548.0,4,0.5),
 ("streetcars from above",558.0,4,0.5),
 ("streetcar and crowd",567.6,2,0.5),
 ("city panorama",152.0,4,0.5),
 ("skyline behind the Brooklyn Bridge",33.2,8,0.5),
]
# per shot levels for the one hazy shot (ffmpeg eq)
GRADE={"skyline behind the Brooklyn Bridge":"eq=contrast=1.45:brightness=-0.07:gamma=0.95"}
k=0; cuts=[]
for lab,src_in,nb,cx in plan:
    t0=round(beats[k]*FPS) if k else 0
    t1=round(beats[k+nb]*FPS)
    n=t1-t0
    cuts.append({"label":lab,"source":"src/manhatta_1921.webm","source_in":src_in,"source_out":round(src_in+n/FPS,3),
                 "timeline_in":round(t0/FPS,3),"timeline_out":round(t1/FPS,3),"frames":n,"beats":nb,"crop_x":cx,"grade":GRADE.get(lab,""),
                 "cut_on_beat_s":round(beats[k],4) if k else None})
    k+=nb
end=cuts[-1]["timeline_out"]
json.dump({"output":"film.mp4","width":1080,"height":1920,"fps":FPS,
 "music":{"source":"src/maple_leaf_rag_joplin_1916.ogg","in":0.0,"out":end,"gain_db":4.5,"limit_dbfs":-1.5,"fade_out_s":2.0},
 "crop":{"source_active_area":[10,0,944,720],"crop_w":405,"crop_h":720},
 "cuts":cuts},open('edit.json','w'),indent=1)
print(len(cuts),'cuts, duration',end,'s, beats used',k)
