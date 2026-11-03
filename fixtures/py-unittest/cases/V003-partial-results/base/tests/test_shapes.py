import math
import unittest

from shapes import area_of_circle, perimeter_of_rect


class ShapesTest(unittest.TestCase):
    def test_circle_area(self):
        self.assertAlmostEqual(area_of_circle(1), math.pi)

    def test_negative_radius_raises(self):
        with self.assertRaises(ValueError):
            area_of_circle(-1)

    @unittest.skip("not implemented yet")
    def test_ellipse_area(self):
        self.fail("should not run")

    @unittest.expectedFailure
    def test_known_bug(self):
        self.assertEqual(perimeter_of_rect(1, 1), 5)

    def test_rect_perimeter_subtests(self):
        for w, h, expected in [(1, 1, 4), (2, 3, 10), (0, 5, 10)]:
            with self.subTest(w=w, h=h):
                self.assertEqual(perimeter_of_rect(w, h), expected)

    def test_fails_on_purpose(self):
        self.assertEqual(perimeter_of_rect(2, 2), 9)


class EdgeCasesTest(unittest.TestCase):
    def test_zero_radius(self):
        self.assertEqual(area_of_circle(0), 0)
