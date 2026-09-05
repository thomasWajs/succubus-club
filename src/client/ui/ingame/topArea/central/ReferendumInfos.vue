<template>
    <CentralPanel
        class="referendum-infos"
        title="Referendum"
    >
        <div class="referendum-body">
            <!--
            Left column : votes that don't come from a vampire, one row per
            Methuselah. Only your own row is editable, everyone announces their
            own. Its width is content-driven and stable, which is what keeps the
            tally on the right from moving as the panel changes state.
            -->
            <div class="methuselah-votes">
                <span class="methuselah-votes-title">Methuselah votes</span>

                <span class="methuselah-votes-header">In favour</span>
                <span class="methuselah-votes-header">Against</span>

                <template
                    v-for="row in methuselahVoteRows"
                    :key="row.player.oid"
                >
                    <span
                        class="inline-player-name methuselah-votes-player"
                        :style="{ backgroundColor: row.player.rgbaColor }"
                    >
                        {{ row.player.shortName }}
                    </span>

                    <span class="methuselah-votes-cell">
                        <PropertyStepper
                            v-if="row.isSelf"
                            :value="row.votes[VoteSide.InFavour]"
                            @change="changePlayerVotes(row.player, VoteSide.InFavour, $event)"
                        />

                        <template v-else>{{ row.votes[VoteSide.InFavour] }}</template>
                    </span>

                    <span class="methuselah-votes-cell">
                        <PropertyStepper
                            v-if="row.isSelf"
                            :value="row.votes[VoteSide.Against]"
                            @change="changePlayerVotes(row.player, VoteSide.Against, $event)"
                        />

                        <template v-else>{{ row.votes[VoteSide.Against] }}</template>
                    </span>
                </template>
            </div>

            <!-- Right column : the tally, the panel's headline, and the controls -->
            <div class="referendum-summary">
                <div class="referendum-tally">
                    <div
                        class="tally-side in-favour"
                        :class="{ 'is-winner': winningSide == VoteSide.InFavour }"
                    >
                        <span class="tally-amount">{{ tally[VoteSide.InFavour] }}</span>
                        <span class="tally-label">In favour</span>
                    </div>

                    <div
                        class="tally-side against"
                        :class="{ 'is-winner': winningSide == VoteSide.Against }"
                    >
                        <span class="tally-amount">{{ tally[VoteSide.Against] }}</span>
                        <span class="tally-label">Against</span>
                    </div>
                </div>

                <div class="referendum-controls">
                    <!--
                    Fixed slots : the Interrupt button takes the place of the
                    Last call button, and the countdown takes the room between
                    the two buttons, so nothing moves when a last call starts
                    or stops.
                    -->
                    <template v-if="lastCallPending">
                        <button
                            class="game-button small"
                            @click="gameMutations.REFERENDUM_interruptLastCall.actSelf({})"
                        >
                            Interrupt
                        </button>
                    </template>

                    <button
                        v-else
                        class="game-button small"
                        @click="startLastCall"
                    >
                        Last call
                    </button>

                    <span
                        v-if="lastCallPending"
                        class="last-call-countdown"
                    >
                        Last call : {{ remainingSeconds }}
                    </span>

                    <button
                        class="game-button small is-danger"
                        @click="gameMutations.REFERENDUM_close.actSelf({})"
                    >
                        End referendum
                    </button>
                </div>
            </div>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
/**
 * Tally of an ongoing referendum.
 *
 * The panel is a scoreboard, not a referee : votes are announced by the players
 * through the vote boxes sitting next to their vampires, and through the
 * Methuselah vote steppers here for everything that has no vampire behind it
 * ( burning the edge, discarding a political card, activating a card in play ).
 * The only thing settled here is the last call, and even that is only a display
 * : the countdown runs off the shared lastCallStartTime, so each client reaches
 * the same outcome without any further broadcast.
 *
 * The whole panel has to fit the central box, which is short, hence the two
 * columns : one row per Methuselah on the left, the tally and its controls on
 * the right.
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ReferendumState, VoteSide } from '@/shared/types/state.ts'
import {
    getLastCallRemainingTime,
    getPlayerVotes,
    getWinningSide,
    isLastCallOver,
    tallyVotes,
} from '@/shared/state/referendumState.ts'
import { Player } from '@/shared/model/Player.ts'
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const props = defineProps<{
    referendum: ReferendumState
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()

/**
 * Last call countdown
 *
 * We only tick while a countdown is actually running, and stop as soon as it
 * is over : there is nothing left to refresh once the outcome is settled.
 */

const LAST_CALL_TICK = 100

const now = ref(Date.now())
let tickInterval: ReturnType<typeof setInterval> | undefined

function stopTick() {
    clearInterval(tickInterval)
    tickInterval = undefined
}

watch(
    () => props.referendum.lastCallStartTime,
    lastCallStartTime => {
        stopTick()
        now.value = Date.now()

        if (lastCallStartTime === null) {
            return
        }

        tickInterval = setInterval(() => {
            now.value = Date.now()
            if (isLastCallOver(props.referendum, now.value)) {
                stopTick()
            }
        }, LAST_CALL_TICK)
    },
    { immediate: true },
)

onUnmounted(stopTick)

const outcomeReached = computed(() => isLastCallOver(props.referendum, now.value))

const lastCallPending = computed(
    () => props.referendum.lastCallStartTime !== null && !outcomeReached.value,
)

const remainingSeconds = computed(() =>
    Math.ceil(getLastCallRemainingTime(props.referendum, now.value) / 1000),
)

function startLastCall() {
    gameMutations.REFERENDUM_startLastCall.actSelf({ date: new Date() })
}

const tally = computed(() => tallyVotes(props.referendum))

// Nothing is highlighted until an uninterrupted last call settles the outcome
const winningSide = computed(() => (outcomeReached.value ? getWinningSide(props.referendum) : null))

/**
 * Methuselah votes
 *
 * Every player gets a row, whether they brought votes or not, so the table
 * reads as the standing of the whole table rather than as a growing list.
 */

const methuselahVoteRows = computed(() =>
    gameState.competingPlayers.map(player => ({
        player,
        votes: getPlayerVotes(props.referendum, player),
        isSelf: player == players.selfPlayer,
    })),
)

function changePlayerVotes(player: Player, side: VoteSide, amount: number) {
    gameMutations.REFERENDUM_changePlayerVotes.actSelf({ player, side, amount })
}
</script>

<style lang="scss">
.central-panel.referendum-infos {
    // The central box is short, so this panel stays deliberately dense
    font-size: 13px;
    padding: 0.5rem 0.75rem;

    .referendum-body {
        align-self: stretch;
        display: flex;
        gap: 1rem;
    }

    /**
     * Methuselah votes
     */

    .methuselah-votes {
        // Content-sized and stable : the tally takes whatever is left, so
        // nothing in this panel reflows as its state changes
        flex: 0 0 auto;
        display: grid;
        // Fixed vote columns so a count growing to two digits doesn't widen
        // the table, and so plain numbers line up under the headers
        grid-template-columns: auto 70px 70px;
        align-items: center;
        gap: 1px 0.4rem;
    }

    // Plain case : uppercased, this heading widened the whole table
    .methuselah-votes-title {
        font-size: 12px;
    }

    .methuselah-votes-header {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        text-align: center;
    }

    .methuselah-votes-player {
        justify-self: start;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .methuselah-votes-cell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.2rem;
        font-weight: bold;
        font-variant-numeric: tabular-nums;
    }

    /**
     * Tally and controls
     */

    // Ruled off from the table : the tally on top, its controls underneath
    .referendum-summary {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 0.4rem;
        padding-left: 1rem;
        border-left: solid 1px rgba($shadow-grey, 0.4);
    }

    .referendum-tally {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
    }

    .tally-side {
        // The headline of the whole panel : both sides share the space the
        // table left over, and take as much of it as they can
        flex: 1 1 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2px 4px;
        border: solid 2px transparent;

        .tally-amount {
            font-size: 48px;
            font-weight: bold;
            line-height: 1.05;
            font-variant-numeric: tabular-nums;
        }

        .tally-label {
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        &.in-favour .tally-amount {
            color: $dark-forest;
        }

        &.against .tally-amount {
            color: $wine-crimson;
        }

        // The side that carried an uninterrupted last call
        &.is-winner {
            border-color: $shadow-grey;
            background: rgba($ghost-white, 0.9);
        }
    }

    // Both controls share one width, at the right edge of the panel
    .referendum-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;

        > * {
            width: 100px;
        }
    }

    // The one time-critical thing on the panel, hence the size and the colour
    .last-call-countdown {
        // Content-sized : sitting between the two fixed control slots, its own
        // width changes nothing around it
        width: auto;
        font-size: 17px;
        font-weight: bold;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        text-align: center;
        color: $blood-red;
        animation: ReferendumLastCallAppear 0.3s ease-out;
    }
}

@keyframes ReferendumLastCallAppear {
    0% {
        opacity: 0;
        transform: scale(0.8);
    }
    100% {
        opacity: 1;
        transform: scale(1);
    }
}
</style>
