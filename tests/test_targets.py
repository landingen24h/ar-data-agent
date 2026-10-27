import json, os, re, unittest
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = ["handle", "name", "where", "source", "segment", "why_now"]

class TargetsTest(unittest.TestCase):
    def setUp(self):
        self.t = json.load(open(os.path.join(H, 'targets.json')))

    def test_shape(self):
        self.assertIsInstance(self.t, list)
        self.assertGreater(len(self.t), 0)
        for r in self.t:
            for k in FIELDS:
                self.assertTrue(str(r.get(k, '')).strip(), (r.get('handle'), k))

    def test_public_links_and_unique(self):
        hs = [r['handle'].lower() for r in self.t]
        self.assertEqual(len(hs), len(set(hs)))
        for r in self.t:
            self.assertRegex(r['where'], r'^https://')

    def test_no_private_contact_data(self):
        txt = json.dumps(self.t)
        self.assertIsNone(re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', txt))
        self.assertIsNone(re.search(r'0x[0-9a-fA-F]{40}', txt))

if __name__ == '__main__':
    unittest.main()
