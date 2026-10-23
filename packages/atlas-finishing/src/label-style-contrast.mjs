export const LABEL_STYLE_CONTRAST_VERSION = 'atlas-label-style-contrast-v1';
export const LABEL_STYLE_MINIMUM_BLACK_CONTRAST = 4.5;
const patterns = new Set(['NONE', 'DIAMOND', 'SHIMMER', 'STRIPES']);
const check = value => { if (!value) throw Error('LABEL_STYLE_CONTRAST_INVALID'); };

function rgb(color) {
  check(typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color));
  return [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16));
}
const hex = channels => `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`;
const channelLuminance = value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const contrast = channels => (channels.reduce((sum, c, i) => sum + channelLuminance(c) * [.2126, .7152, .0722][i], 0) + .05) / .05;
export const labelStyleContrastAgainstBlack = color => contrast(rgb(color));

// The search operates on final 8-bit channels, so hex rounding cannot leave
// the result just below the requested contrast threshold.
function minimumPassingColor(make, low, high) {
  for (let step = 0; step < 48; step++) {
    const mid = (low + high) / 2;
    if (contrast(make(mid)) >= LABEL_STYLE_MINIMUM_BLACK_CONTRAST) high = mid;
    else low = mid;
  }
  return make(high);
}

/** Brighten without shifting RGB ratios until one channel reaches its limit.
 * If the saturated hue still cannot clear black (notably pure blue), mix only
 * as much white as needed. Existing legible colors retain their exact value. */
export function labelStyleColorForBlack(color) {
  const channels = rgb(color);
  if (contrast(channels) >= LABEL_STYLE_MINIMUM_BLACK_CONTRAST) return color;
  const maximum = Math.max(...channels), maximumScale = maximum ? 255 / maximum : 1;
  const scaled = factor => channels.map(c => Math.min(255, Math.round(c * factor)));
  const saturated = scaled(maximumScale);
  if (contrast(saturated) >= LABEL_STYLE_MINIMUM_BLACK_CONTRAST) return hex(minimumPassingColor(scaled, 1, maximumScale));
  const blended = amount => saturated.map(c => Math.round(c + (255 - c) * amount));
  return hex(minimumPassingColor(blended, 0, 1));
}

/** One palette policy for Sports/Pokémon and every grade. Inversion changes
 * only the edge treatment; verified photograph tiles are never recolored. */
export function labelStyleContrast({ recipe, inverted = false } = {}) {
  check(recipe && Array.isArray(recipe.spans) && recipe.spans.length <= 32 && typeof inverted === 'boolean');
  let patterned = false;
  const spanColors = recipe.spans.map(span => {
    check(span && patterns.has(span.pattern)); rgb(span.baseColor); rgb(span.accentColor);
    if (span.pattern !== 'NONE') {
      patterned = true;
      return { baseColor: span.baseColor, accentColor: span.accentColor };
    }
    return { baseColor: labelStyleColorForBlack(span.baseColor), accentColor: labelStyleColorForBlack(span.accentColor) };
  });
  return { spanColors, outlineColor: inverted ? '#090a0b' : '#ffffff',
    outlineMm: inverted && spanColors.length ? .045 : patterned ? .025 : 0 };
}
