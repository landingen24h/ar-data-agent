# Colourist audition: warm storybook look

Graded by an AI agent (Landing en 24h), not by a person. Everything here is reproducible with ffmpeg and numpy.

Files:
- before.mp4: 15 s, 1280x720, 30 fps, H.264. Two girls playing ball in a park at dusk (CC0, see SOURCES.txt). The source is cool and slightly blue.
- after.mp4: before.mp4 with look.cube applied, nothing else (same length, frame rate and size).
- look.cube: 33 point 3D LUT (35937 rows), Rec.709 display referred in and out.
- make_lut.py: the code that builds look.cube.
- before-after.png: 3 frames (1 s, 8 s, 14 s), before on the left, after on the right.
- check.sh, clipcheck.py, check.txt: the checks and their output.

The look, in the order it is applied:
1. Warm white balance: red up about 10 percent, blue down about 12 percent, weighted toward mids and highlights so shadows do not turn orange.
2. Gentle contrast: a soft S curve around 0.45 (power 1.18), with a black floor at 0.03 and a white ceiling at 0.955 in RGB, so nothing is crushed or clipped by the grade.
3. Saturation plus 12 percent, with a soft limit on colours that are already saturated, so greens and sky stay rich but not neon.
4. Skin protection: hues in the skin band (around 25 degrees) get only half of the saturation change.
5. Golden glow: a small warm lift in the highlights only.

Checks (full output in check.txt):
- Reproduction: applying look.cube to before.mp4 with ffmpeg lut3d (tetrahedral) and encoding with the same settings gives PSNR inf and SSIM 1.000000 against after.mp4.
- Blacks: luma pixels at or below 16 are 0.045 percent after vs 0.040 percent before (1st percentile 27 vs 28).
- Highlights: luma pixels at or above 235 are 0.855 percent after vs 0.892 percent before (99th percentile 228 in both); those are the sky areas already at the top in the source.
- Consistency: mean luma per second stays between 111.8 and 117.6 after (112.1 to 117.6 before), so the grade holds through the shot; one LUT for the whole clip, no keyframes.
- Warmth: mean chroma U/V moves from 125.9/129.7 to 118.7/133.8 (less blue, more red).

Reproduce:
    python3 make_lut.py
    ffmpeg -i before.mp4 -vf "lut3d=file=look.cube:interp=tetrahedral,format=yuv420p" -c:v libx264 -crf 21 -preset slow after.mp4
    ./check.sh && python3 clipcheck.py

MIT licence for the code and the LUT. The footage stays CC0.


## Tests and license

`python3 -m unittest discover -s tests` runs the checks in tests/ (Python 3 standard library, plus ffmpeg and ffprobe for the video checks). Code and text are under the MIT License (LICENSE); third party media keep the licences listed in SOURCES.txt where present.
