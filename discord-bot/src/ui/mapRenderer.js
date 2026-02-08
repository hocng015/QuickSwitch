/**
 * Map image renderer for the /go wizard.
 * Fetches FFXIV zone maps from XIVAPI, composites a pin marker at the
 * specified map coordinates, and returns a PNG buffer for Discord embeds.
 */

import sharp from 'sharp';

// ========== Configuration ==========

/** Output image size in pixels (square). Discord renders embeds nicely at this size. */
const OUTPUT_SIZE = 512;

/** In-memory LRU cache for fetched map images. */
const mapImageCache = new Map();
const MAP_CACHE_MAX = 30;
const MAP_CACHE_TTL = 30 * 60_000; // 30 minutes

// ========== Map Image Fetching ==========

/**
 * Fetch a map image from XIVAPI CDN with caching.
 * @param {string} mapId - Map ID path, e.g. "s1f1"
 * @param {string} region - Map region, e.g. "00"
 * @returns {Promise<Buffer>} Raw JPEG buffer (2048x2048)
 */
async function fetchMapImage(mapId, region = '00') {
    const cacheKey = `${mapId}/${region}`;
    const cached = mapImageCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
        return cached.buffer;
    }

    const url = `https://v2.xivapi.com/api/asset/map/${mapId}/${region}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch map image from XIVAPI: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Evict oldest entry if cache is full
    if (mapImageCache.size >= MAP_CACHE_MAX) {
        const oldest = mapImageCache.keys().next().value;
        mapImageCache.delete(oldest);
    }

    mapImageCache.set(cacheKey, { buffer, expires: Date.now() + MAP_CACHE_TTL });
    return buffer;
}

// ========== Coordinate Conversion ==========

/**
 * Convert FFXIV map coordinates (what players see on the map) to pixel
 * coordinates on the 2048x2048 map image.
 *
 * Formula derived from ffxiv-datamining MapCoordinates.md:
 *   pixelCoord = (mapCoord - 1) * sizeFactor / 2
 *
 * The offsets cancel out in the map-coord-to-pixel conversion because
 * map coordinates already account for the offset.
 *
 * @param {number} mapX - Map X coordinate (typically 1-42)
 * @param {number} mapY - Map Y coordinate (typically 1-42)
 * @param {number} sizeFactor - Map size factor (e.g. 100, 200)
 * @returns {{ x: number, y: number }} Pixel coordinates on 2048x2048 image
 */
function mapToPixel(mapX, mapY, sizeFactor) {
    return {
        x: (mapX - 1) * sizeFactor / 2,
        y: (mapY - 1) * sizeFactor / 2,
    };
}

// ========== Pin Marker ==========

/**
 * Create an SVG overlay with a pin marker at the specified position.
 * Uses SVG because sharp natively supports compositing SVG buffers.
 *
 * @param {number} pixelX - X position on the source 2048x2048 image
 * @param {number} pixelY - Y position on the source 2048x2048 image
 * @param {number} outputSize - Output image dimensions
 * @param {number} sourceSize - Source image dimensions (2048)
 * @returns {Buffer} SVG buffer
 */
function createPinSvg(pixelX, pixelY, outputSize, sourceSize) {
    const scale = outputSize / sourceSize;
    const cx = Math.round(pixelX * scale);
    const cy = Math.round(pixelY * scale);

    // Pin dimensions
    const r = 8;       // Main circle radius
    const bw = 2;      // Border width
    const crossLen = 6; // Crosshair arm length
    const crossGap = 2; // Gap between circle and crosshair

    return Buffer.from(`<svg width="${outputSize}" height="${outputSize}" xmlns="http://www.w3.org/2000/svg">
  <!-- Drop shadow -->
  <circle cx="${cx}" cy="${cy}" r="${r + bw + 1}" fill="rgba(0,0,0,0.4)" />
  <!-- White border -->
  <circle cx="${cx}" cy="${cy}" r="${r + bw}" fill="#FFFFFF" />
  <!-- Red pin -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FF3333" />
  <!-- Inner dot -->
  <circle cx="${cx}" cy="${cy}" r="3" fill="#FFFFFF" />
  <!-- Crosshair lines -->
  <line x1="${cx - r - crossLen}" y1="${cy}" x2="${cx - r - crossGap}" y2="${cy}" stroke="#FFFFFF" stroke-width="2" />
  <line x1="${cx + r + crossGap}" y1="${cy}" x2="${cx + r + crossLen}" y2="${cy}" stroke="#FFFFFF" stroke-width="2" />
  <line x1="${cx}" y1="${cy - r - crossLen}" x2="${cx}" y2="${cy - r - crossGap}" stroke="#FFFFFF" stroke-width="2" />
  <line x1="${cx}" y1="${cy + r + crossGap}" x2="${cx}" y2="${cy + r + crossLen}" stroke="#FFFFFF" stroke-width="2" />
</svg>`);
}

// ========== Main Export ==========

/**
 * Generate a map preview image with a pin at the specified coordinates.
 *
 * @param {string} mapId - XIVAPI map ID, e.g. "s1f1/00" (with region suffix).
 *                         Both the plugin and territories.js include the region.
 * @param {number} mapX - Map X coordinate (what players see)
 * @param {number} mapY - Map Y coordinate (what players see)
 * @param {number} sizeFactor - Map size factor (e.g. 100, 200)
 * @returns {Promise<Buffer>} PNG image buffer ready for AttachmentBuilder
 */
export async function renderMapPreview(mapId, mapX, mapY, sizeFactor) {
    // Split mapId into base and region (e.g. "s1f1/00" → "s1f1", "00")
    let base, region;
    if (mapId.includes('/')) {
        [base, region] = mapId.split('/');
    } else {
        base = mapId;
        region = '00';
    }

    // Fetch the base map image (2048x2048 JPEG)
    const mapBuffer = await fetchMapImage(base, region);

    // Calculate pixel position on the 2048x2048 source
    const pixel = mapToPixel(mapX, mapY, sizeFactor);

    // Clamp to image bounds
    const sourceSize = 2048;
    pixel.x = Math.max(0, Math.min(sourceSize - 1, pixel.x));
    pixel.y = Math.max(0, Math.min(sourceSize - 1, pixel.y));

    // Create pin SVG overlay
    const pinSvg = createPinSvg(pixel.x, pixel.y, OUTPUT_SIZE, sourceSize);

    // Composite: resize map to output size, overlay pin, output PNG
    const result = await sharp(mapBuffer)
        .resize(OUTPUT_SIZE, OUTPUT_SIZE)
        .composite([{
            input: pinSvg,
            top: 0,
            left: 0,
        }])
        .png()
        .toBuffer();

    return result;
}
