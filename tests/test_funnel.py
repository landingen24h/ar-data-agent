import os, subprocess, sys, tempfile, unittest, json
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, H)
import funnel

class FunnelTest(unittest.TestCase):
    def test_example_output_reproduces(self):
        out = subprocess.run([sys.executable, 'funnel.py', 'example-contacts.jsonl'], cwd=H, capture_output=True, text=True, check=True).stdout
        self.assertEqual(out.strip(), open(os.path.join(H, 'example-output.txt')).read().strip())

    def test_distinct_builders_and_bad_lines(self):
        rows = [
            {"date": "2026-10-20", "builder": "A", "channel": "x", "step": "reached", "next": ""},
            {"date": "2026-10-21", "builder": "a", "channel": "x", "step": "reached", "next": ""},
            {"date": "2026-10-21", "builder": "b", "channel": "x", "step": "bid", "next": ""},
        ]
        with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False) as f:
            for r in rows: f.write(json.dumps(r) + '\n')
            f.write('{"date": "2026-10-21", "builder": "c", "step": "unknown"}\n')
            f.write('not json\n')
        try:
            ok, bad = funnel.load(f.name)
            self.assertEqual(len(ok), 3)
            self.assertEqual(len(bad), 2)
            c = funnel.funnel(ok)
            self.assertEqual(c['reached'], 1)  # same builder, case folded
            self.assertEqual(c['bid'], 1)
            self.assertEqual(c['earning'], 0)
        finally:
            os.unlink(f.name)

if __name__ == '__main__':
    unittest.main()
