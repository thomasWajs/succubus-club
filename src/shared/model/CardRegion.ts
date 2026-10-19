import { BaseModel } from '@/shared/model/BaseModel.ts'
import { CardRegionVisibility, RegionName } from '@/shared/const/model.ts'
import { Card } from '@/shared/model/Card.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { CardOid, CardRegionOid, GameId } from '@/shared/types/model.ts'
import { Player } from '@/shared/model/Player.ts'

export class CardRegion<CardType extends Card> extends BaseModel {
    constructor(
        public gameId: GameId,
        public oid: CardRegionOid,
        public name: RegionName,
        public visibility: CardRegionVisibility,
        public cardsOid: CardOid[] = [],
    ) {
        super(gameId, oid)
    }

    get cards(): CardType[] {
        return this.cardsOid
            .map(cardOid => this.gameState.cards[cardOid])
            .filter((card): card is CardType => card !== undefined)
    }

    get isEmpty() {
        return this.cards.length == 0
    }

    get length() {
        return this.cards.length
    }

    get firstCard() {
        if (this.isEmpty) {
            throw new Error('Cannot get first card from empty region')
        }
        return this.cards[0]
    }

    get owner(): Player | undefined {
        return this.gameState.regionOwners[this.oid]
    }

    // The player the owner gave control to, if any
    get delegate(): Player | undefined {
        const delegateOid = this.gameState.regionTakeovers[this.oid]
        return delegateOid ? this.gameState.players[delegateOid] : undefined
    }

    // Control is cumulative : the owner always keeps it, the delegate shares it
    isControlledBy(player: Player): boolean {
        return this.owner?.oid == player.oid || this.delegate?.oid == player.oid
    }

    // Shortcuts to check this region
    get is() {
        return {
            play: [
                RegionName.Ready,
                RegionName.Torpor,
                RegionName.Uncontrolled,
                RegionName.Table,
            ].includes(this.name),
            controlled: [RegionName.Ready, RegionName.Torpor, RegionName.Table].includes(this.name),
            ready: this.name == RegionName.Ready,
            torpor: this.name == RegionName.Torpor,
            uncontrolled: this.name == RegionName.Uncontrolled,
            crypt: this.name == RegionName.Crypt,
            library: this.name == RegionName.Library,
            hand: this.name == RegionName.Hand,
            ashHeap: this.name == RegionName.AshHeap,
            removed: this.name == RegionName.Removed,
            table: this.name == RegionName.Table,
        }
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

    // With a subset, only those cards are shuffled, among the positions they occupy
    generateShuffledCardsOrder(subset?: CardOid[]) {
        if (subset) {
            const chosen = new Set(subset)
            const shuffled = shuffleArray(this.cardsOid.filter(oid => chosen.has(oid)))
            let next = 0
            return this.cardsOid.map(oid => (chosen.has(oid) ? shuffled[next++] : oid))
        } else {
            return shuffleArray([...this.cardsOid])
        }
    }

    shuffle() {
        this.cardsOid = this.generateShuffledCardsOrder()
    }
}
