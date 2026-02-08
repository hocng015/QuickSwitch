/**
 * Reverse zone name lookup — maps normalized zone names to territory data.
 * Built from territories.js at module load for O(1) lookups.
 * Includes community aliases from zoneAliases.js for abbreviated zone names.
 */

import { territories } from './territories.js';
import { zoneAliases } from './zoneAliases.js';

// Map<normalizedName, { territoryId, mapId, sizeFactor, zoneName, offsetX, offsetY }>
const zoneIndex = new Map();

// Also build a list of entries for substring matching
const zoneEntries = [];

for (const [id, data] of Object.entries(territories)) {
    const normalized = data.zoneName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const entry = { territoryId: Number(id), ...data };
    zoneIndex.set(normalized, entry);
    zoneEntries.push({ normalized, entry });
}

// Build alias → entry lookup by resolving alias targets to zone entries
// Map<aliasKey, entry>
const aliasIndex = new Map();
for (const [alias, officialName] of zoneAliases) {
    const normalizedOfficial = officialName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const entry = zoneIndex.get(normalizedOfficial);
    if (entry) {
        aliasIndex.set(alias, entry);
    }
}

/**
 * Find a zone by name. Tries exact match, then alias, then substring.
 * @param {string} name - Zone name to search for
 * @returns {{ territoryId: number, mapId: string, sizeFactor: number, zoneName: string, offsetX: number, offsetY: number } | null}
 */
export function findZone(name) {
    if (!name) return null;
    const normalized = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!normalized) return null;

    // Exact match against official zone names
    if (zoneIndex.has(normalized)) return zoneIndex.get(normalized);

    // Alias match (community abbreviations like "cwh", "fringes", "rak", etc.)
    if (aliasIndex.has(normalized)) return aliasIndex.get(normalized);

    // Substring match — check if any known zone name is contained in the input
    // or if the input is contained in a known zone name
    let bestMatch = null;
    let bestLength = 0;
    for (const { normalized: key, entry } of zoneEntries) {
        if (key.includes(normalized) || normalized.includes(key)) {
            // Prefer longer matches (more specific)
            if (key.length > bestLength) {
                bestMatch = entry;
                bestLength = key.length;
            }
        }
    }
    return bestMatch;
}

/**
 * Try to find a zone name within a larger text corpus.
 * Scans the text for official zone name substrings and community aliases.
 * @param {string} text - Text to search within
 * @returns {{ territoryId: number, mapId: string, sizeFactor: number, zoneName: string, offsetX: number, offsetY: number } | null}
 */
export function findZoneInText(text) {
    if (!text) return null;
    const lower = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');

    let bestMatch = null;
    let bestLength = 0;

    // Check official zone names (substring match)
    for (const { normalized: key, entry } of zoneEntries) {
        if (key.length > 3 && lower.includes(key)) {
            if (key.length > bestLength) {
                bestMatch = entry;
                bestLength = key.length;
            }
        }
    }

    // Check community aliases (word-boundary match to avoid false positives)
    // Only use alias if no official zone name was already found via substring
    if (!bestMatch) {
        let bestAliasLen = 0;
        for (const [alias, entry] of aliasIndex) {
            if (alias.length < 3) continue; // skip very short aliases in free-text search
            const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            if (regex.test(lower) && alias.length > bestAliasLen) {
                bestMatch = entry;
                bestAliasLen = alias.length;
            }
        }
    }

    return bestMatch;
}
