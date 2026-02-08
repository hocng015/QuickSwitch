/**
 * Static FFXIV world/data center/region data.
 * Used for populating Discord select menus.
 */

export const regions = [
    { id: 'na', name: 'North America' },
    { id: 'eu', name: 'Europe' },
    { id: 'jp', name: 'Japan' },
    { id: 'oc', name: 'Oceania' },
];

export const dataCenters = [
    // North America
    { name: 'Aether', region: 'na', worlds: ['Adamantoise', 'Cactuar', 'Faerie', 'Gilgamesh', 'Jenova', 'Midgardsormr', 'Sargatanas', 'Siren'] },
    { name: 'Primal', region: 'na', worlds: ['Behemoth', 'Excalibur', 'Exodus', 'Famfrit', 'Hyperion', 'Lamia', 'Leviathan', 'Ultros'] },
    { name: 'Crystal', region: 'na', worlds: ['Balmung', 'Brynhildr', 'Coeurl', 'Diabolos', 'Goblin', 'Malboro', 'Mateus', 'Zalera'] },
    { name: 'Dynamis', region: 'na', worlds: ['Halicarnassus', 'Maduin', 'Marilith', 'Seraph', 'Cuchulainn', 'Golem', 'Kraken', 'Rafflesia'] },

    // Europe
    { name: 'Chaos', region: 'eu', worlds: ['Cerberus', 'Louisoix', 'Moogle', 'Omega', 'Phantom', 'Ragnarok', 'Sagittarius', 'Spriggan'] },
    { name: 'Light', region: 'eu', worlds: ['Alpha', 'Lich', 'Odin', 'Phoenix', 'Raiden', 'Shiva', 'Twintania', 'Zodiark'] },
    { name: 'Shadow', region: 'eu', worlds: ['Innocence', 'Titania', 'Pixie'] },

    // Japan
    { name: 'Elemental', region: 'jp', worlds: ['Aegis', 'Atomos', 'Carbuncle', 'Garuda', 'Gungnir', 'Kujata', 'Tonberry', 'Typhon'] },
    { name: 'Gaia', region: 'jp', worlds: ['Alexander', 'Bahamut', 'Durandal', 'Fenrir', 'Ifrit', 'Ridill', 'Tiamat', 'Ultima'] },
    { name: 'Mana', region: 'jp', worlds: ['Anima', 'Asura', 'Chocobo', 'Hades', 'Ixion', 'Masamune', 'Pandaemonium', 'Titan'] },
    { name: 'Meteor', region: 'jp', worlds: ['Belias', 'Mandragora', 'Ramuh', 'Shinryu', 'Unicorn', 'Valefor', 'Yojimbo', 'Zeromus'] },

    // Oceania
    { name: 'Materia', region: 'oc', worlds: ['Bismarck', 'Ravana', 'Sephirot', 'Sophia', 'Zurvan'] },
];

/**
 * Find which data center a world belongs to.
 */
export function findWorldDC(worldName) {
    const lower = worldName.toLowerCase();
    for (const dc of dataCenters) {
        if (dc.worlds.some(w => w.toLowerCase() === lower)) {
            return dc;
        }
    }
    return null;
}

/**
 * Get all worlds on a specific data center.
 */
export function getWorldsForDC(dcName) {
    const dc = dataCenters.find(d => d.name.toLowerCase() === dcName.toLowerCase());
    return dc ? dc.worlds : [];
}

/**
 * Get all data centers for a region.
 */
export function getDCsForRegion(regionId) {
    return dataCenters.filter(dc => dc.region === regionId);
}

/**
 * Check if two worlds are on the same data center.
 */
export function isSameDC(world1, world2) {
    const dc1 = findWorldDC(world1);
    const dc2 = findWorldDC(world2);
    return dc1 && dc2 && dc1.name === dc2.name;
}

/**
 * Get all world names as a flat list.
 */
export function getAllWorlds() {
    return dataCenters.flatMap(dc => dc.worlds).sort();
}
