import { computed } from 'vue'
import { Card } from '@/shared/model/Card.ts'
import { selfCanSee } from '@/client/state/self.ts'
import {
    getAtlasForCard,
    isTextureLoaded,
    loadTexture,
    Texture,
} from '@/client/resources/textures.ts'
import { getTabletopScene } from '@/client/game/camera.ts'

export function useCardTexture(card: Card) {
    const backTexture = {
        textureName: card.isCrypt ? Texture.CardbackCrypt : Texture.CardbackLibrary,
        frameName: undefined,
    }
    const backTextureLoading = {
        textureName: card.isCrypt ? Texture.CardbackCryptLoading : Texture.CardbackLibraryLoading,
        frameName: undefined,
    }

    const texture = computed(() => {
        if (!card.resource) {
            return backTexture
        }
        const imageName = card.resource.imageName

        // Load only if not loaded
        if (!isTextureLoaded(imageName)) {
            loadTexture(getTabletopScene(), imageName)
            return backTextureLoading
        }

        const atlasName = getAtlasForCard(imageName)
        if (atlasName) {
            return {
                textureName: atlasName,
                frameName: imageName,
            }
        } else {
            return {
                textureName: imageName,
            }
        }
    })

    const displayedTexture = computed(() => {
        return selfCanSee(card) ? texture.value : backTexture
    })

    return { texture, backTexture, displayedTexture }
}
