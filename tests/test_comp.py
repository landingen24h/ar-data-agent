import json, os, subprocess, unittest
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def probe(f):
    p = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_streams', '-of', 'json', os.path.join(H, f)], capture_output=True, text=True, check=True).stdout)
    return p['streams'][0]

class CompTest(unittest.TestCase):
    def test_before_and_after_match_format(self):
        a, b = probe('before.mp4'), probe('after.mp4')
        for k in ['width', 'height', 'r_frame_rate', 'nb_read_frames', 'codec_name']:
            self.assertEqual(a[k], b[k], k)

    def test_frames_differ_only_in_part(self):
        log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(H, 'after.mp4'), '-i', os.path.join(H, 'before.mp4'),
                              '-lavfi', 'psnr', '-f', 'null', '-'], capture_output=True, text=True).stderr
        avg = float(log.split('average:')[1].split()[0])
        self.assertGreater(avg, 20.0)  # a comp, not a different clip
        self.assertLess(avg, 99.0)     # something was actually added

if __name__ == '__main__':
    unittest.main()
