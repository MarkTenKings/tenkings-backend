# Barlow font family

This directory vendors the complete user-supplied static Barlow family for deterministic Ten Kings label rendering on Mac and PC. It contains normal and italic faces at weights 100 through 900 and the original SIL Open Font License 1.1.

## Usage

- Browser/CSS: import `barlow.css`, then use `font-family: "Barlow", sans-serif` with the declared numeric weight and style.
- PDF/SVG or other renderers: load the exact `.ttf` file directly from this directory; do not depend on a machine-installed font or a Google Fonts network request.
- Recommended label metadata starting point: `Barlow-SemiBold.ttf` (600) or `Barlow-Bold.ttf` (700). Use `Barlow-ExtraBold.ttf` (800) or `Barlow-Black.ttf` (900) only when the smaller counters remain legible in an actual-size proof.
- Do not synthesize bold or italic. Select the matching static file.

Adding this family does not change the approved Label V1 renderer automatically. Any switch from Bebas Neue to Barlow must update the frozen template/font hashes, regenerate the full proof bundle twice, and complete the existing actual-size and 300-DPI inspection gates.

## Weight map

| Weight | Normal | Italic |
|---:|---|---|
| 100 | `Barlow-Thin.ttf` | `Barlow-ThinItalic.ttf` |
| 200 | `Barlow-ExtraLight.ttf` | `Barlow-ExtraLightItalic.ttf` |
| 300 | `Barlow-Light.ttf` | `Barlow-LightItalic.ttf` |
| 400 | `Barlow-Regular.ttf` | `Barlow-Italic.ttf` |
| 500 | `Barlow-Medium.ttf` | `Barlow-MediumItalic.ttf` |
| 600 | `Barlow-SemiBold.ttf` | `Barlow-SemiBoldItalic.ttf` |
| 700 | `Barlow-Bold.ttf` | `Barlow-BoldItalic.ttf` |
| 800 | `Barlow-ExtraBold.ttf` | `Barlow-ExtraBoldItalic.ttf` |
| 900 | `Barlow-Black.ttf` | `Barlow-BlackItalic.ttf` |

## SHA-256 inventory

| File | SHA-256 |
|---|---|
| `Barlow-Black.ttf` | `3cd28e18114e7f701b6117a282ccaa99ff3a867d855ec7138274ec6f15e05913` |
| `Barlow-BlackItalic.ttf` | `cbca36a4ec89242c454070f2e068580d34c90a35436da535d43eeb133a10f542` |
| `Barlow-Bold.ttf` | `984a0f81f4b34352fdf463d201091f9be8e5f6be66277779ddec6d3644d77ecf` |
| `Barlow-BoldItalic.ttf` | `924426ca24b4b0606774f19ae152f0ebb3dd0314fa4153a60cc7bcbdadf53979` |
| `Barlow-ExtraBold.ttf` | `3bbffb00f916dc17f3abfcc05533e9018d7b46b8b2271afd796e5f9e8586b706` |
| `Barlow-ExtraBoldItalic.ttf` | `e91147b70e37ffe430bd45c02bc5aa23deab95c93539ad599c5735a37319d732` |
| `Barlow-ExtraLight.ttf` | `582514aa0a152cdeda980773b02372b1a662a3cd5db46ea279029f7d73079b7b` |
| `Barlow-ExtraLightItalic.ttf` | `e2a302e84f3d6a2b048ccebdc44d463ff1e4a1f64e9a6ffc5f04af032b0bd75f` |
| `Barlow-Italic.ttf` | `b4f6fcb952de98bb75f9754526213f4a8f5bf0878638e60730c8bc947f29ce2a` |
| `Barlow-Light.ttf` | `c9e9410bad3b4efb1cffaa0edc4f31ac2365689edbc65aa2b7c48ed0aedd46a4` |
| `Barlow-LightItalic.ttf` | `6577eafb9a847039d16cb8dbca9571fbd98429f988c67e4e5c46f5fa693b54ec` |
| `Barlow-Medium.ttf` | `f1f57edb6604f544ff75805ce37fffcd05ae00c308b0a0e83d28da1faa902fe1` |
| `Barlow-MediumItalic.ttf` | `0a5e8646d4b02495ef6f09df59ff65f3b8d456d46723807594a467df235787bd` |
| `Barlow-Regular.ttf` | `77fb1ac54d2ceb980e3ebdfa7a9d0f64e85a66e4fdfb7f914a7b0aa08fb33a5d` |
| `Barlow-SemiBold.ttf` | `07ea3ff2743cf6716122a520c5e6f1aed0e75c079bc3b75e512fbf1a85caef9b` |
| `Barlow-SemiBoldItalic.ttf` | `aad663fc84b5bf01687d39d87acb22d36ab4b4f7167cf44aac36498a620099c9` |
| `Barlow-Thin.ttf` | `547b19097809e17861a9c0a09ea41b6a98f4981c71688bf66041763080deba20` |
| `Barlow-ThinItalic.ttf` | `3ebc2a4ec301bdc518814d181921761f2752ecdb624a13fe2b9d06db0e78c7df` |
| `OFL-Barlow.txt` | `b1fdb0a932913e455b992402cea57253160f9b043254435520dcfbe6b17bec8c` |
