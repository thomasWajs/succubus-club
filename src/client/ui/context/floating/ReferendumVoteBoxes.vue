<template>
    <div
        v-for="voteBox in voteBoxes"
        :key="voteBox.vampire.oid"
        class="referendum-vote-box"
        :class="{
            'is-read-only': !voteBox.isSelfControlled,
            'is-ballot': voteBox.isBallot,
            'voted-in-favour':
                !voteBox.isSelfControlled && voteBox.castVote.side == VoteSide.InFavour,
            'voted-against': !voteBox.isSelfControlled && voteBox.castVote.side == VoteSide.Against,
        }"
        :style="voteBox.style"
    >
        <!-- Own vampires : the sides are the way to announce a vote -->
        <template v-if="voteBox.isSelfControlled">
            <div class="vote-sides">
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
            </div>

            <div class="vote-amount">
                <PropertyStepper
                    :value="voteBox.castVote.amount"
                    :label="voteBox.isBallot ? 'ballots' : 'votes'"
                    @change="changeVotes(voteBox.vampire, $event)"
                />
            </div>
        </template>

        <!--
        Other players' vampires : a compact read-only badge showing only the
        number cast. The side is read from the box background alone : neutral
        when the vampire abstains, green in favour, red against.
        -->
        <strong
            v-else
            class="vote-badge"
        >
            {{ voteBox.castVote.amount }} {{ voteBox.isBallot ? 'ballots' : 'votes' }}
        </strong>
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
import { getCastBallot, getCastVote, isBallotVampire } from '@/shared/state/referendumState.ts'
import { CastVote, VoteSide } from '@/shared/types/state.ts'
import { Vampire } from '@/shared/model/Card.ts'
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const players = usePlayersStore()

// Gap between the bottom of the card and the top of its box, in world units
const VOTE_BOX_GAP = 5

type VoteBoxData = {
    vampire: Vampire
    castVote: CastVote
    isSelfControlled: boolean
    // A priscus casts ballots into the subreferendum rather than plain votes
    isBallot: boolean
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
                const isBallot = isBallotVampire(vampire)
                boxes.push({
                    vampire,
                    castVote:
                        isBallot ?
                            getCastBallot(referendum, vampire)
                        :   getCastVote(referendum, vampire),
                    isSelfControlled,
                    isBallot,
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
    gap: 3px;

    padding: 3px;
    border: solid 2px $shadow-grey;
    background: rgba($pearl-grey, 0.92);
    color: $shadow-grey;

    white-space: nowrap;
    user-select: none;

    .vote-sides,
    .vote-amount {
        display: flex;
        align-items: center;
        gap: 3px;
        font-size: 0.75rem;
    }

    .game-button.small {
        font-size: 0.72rem;
        padding: 2px 4px;
        min-width: 0;
    }

    // Compact read-only badge : just the number cast, the side carried by the
    // box background alone
    .vote-badge {
        font-size: 0.95rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
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

    &:hover {
        z-index: 1100;
    }

    // Nothing to click on : keep the box discreet and tight
    &.is-read-only {
        padding: 2px 6px;
        background: rgba($pearl-grey, 0.75);
    }

    // Read-only side indicators : the background carries the vote on its own,
    // overriding the discreet neutral background above
    &.voted-in-favour {
        background: $dark-forest;
        color: $ghost-white;
    }

    &.voted-against {
        background: $wine-crimson;
        color: $ghost-white;
    }

    // Priscii cast ballots into the subreferendum : set their boxes apart
    &.is-ballot {
        border-color: $royal-purple;
    }
}
</style>
