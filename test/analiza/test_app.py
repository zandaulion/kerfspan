"""Synthetic requests exercise Slats limits at the analysis API boundary."""
import asyncio
import inspect
import io
import json
import os
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import UploadFile
from pydantic.fields import FieldInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "analiza"))
from app import analizeaza  # noqa: E402


def render_slats(**overrides):
    arguments = {name: parameter.default.default if isinstance(parameter.default, FieldInfo) else parameter.default
                 for name, parameter in inspect.signature(analizeaza).parameters.items()}
    _, png = cv2.imencode('.png', np.full((48, 64, 3), 255, np.uint8))
    arguments.update({
        'foto': UploadFile(file=io.BytesIO(png.tobytes()), filename='synthetic.png'),
        'stil': 'lamele', 'fara_fundal': False, 'coala_lat_mm': 300, 'pas_mm': 18,
        'unghi_lamele': -55, 'punte_min_mm': 2, 'fanta_min_mm': 2,
        'latime_lumina_lamele_mm': 1.5, 'kerf_mm': 1.2,
        'interpretare_geometrie': 'finished-boundary-cam-v1',
        **overrides,
    })
    # The fixture is a uniform synthetic light field, with no private source
    # image or segmentation model needed to exercise physical generation.
    with patch('app.portret', side_effect=lambda image, **_: np.zeros(image.shape[:2], np.float32)):
        return json.loads(asyncio.run(analizeaza(**arguments)).body)


class TestSlatManufacturingFloor(unittest.TestCase):
    def test_slats_use_profile_limits_below_three_mm_and_clamp_light_width(self):
        result = render_slats()
        pattern = result['info']['slatHighlights']['pattern']
        self.assertAlmostEqual(pattern['minimumWeb'] * 300, 2)
        self.assertAlmostEqual(pattern['minimumOpening'] * 300, 2)
        self.assertEqual(result['sourceMask'], render_slats(latime_lumina_lamele_mm=2)['sourceMask'])

    def test_larger_profile_limits_and_legacy_kerf_allowance_survive(self):
        strict = render_slats(punte_min_mm=4, fanta_min_mm=5)
        self.assertAlmostEqual(strict['info']['slatHighlights']['pattern']['minimumWeb'] * 300, 4)
        self.assertAlmostEqual(strict['info']['slatHighlights']['pattern']['minimumOpening'] * 300, 5)
        legacy = render_slats(interpretare_geometrie='legacy-uncompensated-centerline-v1')
        self.assertAlmostEqual(legacy['info']['slatHighlights']['pattern']['minimumWeb'] * 300, 3.2)
        self.assertAlmostEqual(legacy['info']['slatHighlights']['pattern']['minimumOpening'] * 300, 2)

    def test_web_and_opening_limits_are_independent_and_openings_allow_for_kerf(self):
        result = render_slats(punte_min_mm=3, fanta_min_mm=2)
        pattern = result['info']['slatHighlights']['pattern']
        self.assertAlmostEqual(pattern['minimumWeb'] * 300, 3)
        self.assertAlmostEqual(pattern['minimumOpening'] * 300, 2)
        wide_tool = render_slats(kerf_mm=2.5)
        self.assertAlmostEqual(wide_tool['info']['slatHighlights']['pattern']['minimumOpening'] * 300, 2.5)

    def test_resolution_tracks_the_smallest_manufacturable_slat_feature(self):
        result = render_slats(coala_lat_mm=600)
        self.assertEqual(result['sourceMask']['width'], 2400)


if __name__ == '__main__':
    unittest.main()
