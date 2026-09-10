<template>
    <div
        v-if="editor && gameState.action"
        class="action-usage-editor"
        :class="{ 'read-only': !editor.editable }"
        :style="editor.style"
        @pointerdown.stop="onDragStart"
        @pointerup.stop
        @pointermove.stop
        @click.stop
        @wheel.stop
    >
        <div class="usage-title">{{ actions.getName(gameState.action.minionAction) }}</div>

        <div
            v-if="editor.chips.length > 0"
            class="discipline-options"
        >
            <div
                v-for="chip in editor.chips"
                :key="chip.key"
                class="discipline-chip"
                :class="{ selected: chip.selected && editor.editable, static: !editor.editable }"
                @click="editor.editable ? toggleOption(chip) : null"
            >
                <DisciplineIcon
                    v-for="use in chip.uses"
                    :key="useKey(use)"
                    :discipline="use.discipline"
                    :level="use.level"
                />
            </div>
        </div>

        <!-- Editable : target declaration button. Each click declares an
        additional target, so a card can be aimed at several targets. -->
        <template v-if="editor.editable && editor.directable">
            <div
                v-if="editor.chips.length > 0"
                class="usage-divider"
            />
            <div
                class="usage-target-button"
                @click="declareTarget"
            >
                Declare target
            </div>
        </template>

        <template v-if="editor.editable">
            <div class="usage-divider" />
            <div
                class="usage-end-button"
                @click="gameMutations.ACTION_endAction.actSelf({})"
            >
                End action
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { display } from '@/client/game/display.ts'
import { getCardRectangle, getScreenPoint } from '@/client/game/utils.ts'
import { DisciplineUse, LibraryCardUsage, MinionActionType } from '@/shared/types/state.ts'
import { LibraryCardType } from '@/shared/const/model.ts'
import { parseCardUsage } from '@/shared/state/usageParsing.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { startTargetDeclaration } from '@/client/game/declaration.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import DisciplineIcon from '@/client/ui/components/DisciplineIcon.vue'
import * as actions from '@/shared/state/minionActions.ts'

const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const players = usePlayersStore()
const { usageEditorEnabled } = useUIFeatures()

function useKey(use: DisciplineUse): string {
    return `${use.discipline}:${use.level}`
}

type UsageChip = {
    key: string
    selected: boolean
    uses: DisciplineUse[]
}

/**
 * Dragging the box, so the player can uncover the card underneath. The offset is
 * kept in screen pixels and added on top of the card-anchored position, so the
 * box still follows the card ( and camera ) once moved. It resets whenever the
 * action card changes.
 */
const dragOffset = ref({ x: 0, y: 0 })
let dragStart: { pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null =
    null
// The element ( the title bar ) that captured the pointer. Using pointer capture
// routes every move / up straight to it, so the box's own `@pointermove.stop` /
// `@pointerup.stop` ( which block the underlying canvas ) can't swallow the drag.
let dragElement: HTMLElement | null = null

function onDragMove(event: PointerEvent) {
    if (!dragStart) {
        return
    }
    dragOffset.value = {
        x: dragStart.offsetX + (event.clientX - dragStart.pointerX),
        y: dragStart.offsetY + (event.clientY - dragStart.pointerY),
    }
}

function onDragEnd() {
    dragStart = null
    if (dragElement) {
        dragElement.removeEventListener('pointermove', onDragMove)
        dragElement.removeEventListener('pointerup', onDragEnd)
        dragElement.removeEventListener('pointercancel', onDragEnd)
        dragElement = null
    }
}

function onDragStart(event: PointerEvent) {
    // The whole box is a drag surface, except the interactive controls : a
    // pointerdown starting on a chip or the target button must stay a click.
    const source = event.target as HTMLElement
    if (source.closest('.discipline-chip, .usage-target-button, .usage-end-button')) {
        return
    }
    const element = event.currentTarget as HTMLElement
    dragStart = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: dragOffset.value.x,
        offsetY: dragOffset.value.y,
    }
    dragElement = element
    element.setPointerCapture(event.pointerId)
    element.addEventListener('pointermove', onDragMove)
    element.addEventListener('pointerup', onDragEnd)
    element.addEventListener('pointercancel', onDragEnd)
}

onUnmounted(onDragEnd)

const actionCardOid = computed(() =>
    gameState.action?.minionAction.type == MinionActionType.ActionCardFromHand ?
        gameState.action.minionAction.card.oid
    :   null,
)
// A new action starts fresh in its card-anchored position.
watch(actionCardOid, () => {
    dragOffset.value = { x: 0, y: 0 }
})

// The action card usage box : editable for the acting player, read-only for the
// others ( so they can see the declared disciplines ). Null unless one of our /
// their action cards is in progress and there is something to show.
const editor = computed(() => {
    const action = gameState.action
    const selfPlayer = players.selfPlayer

    if (
        !usageEditorEnabled.value ||
        !action ||
        gameBus.contextMenu.show ||
        action.minionAction.type != MinionActionType.ActionCardFromHand
    ) {
        return null
    }

    const minionAction = action.minionAction
    const card = minionAction.card
    const usage = minionAction.usage
    const selectedUses = usage.disciplines ?? []

    const editable = !!selfPlayer && minionAction.actingMinion.controller.oid == selfPlayer.oid

    // Other players / spectators only get the box once a discipline is chosen.
    if (!editable && selectedUses.length == 0) {
        return null
    }

    // The box is anchored under the acting minion, horizontally centered, its top
    // border aligned with the minion's bottom edge. getWorldPosition() gives the
    // minion's visual center ; a locked minion ( which it is once the action is
    // declared ) is rotated 90 degrees, so its on-screen height is the card width.
    const minion = minionAction.actingMinion
    const worldPoint = gameBus.cardsInGame[minion.oid]?.getWorldPosition()
    if (!worldPoint) {
        return null
    }

    const scale = display.scale
    const { x, y } = getScreenPoint(worldPoint.x, worldPoint.y)
    const rect = getCardRectangle(minion)
    const minionHalfHeight = (minion.isLocked ? rect.width : rect.height) / 2
    const minionBottom = y + minionHalfHeight * scale

    const selectedKeys = new Set(selectedUses.map(useKey))

    let chips: UsageChip[]
    if (editable) {
        // All parsed options, selectable.
        const { options } = parseCardUsage(card.text)
        chips = options.map(option => ({
            key: option.map(useKey).join('|'),
            selected: option.every(use => selectedKeys.has(useKey(use))),
            uses: option,
        }))
    } else {
        // Only what was actually declared, static.
        chips = selectedUses.map(use => ({
            key: useKey(use),
            selected: true,
            uses: [use],
        }))
    }

    // Only a plain Action card can be directed at a target.
    // Every other Action cards ( Political, Equipment... ) is necessarily undirected,
    // so the target button is hidden.
    const directable = card.type == LibraryCardType.Action

    return {
        editable,
        directable,
        chips,
        style: {
            top: `${minionBottom + dragOffset.value.y}px`,
            left: `${x + dragOffset.value.x}px`,
            transform: `scale(${scale}) translate(-50%, 0)`,
        },
    }
})

function currentUsage(): LibraryCardUsage {
    return gameState.action?.minionAction.type == MinionActionType.ActionCardFromHand ?
            gameState.action.minionAction.usage
        :   {}
}

function updateDisciplines(disciplines: DisciplineUse[]) {
    const usage = currentUsage()
    // Re-selecting the same discipline(s) changes nothing : skip the mutation so
    // it does not append a redundant log line.
    if (actions.sameDisciplineUses(usage, { disciplines })) {
        return
    }
    gameMutations.ACTION_updateUsage.actSelf({
        usage: { ...usage, disciplines },
    })
}

function toggleOption(chip: UsageChip) {
    const usage = currentUsage()
    const current = usage.disciplines ?? []
    const { multiple } = parseCardUsage(
        gameState.action?.minionAction.type == MinionActionType.ActionCardFromHand ?
            gameState.action.minionAction.card.text
        :   '',
    )

    if (multiple) {
        // Multi-select : toggle just this option's uses, keep the others.
        const optionKeys = new Set(chip.uses.map(useKey))
        const kept = current.filter(use => !optionKeys.has(useKey(use)))
        updateDisciplines(chip.selected ? kept : [...kept, ...chip.uses])
        return
    }

    // Single-select : the option becomes the whole selection. Re-clicking the
    // already-selected option is a no-op ( updateDisciplines skips it ).
    updateDisciplines([...chip.uses])
}

function declareTarget() {
    if (gameState.action?.minionAction.type != MinionActionType.ActionCardFromHand) {
        return
    }
    // Reuse the board target-declaration flow : the player then clicks a card or
    // player, which validateTargetDeclaration records into the action usage.
    startTargetDeclaration(gameState.action.minionAction.card)
}
</script>

<style lang="scss">
.action-usage-editor {
    position: absolute;
    transform-origin: top left;
    z-index: 1049;

    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    min-width: 90px;

    background: $ash-grey;
    color: $ghost-white;
    border: 2px solid rgba($blood-red, 0.2);

    user-select: none;
    cursor: move;

    &.read-only {
        border-color: rgba($ghost-white, 0.15);
    }

    .usage-title {
        font-size: 11px;
        letter-spacing: 0.3px;
        text-align: center;
        color: $silver-grey;
        text-transform: capitalize;
    }

    .discipline-options {
        display: flex;
        gap: 6px;
        justify-content: center;
        flex-wrap: wrap;
    }

    .discipline-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 4px 8px;
        font-size: 20px;
        cursor: pointer;

        background: $slate-grey;
        color: $silver-grey;
        border: 1px solid rgba($ghost-white, 0.15);

        &:hover:not(.static) {
            background: $shadow-teal;
            color: $ghost-white;
        }

        &.selected {
            background: $dark-teal;
            color: $ghost-white;
            border-color: rgba($ghost-white, 0.35);
        }

        &.static {
            cursor: default;
            background: $slate-grey;
        }
    }

    // Separates the discipline choice from the target declaration.
    .usage-divider {
        height: 2px;
        margin: 4px 0;
        background: rgba($ghost-white, 0.4);
    }

    .usage-target-button {
        padding: 4px 8px;
        font-size: 12px;
        text-align: center;
        cursor: pointer;

        background: $slate-grey;
        color: $silver-grey;
        border: 1px solid rgba($ghost-white, 0.15);

        &:hover {
            background: $shadow-teal;
            color: $ghost-white;
        }
    }

    // A discreet destructive action : it only hints at the blood-red danger,
    // brightening on hover, so it does not shout from the small box.
    .usage-end-button {
        padding: 3px 8px;
        font-size: 11px;
        text-align: center;
        cursor: pointer;

        background: rgba($blood-red, 0.2);
        color: $ghost-white;
        border: 1px solid rgba($blood-red, 0.35);

        &:hover {
            background: rgba($blood-red, 0.4);
            color: $ghost-white;
        }
    }
}
</style>
