"""ATLAS proposer-only physical outlines from observed card-to-mat boundaries.

All candidates, including shape-valid inner artwork, need four supported outer
sides. Lighting-aware mat paths and multiscale contours preserve faint physical
edges without synthesizing a card rectangle or a printed frame.
"""
import cv2
import numpy as np

import card_geometry as geometry
import color_geometry as color


POLICY_VERSION = "atlas-native-photo-outer-ranking-v2"
ENGINE_VERSION = "atlas-physical-outer-ranking-v2"
POLICY_PROVENANCE = "ATLAS_NATIVE_PHOTO_OUTER_RANKING_V2"
PHYSICAL_LOCAL_CONTRAST_FLOOR = 8.0
MIN_SELECTED_PERIMETER_FRACTION = .20
MAX_PHYSICAL_CANDIDATES = 64
MAX_RAY_PATCHES = 160


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
    candidates = []
    # The second scale suppresses textured-mat edges before looking for faint
    # card edges. Both paths still require four independently observed sides;
    # a minimum-area rectangle never supplies a missing side.
    for kernel, thresholds in ((5, (low, high)), (15, (8, 20))):
        edges = cv2.Canny(cv2.GaussianBlur(working, (kernel, kernel), 0), *thresholds)
        contours, _ = cv2.findContours(cv2.dilate(edges, np.ones((3, 3), np.uint8)),
                                      cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
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
    return candidates[:MAX_PHYSICAL_CANDIDATES]


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


def _patches(lab, points):
    """Bounded vectorized median patches; callers supply only in-image points."""
    pixels = np.rint(points).astype(np.int32)
    dy, dx = np.mgrid[-2:3, -2:3]
    return np.median(lab[pixels[..., 1, None] + dy.ravel(),
                         pixels[..., 0, None] + dx.ravel()], axis=-2)


def _perimeter_evidence(lab, quad):
    """Follow outside material to the photo perimeter without a global color.

    Mat illumination may change smoothly. An internal print boundary instead
    crosses another material transition on its outward path. Record both the
    nearby stability and the full path, including chroma at the perimeter.
    """
    height, width = lab.shape[:2]
    center = quad.mean(axis=0)
    distance = max(5.0, min(height, width) * 0.009)
    sides = {}
    for index, name in enumerate(color.SIDE_NAMES):
        first, second = quad[index], quad[(index + 1) % 4]
        tangent = second - first
        inward = np.array([-tangent[1], tangent[0]], dtype=np.float64)
        inward /= np.linalg.norm(inward)
        if np.dot(inward, center - (first + second) * .5) < 0:
            inward *= -1
        edges = first + np.linspace(.12, .88, 33)[:, None] * tangent
        inner_points = edges + inward * distance
        outer_points = edges - inward * distance
        valid = np.all((inner_points >= 2) & (inner_points < [width - 3, height - 3])
                       & (outer_points >= 2) & (outer_points < [width - 3, height - 3]), axis=1)
        contrast = np.zeros(33)
        noise = np.zeros(33)
        stable = np.zeros(33, dtype=bool)
        continuous = np.zeros(33, dtype=bool)
        chroma_matches = np.zeros(33, dtype=bool)
        for sample in np.flatnonzero(valid):
            edge = edges[sample]
            outward = -inward
            reaches = [(bound - edge[axis]) / outward[axis]
                       for axis, bound in ((0, 2), (0, width - 4), (1, 2), (1, height - 4))
                       if abs(outward[axis]) > 1e-8 and (bound - edge[axis]) / outward[axis] > 0]
            reach = min(reaches)
            if reach < 4 * distance:
                continue
            offsets = np.linspace(distance, reach, min(MAX_RAY_PATCHES, max(4, int(np.ceil(reach / distance)))))
            outer = _patches(lab, edge + offsets[:, None] * outward)
            # Different designs can match the mat several pixels inside an
            # otherwise visible cut edge. Sample the observed narrow edge band
            # as well as the card interior rather than requiring one inset.
            inner_band = _patches(lab, edge + np.linspace(-.5, 1.0, max(7, int(np.ceil(1.5 * distance)) + 1))[:, None] * distance * inward)
            contrast[sample] = np.max(np.linalg.norm(inner_band - outer[0], axis=1))
            drift = np.linalg.norm(np.diff(outer, axis=0), axis=1)
            # Fit away the local lighting slope before estimating mat noise;
            # a smooth shadow is not random uncertainty in the visible edge.
            local = outer[:4]
            positions = np.arange(4) - 1.5
            slope = positions @ local / np.dot(positions, positions)
            residual = local - (local.mean(axis=0) + positions[:, None] * slope)
            noise[sample] = np.median(np.linalg.norm(residual, axis=1))
            stable[sample] = np.max(np.linalg.norm(outer[:4] - outer[0], axis=1)) <= 18
            # A mat seam or another object can interrupt one ray far from the
            # card. Three outward-only paths provide independent observed
            # routes to the perimeter; none can cross a convex card interior.
            for direction in (outward,
                              .258819 * outward + .965926 * tangent / np.linalg.norm(tangent),
                              .258819 * outward - .965926 * tangent / np.linalg.norm(tangent)):
                origin = outer_points[sample]
                lengths = [(bound - origin[axis]) / direction[axis]
                           for axis, bound in ((0, 2), (0, width - 4), (1, 2), (1, height - 4))
                           if abs(direction[axis]) > 1e-8 and (bound - origin[axis]) / direction[axis] > 0]
                length = min(lengths)
                path = _patches(lab, origin + np.linspace(0, length, min(MAX_RAY_PATCHES, max(2, int(np.ceil(length / distance)) + 1)))[:, None] * direction)
                path_continuous = np.max(np.linalg.norm(np.diff(path, axis=0), axis=1)) <= 18
                path_chroma_matches = np.linalg.norm(path[0, 1:] - path[-1, 1:]) <= 18
                continuous[sample] |= path_continuous
                chroma_matches[sample] |= path_chroma_matches
                if path_continuous and path_chroma_matches:
                    break
            else:
                # Both facts must belong to the same outward path.
                continuous[sample] = False
        # A faint edge must exceed the observed adjacent-mat variation as well
        # as the absolute floor. This is versioned ATLAS photo evidence, not a
        # change to the shared Speedster physical or printed-frame policy.
        contrast_supported = contrast >= np.maximum(PHYSICAL_LOCAL_CONTRAST_FLOOR, 3 * noise)
        outside = stable & continuous & chroma_matches
        supported = valid & contrast_supported & outside
        sides[name] = {"medianContrastDeltaE": round(float(np.median(contrast)), 3),
                       "medianMatNoiseResidualDeltaE": round(float(np.median(noise)), 3),
                       "supportFraction": round(float(np.mean(supported)), 4),
                       "contrastSupportFraction": round(float(np.mean(contrast_supported)), 4),
                       "outsidePerimeterSupportFraction": round(float(np.mean(outside)), 4),
                       "outsideLocalStabilityFraction": round(float(np.mean(stable)), 4),
                       "outsideRayContinuityFraction": round(float(np.mean(continuous)), 4),
                       "outsidePerimeterChromaFraction": round(float(np.mean(chroma_matches)), 4),
                       "sampleCount": 33, "candidateCount": 1, "ambiguous": False}
    return sides


def _result(mat_color, outcome, **kwargs):
    result = color._result("PHYSICAL_OUTER", mat_color, outcome, **kwargs)
    result.update(engineVersion=ENGINE_VERSION, policyProvenance=POLICY_PROVENANCE,
                  contrastFloorDeltaE=PHYSICAL_LOCAL_CONTRAST_FLOOR)
    return result


def propose_physical_outer(image, mat_color):
    if mat_color not in color.MAT_COLORS:
        raise ValueError("matColor must be BLACK, WHITE, or MAGENTA")
    height, width = image.shape[:2]
    perimeter = color._photo_perimeter_mask(height, width)
    if float(np.mean(color._mat_pixel_mask(image[perimeter], mat_color))) < MIN_SELECTED_PERIMETER_FRACTION:
        return _result(mat_color, "ABSTAIN", advisory=color._advisory(
            "PHYSICAL_MAT_NOT_VISIBLE", None, "The selected mat is not sufficiently visible around this photo."))
    lab = color._cie_lab(cv2.GaussianBlur(image, (5, 5), 0))
    supported = []
    candidates = _color_candidates(image)
    for score, quad in candidates:
        sides = _perimeter_evidence(lab, quad)
        if not all(side["supportFraction"] >= color.PHYSICAL_MINIMUM_SIDE_SUPPORT for side in sides.values()):
            continue
        diagonal = float(np.linalg.norm(quad[2] - quad[0]))
        if any(float(np.mean(np.linalg.norm(quad - existing, axis=1))) / diagonal < .012
               for _, existing, _ in supported):
            continue
        supported.append((score, quad, sides))
    if not supported:
        return _result(mat_color, "INSUFFICIENT_EVIDENCE", candidate_count=len(candidates),
                       advisory=color._advisory("NO_SUPPORTED_PHYSICAL_OUTLINE", None,
                       "No complete outline has supported card-to-mat evidence on all four sides."))
    score, quad, sides = supported[0]
    ratio, ambiguous = (color._canonical_ambiguity(supported[1][0] / score,
                        color.PHYSICAL_AMBIGUOUS_RUNNER_UP_RATIO)
                        if len(supported) > 1 else (None, False))
    for side in sides.values():
        side.update(candidateCount=len(supported), ambiguous=ambiguous)
    return _result(mat_color, "ABSTAIN" if ambiguous else "ACCEPTED",
                   proposal=None if ambiguous else quad, sides=sides,
                   candidate_count=len(supported), runner_up_ratio=ratio, ambiguous=ambiguous)
