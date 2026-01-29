import { computed } from 'vue'
import { Card } from '@/shared/model/Card.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { ATLAS_FREQUENT } from '@/client/resources/cards.ts'
import { selfCanSee } from '@/client/state/self.ts'
import { Texture } from '@/client/resources/textures.ts'

export function useCardTexture(card: Card) {
    const core = useCoreStore()
    const frequentCards = core.phaserGame.textures.get(ATLAS_FREQUENT).getFrameNames()

    let texture
    if (frequentCards.includes(card.resource.imageName)) {
        texture = {
            textureName: ATLAS_FREQUENT,
            frameName: card.resource.imageName,
        }
    } else {
        texture = {
            textureName: card.resource.imageName,
        }
    }

    const backTexture = {
        textureName: card.isCrypt ? Texture.CardbackCrypt : Texture.CardbackLibrary,
        frameName: undefined,
    }

    const displayedTexture = computed(() => {
        return selfCanSee(card) ? texture : backTexture
    })

    return { texture, backTexture, displayedTexture }
}
