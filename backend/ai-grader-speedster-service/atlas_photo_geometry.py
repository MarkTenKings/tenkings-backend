"""ATLAS native-photo recovery for an unusable legacy physical proposal.

Successful shared-engine proposals are returned unchanged. If its selected
region cannot satisfy the manual workspace's quad contract, color-channel
edges may supply an enclosing, physically supported contour. No template,
clamped point, prior card or minimum-area rectangle becomes card authority.
The shared Speedster engine and every grading/warp function remain unchanged.
"""
import cv2
import numpy as np

import card_geometry as geometry
import color_geometry as color


POLICY_VERSION = "atlas-native-photo-color-edge-v1"
ENGINE_VERSION = "atlas-physical-color-recovery-v1"
POLICY_PROVENANCE = "ATLAS_NATIVE_PHOTO_COLOR_EDGE_V1"


def _adoptable(quad, width, height):
    """Match the normalized bounds/order/area/convexity required by the UI."""
    if quad is None:
        return False
    points = np.asarray(quad, dtype=np.float64)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        return False
    unit = points / np.array([width, height])
    if not ((unit >= 0).all() and (unit <= 1).all()):
        return False
    tl, tr, br, bl = unit
    area = float(np.dot(unit[:, 0], np.roll(unit[:, 1], -1))
                 - np.dot(unit[:, 1], np.roll(unit[:, 0], -1)))
    cross = [np.cross(unit[(i + 1) % 4] - unit[i],
                      unit[(i + 2) % 4] - unit[(i + 1) % 4]) for i in range(4)]
    return bool(tl[1] < bl[1] and tr[1] < br[1]
                and tl[0] < tr[0] and bl[0] < br[0]
                and area > 0.02 and all(value > 1e-10 for value in cross))


def _color_candidates(image):
    working, scale = geometry._working_image(image)
    gray = cv2.GaussianBlur(cv2.cvtColor(working, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    median = float(np.median(gray))
    low = max(12, int(0.66 * median))
    high = max(low + 20, min(255, int(1.33 * median)))
    # Canny chooses the strongest B/G/R gradient, retaining chromatic physical
    # edges that disappear when blue card and dark mat collapse to gray.
    edges = cv2.Canny(cv2.GaussianBlur(working, (5, 5), 0), low, high)
    contours, _ = cv2.findContours(cv2.dilate(edges, np.ones((3, 3), np.uint8)),
                                  cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    candidates = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        if x <= 0 or y <= 0 or x + width >= working.shape[1] or y + height >= working.shape[0]:
            continue
        area = float(cv2.contourArea(contour))
        rectangle = cv2.minAreaRect(contour)
        a, b = rectangle[1]
        if area <= 1 or min(a, b) <= 0:
            continue
        fitted = _fitted_perimeter(contour, rectangle)
        if fitted is None:
            continue
        quad = geometry._portraitize(fitted) / scale
        if not _adoptable(quad, image.shape[1], image.shape[0]):
            continue
        aspect_quality = max(0.01, 1 - abs(min(a, b) / max(a, b) - geometry.EXPECTED_ASPECT) / geometry.ASPECT_RANK_SCALE)
        fill_quality = max(0.01, min(1, area / (a * b) / geometry.FILL_RANK_TARGET))
        candidates.append((area * aspect_quality * fill_quality, quad))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates


def _fitted_perimeter(contour, rectangle):
    """Fit all four observed sides; never fall back to the bounding box.

    The box only locates the same middle-side search bands as the shared
    fitter. Every side must span most of that band in the actual contour.
    """
    box = geometry.order_corners(cv2.boxPoints(rectangle))
    points = contour.reshape(-1, 2).astype(np.float32)
    lines = []
    for index in range(4):
        first, second = box[index], box[(index + 1) % 4]
        side = second - first
        length = float(np.linalg.norm(side))
        if length <= 0:
            return None
        unit = side / length
        normal = np.array([-unit[1], unit[0]], dtype=np.float32)
        relative = points - first
        along, distance = relative @ unit, np.abs(relative @ normal)
        selected = (along > 0.15 * length) & (along < 0.85 * length) & (distance < 0.03 * length + 5.0)
        if np.count_nonzero(selected) < 10 or np.ptp(along[selected]) < 0.55 * length:
            return None
        vx, vy, x0, y0 = cv2.fitLine(points[selected], cv2.DIST_HUBER, 0, 0.01, 0.01).flatten()
        lines.append((float(x0), float(y0), float(vx), float(vy)))
    corners = []
    for index in range(4):
        x1, y1, vx1, vy1 = lines[(index - 1) % 4]
        x2, y2, vx2, vy2 = lines[index]
        matrix = np.array([[vx1, -vx2], [vy1, -vy2]], dtype=np.float32)
        if abs(float(np.linalg.det(matrix))) < 1e-5:
            return None
        distance = np.linalg.solve(matrix, np.array([x2 - x1, y2 - y1], dtype=np.float32))[0]
        corners.append((x1 + distance * vx1, y1 + distance * vy1))
    return geometry.order_corners(np.asarray(corners, dtype=np.float32))


def _perimeter_evidence(lab, quad):
    """Compare each outside sample to the photo perimeter along its own ray.

    Local perimeter references tolerate a lighting gradient across the mat.
    A printed/art rectangle instead has card material on its outside and fails
    this test. The complete contour and all four sides still need evidence.
    """
    height, width = lab.shape[:2]
    center = quad.mean(axis=0)
    distance = max(5.0, min(height, width) * 0.009)
    sides = {}
    for index, name in enumerate(color.SIDE_NAMES):
        first, second = quad[index], quad[(index + 1) % 4]
        inward = center - (first + second) * 0.5
        inward /= np.linalg.norm(inward)
        outward = -inward
        samples = []
        for along in np.linspace(0.12, 0.88, 33):
            edge = first + along * (second - first)
            inside, outside = edge + inward * distance, edge - inward * distance
            # Sampling outside the image would synthesize boundary evidence.
            if not all(2 <= point[0] < width - 2 and 2 <= point[1] < height - 2
                       for point in (inside, outside)):
                samples.append((0.0, False, False))
                continue
            distances = [(bound - edge[axis]) / outward[axis]
                         for axis, bound in ((0, 2), (0, width - 3), (1, 2), (1, height - 3))
                         if abs(outward[axis]) > 1e-8 and (bound - edge[axis]) / outward[axis] > 0]
            reference = color._sample_patch(lab, edge + outward * min(distances))
            inner = color._sample_patch(lab, inside)
            outer = color._sample_patch(lab, outside)
            contrast = float(np.linalg.norm(inner - outer))
            outside_matches = np.linalg.norm(outer - reference) <= color.PHYSICAL_MAT_REFERENCE_MAX_DELTA_E
            inside_differs = np.linalg.norm(inner - reference) >= color.PHYSICAL_CONTRAST_FLOOR_DELTA_E
            samples.append((contrast, bool(outside_matches), bool(inside_differs)))
        values = np.asarray(samples)
        supported = ((values[:, 0] >= color.PHYSICAL_CONTRAST_FLOOR_DELTA_E)
                     & values[:, 1].astype(bool) & values[:, 2].astype(bool))
        sides[name] = {"medianContrastDeltaE": round(float(np.median(values[:, 0])), 3),
                       "supportFraction": round(float(np.mean(supported)), 4),
                       "outsidePerimeterSupportFraction": round(float(np.mean(values[:, 1])), 4),
                       "insideNonPerimeterSupportFraction": round(float(np.mean(values[:, 2])), 4),
                       "sampleCount": 33, "candidateCount": 1, "ambiguous": False}
    return sides


def propose_physical_outer(image, mat_color):
    prior = color.propose_physical_outer(image, mat_color)
    height, width = image.shape[:2]
    if prior["outcome"] != "ACCEPTED" or _adoptable(prior["proposal"], width, height):
        return prior
    rejected = np.asarray(prior["proposal"], dtype=np.float32)
    if rejected.shape != (4, 2) or not np.isfinite(rejected).all():
        return prior
    # Bind recovery to a visible selected mat, using the shared perimeter
    # support requirement without the global color reference that loses a
    # locally illuminated side. A frame filled by card art is not a mat.
    perimeter = color._photo_perimeter_mask(height, width)
    if float(np.mean(color._mat_pixel_mask(image[perimeter], mat_color))) < 0.55:
        return prior
    lab = color._cie_lab(cv2.GaussianBlur(image, (5, 5), 0))
    supported = []
    for score, quad in _color_candidates(image):
        # A recovery must enclose the failed region. An unrelated small shape
        # elsewhere in the photo cannot become the replacement physical card.
        if not all(cv2.pointPolygonTest(quad.astype(np.float32), tuple(map(float, point)), False) >= 0
                   for point in rejected):
            continue
        sides = _perimeter_evidence(lab, quad)
        if not all(side["supportFraction"] >= color.PHYSICAL_MINIMUM_SIDE_SUPPORT for side in sides.values()):
            continue
        diagonal = float(np.linalg.norm(quad[2] - quad[0]))
        if any(float(np.mean(np.linalg.norm(quad - existing, axis=1))) / diagonal < 0.012
               for _, existing, _ in supported):
            continue
        supported.append((score, quad, sides))
    if not supported:
        return prior
    score, quad, sides = supported[0]
    ratio, ambiguous = (color._canonical_ambiguity(supported[1][0] / score,
                        color.PHYSICAL_AMBIGUOUS_RUNNER_UP_RATIO)
                        if len(supported) > 1 else (None, False))
    if ambiguous:
        return prior
    for side in sides.values():
        side["candidateCount"] = len(supported)
    result = color._result("PHYSICAL_OUTER", mat_color, "ACCEPTED", proposal=quad,
                           sides=sides, candidate_count=len(supported), runner_up_ratio=ratio)
    result.update(engineVersion=ENGINE_VERSION, policyProvenance=POLICY_PROVENANCE)
    return result
