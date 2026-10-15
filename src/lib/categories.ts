/*
 * Categorías fijas de producto. Se guardan en products.category como texto:
 * los juegos de TCG van como "TCG · Pokémon"; "TCG" solo es otro juego.
 */

export const TCG = 'TCG'
const SEP = ' · '

/** Juegos de TCG (subcategorías). */
export const TCG_GAMES = ['Pokémon', 'Yu-Gi-Oh!', 'Lorcana', 'Magic', 'Flesh and Blood'] as const

export const MAIN_CATEGORIES = [TCG, 'Accesorios', 'Cafetería', 'Comida', 'Juegos de Mesa', 'Torneos'] as const

export const tcgCategory = (game: string) => `${TCG}${SEP}${game}`

/** Todos los valores válidos, en orden de menú. */
export const CATEGORY_VALUES: string[] = [
  ...TCG_GAMES.map(tcgCategory),
  TCG,
  ...MAIN_CATEGORIES.filter((c) => c !== TCG),
]

/** Categoría principal de un valor guardado ("TCG · Magic" → "TCG"). */
export function mainCategory(category: string | null | undefined) {
  if (!category) return null
  return category === TCG || category.startsWith(`${TCG}${SEP}`) ? TCG : category
}

/** ¿El producto cae en el filtro? (un filtro "TCG" incluye todos sus juegos). */
export function matchesCategory(category: string | null | undefined, filter: string) {
  if (!filter) return true
  return filter === TCG ? mainCategory(category) === TCG : category === filter
}

/** Texto corto para el menú: "TCG · Magic" → "Magic"; "TCG" → "Otros TCG". */
export function categoryLabel(value: string) {
  if (value === TCG) return 'Otros juegos TCG'
  return value.startsWith(`${TCG}${SEP}`) ? value.slice(TCG.length + SEP.length) : value
}

/** Categoría sugerida a partir del juego del catálogo TCGplayer. */
export function categoryFromGame(game: string | null | undefined): string {
  const g = (game ?? '').toLowerCase()
  if (/pok[eé]mon/.test(g)) return tcgCategory('Pokémon')
  if (/yu.?gi.?oh/.test(g)) return tcgCategory('Yu-Gi-Oh!')
  if (g.includes('lorcana')) return tcgCategory('Lorcana')
  if (g.includes('magic')) return tcgCategory('Magic')
  if (g.includes('flesh')) return tcgCategory('Flesh and Blood')
  if (/dragon shield|ultra ?pro/.test(g)) return 'Accesorios'
  return TCG
}
