/**
 * The Hark roster: eight bot mascots tuned for the Hark design system (Rev 8).
 *
 * Geometry follows the avatar contract v1 and the open-bot-avatar gallery (MIT,
 * Dominik Scholz); colour and material follow Hark's "two inks, one sky" rule —
 * every body colour is either a sky stop at a phase of the day or one of the three
 * system accents, rendered with the `soft` subsurface material instead of a flat
 * fill. `sky` carries the four zenith-to-horizon stops of the phase behind the bot,
 * for hosts that paint the Hark sky gradient.
 */
/** Hark DS Rev 8 tokens used by the roster. */
export const HARK = {
    ink: '#1D1D1F',
    paper: '#F5F5F7',
    skyDay: '#ABC1DB',
    skyNight: '#2A3256',
    systemOrange: '#FF4D00',
    systemGreen: '#00A665',
    systemRed: '#DA2F35',
    /** Raw live dusk stop (DS §6 table), the bunny's violet. */
    duskGlow: '#5B6CB4',
    /** Success capsule surface (DS §3.5), the analysis bot's mint sky. */
    successSurface: '#C9F9DA',
    /** Opaque secondary surface (DS §3.2). */
    surfaceSecondary: '#F3F5FA',
};
/** Zenith-to-horizon sky stops per phase (Hark DS §6, shown values). */
export const HARK_SKY = {
    day: ['#3F78B1', '#65A3DD', '#A0D3F4', '#DAE6E1'],
    golden: ['#3E6B8C', '#6D94B4', '#BEC2AB', '#FEC768'],
    sunset: ['#446787', '#7489B8', '#C5AEAB', '#FF9E7B'],
    dusk: ['#2E5077', '#4E63A2', '#8485AE', '#D08E6F'],
    night: ['#0C1227', '#111830', '#192039', '#252B43'],
    overcast: ['#8498AB', '#9FB1C4', '#ADB7BB'],
    auth: ['#B6CFE7', '#FFEED9'],
};
const def = (id, name, path, eyes) => ({
    version: 1,
    id,
    name,
    body: { path },
    eyes,
});
/**
 * Eight bots, eight silhouettes, eight live colours. Pale bodies (the cloud) use a
 * denser, lower-ambient material so the volume reads; saturated bodies use the
 * gentle default so the hue stays vivid.
 */
export const HARK_ROSTER = [
    {
        definition: def('ghost', 'Ghost', 'M24 50C24 28 35 12 50 12C65 12 76 28 76 50L77 80C77 85 73 88 68 88C63 88 61 84 59 81C57 84 54 88 50 88C46 88 43 84 41 81C39 84 37 88 32 88C27 88 23 85 23 80Z', { x: 50, y: 42, spacing: 16, scale: 1.15 }),
        role: 'Scout',
        color: '#65A3DD',
        soft: { density: 1.6, ambient: 0.5 },
        phase: 'day',
        sky: HARK_SKY.day,
    },
    {
        definition: def('cat', 'Cat', 'M50 23C68 23 82 30 82 45C82 58 68 65 50 65C32 65 18 58 18 45C18 30 32 23 50 23ZM24 42C21 32 20 22 22 15C23 11 26 10 29 12C34 16 39 21 44 28L36 42ZM64 42L56 28C61 21 66 16 71 12C74 10 77 11 78 15C80 22 79 32 76 42ZM38 56L62 56C70 56 74 66 74 76C74 83 70 86 63 86L37 86C30 86 26 83 26 76C26 66 30 56 38 56ZM70 72C77 74 81 70 80 64C79 60 81 57 84 58C87 59 88.5 63 88 68C87 77 80 83 70 81Z', { x: 50, y: 43, spacing: 17, scale: 1.1 }),
        role: 'Assistant',
        color: HARK.systemOrange,
        soft: { density: 1.4, ambient: 0.55 },
        phase: 'auth',
        sky: HARK_SKY.auth,
    },
    {
        definition: def('cloud', 'Cloud', 'M24 76C14 76 9 69 9 61C9 52 15 46 23 45.5C25 33 36 24 49 24C61 24 70 31 73 41C83 41 91 49 91 59C91 69 83 76 74 76Z', { x: 50, y: 54, spacing: 17, scale: 1.15 }),
        role: 'Weather',
        color: HARK.paper,
        soft: { density: 5, ambient: 0.12 },
        phase: 'overcast',
        sky: HARK_SKY.overcast,
    },
    {
        definition: def('mug', 'Mug', 'M22 20H62C67 20 70 23 70 28V72C70 80 64 86 56 86H28C20 86 14 80 14 72V28C14 23 17 20 22 20ZM68 36C80 34 87 42 87 53C87 64 80 72 68 70ZM69 45L69 61C75.5 62 79 58.5 79 53C79 47.5 76 44 69 45Z', { x: 42, y: 49, spacing: 16, scale: 1.15 }),
        role: 'Routine',
        color: '#FF9E7B',
        soft: { density: 2, ambient: 0.4 },
        phase: 'sunset',
        sky: HARK_SKY.sunset,
    },
    {
        definition: def('brain', 'Brain', 'M14 50C10 42 14 32 22 30C24 21 34 17 41 21C46 15 56 15 61 20C68 16 78 20 79 28C87 30 91 39 88 47C92 54 89 64 81 66C80 71 76 74 71 73C67 75 64 74 62 72C61 74 61 76 61.5 78C62 81 59 82.5 57 81.5C55.5 80.5 55 78 54 76C53 74 50 72.5 47 72.5C42 74 38 72 36 70C30 73 20 71 18 64C12 62 10 56 14 50Z', { x: 50, y: 45, spacing: 17, scale: 1.15 }),
        role: 'Analysis',
        color: HARK.systemGreen,
        soft: { density: 1.4, ambient: 0.55 },
        phase: 'day',
        sky: ['#A0D3F4', '#DAE6E1', '#C9F9DA'],
    },
    {
        definition: def('rocket', 'Rocket', 'M46 10C48 8.5 52 8.5 54 10C64 17 71 29 71 44V72H29V44C29 29 36 17 46 10ZM29 56H71C80 61 86 70 86 80C86 84 83 86 79 85L72 83H28L21 85C17 86 14 84 14 80C14 70 20 61 29 56ZM42 80H58C59 86 55 90 50 92C45 90 41 86 42 80Z', { x: 50, y: 46, spacing: 15, scale: 1.05 }),
        role: 'Launches',
        color: HARK.systemRed,
        soft: { density: 1.4, ambient: 0.5 },
        phase: 'day',
        sky: ['#F3F5FA', '#DAE6E1'],
    },
    {
        definition: def('star', 'Star', 'M53.7 17.95L62 31.2Q64.1 34.6 68 35.6L83.1 39.3Q89.9 41 85.4 46.4L75.4 58.3Q72.8 61.4 73.1 65.4L74.2 81Q74.7 88 68.2 85.4L53.7 79.5Q50 78 46.3 79.5L31.8 85.4Q25.3 88 25.8 81L26.9 65.4Q27.2 61.4 24.6 58.3L14.6 46.4Q10.1 41 16.9 39.3L32 35.6Q35.9 34.6 38 31.2L46.3 17.95Q50 12 53.7 17.95Z', { x: 50, y: 52, spacing: 16, scale: 1.1 }),
        role: 'Favorites',
        color: '#FEC768',
        soft: { density: 2.5, ambient: 0.35 },
        phase: 'golden',
        sky: HARK_SKY.golden,
    },
    {
        definition: def('bunny', 'Bunny', 'M50 40C68 40 80 50 80 64C80 78 68 86 50 86C32 86 20 78 20 64C20 50 32 40 50 40ZM30 46C26 36 24 24 26 16C28 10 34 10 37 15C40 22 42 34 42 44ZM58 44C58 34 61 22 66 15C69 10 76 11 76 17C76 25 74 36 70 46Z', { x: 50, y: 62, spacing: 17, scale: 1.15 }),
        role: 'Creative',
        color: HARK.duskGlow,
        soft: { density: 1.6, ambient: 0.5 },
        phase: 'dusk',
        sky: HARK_SKY.dusk,
    },
];
/** A roster bot by definition id, e.g. `harkBot('ghost')`. */
export function harkBot(id) {
    return HARK_ROSTER.find((b) => b.definition.id === id);
}
/** The sky gradient stops of a phase, zenith to horizon. */
export function harkSky(phase) {
    return HARK_SKY[phase];
}
