// @ts-nocheck
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

module.exports = { slugify, clamp };
