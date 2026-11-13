from unittest import TestCase

from pkg.script import PythonScript, ResourceScriptDirectory


class PythonScriptTests(TestCase):
    def test_render(self):
        self.assertEqual(PythonScript().render(), "ok")


class ResourceScriptDirectoryTests(TestCase):
    def test_render_not_found(self):
        self.assertEqual(ResourceScriptDirectory().render(), 404)

    def test_not_found_child(self):
        directory = ResourceScriptDirectory()
        self.assertEqual(directory.render(), 404)
