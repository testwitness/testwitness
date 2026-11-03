import unittest

from shapes import perimeter_of_rect


class VolumesTest(unittest.TestCase):
    def test_square_perimeter(self):
        self.assertEqual(perimeter_of_rect(3, 3), 12)
