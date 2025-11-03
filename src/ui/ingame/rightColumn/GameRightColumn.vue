<template>
    <div id="GameRightColumn">
        <div class="card-close-up">
            <div
                v-if="closeUpCardImage"
                class="rulings-switch"
                :class="{ active: showRuling }"
                @click="showRuling = !showRuling"
            >
                <template v-if="showRuling">Hide </template>Rulings
            </div>

            <div
                v-if="showRuling"
                class="rulings-overlay"
            >
                <div
                    v-for="ruling in closeUpCardRulings"
                    :key="ruling.text"
                    class="ruling-text"
                >
                    {{ ruling.text }}
                    <br />
                    <a
                        v-for="(refUrl, refName) of ruling.refs"
                        :key="refName"
                        class="ruling-reference"
                        :href="refUrl"
                        target="_blank"
                    >
                        [{{ refName }}]
                    </a>
                </div>
            </div>

            <img
                v-if="closeUpCardImage"
                :src="closeUpCardImage"
            />
            <img
                v-else
                src="/assets/cardbackLibrary.webp"
            />
        </div>

        <RightColumnPlayers />
        <RightColumnTabs />
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameBusStore } from '@/store/bus.ts'
import RightColumnPlayers from '@/ui/ingame/rightColumn/RightColumnPlayers.vue'
import RightColumnTabs from '@/ui/ingame/rightColumn/RightColumnTabs.vue'
import { useCoreStore } from '@/store/core.ts'

const core = useCoreStore()
const gameBus = useGameBusStore()

const showRuling = ref(false)

const closeUpCardImage = computed(() => {
    const closeUp = gameBus.closeUpCard

    if (!closeUp.card) {
        return null
    }

    const texture = closeUp.canView ? closeUp.card.texture : closeUp.card.backTexture
    return core.phaserGame.textures.getBase64(texture.textureName, texture.frameName)
})

const closeUpCardRulings = computed(() => {
    const closeUp = gameBus.closeUpCard
    return closeUp.card && closeUp.canView ? closeUp.card.rulings : []
})
</script>

<style lang="scss" scoped>
$closeup-width: $right-column-width;
$closeup-height: 478px;

#GameRightColumn {
    width: $right-column-width;
    height: 100vh;

    background-color: $purple-grey;
    border-left: solid 4px $purple-grey;
    display: flex;
    flex-direction: column;
}

.card-close-up {
    width: $closeup-width;
    height: $closeup-height;
    max-width: $closeup-width;
    max-height: $closeup-height;
    min-width: $closeup-width;
    min-height: $closeup-height;
    margin: 0;
    padding: 0;
    overflow: hidden;
    position: relative;

    .rulings-switch {
        position: absolute;
        bottom: 0;
        left: 0;
        background: rgba(black, 0.75);
        color: $pearl-grey;
        padding: 2px 1px;
        font-size: 15px;
        cursor: pointer;
        user-select: none;

        z-index: 2;

        &:hover {
            filter: brightness(150%);
        }
        &.active {
            background: rgba($purple-grey, 1);
        }
    }

    .rulings-overlay {
        position: absolute;
        left: 0;
        top: 0;
        height: calc(100% - 2rem);
        width: calc(100% - 2rem);
        padding: 1rem;
        overflow: auto;
        overflow-x: hidden;

        background: rgba($shadow-grey, 0.97);
        color: $ghost-white;
        font-size: 16px;

        z-index: 1;
    }

    .ruling-text {
        margin-bottom: 1rem;
    }

    .ruling-reference {
        margin-right: 0.75rem;
        display: inline-block;
    }

    img {
        object-fit: none;
        width: $closeup-width;
        height: $closeup-height;
        max-width: $closeup-width;
        max-height: $closeup-height;
        min-width: $closeup-width;
        min-height: $closeup-height;
    }
}
</style>
