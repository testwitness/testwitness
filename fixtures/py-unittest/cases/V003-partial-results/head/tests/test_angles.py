import math
import unittest

from shapes import area_of_circle


class AnglesTest(unittest.TestCase):
    def test_unit_circle(self):
        self.assertAlmostEqual(area_of_circle(1) / math.pi, 1)
