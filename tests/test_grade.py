import os, re, subprocess, tempfile, unittest
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def ff(*a):
    return subprocess.run(['ffmpeg', '-hide_banner', '-nostats', *a], capture_output=True, text=True, cwd=H).stderr

class GradeTest(unittest.TestCase):
    def test_cube_is_valid_3d_lut(self):
        lines = open(os.path.join(H, 'look.cube')).read().splitlines()
        size = int([l for l in lines if l.startswith('LUT_3D_SIZE')][0].split()[1])
        data = [l for l in lines if re.match(r'^-?[0-9.]+ -?[0-9.]+ -?[0-9.]+$', l.strip())]
        self.assertEqual(len(data), size ** 3)
        for l in data:
            for v in map(float, l.split()):
                self.assertGreaterEqual(v, 0.0); self.assertLessEqual(v, 1.0)

    def test_lut_reproduces_after_clip(self):
        out = os.path.join(tempfile.mkdtemp(), 'relut.mp4')
        ff('-v', 'error', '-y', '-i', 'before.mp4', '-vf', 'lut3d=file=look.cube:interp=tetrahedral,format=yuv420p',
           '-c:v', 'libx264', '-crf', '21', '-preset', 'slow', out)
        log = ff('-i', 'after.mp4', '-i', out, '-lavfi', 'ssim', '-f', 'null', '-')
        ssim = float(re.findall(r'All:([0-9.]+)', log)[-1])
        self.assertGreater(ssim, 0.999)

if __name__ == '__main__':
    unittest.main()
