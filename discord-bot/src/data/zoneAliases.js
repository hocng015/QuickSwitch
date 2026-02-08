/**
 * Zone name aliases — maps common abbreviations, nicknames, and shorthand
 * used by the NA FFXIV player base to official zone names.
 *
 * These supplement the substring matching in zoneIndex.js. They handle cases
 * where the community name doesn't substring-match the official name.
 *
 * Note: Aliases that are already substrings of the official name (e.g. "Fringes"
 * matching "The Fringes") don't need to be listed here — zoneIndex handles those.
 * This file is for non-obvious mappings only.
 */

export const zoneAliases = new Map([
    // === Expansion tags (used in train announcements: "EW TRAIN") ===
    // These map to null — they're detected as expansion context, not a specific zone.
    // The parser uses these to narrow zone search scope.

    // === A Realm Reborn ===
    // La Noscea directional abbreviations
    ['mln', 'Middle La Noscea'],
    ['mid ln', 'Middle La Noscea'],
    ['lln', 'Lower La Noscea'],
    ['lower ln', 'Lower La Noscea'],
    ['eln', 'Eastern La Noscea'],
    ['east ln', 'Eastern La Noscea'],
    ['wln', 'Western La Noscea'],
    ['west ln', 'Western La Noscea'],
    ['uln', 'Upper La Noscea'],
    ['upper ln', 'Upper La Noscea'],
    ['oln', 'Outer La Noscea'],
    ['outer ln', 'Outer La Noscea'],

    // Shroud abbreviations
    ['cs', 'Central Shroud'],
    ['c shroud', 'Central Shroud'],
    ['es', 'East Shroud'],
    ['e shroud', 'East Shroud'],
    ['n shroud', 'North Shroud'],
    ['ns', 'North Shroud'],
    ['s shroud', 'South Shroud'],

    // Thanalan abbreviations
    ['wthan', 'Western Thanalan'],
    ['w than', 'Western Thanalan'],
    ['west than', 'Western Thanalan'],
    ['cthan', 'Central Thanalan'],
    ['c than', 'Central Thanalan'],
    ['ethan', 'Eastern Thanalan'],
    ['e than', 'Eastern Thanalan'],
    ['east than', 'Eastern Thanalan'],
    ['sthan', 'Southern Thanalan'],
    ['s than', 'Southern Thanalan'],
    ['south than', 'Southern Thanalan'],
    ['nthan', 'Northern Thanalan'],
    ['n than', 'Northern Thanalan'],
    ['north than', 'Northern Thanalan'],

    // Other ARR
    ['cch', 'Coerthas Central Highlands'],
    ['central coerthas', 'Coerthas Central Highlands'],
    ['md', 'Mor Dhona'],

    // === Heavensward ===
    ['cwh', 'Coerthas Western Highlands'],
    ['west coerthas', 'Coerthas Western Highlands'],
    ['western coerthas', 'Coerthas Western Highlands'],
    ['soc', 'The Sea of Clouds'],
    ['sea of clouds', 'The Sea of Clouds'],
    ['forelands', 'The Dravanian Forelands'],
    ['dfl', 'The Dravanian Forelands'],
    ['drav forelands', 'The Dravanian Forelands'],
    ['hinterlands', 'The Dravanian Hinterlands'],
    ['dhl', 'The Dravanian Hinterlands'],
    ['drav hinterlands', 'The Dravanian Hinterlands'],
    ['hinter', 'The Dravanian Hinterlands'],
    ['churning', 'The Churning Mists'],
    ['churning mists', 'The Churning Mists'],
    ['tcm', 'The Churning Mists'],
    ['mists', 'The Churning Mists'],
    ['azys', 'Azys Lla'],

    // === Stormblood ===
    ['fringe', 'The Fringes'],
    ['fringes', 'The Fringes'],
    ['peaks', 'The Peaks'],
    ['lochs', 'The Lochs'],
    ['loch', 'The Lochs'],
    ['ruby', 'The Ruby Sea'],
    ['ruby sea', 'The Ruby Sea'],
    ['azim', 'The Azim Steppe'],
    ['steppe', 'The Azim Steppe'],
    ['azim steppe', 'The Azim Steppe'],

    // === Shadowbringers ===
    ['lake', 'Lakeland'],
    ['khol', 'Kholusia'],
    ['amh', 'Amh Araeng'],
    ['aa', 'Amh Araeng'],
    ['mheg', 'Il Mheg'],
    ['il mheg', 'Il Mheg'],
    ['raktika', "The Rak'tika Greatwood"],
    ['rak', "The Rak'tika Greatwood"],
    ['tempest', 'The Tempest'],

    // === Endwalker ===
    ['thav', 'Thavnair'],
    ['garle', 'Garlemald'],
    ['laby', 'Labyrinthos'],
    ['lab', 'Labyrinthos'],
    ['mare', 'Mare Lamentorum'],
    ['mare lam', 'Mare Lamentorum'],
    ['ut', 'Ultima Thule'],
    ['ultima', 'Ultima Thule'],

    // === Dawntrail ===
    ['urqo', 'Urqopacha'],
    ['koz', "Kozama'uka"],
    ['kozama', "Kozama'uka"],
    ['yak', "Yak T'el"],
    ['yak tel', "Yak T'el"],
    ['yt', "Yak T'el"],
    ['shaal', 'Shaaloani'],
    ['hf', 'Heritage Found'],
    ['heritage', 'Heritage Found'],
    ['lm', 'Living Memory'],
    ['living mem', 'Living Memory'],
]);

/**
 * Expansion abbreviation → full name mapping.
 * Used to detect expansion context in train announcements (e.g. "EW TRAIN").
 */
export const expansionAbbreviations = new Map([
    ['arr', 'A Realm Reborn'],
    ['hw', 'Heavensward'],
    ['sb', 'Stormblood'],
    ['stb', 'Stormblood'],
    ['shb', 'Shadowbringers'],
    ['ew', 'Endwalker'],
    ['dt', 'Dawntrail'],
]);
