#!/usr/bin/env python3
"""Import approved B static pixels, without rendering SVG or choosing fonts.

Usage: python3 import-approved-b-assets.py /path/to/Atlas_Final_Approved_Labels
Requires Pillow. The supplied PNGs are the visual authority. Both front samples
must produce exactly the same static pixels after their documented dynamic
regions are cleared. The back is copied byte-for-byte, never resized or traced.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image, __version__ as pillow_version

GEOMETRY = {"widthMm": 68.342, "heightMm": 20.082,
            "pixelWidth": 6458, "pixelHeight": 1898, "ppi": 2400}
SIZE = (GEOMETRY["pixelWidth"], GEOMETRY["pixelHeight"])
# Left/top inclusive, right/bottom exclusive. These enclose only the mutable
# name, details, numeral, descriptor, certificate/frame and fixed support text.
# Bounds follow the supplied masters' element positions, with a small raster
# margin; no logo, NFC aperture, right border or outside silhouette is touched.
REGIONS_MM = {
    "name": [17.4, 2.95, 46.4, 11.2],
    "details": [17.4, 12.6, 46.6, 14.5],
    "grade": [58.0, 4.3, 67.9, 15.2],
    "descriptor": [58.0, 16.0, 67.2, 17.9],
    # Exact source's opaque clearing rectangle. Do not extend left into the
    # fingerprint ridges. The original connector at x<17.1 remains static.
    "certificateAndFrame": [17.1, 16.75, 47.3, 20.082],
}
SUPPORT_MM = [48.7, 15.2, 54.9, 18.7]
SAMPLES = ["Atlas_Michael_Jordan_Front", "Atlas_Alakazam_10_Front"]
# Immutable delivered PNGs. Changing the design requires a new asset version,
# not silently accepting a different package under these extraction rules.
SOURCE_HASHES = {
    "masters/Atlas_Michael_Jordan_Front.png": "26616a73baf01542fc4abf8d58a5ce8c525110f3f39bf18c96b319b22822cb42",
    "masters/Atlas_Alakazam_10_Front.png": "fa2ff887542d89cf5ab25881d9b8395aa57d00d8d6b0f6912fad380b70fa1413",
    "masters/Atlas_Shared_Back.png": "f83d36e2605b44837a01e1332edffa3309757cd01ed711ac72068389bb620ed7",
    "masters/Atlas_Michael_Jordan_Front.svg": "28623988b1a20d2872343d9e5cb559bcd1095a4c53cbcd94290b2c5437d8fa44",
    "masters/Atlas_Alakazam_10_Front.svg": "cb068efe6f5775ffac2e97c9f083256d8a43d6a1df08c9fd2c9cf6bdbde32312",
    "masters/Atlas_Shared_Back.svg": "b9c215ced7324b83d7e6a57c7188ff260d202046887a85413bed1c2550cdbe0a",
    "white_ink_plates/Atlas_Michael_Jordan_Front_WHITE.png": "511ed26fdf1174e312cc48296aa0cf32dc615c918838a1e97cde007d0b316a34",
    "white_ink_plates/Atlas_Alakazam_10_Front_WHITE.png": "f16c03f7f659cf44362a58fbb289981424ee52dbb348beeb9d6153e740c9e09b",
    "Back_Layout_Spec.json": "249d04aba5a9501459fd013fe8156ed73c6c47d7a577083028be968d41e5756c",
}


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def bounds(mm):
    sx, sy = SIZE[0] / GEOMETRY["widthMm"], SIZE[1] / GEOMETRY["heightMm"]
    return [math.floor(mm[0] * sx), math.floor(mm[1] * sy),
            math.ceil(mm[2] * sx), math.ceil(mm[3] * sy)]


def canonical(image):
    """Normalize only RGB channels of fully transparent pixels for comparison."""
    value = bytearray(image.convert("RGBA").tobytes())
    for offset in range(0, len(value), 4):
        if value[offset + 3] == 0:
            value[offset:offset + 3] = b"\0\0\0"
    return bytes(value)


def solid_ink_png(alpha, rgb, target):
    # The 256 palette entries have identical RGB and alpha 0..255. Thus this is
    # lossless alpha storage, NOT color quantization or a threshold operation.
    image = Image.frombytes("P", SIZE, alpha.tobytes())
    image.putpalette(list(rgb) * 256)
    image.info["transparency"] = bytes(range(256))
    image.save(target, optimize=True, compress_level=9, dpi=(2400, 2400))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "assets" / "approved-b")
    args = parser.parse_args()
    source, output = args.package.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sources = {}

    def read(relative):
        data = (source / relative).read_bytes()
        digest = sha256(data)
        if relative in SOURCE_HASHES and digest != SOURCE_HASHES[relative]:
            raise ValueError("Approved package hash mismatch: " + relative)
        sources[relative] = {"sha256": digest, "byteCount": len(data)}
        return data

    def load(relative):
        read(relative)
        image = Image.open(source / relative).convert("RGBA")
        if image.size != SIZE:
            raise ValueError("Approved package dimensions changed: " + relative)
        return image

    dynamic_pixels = {name: bounds(mm) for name, mm in REGIONS_MM.items()}
    support_pixels = bounds(SUPPORT_MM)
    static_values, support_values, receipts = [], [], []
    for sample in SAMPLES:
        original = load("masters/" + sample + ".png")
        # Reference SVG is provenance/geometry only. Its nested filters/masks
        # are not flattened here: renderer antialiasing differs from the PNG.
        read("masters/" + sample + ".svg")
        plate = load("white_ink_plates/" + sample + "_WHITE.png")
        static = original.copy()
        for rectangle in [*dynamic_pixels.values(), support_pixels]:
            static.paste((0, 0, 0, 255), rectangle)
        support = Image.new("RGBA", SIZE, (255, 255, 255, 0))
        support.paste(plate.crop(support_pixels), support_pixels)

        # Every visible static pixel must be black, and every support pixel
        # must be white. Do not silently recolor a changed source package.
        for red, green, blue, alpha in static.get_flattened_data():
            if alpha and (red or green or blue):
                raise ValueError("Unexpected visible nonblack static artwork")
        for red, green, blue, alpha in support.get_flattened_data():
            if alpha and (red, green, blue) != (255, 255, 255):
                raise ValueError("Unexpected nonwhite support plate")

        # Restore the original dynamic patches and composite only the isolated
        # GRADE/REPORT plate. All visible RGB and all alpha must match exactly.
        reconstructed = Image.alpha_composite(static, support)
        for rectangle in dynamic_pixels.values():
            reconstructed.paste(original.crop(rectangle), rectangle)
        expected = canonical(original)
        if canonical(reconstructed) != expected:
            raise ValueError("Reconstruction does not reproduce approved sample")
        static_values.append(canonical(static))
        support_values.append(canonical(support))
        receipts.append({"source": "masters/" + sample + ".png",
                         "canonicalRgbaSha256": sha256(expected),
                         "reconstructionDifferingPixels": 0})

    if static_values[0] != static_values[1] or support_values[0] != support_values[1]:
        raise ValueError("Approved samples do not share identical static artwork")
    static = Image.frombytes("RGBA", SIZE, static_values[0])
    support = Image.frombytes("RGBA", SIZE, support_values[0])
    solid_ink_png(static.getchannel("A"), (0, 0, 0), output / "front-black.png")
    solid_ink_png(support.getchannel("A"), (255, 255, 255), output / "front-support-white.png")
    solid_ink_png(support.getchannel("A"), (0, 0, 0), output / "front-support-black.png")
    if canonical(Image.open(output / "front-black.png")) != static_values[0]:
        raise ValueError("Static PNG encoding changed pixels")
    if canonical(Image.open(output / "front-support-white.png")) != support_values[0]:
        raise ValueError("Support PNG encoding changed pixels")
    if Image.open(output / "front-support-black.png").convert("RGBA").getchannel("A").tobytes() != support.getchannel("A").tobytes():
        raise ValueError("Support knockout encoding changed alpha")
    back_bytes = read("masters/Atlas_Shared_Back.png")
    (output / "back-black.png").write_bytes(back_bytes)
    back = Image.open(output / "back-black.png").convert("RGBA")
    if back.size != SIZE or any(alpha and (r or g or b) for r, g, b, alpha in back.get_flattened_data()):
        raise ValueError("Back dimensions or black/transparent channels changed")
    read("masters/Atlas_Shared_Back.svg")
    read("Back_Layout_Spec.json")
    back_spec = json.loads((source / "Back_Layout_Spec.json").read_text())
    original_svg = ElementTree.parse(source / "masters/Atlas_Alakazam_10_Front.svg")
    namespace = {"svg": "http://www.w3.org/2000/svg"}
    grade10 = original_svg.find('.//svg:mask[@id="ink-mask"]/svg:g[@transform="translate(0,0.5) translate(58.35,4.15)"]', namespace)
    if grade10 is None or len(list(grade10)) != 2:
        raise ValueError("Approved grade-10 vector structure changed")
    for element in grade10.iter():
        element.tag = element.tag.split("}")[-1]
        if element.tag not in ["g", "path"] or any(key not in ["transform", "d", "fill-rule"] for key in element.attrib):
            raise ValueError("Unexpected approved grade-10 vector element")
    vectors = {"version": "atlas-approved-b-vector-parts-v1",
               "grade10": ElementTree.tostring(grade10, encoding="unicode").strip(),
               "grade10BoundsMm": {"x": 58.35, "y": 4.65, "width": 9.47, "height": 10.2},
               "source": "masters/Atlas_Alakazam_10_Front.svg"}
    (output / "vectors.json").write_text(json.dumps(vectors, indent=2) + "\n")

    files = {}
    for name in ["front-black.png", "front-support-white.png", "front-support-black.png", "back-black.png"]:
        data = (output / name).read_bytes()
        files[name] = {"sha256": sha256(data), "byteCount": len(data),
                       "pixelWidth": SIZE[0], "pixelHeight": SIZE[1]}
    vector_bytes = (output / "vectors.json").read_bytes()
    files["vectors.json"] = {"sha256": sha256(vector_bytes), "byteCount": len(vector_bytes)}
    front_embedding = sum(4 * math.ceil(files[name]["byteCount"] / 3) + 22
                          for name in ["front-black.png", "front-support-white.png"])
    if front_embedding >= 1024 * 1024:
        raise ValueError("Static front data URIs exceed the existing artwork bound")
    manifest = {
        "version": "atlas-approved-b-static-assets-v1",
        "sourcePackage": "Atlas_Final_Approved_Labels.zip",
        "geometry": GEOMETRY, "files": files, "sources": sources,
        "front": {
            "blackAsset": "front-black.png", "supportWhiteAsset": "front-support-white.png",
            "supportBlackAsset": "front-support-black.png",
            "dynamicRegions": {name: {"mmBounds": mm, "pixelBounds": dynamic_pixels[name]}
                               for name, mm in REGIONS_MM.items()},
            "supportRegion": {"mmBounds": SUPPORT_MM, "pixelBounds": support_pixels,
                              "text": ["GRADE", "REPORT"]},
            "regionConvention": "left-top-inclusive-right-bottom-exclusive",
            "nfcApertureMm": {"cx": 51.8, "cy": 9.75, "radius": 5.1},
            "logoTransform": "translate(1.9,4.9) scale(0.012277580) translate(-60,-118)",
            "certificateFrame": {"xMm": 17.5, "yMm": 17.0, "heightMm": 2.1,
                                 "radiusMm": 0.85, "strokeWidthMm": 0.3,
                                 "widthPolicy": "fit dynamic certificate; preserve closed frame",
                                 "leadingPathRetainedLeftOfMm": 17.1,
                                 "leadingPath": "M16.9 18.08 C17.1 18.08 17.25 18.05 17.50 18.05"},
            "originalGrade10VectorAsset": "vectors.json",
            "staticDataUriByteCount": front_embedding,
            "remainingSvgByteBudget": 1024 * 1024 - front_embedding,
        },
        "back": {"blackAsset": "back-black.png", "sourceBytesPreserved": True,
                 "containsWhiteInk": False, "websiteQrUrl": "https://atlasgrading.com/",
                 "layout": back_spec},
        "verification": {
            "method": "exact-source-png-dynamic-region-extraction-v1",
            "svgRasterizationUsed": False,
            "reason": "Sharp/librsvg and WebKit reproduce the SVG shapes but differ from supplied PNG raster/alpha values; direct approved PNG extraction avoids that rasterization variance.",
            "resampling": False, "tracing": False, "fontSubstitution": False,
            "alphaThresholding": False, "sharedStaticDifferingPixels": 0,
            "transparentRgbPolicy": "Only RGB of fully transparent pixels normalized to zero for comparison; every alpha byte and every visible RGB byte preserved outside explicit dynamic/support rectangles.",
            "samples": receipts,
            "tool": {"python": "3", "pillow": pillow_version},
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "VERIFIED", "files": files,
                      "frontDataUriBytes": front_embedding,
                      "sharedStaticDifferingPixels": 0,
                      "reconstructionDifferingPixels": 0}, indent=2))


if __name__ == "__main__":
    main()
