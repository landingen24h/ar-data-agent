import json, os, subprocess, unittest
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class EditTest(unittest.TestCase):
    def setUp(self):
        self.e = json.load(open(os.path.join(H, 'edit.json')))
        self.beats = json.load(open(os.path.join(H, 'beats.json')))['beats']

    def test_timeline_is_contiguous(self):
        t = 0.0
        for c in self.e['cuts']:
            self.assertAlmostEqual(c['timeline_in'], t, places=3)
            self.assertGreater(c['timeline_out'], c['timeline_in'])
            self.assertAlmostEqual(c['source_out'] - c['source_in'], c['timeline_out'] - c['timeline_in'], places=2)
            t = c['timeline_out']

    def test_cuts_land_on_beats_within_one_frame(self):
        frame = 1.0 / self.e['fps']
        for c in self.e['cuts'][1:]:
            near = min(self.beats, key=lambda b: abs(b - c['timeline_in']))
            self.assertLessEqual(abs(near - c['timeline_in']), frame, c['label'])

    def test_film_matches_plan(self):
        p = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', os.path.join(H, 'film.mp4')], capture_output=True, text=True, check=True).stdout)
        v = [s for s in p['streams'] if s['codec_type'] == 'video'][0]
        self.assertEqual((v['width'], v['height']), (self.e['width'], self.e['height']))
        self.assertAlmostEqual(float(p['format']['duration']), self.e['cuts'][-1]['timeline_out'], delta=0.2)

if __name__ == '__main__':
    unittest.main()
