/**
 * Hunt notification message parser.
 * Extracts hunt information (mob, rank, world, zone, coordinates, instance)
 * from Discord messages using flexible regex patterns.
 * Works with both plain text and embed-based messages from any hunt bot.
 *
 * Supported formats:
 * - Faloop / Aether Hunts: embed title "[World] MobName", :smob: custom emoji,
 *   :aetheryte: Location ⇒ 🚩 X, Y, rank from embed color or (S)/(A)/(B)
 * - Sonar / Centurio: structured embed fields (World, Zone, Coordinates, Rank)
 * - Plain text: "S Rank: Ixion spawned on Gilgamesh in The Lochs (24.5, 23.8) i3"
 * - Manual /hunt report: modal-submitted world, zone, coords, details
 */

import { getAllWorlds } from '../data/worlds.js';
import { findZone, findZoneInText } from '../data/zoneIndex.js';
import { worldAliases } from '../data/worldAliases.js';

// Pre-build a lowercase Set of all world names for O(1) lookup
const allWorldsLower = new Map();
for (const world of getAllWorlds()) {
    allWorldsLower.set(world.toLowerCase(), world);
}

// Known FFXIV S-rank, SS-rank, A-rank mob names for fallback identification
// This list covers popular mobs; the parser doesn't depend on it exclusively
const KNOWN_HUNT_MOBS = new Set([
    // Endwalker S
    'ker', 'storsie', 'sphatika', 'armstrong',
    // Endwalker A
    'minerva', 'lunatender queen', 'petalodus', 'yilan',
    'sugaar', 'storsie', 'burfurlur', 'aegeiros',
    // Shadowbringers S
    'tarchia', 'gunitt', 'aglaope', 'forgiven rebellion',
    // Stormblood S
    'ixion', 'gamma', 'okina', 'udumbara',
    'salt and light', 'bone crawler',
    // Heavensward S
    'leucrotta', 'gandarewa', 'bird of paradise',
    'kaiser behemoth', 'senmurv', 'the pale rider',
    // ARR S
    'croque-mitaine', 'croakadile', 'laideronnette',
    'nandi', 'mindflayer', 'safat', 'brontes',
    'garlok', 'bonnacon', 'lampalagua', 'minhocao',
    'nunyunuwi', 'thousand-cast theda', 'zona seeker',
    'agrippa the mighty', 'chernobog',
    // Dawntrail S (if applicable)
    'the forecaster', 'kirlirger', 'queen hawk', 'atticus the primogenitor',
    // SS
    'archaeotania', 'forgiven rebellion', 'chi',
]);

// ========== Train Detection ==========

/**
 * Check if a message is a hunt TRAIN announcement (as opposed to an
 * individual hunt sighting). Used to tag the result, not to filter.
 */
function isTrainAnnouncement(corpus) {
    const trainPhrases = [
        /\btrain\b/i,
        /\bconductor/i,
        /\bnut\s+train\b/i,
        /\bhunt\s+train\b/i,
        /starting\s+(?:a\s+)?train/i,
        /join\s+(?:the\s+)?train/i,
    ];

    for (const pattern of trainPhrases) {
        if (pattern.test(corpus)) return true;
    }
    return false;
}

/**
 * Extract starting zones from train announcements.
 * Handles formats like:
 *   "EW starts at Archeion, Labyrinthos" → "Labyrinthos"
 *   "MIDGARD StB TRAIN - Castrum Orien, Fringe" → "The Fringes"
 *   "SB train starting Fringes" → "The Fringes"
 * Returns the first zone found.
 */
function extractTrainStartZone(corpus) {
    // Strategy 1: "starts at <aetheryte>, <zone>" or "starts at <zone>"
    const patterns = [
        /starts?\s+at\s+[^,\n]+,\s*([A-Z][A-Za-z\s'-]+)/g,  // "starts at X, ZoneName"
        /starts?\s+at\s+([A-Z][A-Za-z\s'-]+)/g,               // "starts at ZoneName"
        /starting\s+(?:at\s+)?([A-Z][A-Za-z\s'-]+)/g,         // "starting ZoneName"
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(corpus)) !== null) {
            const candidate = match[1].trim();
            const zoneData = findZone(candidate) || findZoneInText(candidate);
            if (zoneData) return zoneData.zoneName;
        }
    }

    // Strategy 2: "TRAIN - <aetheryte>, <zone>" (dash-separated format)
    const dashPattern = /train\s*[-–—]\s*([^,\n]+),\s*([A-Za-z\s'-]+)/gi;
    let dashMatch;
    while ((dashMatch = dashPattern.exec(corpus)) !== null) {
        // Try the part after the comma first (usually the zone)
        const afterComma = dashMatch[2].trim();
        const zoneData = findZone(afterComma) || findZoneInText(afterComma);
        if (zoneData) return zoneData.zoneName;
        // Try the part before the comma (might be the zone directly)
        const beforeComma = dashMatch[1].trim();
        const zoneData2 = findZone(beforeComma) || findZoneInText(beforeComma);
        if (zoneData2) return zoneData2.zoneName;
    }

    return null;
}

// ========== Extraction Functions ==========

/**
 * Extract structured data from Discord embeds.
 * Handles both structured-field embeds (Sonar) and description-based embeds (Faloop).
 */
function extractFromEmbeds(embeds) {
    const data = { world: null, zone: null, x: null, y: null, rank: null, instance: null, mobName: null };
    if (!embeds || embeds.length === 0) return data;

    for (const embed of embeds) {
        // --- Check structured fields first (Sonar, Centurio, etc.) ---
        if (embed.fields) {
            for (const field of embed.fields) {
                const name = (field.name || '').toLowerCase();
                const value = (field.value || '').trim();

                if (/^(world|server)$/i.test(name)) {
                    const w = matchWorld(value);
                    if (w) data.world = w;
                }
                if (/^(zone|location|area|map|region)$/i.test(name)) {
                    data.zone = value;
                }
                if (/^(coord|coords|coordinates|position|pos)$/i.test(name)) {
                    const coords = extractCoords(value);
                    if (coords) { data.x = coords.x; data.y = coords.y; }
                }
                if (/^(instance|inst)$/i.test(name)) {
                    const inst = extractInstance(value);
                    if (inst) data.instance = inst;
                }
                if (/^(rank|type)$/i.test(name)) {
                    const r = extractRankFromText(value);
                    if (r) data.rank = r;
                }
                if (/^(mob|monster|target|name|hunt)$/i.test(name)) {
                    if (value.length > 1 && value.length < 60) {
                        data.mobName = value;
                    }
                }
            }
        }

        // --- Faloop / Aether Hunts title format: "[World] MobName" ---
        if (embed.title) {
            const titleWorldMob = embed.title.match(/^\[([^\]]+)\]\s*(.+)$/);
            if (titleWorldMob) {
                const w = matchWorld(titleWorldMob[1]);
                if (w) data.world = w;
                const mobCandidate = titleWorldMob[2].trim();
                if (mobCandidate.length > 1 && mobCandidate.length < 60) {
                    data.mobName = mobCandidate;
                }
            }
            // Also try other embed title formats: "S Rank: MobName", "[S] MobName"
            else if (!data.mobName) {
                const cleaned = embed.title
                    .replace(/\[?(?:SS?|A|B)\]?\s*[-:]?\s*(?:rank\s*[-:]?\s*)?/i, '')
                    .replace(/spawned|killed|found|spotted|detected/gi, '')
                    .trim();
                if (cleaned.length > 1 && cleaned.length < 60) {
                    data.mobName = cleaned;
                }
            }
        }

        // --- Faloop description parsing ---
        if (embed.description) {
            const desc = embed.description;

            // Normalize Discord custom emojis: <:name:id> → :name:
            const descNorm = desc.replace(/<(:\w+:)\d+>/g, '$1');

            // :smob: MobName or :mob: MobName (custom emoji format)
            // Discord API sends custom emojis as <:smob:123456789>, normalized above
            if (!data.mobName) {
                const smobPatterns = [
                    /:s?mob:\s*(.+?)(?:\n|$)/i,                // :smob: Laideronnette
                    /:s?mob:\s*\*{0,2}(.+?)\*{0,2}(?:\n|$)/i, // :smob: **Laideronnette**
                ];
                for (const pattern of smobPatterns) {
                    const smobMatch = descNorm.match(pattern);
                    if (smobMatch) {
                        const mobCandidate = smobMatch[1].replace(/\*+/g, '').trim();
                        if (mobCandidate.length > 1 && mobCandidate.length < 60) {
                            data.mobName = mobCandidate;
                            break;
                        }
                    }
                }
            }

            // :aetheryte: Location ⇒ 🚩 X, Y  (various Faloop formats)
            // Also handle raw custom emoji format: <:aetheryte:123456>
            const descForCoords = descNorm;
            const aetherytePatterns = [
                // :aetheryte: Bentbranch Meadows ⇒ 🚩 15.8, 19.7
                /:aetheryte:\s*.+?[⇒→=>]+\s*(?:🚩\s*)?(\d{1,2}(?:\.\d{1,2})?)\s*,\s*(\d{1,2}(?:\.\d{1,2})?)/i,
                // 🚩 15.8, 19.7 (standalone flag + coords)
                /🚩\s*(\d{1,2}(?:\.\d{1,2})?)\s*,\s*(\d{1,2}(?:\.\d{1,2})?)/,
                // Generic coords in description
                /(\d{1,2}\.\d{1,2})\s*,\s*(\d{1,2}\.\d{1,2})/,
            ];
            if (data.x == null) {
                for (const pattern of aetherytePatterns) {
                    const match = descForCoords.match(pattern);
                    if (match) {
                        const ax = parseFloat(match[1]);
                        const ay = parseFloat(match[2]);
                        if (ax >= 1 && ax <= 42 && ay >= 1 && ay <= 42) {
                            data.x = ax;
                            data.y = ay;
                            break;
                        }
                    }
                }
            }

            // Extract zone from description: look for lines with :map: or zone-like content
            if (!data.zone) {
                const mapPatterns = [
                    /:map:\s*(.+?)(?:\n|$)/i,            // :map: Central Shroud
                    /zone:\s*(.+?)(?:\n|$)/i,             // Zone: Central Shroud
                ];
                for (const pattern of mapPatterns) {
                    const mapMatch = descNorm.match(pattern);
                    if (mapMatch) {
                        data.zone = mapMatch[1].trim();
                        break;
                    }
                }
            }

            // Rank from (S), (A), (B) or (SS) in description text
            if (!data.rank) {
                const descRank = descNorm.match(/\(([SAB]{1,2})\)/);
                if (descRank) {
                    data.rank = descRank[1].toUpperCase();
                }
            }

            // Also try :srank:, :arank:, :brank: custom emoji patterns
            if (!data.rank) {
                if (/:srank:/i.test(descNorm) || /:smob:/i.test(descNorm)) {
                    data.rank = 'S';
                } else if (/:arank:/i.test(descNorm) || /:amob:/i.test(descNorm)) {
                    data.rank = 'A';
                } else if (/:brank:/i.test(descNorm) || /:bmob:/i.test(descNorm)) {
                    data.rank = 'B';
                }
            }

            // Instance from description: i1-i9 pattern or "Instance X"
            if (!data.instance) {
                const instMatch = extractInstance(descNorm);
                if (instMatch) data.instance = instMatch;
            }
        }

        // --- Rank from embed color (Faloop uses specific colors per rank) ---
        if (!data.rank && embed.color != null) {
            // Common color conventions:
            // Red tones (0xFF0000, 0xCC0000, 0xED4245, etc.) = S rank
            // Orange tones (0xFFA500, 0xFF8C00, 0xE67E22, etc.) = A rank
            // Blue/teal tones (0x5865F2, 0x3498DB, etc.) = B rank
            // We use a broad hue-based check rather than exact values
            const r = (embed.color >> 16) & 0xFF;
            const g = (embed.color >> 8) & 0xFF;
            const b = embed.color & 0xFF;

            if (r > 180 && g < 80 && b < 80) {
                data.rank = 'S'; // Red = S rank
            } else if (r > 180 && g > 100 && g < 200 && b < 80) {
                data.rank = 'A'; // Orange = A rank
            }
            // Don't guess B from blue — too many embeds use blue as default
        }
    }

    return data;
}

/**
 * Try to match a single token to a world name.
 * Checks exact match, then alias lookup, then unique prefix match (min 4 chars).
 * e.g. "midgard" → "Midgardsormr", "greg" → "Gilgamesh", "sarg" → "Sargatanas"
 */
function matchWorldToken(token) {
    if (!token || token.length < 3) return null;
    // Strip common prefixes/suffixes from Discord mentions and formatting
    // e.g. "@Gilg" → "Gilg", "#Siren" → "Siren", "[Gilg]" → "Gilg"
    const cleaned = token.replace(/^[@#\[\(]+|[\]\)]+$/g, '');
    if (!cleaned || cleaned.length < 3) return null;
    const lower = cleaned.toLowerCase();

    // Exact match against official names
    const exact = allWorldsLower.get(lower);
    if (exact) return exact;

    // Alias lookup (handles nicknames like "greg", short forms like "mid", "beh", misspellings like "marlboro")
    const alias = worldAliases.get(lower);
    if (alias) return alias;

    // Prefix match (min 4 chars to avoid false positives like "ada" matching "Adamantoise")
    if (lower.length >= 4) {
        let prefixMatch = null;
        for (const [worldLower, worldName] of allWorldsLower) {
            if (worldLower.startsWith(lower)) {
                if (prefixMatch) return null; // Ambiguous — multiple worlds match this prefix
                prefixMatch = worldName;
            }
        }
        if (prefixMatch) return prefixMatch;
    }

    return null;
}

/**
 * Match a token against all known FFXIV world names.
 */
function matchWorld(text) {
    if (!text) return null;
    const words = text.split(/[\s,;|/]+/);
    for (const word of words) {
        const match = matchWorldToken(word);
        if (match) return match;
    }
    return null;
}

/**
 * Find all world names in a text corpus.
 */
function findWorldsInText(text) {
    if (!text) return [];
    const found = [];
    const words = text.split(/[\s,;|/()\[\]]+/);
    for (const word of words) {
        const match = matchWorldToken(word);
        if (match) found.push(match);
    }
    return [...new Set(found)];
}

/**
 * Extract coordinates from text using multiple regex patterns.
 */
function extractCoords(text) {
    if (!text) return null;

    const patterns = [
        // X: 24.5, Y: 23.8 (labeled format)
        /[Xx]\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*[,;]?\s*[Yy]\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)/,
        // 🚩 15.8, 19.7 (flag emoji prefix)
        /🚩\s*(\d{1,2}(?:\.\d{1,2})?)\s*,\s*(\d{1,2}(?:\.\d{1,2})?)/,
        // ⇒ 15.8, 19.7 (arrow prefix)
        /[⇒→=>]+\s*(?:🚩\s*)?(\d{1,2}(?:\.\d{1,2})?)\s*,\s*(\d{1,2}(?:\.\d{1,2})?)/,
        // (24.5, 23.8) — parenthesized pair
        /\(\s*(\d{1,2}(?:\.\d{1,2})?)\s*,\s*(\d{1,2}(?:\.\d{1,2})?)\s*\)/,
        // 24.5, 23.8 — bare comma-separated pair (must both be in map range)
        /(?<!\d)(\d{1,2}\.\d{1,2})\s*,\s*(\d{1,2}\.\d{1,2})(?!\d)/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const x = parseFloat(match[1]);
            const y = parseFloat(match[2]);
            // Valid FFXIV map coords are roughly 1-42
            if (x >= 1 && x <= 42 && y >= 1 && y <= 42) {
                return { x, y };
            }
        }
    }
    return null;
}

/**
 * Extract instance number from text.
 */
function extractInstance(text) {
    if (!text) return null;

    const patterns = [
        /\bi(\d)\b/i,                    // i3
        /Instance\s*#?\s*(\d)/i,         // Instance 3, Instance #3
        /\(i(\d)\)/i,                    // (i3)
        /\binst(?:ance)?\s*(\d)\b/i,     // inst 3, instance3
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const inst = parseInt(match[1]);
            if (inst >= 1 && inst <= 9) return inst;
        }
    }
    return null;
}

/**
 * Extract rank from text using multiple patterns.
 * Careful to avoid false positives from train announcements like "S RANK day".
 */
function extractRankFromText(text) {
    if (!text) return null;

    const patterns = [
        /\[(SS?|A|B)\]/,                    // [S], [SS], [A], [B] — most unambiguous
        /\((SS?|A|B)\)/,                    // (S), (A), (B) — parenthesized
        /\b(SS)\s*[- ]?[Rr]ank\b/,          // SS Rank, SS-Rank
        /\b(S)\s*[- ]?[Rr]ank\b(?!\s+day)/i, // S Rank but NOT "S Rank day"
        /\b(A)\s*[- ]?[Rr]ank\b/,           // A Rank
        /\b(B)\s*[- ]?[Rr]ank\b/,           // B Rank
        /[Rr]ank\s*[:=]?\s*(SS?|A|B)\b/,    // Rank: S, Rank=A
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].toUpperCase();
    }
    return null;
}

/**
 * Try to extract a mob name from text using known hunt mob names.
 */
function findKnownMobInText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    let bestMatch = null;
    let bestLength = 0;

    for (const mob of KNOWN_HUNT_MOBS) {
        if (lower.includes(mob) && mob.length > bestLength) {
            // Verify it's a word boundary match (not a substring of another word)
            const regex = new RegExp(`\\b${mob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (regex.test(text)) {
                bestMatch = mob;
                bestLength = mob.length;
            }
        }
    }

    if (bestMatch) {
        // Capitalize first letter of each word
        return bestMatch.replace(/\b\w/g, c => c.toUpperCase());
    }
    return null;
}

// ========== Main Parser ==========

/**
 * Parse a Discord message for hunt information.
 * @param {import('discord.js').Message} message - Discord message to parse
 * @returns {{ mobName: string|null, rank: string|null, world: string, zone: string|null, x: number|null, y: number|null, instance: number|null, raw: string } | null}
 */
export function parseHuntMessage(message) {
    // 1. Build search corpus from all text content (needed early for train check)
    const textParts = [];
    if (message.content) textParts.push(message.content);
    if (message.embeds) {
        for (const embed of message.embeds) {
            if (embed.title) textParts.push(embed.title);
            if (embed.description) textParts.push(embed.description);
            if (embed.fields) {
                for (const f of embed.fields) {
                    textParts.push(`${f.name}: ${f.value}`);
                }
            }
            if (embed.footer?.text) textParts.push(embed.footer.text);
        }
    }
    const corpus = textParts.join('\n');
    if (!corpus.trim()) return null;

    // 2. Detect train announcements (tag, not filter)
    const isTrain = isTrainAnnouncement(corpus);

    // 3. Extract structured data from embeds
    const embedData = extractFromEmbeds(message.embeds);

    // 4. World detection
    let world = embedData.world;
    if (!world) {
        const worlds = findWorldsInText(corpus);
        if (worlds.length > 0) world = worlds[0];
    }

    // 5. Coordinate extraction
    let x = embedData.x;
    let y = embedData.y;
    if (x == null || y == null) {
        const coords = extractCoords(corpus);
        if (coords) { x = coords.x; y = coords.y; }
    }

    // 6. Instance extraction
    let instance = embedData.instance;
    if (!instance) {
        instance = extractInstance(corpus);
    }

    // 7. Rank extraction
    let rank = embedData.rank;
    if (!rank) {
        rank = extractRankFromText(corpus);
    }

    // 8. Zone detection
    let zone = null;
    // If embed provided a zone name, normalize it through findZone (handles aliases)
    if (embedData.zone) {
        const resolved = findZone(embedData.zone);
        zone = resolved ? resolved.zoneName : embedData.zone;
    }
    if (!zone) {
        const zoneData = findZoneInText(corpus);
        if (zoneData) zone = zoneData.zoneName;
    }
    // For train announcements, try to extract starting zone
    if (!zone && isTrain) {
        zone = extractTrainStartZone(corpus);
    }

    // 9. Mob name — try multiple strategies
    let mobName = embedData.mobName;

    // Strategy B: look for known mob names in the full corpus
    if (!mobName) {
        mobName = findKnownMobInText(corpus);
    }

    // Strategy C: try to extract from embed title if not already done
    if (!mobName && message.embeds?.length > 0) {
        const title = message.embeds[0].title;
        if (title) {
            const cleaned = title
                .replace(/\[?(?:SS?|A|B)\]?\s*[-:]?\s*(?:rank\s*[-:]?\s*)?/i, '')
                .replace(/spawned|killed|found|spotted|detected/gi, '')
                .replace(/^\[.*?\]\s*/, '') // strip [World] prefix
                .trim();
            if (cleaned.length > 1 && cleaned.length < 60 && !matchWorld(cleaned)) {
                mobName = cleaned;
            }
        }
    }

    // Strategy D: try to find a capitalized name in the corpus that isn't
    // a world name, zone name, or common keyword
    if (!mobName) {
        mobName = extractMobNameHeuristic(corpus, world, zone);
    }

    // 10. Validation — must have world; non-trains also need coords or zone
    if (!world) return null;
    if (!isTrain && x == null && y == null && !zone) return null;

    return {
        mobName: mobName || null,
        rank: rank || null,
        world,
        zone: zone || null,
        x: x != null ? x : null,
        y: y != null ? y : null,
        instance: instance || null,
        isTrain,
        raw: corpus.substring(0, 500),
    };
}

/**
 * Heuristic: try to extract a mob name from text by finding capitalized
 * multi-word phrases that aren't worlds, zones, or common keywords.
 */
function extractMobNameHeuristic(corpus, world, zone) {
    // Common words to exclude (not mob names)
    const excludeWords = new Set([
        'hunt', 'rank', 'spawn', 'spawned', 'spotted', 'found', 'detected',
        'killed', 'dead', 'alive', 'instance', 'world', 'server', 'zone',
        'location', 'coordinates', 'train', 'alert', 'notification',
        'data', 'center', 'datacenter', 'aether', 'primal', 'crystal',
        'dynamis', 'light', 'chaos', 'elemental', 'gaia', 'mana', 'meteor',
        'the', 'in', 'on', 'at', 'from', 'for', 'is', 'was', 'has',
    ]);

    // Find lines that look like standalone names (Capitalized, 1-3 words)
    const lines = corpus.split('\n');
    for (const line of lines) {
        const trimmed = line.replace(/^[:*_~`>]+\s*/, '').trim(); // strip markdown/emoji prefix
        // Skip empty or very long lines
        if (!trimmed || trimmed.length > 50 || trimmed.length < 3) continue;
        // Skip lines that are just known fields
        if (/^(world|server|zone|rank|coords|instance):/i.test(trimmed)) continue;
        // Check if it looks like a proper noun (starts with uppercase, not all caps)
        if (/^[A-Z][a-z]/.test(trimmed)) {
            const words = trimmed.split(/\s+/);
            if (words.length <= 4) {
                // Make sure it's not a world name or zone name
                const lower = trimmed.toLowerCase();
                if (allWorldsLower.has(lower)) continue;
                if (world && lower === world.toLowerCase()) continue;
                if (zone && lower === zone.toLowerCase()) continue;
                if (words.every(w => excludeWords.has(w.toLowerCase()))) continue;
                return trimmed;
            }
        }
    }
    return null;
}

/**
 * Parse a plain text string for hunt information (for /hunts test command).
 * Creates a fake message object to reuse the main parser.
 * @param {string} text
 * @returns {ReturnType<typeof parseHuntMessage>}
 */
export function parseHuntText(text) {
    return parseHuntMessage({
        content: text,
        embeds: [],
    });
}
