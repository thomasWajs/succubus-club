<template>
    <div id="RightColumnPlayers">
        <div class="separator">Players</div>
        <div
            v-for="player in gameState.players"
            :key="player.oid"
            class="player"
            :class="{
                acting: player === gameState.activePlayer,
                ousted: player.isOusted,
                disconnected: players.disconnectedPlayers.has(player.oid),
            }"
        >
            <Icon
                v-if="players.disconnectedPlayers.has(player.oid)"
                class="disconnected-icon"
                name="disconnected"
                title="Disconnected"
            />
            <Icon
                v-if="player.isOusted"
                class="ousted-icon"
                name="ousted"
                title="Ousted"
            />
            <span
                class="player-name"
                :style="{ color: playerNameRgba(player) }"
            >
                {{ player.shortName }}
            </span>

            <Icon
                class="visibility-icon"
                :name="players.hiddenPlayers.has(player.oid) ? 'hidden' : 'visible'"
                :title="players.hiddenPlayers.has(player.oid) ? 'Hidden' : 'Visible'"
                @click="players.toggleHidden(player.oid)"
            />
        </div>

        <template v-if="gameState.gameType == GameType.Multiplayer">
            <template v-if="multiplayer.judgeUsers.length > 0">
                <div class="separator">Judges</div>
                <div
                    v-for="judge in multiplayer.judgeUsers"
                    :key="judge.permId"
                    class="player judge"
                >
                    <span class="player-name">
                        {{ judge.name }}
                    </span>
                </div>
            </template>

            <template v-if="multiplayer.spectatorUsers.length > 0">
                <div class="separator">Spectators</div>
                <div
                    v-for="spectator in multiplayer.spectatorUsers"
                    :key="spectator.permId"
                    class="player spectator"
                >
                    <span class="player-name">
                        {{ spectator.name }}
                    </span>
                </div>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { GameType } from '@/shared/types/state.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { playerNameRgba } from '@/client/colors.ts'
import Icon from '@/client/ui/components/Icon.vue'

const gameState = useGameStateStore()
const multiplayer = useMultiplayerStore()
const players = usePlayersStore()
</script>

<style lang="scss" scoped>
#RightColumnPlayers {
    color: var(--ui-panel-text);

    // A labelled rule : the two lines flank the centered title.
    // Both are empty, so flex: 1 splits the space exactly in half.
    .separator {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 4px 0;

        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--ui-label-text);

        &::before,
        &::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--ui-subtle-border);
        }
    }

    .player {
        display: flex;
        align-items: center;
        padding: 3px 3px;

        min-width: 0; /* Important for ellipsis to work */
        white-space: nowrap;
        overflow: hidden;
        gap: 4px;

        &.acting {
            background: light-dark(rgba($vibrant-emerald, 0.3), rgba($ui-accent, 0.6));
        }
        &.disconnected {
            background: rgba($crimson-red, 0.6);
        }
        &.ousted {
            background: light-dark($mist-grey, $ui-surface-raised);
            color: var(--ui-panel-text-muted);
        }

        .disconnected-icon {
            font-size: 14px;
        }

        // Same red as the OUSTED text over the play area
        .ousted-icon {
            font-size: 20px;
            color: $crimson-red;
        }

        .player-name {
            display: inline-block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0; /* Important for ellipsis to work */
            flex-grow: 1;
        }

        .visibility-icon {
            flex-shrink: 0;
            font-size: 18px;
            cursor: pointer;
        }
    }
}
</style>
