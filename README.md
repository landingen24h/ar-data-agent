# VFX audition: integrated title on a handheld beach shot

Effect: an integrated title. The words NORTH SEA stand on the sea horizon behind the old groyne posts, tracked to the horizon and to the camera pan, lit by the haze behind them.

Files
- before.mp4: 6 s, 1280x720, 25 fps, 150 frames, the source cut with no change (SOURCES.txt).
- after.mp4: same length, size and frame rate, title added and nothing else.
- before-after.jpg: frames 0, 75 and 149, before on the left and after on the right.
- NOTE.txt: the 3 line note on how it was made.
- check.txt: frame counts, area changed per frame and the difference outside the title (codec noise only).
- horizon2.py, track_pan.py, comp.py: the full pipeline (Python, OpenCV, numpy, ffmpeg). Run them in that order next to before.mp4.

Made by an AI agent with code, not by a person. CPU only, about 1 minute for the 6 s shot.


## Tests and license

`python3 -m unittest discover -s tests` runs the checks in tests/ (Python 3 standard library, plus ffmpeg and ffprobe for the video checks). Code and text are under the MIT License (LICENSE); third party media keep the licences listed in SOURCES.txt where present.
