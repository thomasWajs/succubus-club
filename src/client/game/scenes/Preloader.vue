<template>
    <Scene
        name="Preloader"
        :autoStart="true"
        @preload="preload"
        @create="create"
    />
</template>

<script setup lang="ts">
import Phaser from 'phaser'
import { Scene } from 'phavuer'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { ATLAS_FREQUENT, CARDS_PATH } from '@/client/resources/cards.ts'
import { preloadedTextures, Texture } from '@/client/resources/textures.ts'
import { gameResources } from '@/shared/registries.ts'

const gameState = useGameStateStore()

function preload(scene: Phaser.Scene) {
    for (const textureName of Object.values(Texture)) {
        scene.textures.addImage(
            textureName,
            preloadedTextures[textureName as keyof typeof preloadedTextures],
        )
    }

    scene.textures.addAtlas(ATLAS_FREQUENT, preloadedTextures.atlasTexture, gameResources.atlasJson)
    const frequentCards = scene.textures.get(ATLAS_FREQUENT).getFrameNames()

    const cardsInGame = new Set<string>()
    for (const [_, card] of Object.entries(gameState.cards)) {
        cardsInGame.add(card.resource.imageName)
    }
    for (const cardName of cardsInGame) {
        if (!frequentCards.includes(cardName)) {
            scene.load.image(cardName, `${CARDS_PATH}/${cardName}.webp`)
        }
    }
}

function create(scene: Phaser.Scene) {
    scene.scene.start('Tabletop')
}
</script>
