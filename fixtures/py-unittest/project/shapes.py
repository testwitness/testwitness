import math


def area_of_circle(r):
    if r < 0:
        raise ValueError("radius must be non negative")
    return math.pi * r * r


def perimeter_of_rect(w, h):
    return 2 * (w + h)
