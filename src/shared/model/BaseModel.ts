import { GameId, ObjectId } from '@/shared/types/model.ts'
import { getGameState } from '@/shared/registries.ts'

export class BaseModel {
    constructor(
        public gameId: GameId,
        public oid: ObjectId,
    ) {}

    get gameState() {
        return getGameState(this.gameId)
    }
}
