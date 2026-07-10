import { DeckList } from '@/shared/types/gateway.ts'

export class NotInAGameRoom extends Error {
    constructor(message?: string) {
        super(message)
        this.name = 'NotInAGameRoom'
    }
}

export type Puppet = {
    name: string
    deckList: DeckList
}
