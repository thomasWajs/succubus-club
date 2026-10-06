<template>
    <CentralPanel
        class="combat-infos"
        title="Combat"
    >
        <div class="combat-status">
            Round {{ combat.round }} &middot; {{ STEP_LABELS[combat.step] }} &middot;
            {{ combat.range }} range
        </div>

        <div class="combatants">
            <div
                v-for="combatant in combatants"
                :key="combatant.minion.oid"
                class="combatant"
            >
                <span class="cryptCard">{{ combatant.minion.name }}</span>
                <span v-if="combatant.strike">Strike: {{ combatant.strike.name }}</span>
                <span v-if="combatant.pendingDamage.regular || combatant.pendingDamage.aggravated">
                    Damage: {{ combatant.pendingDamage.regular }}
                    <template v-if="combatant.pendingDamage.aggravated">
                        + {{ combatant.pendingDamage.aggravated }} aggravated
                    </template>
                </span>
            </div>
        </div>

        <div class="combat-impulse">
            Impulse
            <strong :style="{ color: combat.impulsePlayer.rgbaColor }">
                {{ combat.impulsePlayer.shortName }}
            </strong>
        </div>

        <div class="combat-buttons">
            <template v-if="combat.step == CombatStep.Strike">
                <button
                    class="game-button"
                    :disabled="!selfCombatant"
                    @click="selfCombatant && strike(createHandStrike(selfCombatant))"
                >
                    Hand strike
                </button>
                <button
                    class="game-button"
                    :disabled="!selfCombatant"
                    @click="strike(createDodgeStrike())"
                >
                    Dodge
                </button>
                <!-- A strike from a card is resolved by hand: it has no effect here -->
                <button
                    class="game-button"
                    :disabled="!selfCombatant"
                    @click="strike(createStrike('Other strike'))"
                >
                    Other strike
                </button>
            </template>
            <button
                v-else
                class="game-button"
                :disabled="!selfCombatant"
                @click="gameMutations.COMBAT_pass.actSelf({})"
            >
                Pass
            </button>

            <!-- The damage to a human minion is applied by hand, or with this button -->
            <button
                v-if="
                    combat.step == CombatStep.DamageResolution &&
                    selfCombatant &&
                    hasPendingDamage(selfCombatant)
                "
                class="game-button"
                @click="gameMutations.COMBAT_applyDamage.actSelf({ minion: selfCombatant.minion })"
            >
                Apply damage
            </button>

            <button
                class="game-button is-danger"
                @click="gameMutations.COMBAT_end.actSelf({})"
            >
                End combat
            </button>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { CombatantMinion, CombatState, CombatStep, CombatStrike } from '@/shared/types/state.ts'
import { createDodgeStrike, createHandStrike, createStrike } from '@/shared/state/combatState.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const props = defineProps<{
    combat: CombatState
}>()

const players = usePlayersStore()

const STEP_LABELS: Record<CombatStep, string> = {
    [CombatStep.BeforeRange]: 'Before range',
    [CombatStep.DetermineRange]: 'Determine range',
    [CombatStep.BeforeStrikes]: 'Before strikes',
    [CombatStep.Strike]: 'Strike',
    [CombatStep.DamageResolution]: 'Damage resolution',
    [CombatStep.AdditionalStrikes]: 'Additional strikes',
    [CombatStep.Press]: 'Press',
    [CombatStep.EndOfRound]: 'End of round',
}

const combatants = computed(() => [props.combat.acting, props.combat.defending])

// The self player's minion, when the self player has the impulse
const selfCombatant = computed(() =>
    props.combat.impulsePlayer == players.selfPlayer ?
        combatants.value.find(combatant => combatant.minion.controller == players.selfPlayer)
    :   undefined,
)

function hasPendingDamage(combatant: CombatantMinion): boolean {
    return combatant.pendingDamage.regular > 0 || combatant.pendingDamage.aggravated > 0
}

function strike(chosen: CombatStrike) {
    if (selfCombatant.value) {
        gameMutations.COMBAT_chooseStrike.actSelf({
            minion: selfCombatant.value.minion,
            strike: chosen,
        })
    }
}
</script>

<style lang="scss">
.central-panel.combat-infos {
    align-items: stretch;
    gap: 0.5rem;
    padding: 0.5rem;

    .cryptCard {
        color: $crypt-orange;
        font-weight: bold;
    }

    .combat-status,
    .combat-impulse {
        text-align: center;
    }

    .combatants {
        display: flex;
        gap: 0.5rem;

        .combatant {
            flex: 1 1 0;
            min-width: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
    }

    .combat-buttons {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
    }
}
</style>
