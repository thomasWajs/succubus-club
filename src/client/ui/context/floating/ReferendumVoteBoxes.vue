<template>
    <div
        v-for="voteBox in voteBoxes"
        :key="voteBox.vampire.oid"
        class="referendum-vote-box"
        :class="{ 'is-read-only': !voteBox.isSelfControlled }"
        :style="voteBox.style"
    >
        <div class="vote-sides">
            <!-- Own vampires : the sides are the way to announce a vote -->
            <template v-if="voteBox.isSelfControlled">
                <button
                    class="game-button small vote-in-favour"
                    :class="{ 'is-cast': voteBox.castVote.side == VoteSide.InFavour }"
                    @click="castVote(voteBox.vampire, VoteSide.InFavour)"
                >
                    In favour
                </button>

                <button
                    class="game-button small vote-against"
                    :class="{ 'is-cast': voteBox.castVote.side == VoteSide.Against }"
                    @click="castVote(voteBox.vampire, VoteSide.Against)"
                >
                    Against
                </button>
            </template>

            <!-- Other players' vampires : same sides, as a read-only state -->
            <template v-else>
                <span
                    class="vote-side-display vote-in-favour"
                    :class="{ 'is-cast': voteBox.castVote.side == VoteSide.InFavour }"
                >
                    In favour
                </span>

                <span
                    class="vote-side-display vote-against"
                    :class="{ 'is-cast': voteBox.castVote.side == VoteSide.Against }"
                >
                    Against
                </span>
            </template>
        </div>

        <div class="vote-amount">
            <PropertyStepper
                v-if="voteBox.isSelfControlled"
                :value="voteBox.castVote.amount"
                label="votes"
                @change="changeVotes(voteBox.vampire, $event)"
            />

            <strong v-else>{{ voteBox.castVote.amount }} votes</strong>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * One vote box per ready vampire, for the duration of a referendum.
 *
 * The box is anchored below its vampire on the tabletop, the same way the
 * floating actions and the action drop tooltip are. Boxes are shown for every
 * player's vampires, but only your own are interactive : other players announce
 * their own votes, so theirs are displayed as a read-only state.
 *
 * Clicking the side one of your vampires already voted for retracts its vote.
 */
import { computed } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { display } from '@/client/game/display.ts'
import { getCardRectangle, getScreenPoint } from '@/client/game/utils.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { getCastVote } from '@/shared/state/referendumState.ts'
import { CastVote, VoteSide } from '@/shared/types/state.ts'
import { Vampire } from '@/shared/model/Card.ts'
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const players = usePlayersStore()

// Gap between the bottom of the card and the top of its box, in world units
const VOTE_BOX_GAP = 10

type VoteBoxData = {
    vampire: Vampire
    castVote: CastVote
    isSelfControlled: boolean
    style: Record<string, string>
}

// Anchored just below the vampire, centered on it
function getBoxStyle(vampire: Vampire): Record<string, string> | null {
    const worldPoint = gameBus.cardsInGame[vampire.oid]?.getWorldPosition()
    if (!worldPoint) {
        return null
    }

    const { x, y } = getScreenPoint(worldPoint.x, worldPoint.y)
    const rect = getCardRectangle(vampire)

    return {
        left: `${x}px`,
        top: `${y + (rect.height * display.scale) / 2 + VOTE_BOX_GAP * display.scale}px`,
        transform: `scale(${display.scale}) translateX(-50%)`,
    }
}

const voteBoxes = computed<VoteBoxData[]>(() => {
    const referendum = gameState.referendum
    if (!referendum) {
        return []
    }

    const boxes: VoteBoxData[] = []

    for (const player of gameState.competingPlayers) {
        const isSelfControlled = player == players.selfPlayer

        for (const vampire of player.vampiresReady) {
            const style = getBoxStyle(vampire)
            // A vampire whose game object is not on the tabletop yet gets no box
            if (style) {
                boxes.push({
                    vampire,
                    castVote: getCastVote(referendum, vampire),
                    isSelfControlled,
                    style,
                })
            }
        }
    }

    return boxes
})

function castVote(vampire: Vampire, side: VoteSide) {
    gameMutations.REFERENDUM_castVote.actSelf({ vampire, side })
}

function changeVotes(vampire: Vampire, amount: number) {
    gameMutations.REFERENDUM_changeVotes.actSelf({ vampire, amount })
}
</script>

<style lang="scss">
.referendum-vote-box {
    position: absolute;
    transform-origin: top left;
    z-index: 1049;

    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;

    padding: 5px 6px;
    border: solid 2px $shadow-grey;
    background: rgba($pearl-grey, 0.92);
    color: $shadow-grey;

    white-space: nowrap;
    user-select: none;

    .vote-sides,
    .vote-amount {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    // Read-only counterpart of the side buttons, on other players' vampires
    .vote-side-display {
        padding: 3px 5px;
        border: 1px solid transparent;

        font-size: 0.8rem;
        font-weight: 600;
        color: $mist-grey;
    }

    // The side this vampire currently votes for
    .vote-in-favour.is-cast {
        background: $dark-forest;
        border-color: $vibrant-emerald;
        color: $ghost-white;
    }

    .vote-against.is-cast {
        background: $wine-crimson;
        border-color: $warm-coral;
        color: $ghost-white;
    }

    // Nothing to click on : keep the box discreet
    &.is-read-only {
        background: rgba($pearl-grey, 0.75);
    }
}
</style>
