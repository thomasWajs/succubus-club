import { AvailabilitySlot, PlayerAvailability, SlotCategory } from '@/shared/types/availability.ts'
import { cellMidEpoch } from '@/client/gateway/availabilityTime.ts'
import { slotCoversInstant } from '@/shared/availability/recurrence.mjs'

// Aggregates every player's slots into a ( weekday x hour ) heatmap for a displayed
// local week. Each cell holds the roster of players free during that hour, so the grid
// answers "when can we get enough people together ?" at a glance.

export type CategoryFilter = 'all' | 'casual' | 'competitive'

export interface RosterEntry {
    uid: string
    name: string
    permId: string
    category: SlotCategory
}

export interface GridCell {
    count: number
    roster: RosterEntry[]
    mine: boolean
}

function slotMatchesFilter(slot: AvailabilitySlot, filter: CategoryFilter): boolean {
    if (filter === 'all') {
        return true
    }
    if (slot.category === SlotCategory.Both) {
        return true
    }
    return slot.category === filter
}

// Two categories on the same player in the same cell collapse to Both.
function mergeCategory(a: SlotCategory, b: SlotCategory): SlotCategory {
    return a === b ? a : SlotCategory.Both
}

// Returns grid[weekday][hour]. weekday : 0 = Monday .. 6 = Sunday ; hour : 0 .. 23.
export function buildAvailabilityGrid(
    players: PlayerAvailability[],
    weekStart: Date,
    filter: CategoryFilter,
    myUid: string | null,
): GridCell[][] {
    const grid: GridCell[][] = []

    for (let weekday = 0; weekday < 7; weekday++) {
        const column: GridCell[] = []
        for (let hour = 0; hour < 24; hour++) {
            const mid = cellMidEpoch(weekStart, weekday, hour)
            const byUid = new Map<string, RosterEntry>()

            for (const player of players) {
                let category: SlotCategory | null = null
                for (const slot of player.slots) {
                    if (!slotMatchesFilter(slot, filter) || !slotCoversInstant(slot, mid)) {
                        continue
                    }
                    category =
                        category === null ? slot.category : mergeCategory(category, slot.category)
                }
                if (category !== null) {
                    byUid.set(player.uid, {
                        uid: player.uid,
                        name: player.name,
                        permId: player.permId,
                        category,
                    })
                }
            }

            const roster = [...byUid.values()]
            column.push({
                count: roster.length,
                roster,
                mine: myUid !== null && byUid.has(myUid),
            })
        }
        grid.push(column)
    }

    return grid
}
