#!/usr/bin/env python3
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from reportlab.lib.colors import black, white
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

VERSION = "ten-kings-mathematical-calibration-target-v1.0.0"
PDF = Path('output/pdf/ten-kings-mathematical-calibration-target-v1.pdf')
MANIFEST = Path('output/pdf/ten-kings-mathematical-calibration-target-v1.json')


def text(c, x, y, value, size=8, bold=False):
    c.setFillColor(black)
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    c.drawString(x * mm, y * mm, value)


def title(c, y, value, size=10):
    c.setFont('Helvetica-Bold', size)
    c.setFillColor(black)
    c.drawCentredString(LETTER[0] / 2, y * mm, value)


def line(c, x1, y1, x2, y2, width=0.25):
    c.setStrokeColor(black)
    c.setLineWidth(width * mm)
    c.line(x1 * mm, y1 * mm, x2 * mm, y2 * mm)


def cross(c, x, y, arm=3):
    line(c, x - arm, y, x + arm, y, 0.20)
    line(c, x, y - arm, x, y + arm, 0.20)


def scale_bar(c, x, y, length, label):
    line(c, x, y, x + length, y, 0.45)
    line(c, x, y - 2, x, y + 2, 0.45)
    line(c, x + length, y - 2, x + length, y + 2, 0.45)
    text(c, x, y + 3, label, 7, True)


def geometry_page(c):
    title(c, 271, 'TEN KINGS MATHEMATICAL GRADING - GEOMETRY TARGET V1')
    text(c, 18, 263, 'Print at Actual size / 100%.', 8, True)
    text(c, 18, 257, 'Disable Fit, Shrink, and borderless expansion.', 8)
    text(c, 18, 252, 'Accept only when each bar error plus measurement U95 is <= 0.20 mm.', 8)
    text(c, 18, 247, 'Verify scale, then cut only the rounded 63.50 x 88.90 mm coupon outline.', 8)
    text(c, 18, 242, 'After cutting, verify both coupon dimensions with recorded ruler U95.', 8)
    coupon_x, coupon_y = 76.2, 119
    coupon_width, coupon_height, coupon_radius = 63.5, 88.9, 3.18
    x0, y0, cell = coupon_x + 1.75, coupon_y + 1.95, 5
    cols, rows = 12, 17
    c.setStrokeColor(black)
    c.setLineWidth(0.45 * mm)
    c.roundRect(coupon_x * mm, coupon_y * mm,
                coupon_width * mm, coupon_height * mm,
                coupon_radius * mm, fill=0, stroke=1)
    for row in range(rows):
        for col in range(cols):
            c.setFillColor(black if (row + col) % 2 == 0 else white)
            c.rect((x0 + col * cell) * mm, (y0 + row * cell) * mm,
                   cell * mm, cell * mm, fill=1, stroke=0)
    c.setStrokeColor(black)
    c.setFillColor(black)
    c.setLineWidth(0.35 * mm)
    c.rect(x0 * mm, y0 * mm, cols * cell * mm, rows * cell * mm,
           fill=0, stroke=1)
    text(c, 62, 111, '12 x 17 cells; 5.00 mm per cell; 11 x 16 internal corners.', 7, True)
    scale_bar(c, 28, 92, 50, '50.00 mm X')
    scale_bar(c, 28, 78, 100, '100.00 mm X')
    line(c, 187, 28, 187, 228, 0.45)
    line(c, 185, 28, 189, 28, 0.45)
    line(c, 185, 228, 189, 228, 0.45)
    text(c, 190, 124, '200.00 mm Y', 7, True)
    text(c, 18, 63, 'Capture at least 10 distinct in-frame poses at the fixed card plane.', 8)
    text(c, 18, 57, 'Retain every source image, detected corner, distortion fit, and residual.', 8)
    c.showPage()


def instructions_page(c):
    title(c, 271, 'TEN KINGS MATHEMATICAL GRADING - CALIBRATION RECORD V1')
    text(c, 18, 262, 'This target is metrology evidence, not proof by itself.', 9, True)
    sections = (
        ('1. PRINT SCALE', (
            'Print pages 1-2 at Actual size / 100%; do not fit or borderlessly expand.',
            'Measure the 100 mm X and 200 mm Y bars; error plus U95 must be <= 0.20 mm.',
            'Record measured axes, fixed-ruler ID/U95, operator, UTC time, and PDF SHA-256.')),
        ('2. GEOMETRY', (
            'Capture page 1 at the working plane across the required lens poses.',
            'Fit distortion and pixel/mm scale; retain every view and residual.',
            'Measure the cut coupon at 63.50 x 88.90 mm; error plus U95 must be <= 0.20 mm.',
            'Normalize page-1 checkerboard views; retain the fixed-transform holdout residual.',
            'Page 2 is only for centering/reference validation, never checkerboard normalization.')),
        ('3. PHOTOMETRY', (
            'Use the blank matte reverse only if neutral and free of print show-through; hash it.',
            'Capture at least 3 dark, flat-field, and pattern frames for channels 1-8.',
            'Measure each fixed light source point with the ruler at least 3 times.',
            'Retain geometry direction, irradiance validation, confidence, and exact hashes.')),
        ('4. REPEATABILITY AND U95', (
            'Remove and replace the target at least ten times without changing the rig.',
            'Repeat linear, area, relief, roughness, and neutral-patch Delta-E measurements.',
            'Compute certified U95; retain sample values and calculation method.')),
        ('5. ACCEPTANCE', (
            'Evaluate every centralized calibration-acceptance threshold.',
            'A failed or missing gate keeps status non-finalized and isCalibrated false.',
            'Never substitute a production card, internet image, or manual grade.')),
    )
    y = 249
    for heading, lines in sections:
        text(c, 20, y, heading, 9, True)
        y -= 6
        for item in lines:
            text(c, 25, y, '- ' + item, 7.5)
            y -= 5
        y -= 5
    text(c, 20, 58, 'Operator: ____________________  UTC: ____________________', 8)
    text(c, 20, 49, 'Printer/media: __________________________________________', 8)
    text(c, 20, 40, 'Measured 100 X / 200 Y / U95: ___________________________', 8)
    text(c, 20, 35, 'Fixed ruler ID: __________________________________________', 8)
    text(c, 20, 27, 'Artifact/profile hash: ___________________________________', 8)
    c.showPage()


def card_page(c):
    title(c, 271, 'TEN KINGS MATHEMATICAL GRADING - CARD REFERENCE V1')
    text(c, 18, 263, 'Non-production calibration reference. Never grade or publish this target.', 8, True)
    text(c, 18, 257, 'Outer cut: 63.50 x 88.90 mm. Printed frame inset: 5.00 mm per side.', 8)
    x0, y0 = 76.2, 118
    width, height, radius = 63.5, 88.9, 3.18
    c.setStrokeColor(black)
    c.setLineWidth(0.45 * mm)
    c.roundRect(x0 * mm, y0 * mm, width * mm, height * mm,
                radius * mm, fill=0, stroke=1)
    c.setLineWidth(0.25 * mm)
    c.rect((x0 + 5) * mm, (y0 + 5) * mm,
           (width - 10) * mm, (height - 10) * mm, fill=0, stroke=1)
    for offset in range(10, 60, 10):
        line(c, x0 + offset, y0 + 5, x0 + offset, y0 + height - 5, 0.10)
    for offset in range(10, 85, 10):
        line(c, x0 + 5, y0 + offset, x0 + width - 5, y0 + offset, 0.10)
    for px, py in ((x0 + 5, y0 + 5), (x0 + width - 5, y0 + 5),
                   (x0 + 5, y0 + height - 5),
                   (x0 + width - 5, y0 + height - 5)):
        cross(c, px, py, 2.5)
    c.setFillColor(black)
    c.circle((x0 + 12) * mm, (y0 + height - 12) * mm, 2 * mm, fill=1, stroke=0)
    c.rect((x0 + width - 15) * mm, (y0 + 10) * mm, 5 * mm, 5 * mm,
           fill=1, stroke=0)
    scale_bar(c, 40, 92, 50, '50.00 mm X verification')
    line(c, 150, 92, 150, 142, 0.45)
    line(c, 148, 92, 152, 92, 0.45)
    line(c, 148, 142, 152, 142, 0.45)
    text(c, 155, 114, '50.00 mm Y', 7, True)
    text(c, 30, 75, 'Registration notes:', 9, True)
    text(c, 30, 69, 'The circle and square intentionally break rotational symmetry.', 8)
    text(c, 30, 63, 'Use the printed-frame contour for printed_border_v1 tests.', 8)
    text(c, 30, 57, 'Hash this exact artifact before registered-design use.', 8)
    c.showPage()


def build(pdf_path, manifest_path):
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    document = canvas.Canvas(str(pdf_path), pagesize=LETTER, invariant=1)
    document.setTitle(VERSION)
    document.setAuthor('Ten Kings Cards')
    geometry_page(document)
    card_page(document)
    instructions_page(document)
    document.save()
    pdf_sha256 = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    payload = {
        'schemaVersion': 'ten-kings-calibration-target-manifest-v1',
        'version': VERSION,
        'pdf': pdf_path.name,
        'pdfSha256': pdf_sha256,
        'pageSize': {'name': 'LETTER', 'widthMm': 215.9, 'heightMm': 279.4},
        'printScale': 1.0,
        'requiredPrintScaleVerification': {
            'x': {'nominalSpanMm': 100.0},
            'y': {'nominalSpanMm': 200.0},
            'authorityBasis': 'protected_checkerboard_geometry',
            'operatorInputRequired': False,
        },
        'requiredCutDimensionVerification': {
            'x': {'nominalDimensionMm': 63.5},
            'y': {'nominalDimensionMm': 88.9},
            'authorityBasis': 'protected_checkerboard_geometry',
            'operatorInputRequired': False,
        },
        'uniformFlatFieldPolicy': {
            'preferred': 'blank_matte_neutral_reverse_without_print_showthrough',
            'minimumDarkFramesPerChannel': 3,
            'minimumFlatFieldFramesPerChannel': 3,
            'minimumPatternFramesPerChannel': 3,
        },
        'measurementRepeatabilityClasses': [
            'linear_mm', 'area_mm2', 'relief_index', 'roughness_index',
            'color_delta_e',
        ],
        'minimumRepeatedPlacements': 10,
        'geometryCheckerboard': {
            'columns': 12, 'rows': 17, 'internalColumns': 11,
            'internalRows': 16, 'cellMm': 5.0,
            'couponWidthMm': 63.5, 'couponHeightMm': 88.9,
        },
        'cardReference': {'widthMm': 63.5, 'heightMm': 88.9,
                          'cornerRadiusMm': 3.18, 'printedFrameInsetMm': 5.0},
        'verificationBarsMm': [50.0, 100.0, 200.0],
    }
    manifest_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    return payload


def main():
    parser = argparse.ArgumentParser(description='Generate the V1 physical calibration target.')
    parser.add_argument('--output-dir', type=Path, default=PDF.parent)
    args = parser.parse_args()
    pdf_path = args.output_dir / PDF.name
    manifest_path = args.output_dir / MANIFEST.name
    payload = build(pdf_path, manifest_path)
    print(json.dumps(payload, sort_keys=True))


if __name__ == '__main__':
    main()
