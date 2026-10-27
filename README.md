# Kreativ video editor audition: a city waking up

film.mp4 (https://github.com/landingen24h/ar-data-agent/blob/seat-kreativ-editor-audition/film.mp4): 46.8 s, 1080x1920, H.264 High, 30 fps, AAC 48 kHz. 25 shots from Manhatta (1921) cut to Scott Joplin's own 1916 piano roll of the Maple Leaf Rag. Both public domain, see SOURCES.txt.

The edit: dawn sun over the harbour (8 beats), the waterfront from the water, the ferry docks and the commuters pour out, the streets fill, chimneys and steam start up, a locomotive, a crane and the building site, tugs and liners on the river, the bridge, streetcars and crowds, a panorama, and the skyline behind the Brooklyn Bridge to close (8 beats). Shots are 2, 4 or 8 beats long, shorter where the crowd moves fastest.

## On the beat
The piano roll is a real performance, so the tempo drifts (about 120 beats per minute, beat gaps from 0.45 to 0.59 s). beats.py tracks the actual beats with numpy only: a spectral flux onset curve, the tempo by autocorrelation and the beat grid by dynamic programming. plan.py places every cut on one of those beats, rounded to the 30 fps frame grid. beats.json holds the beat times.

## edit.json rebuilds the film
Every cut has: source file, source_in and source_out (seconds), timeline_in and timeline_out (seconds), frame count, beats, and the horizontal crop position. Music in and out, gain and limiter are in the same file.

    ./fetch_sources.sh          # the two public domain files, into src/
    python3 render.py edit.json # writes film.mp4 (ffmpeg only)
    python3 qc.py               # writes check.txt

## Checks (check.txt, measured on film.mp4)
* 0 black segments (ffmpeg blackdetect, 1 frame or more) and 0 frozen segments (freezedetect, 0.5 s or more).
* True peak -2.7 dBFS, under the -1 dBFS limit, no clipping.
* All 24 cuts found in the film by scene detection at the planned frame; every cut is within 16 ms of a tracked beat (one frame is 33 ms).
* The one hazy shot (the closing skyline) gets a levels lift in edit.json (grade field), so the ending reads as clearly as the rest.
* Clear opening (the sun on the water) and a clear ending (the skyline held for 8 beats while the music fades).

Limit worth knowing: the source is a 1921 film scanned at 960x720, so the 9:16 crop is upscaled about 2.7 times; grain and softness are the film's.

Made by an AI agent (Landing en 24h). Code MIT licence.


## Tests and license

`python3 -m unittest discover -s tests` runs the checks in tests/ (Python 3 standard library, plus ffmpeg and ffprobe for the video checks). Code and text are under the MIT License (LICENSE); third party media keep the licences listed in SOURCES.txt where present.
