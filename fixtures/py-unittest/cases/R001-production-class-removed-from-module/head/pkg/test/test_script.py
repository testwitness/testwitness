from unittest import TestCase

from pkg.script import PythonScript


class PythonScriptTests(TestCase):
    def test_render(self):
        self.assertEqual(PythonScript().render(), "ok")
