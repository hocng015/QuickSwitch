/**
 * Static FFXIV territory data for map image rendering.
 * Maps territoryId → { mapId, zoneName, sizeFactor, offsetX, offsetY }
 *
 * mapId is the XIVAPI path component for map images (includes region suffix).
 * URL: https://v2.xivapi.com/api/asset/map/{mapId}
 * e.g. mapId "s1t1/01" → https://v2.xivapi.com/api/asset/map/s1t1/01
 *
 * This is used as a FALLBACK when the plugin doesn't send map metadata.
 * The plugin (v1.0.13+) sends this data dynamically in status updates.
 *
 * Data sourced from XIVAPI v2 TerritoryType sheet (verified 2025-02).
 */

export const territories = {
    // ========== Cities ==========
    128: { mapId: 's1t1/01', zoneName: 'Limsa Lominsa Upper Decks', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    129: { mapId: 's1t2/01', zoneName: 'Limsa Lominsa Lower Decks', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    130: { mapId: 'w1t1/01', zoneName: "Ul'dah - Steps of Nald", sizeFactor: 200, offsetX: 0, offsetY: 0 },
    131: { mapId: 'w1t2/01', zoneName: "Ul'dah - Steps of Thal", sizeFactor: 200, offsetX: 0, offsetY: 0 },
    132: { mapId: 'f1t1/00', zoneName: 'New Gridania', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    133: { mapId: 'f1t2/00', zoneName: 'Old Gridania', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    418: { mapId: 'r2t1/00', zoneName: 'Foundation', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    419: { mapId: 'r2t2/00', zoneName: 'The Pillars', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    628: { mapId: 'e3t1/00', zoneName: 'Kugane', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    819: { mapId: 'n4t1/00', zoneName: 'The Crystarium', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    820: { mapId: 'n4t2/01', zoneName: 'Eulmore', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    962: { mapId: 'k5t1/00', zoneName: 'Old Sharlayan', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    963: { mapId: 'm5t1/00', zoneName: 'Radz-at-Han', sizeFactor: 200, offsetX: 0, offsetY: 0 },
    1185: { mapId: 'y6t1/00', zoneName: 'Tuliyollal', sizeFactor: 180, offsetX: 50, offsetY: -70 },
    1186: { mapId: 'x6t1/00', zoneName: 'Solution Nine', sizeFactor: 180, offsetX: 0, offsetY: 90 },

    // ========== A Realm Reborn — La Noscea ==========
    134: { mapId: 's1f1/00', zoneName: 'Middle La Noscea', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    135: { mapId: 's1f2/00', zoneName: 'Lower La Noscea', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    137: { mapId: 's1f3/01', zoneName: 'Eastern La Noscea', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    138: { mapId: 's1f4/00', zoneName: 'Western La Noscea', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    139: { mapId: 's1f5/00', zoneName: 'Upper La Noscea', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    180: { mapId: 's1f6/00', zoneName: 'Outer La Noscea', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== A Realm Reborn — The Black Shroud ==========
    148: { mapId: 'f1f1/00', zoneName: 'Central Shroud', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    152: { mapId: 'f1f2/00', zoneName: 'East Shroud', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    153: { mapId: 'f1f3/00', zoneName: 'South Shroud', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    154: { mapId: 'f1f4/00', zoneName: 'North Shroud', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== A Realm Reborn — Thanalan ==========
    140: { mapId: 'w1f1/00', zoneName: 'Western Thanalan', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    141: { mapId: 'w1f2/00', zoneName: 'Central Thanalan', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    145: { mapId: 'w1f3/00', zoneName: 'Eastern Thanalan', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    146: { mapId: 'w1f4/01', zoneName: 'Southern Thanalan', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    147: { mapId: 'w1f5/00', zoneName: 'Northern Thanalan', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== A Realm Reborn — Other ==========
    155: { mapId: 'r1f1/00', zoneName: 'Coerthas Central Highlands', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    156: { mapId: 'l1f1/01', zoneName: 'Mor Dhona', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== Heavensward ==========
    397: { mapId: 'r2f1/00', zoneName: 'Coerthas Western Highlands', sizeFactor: 95, offsetX: 0, offsetY: 0 },
    401: { mapId: 'a2f1/00', zoneName: 'The Sea of Clouds', sizeFactor: 95, offsetX: 0, offsetY: 0 },
    398: { mapId: 'd2f1/00', zoneName: 'The Dravanian Forelands', sizeFactor: 95, offsetX: 0, offsetY: 0 },
    400: { mapId: 'd2f3/00', zoneName: 'The Churning Mists', sizeFactor: 95, offsetX: 0, offsetY: 0 },
    402: { mapId: 'a2f2/00', zoneName: 'Azys Lla', sizeFactor: 95, offsetX: 0, offsetY: 0 },
    399: { mapId: 'd2f2/00', zoneName: 'The Dravanian Hinterlands', sizeFactor: 95, offsetX: 0, offsetY: 0 },

    // ========== Stormblood ==========
    612: { mapId: 'g3f1/00', zoneName: 'The Fringes', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    620: { mapId: 'g3f2/00', zoneName: 'The Peaks', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    621: { mapId: 'g3f3/00', zoneName: 'The Lochs', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    613: { mapId: 'e3f1/00', zoneName: 'The Ruby Sea', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    614: { mapId: 'e3f2/00', zoneName: 'Yanxia', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    622: { mapId: 'e3f3/00', zoneName: 'The Azim Steppe', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== Shadowbringers ==========
    813: { mapId: 'n4f1/00', zoneName: 'Lakeland', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    814: { mapId: 'n4f2/00', zoneName: 'Kholusia', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    815: { mapId: 'n4f3/00', zoneName: 'Amh Araeng', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    816: { mapId: 'n4f4/00', zoneName: 'Il Mheg', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    817: { mapId: 'n4f5/00', zoneName: "The Rak'tika Greatwood", sizeFactor: 100, offsetX: 0, offsetY: 0 },
    818: { mapId: 'n4f6/00', zoneName: 'The Tempest', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== Endwalker ==========
    956: { mapId: 'k5f1/00', zoneName: 'Labyrinthos', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    957: { mapId: 'm5f1/00', zoneName: 'Thavnair', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    958: { mapId: 'm5f2/00', zoneName: 'Garlemald', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    959: { mapId: 'u5f1/00', zoneName: 'Mare Lamentorum', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    960: { mapId: 'u5f2/00', zoneName: 'Ultima Thule', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    961: { mapId: 'n5f1/00', zoneName: 'Elpis', sizeFactor: 100, offsetX: 0, offsetY: 0 },

    // ========== Dawntrail ==========
    1187: { mapId: 'y6f1/00', zoneName: 'Urqopacha', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    1188: { mapId: 'y6f2/00', zoneName: "Kozama'uka", sizeFactor: 100, offsetX: 0, offsetY: 0 },
    1189: { mapId: 'y6f3/00', zoneName: "Yak T'el", sizeFactor: 100, offsetX: 0, offsetY: 0 },
    1190: { mapId: 'x6f1/00', zoneName: 'Shaaloani', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    1191: { mapId: 'x6f2/00', zoneName: 'Heritage Found', sizeFactor: 100, offsetX: 0, offsetY: 0 },
    1192: { mapId: 'x6f3/00', zoneName: 'Living Memory', sizeFactor: 100, offsetX: 0, offsetY: 0 },
};

/**
 * Look up territory info by territoryId.
 * @param {number} territoryId
 * @returns {{ mapId: string, zoneName: string, sizeFactor: number, offsetX: number, offsetY: number } | null}
 */
export function getTerritory(territoryId) {
    return territories[territoryId] || null;
}
