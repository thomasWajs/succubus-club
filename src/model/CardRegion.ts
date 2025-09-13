import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { CardRegionVisibility, RegionName } from '@/model/const.ts'
import { Card, CardOid } from '@/model/Card.ts'
import { shuffleArray } from '@/utils.ts'

// Alias to specify the expected objects through the codebase
export type CardRegionOid = ObjectId

export class CardRegion<CardType extends Card> extends BaseModel {
    constructor(
        public oid: CardRegionOid,
        public name: RegionName,
        public visibility: CardRegionVisibility,
        public cardsOid: CardOid[] = [],
    ) {
        super(oid)
    }

    get length() {
        return this.cardsOid.length
    }

    get isEmpty() {
        return this.length == 0
    }

    get cards(): CardType[] {
        const gameState = useGameStateStore()
        return this.cardsOid.map(cardOid => gameState.cards[cardOid]) as CardType[]
    }

    get firstCard() {
        if (this.length === 0) {
            throw new Error('Cannot get first card from empty region')
        }
        return useGameStateStore().cards[this.cardsOid[0]]
    }

    get owner() {
        return useGameStateStore().regionOwners[this.oid]
    }

    get isRevealedToSelf() {
        const gameState = useGameStateStore()
        const revelation = gameState.revelations[this.oid] ?? {}
        return revelation.all || revelation[gameState.selfPlayer.oid]
    }

    indexOf(card: CardType): number {
        return this.cardsOid.indexOf(card.oid)
    }

    remove(card: CardType) {
        this.cardsOid = this.cardsOid.filter(coid => coid != card.oid)
    }

    append(card: CardType) {
        this.cardsOid = [...this.cardsOid, card.oid]
    }

    insert(card: CardType, index: number) {
        this.cardsOid.splice(index, 0, card.oid)
    }

    move(card: CardType, newIndex: number) {
        const oldIndex = this.indexOf(card)
        if (oldIndex < newIndex) {
            newIndex--
        }
        this.cardsOid.splice(oldIndex, 1)
        this.cardsOid.splice(newIndex, 0, card.oid)
    }

    getRandomCard(): CardType {
        if (this.length === 0) {
            throw new Error('Cannot get random card from empty region')
        }
        return this.cards[Math.floor(Math.random() * this.length)]
    }

    generateShuffledCardsOrder() {
        return shuffleArray([...this.cardsOid])
    }

    shuffle() {
        this.cardsOid = this.generateShuffledCardsOrder()
    }
}

export type AnyCardRegion = CardRegion<Card>
