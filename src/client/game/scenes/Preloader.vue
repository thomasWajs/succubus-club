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
import { ATLASES } from '@/client/resources/cards.ts'
import {
    CANVAS_ICONS,
    createFadeTexture,
    enqueueTextureLoading,
    FADE_TEXTURE_KEY,
    fadeDither,
    getFrequentCards,
    iconTextureKey,
    preloadedAtlasTextures,
    preloadedIconTextures,
    preloadedTextures,
    setupTextureListener,
    Texture,
} from '@/client/resources/textures.ts'
import { gameResources } from '@/shared/registries.ts'
import { Colors } from '@/client/colors.ts'
import { ACTIVE_PLAYER_GRADIENT_ALPHA } from '@/shared/const/game.ts'

const gameState = useGameStateStore()

function preload(scene: Phaser.Scene) {
    setupTextureListener(scene)

    for (const textureName of Object.values(Texture)) {
        scene.textures.addImage(
            textureName,
            preloadedTextures[textureName as keyof typeof preloadedTextures],
        )
    }

    for (const icon of CANVAS_ICONS) {
        const canvas = preloadedIconTextures[icon]
        if (canvas) {
            scene.textures.addCanvas(iconTextureKey(icon), canvas)
        }
    }
    // The active player's bar fade, see PlayerBarGo
    scene.textures.addCanvas(
        FADE_TEXTURE_KEY,
        createFadeTexture(
            fadeDither(
                ACTIVE_PLAYER_GRADIENT_ALPHA,
                Colors.ACTIVE_PLAYER_GRADIENT,
                Colors.DARK_PLAYER_BAR,
            ),
        ),
    )

    for (const atlasName of ATLASES) {
        scene.textures.addAtlas(
            atlasName,
            preloadedAtlasTextures[atlasName],
            gameResources.atlasJsons[atlasName],
        )
    }
    const frequentCards = getFrequentCards()

    const knownCardsInGame = new Set<string>()
    for (const card of Object.values(gameState.cards)) {
        if (card.resource) {
            knownCardsInGame.add(card.resource.imageName)
        }
    }
    for (const cardName of knownCardsInGame) {
        if (!frequentCards.includes(cardName)) {
            enqueueTextureLoading(scene, cardName)
        }
    }
}

function create(scene: Phaser.Scene) {
    scene.scene.start(gameState.isFreeTable ? 'FreeTable' : 'Tabletop')
}
</script>
