/**
 * World name aliases — maps common abbreviations, nicknames, and misspellings
 * used by the NA FFXIV player base to official world names.
 *
 * Sources: hunt Discord communities, Reddit, community wikis, PF callouts.
 * Only aliases that differ from prefix matching are listed here;
 * standard prefix truncations (e.g. "sarg" → Sargatanas) are handled
 * by the prefix matcher in the parser.
 */

export const worldAliases = new Map([
    // === Aether ===
    ['greg', 'Gilgamesh'],          // Hildibrand questline nickname
    ['turtle', 'Adamantoise'],      // thematic — the creature is a giant turtle
    ['ada', 'Adamantoise'],         // short prefix (< 4 chars, so prefix match won't catch it)
    ['jenny', 'Jenova'],            // pet name
    ['middy', 'Midgardsormr'],      // affectionate short form
    ['mid', 'Midgardsormr'],        // 3-char shorthand
    ['fae', 'Faerie'],              // 3-char shorthand
    ['gil', 'Gilgamesh'],           // 3-char shorthand
    ['jen', 'Jenova'],              // 3-char shorthand
    ['sir', 'Siren'],               // 3-char shorthand

    // === Primal ===
    ['behe', 'Behemoth'],           // common truncation
    ['beh', 'Behemoth'],            // 3-char shorthand
    ['levi', 'Leviathan'],          // very common
    ['hyp', 'Hyperion'],            // 3-char shorthand
    ['exo', 'Exodus'],              // 3-char shorthand
    ['fam', 'Famfrit'],             // 3-char shorthand
    ['lam', 'Lamia'],               // 3-char shorthand
    ['ult', 'Ultros'],              // 3-char shorthand

    // === Crystal ===
    ['marlboro', 'Malboro'],        // common misspelling (cigarette brand)
    ['gobbie', 'Goblin'],           // pet name
    ['gob', 'Goblin'],              // 3-char shorthand
    ['dia', 'Diabolos'],            // 3-char shorthand
    ['mat', 'Mateus'],              // 3-char shorthand
    ['zal', 'Zalera'],              // 3-char shorthand

    // === Dynamis ===
    ['hali', 'Halicarnassus'],      // common truncation
    ['cuch', 'Cuchulainn'],         // common truncation
    ['raf', 'Rafflesia'],           // 3-char shorthand
    ['mad', 'Maduin'],              // 3-char shorthand
]);
