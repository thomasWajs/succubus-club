import { Discipline, DisciplineCode, DisciplineLevel } from '@/shared/const/model.ts'
import { DisciplineUse } from '@/shared/types/state.ts'

// Discipline icons are served from a single inlined SVG sprite ( see
// client/game/disciplineSprite.ts ), referenced by <use href="#id">. The symbol
// id is the 3-letter discipline code, lowercase for inferior and uppercase for
// superior ( ids are case-sensitive ) : pot / POT, matching the card-text
// convention [pot] / [POT].
const CODE_BY_DISCIPLINE: Record<string, string> = Object.fromEntries(
    Object.entries(DisciplineCode).map(([code, discipline]) => [discipline, code]),
)

export function disciplineSpriteId(discipline: Discipline, level: DisciplineLevel): string {
    const code = CODE_BY_DISCIPLINE[discipline] ?? ''
    return level == DisciplineLevel.SUPERIOR ? code.toUpperCase() : code
}

// An <svg><use> reference into the injected sprite, for the log lines and
// rulings ( rendered via v-html ). Panels use the DisciplineIcon component.
export function disciplineIconSvg(spriteId: string): string {
    return `<svg class="discipline-icon"><use href="#${spriteId}" /></svg>`
}

export function disciplineIconImg(discipline: Discipline, level: DisciplineLevel): string {
    return disciplineIconSvg(disciplineSpriteId(discipline, level))
}

export function disciplineUsesImg(uses: DisciplineUse[]): string {
    return uses.map(use => disciplineIconImg(use.discipline, use.level)).join('')
}
