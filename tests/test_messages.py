import os, re, unittest
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def messages():
    md = open(os.path.join(H, 'messages.md'), encoding='utf-8').read()
    parts = re.split(r'^## ', md, flags=re.M)[1:]
    return [p.split('\n', 1)[1].strip() for p in parts if re.match(r'\d\. To ', p)]

class MessagesTest(unittest.TestCase):
    def test_three_messages(self):
        self.assertEqual(len(messages()), 3)

    def test_each_under_120_words(self):
        for m in messages():
            self.assertLess(len(m.split()), 120, m[:40])

    def test_no_dashes_credentials_or_contact_data(self):
        for m in messages():
            self.assertNotRegex(m, '[\u2013\u2014]')
            self.assertNotRegex(m, r'0x[0-9a-fA-F]{40}')
            self.assertNotRegex(m, r'[\w.+-]+@[\w-]+\.[\w.]+')
            self.assertNotRegex(m.lower(), r'private key|seed phrase|password')

if __name__ == '__main__':
    unittest.main()
