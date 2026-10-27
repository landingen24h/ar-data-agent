"""Warm storybook grade as a 33 point 3D LUT (.cube). Pure numpy, deterministic.
Steps (in display referred RGB 0..1):
 1. white balance: warm the image (R up, B down) with a soft, highlight weighted shift
 2. gentle contrast: soft S curve around 0.45 with lifted toe (no crushed blacks)
    and a shoulder that rolls off before 1.0 (no clipped highlights)
 3. saturation: +12% overall, greens and sky blues capped by a soft limit so they stay rich, not neon
 4. skin protection: hues in the skin band get only half the saturation change
 5. golden glow: small warm tint added in the highlights
"""
import numpy as np, colorsys, sys
N = 33
def grade(rgb):
    r, g, b = rgb[...,0], rgb[...,1], rgb[...,2]
    # 1. warm white balance (gains), stronger in mids/highlights
    lum = 0.2126*r + 0.7152*g + 0.0722*b
    w = 0.6 + 0.4*lum
    r = r * (1 + 0.10*w); g = g * (1 + 0.025*w); b = b * (1 - 0.12*w)
    x = np.stack([r, g, b], -1)
    # 2. soft contrast with toe lift and highlight shoulder
    x = np.clip(x, 0, None)
    s = 0.45
    k = 1.18  # contrast amount (gentle)
    x = np.where(x < s, s*np.power(np.clip(x/s,0,1), k), 1-(1-s)*np.power(np.clip((1-x)/(1-s),0,None), k))
    x = 0.03 + x*(0.92)  # black floor 0.03, white ceiling 0.95
    # 3/4. saturation with skin protection and soft limit
    lum = (0.2126*x[...,0] + 0.7152*x[...,1] + 0.0722*x[...,2])[...,None]
    mx = x.max(-1); mn = x.min(-1)
    sat = np.where(mx > 1e-6, (mx-mn)/np.maximum(mx,1e-6), 0)
    # hue in degrees
    rr, gg, bb = x[...,0], x[...,1], x[...,2]
    hue = (np.degrees(np.arctan2(np.sqrt(3)*(gg-bb), 2*rr-gg-bb)) + 360) % 360
    skin = np.exp(-((hue-25)/18)**2)           # orange skin band around 25 deg
    gain = 1 + 0.12*(1-0.5*skin)
    gain = gain * (1 - 0.35*np.clip(sat-0.55, 0, None))  # soft limit: already saturated colours get less
    x = lum + (x-lum)*gain[...,None]
    # 5. golden glow in highlights
    hl = np.clip((lum[...,0]-0.55)/0.45, 0, 1)**1.5
    x = x + np.stack([0.025*hl, 0.012*hl, -0.015*hl], -1)
    return np.clip(x, 0.03, 0.955)

grid = np.linspace(0, 1, N)
# .cube order: red changes fastest
b, g, r = np.meshgrid(grid, grid, grid, indexing='ij')
rgb = np.stack([r, g, b], -1).reshape(-1, 3)
out = grade(rgb)
with open('look.cube', 'w') as f:
    f.write('TITLE "Warm storybook"\n# 33 point 3D LUT, Rec.709 display referred in and out\nLUT_3D_SIZE 33\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
    for v in out: f.write('%.6f %.6f %.6f\n' % tuple(v))
print('rows', len(out), 'min', out.min(0), 'max', out.max(0))
