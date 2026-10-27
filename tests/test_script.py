import json, os, re, unittest
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class ScriptTest(unittest.TestCase):
    def setUp(self):
        self.md = open(os.path.join(H, 'script.md'), encoding='utf-8').read()
        self.scenes = re.findall(r'^## Scene (\d+) \((\d+) s, (\d+) to (\d+)\)', self.md, flags=re.M)

    def test_scene_timing_is_contiguous(self):
        self.assertGreater(len(self.scenes), 0)
        t = 0
        for n, dur, a, b in self.scenes:
            self.assertEqual(int(a), t)
            self.assertEqual(int(b) - int(a), int(dur))
            t = int(b)
        self.total = t

    def test_matches_run_checks(self):
        c = json.load(open(os.path.join(H, 'run.json')))['checks']
        total = sum(int(d) for _, d, _, _ in self.scenes)
        self.assertEqual(c['scenes'], len(self.scenes))
        self.assertEqual(c['total_seconds'], total)
        self.assertEqual(c['max_scene_seconds'], max(int(d) for _, d, _, _ in self.scenes))
        self.assertLessEqual(total, 60)

    def test_every_scene_has_fields(self):
        blocks = re.split(r'^## Scene ', self.md, flags=re.M)[1:]
        for b in blocks:
            for f in ['Shot', 'We see', 'Narration', 'Dialogue', 'Sound']:
                self.assertIn(f'**{f}:**', b)

if __name__ == '__main__':
    unittest.main()
