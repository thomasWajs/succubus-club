// Register server code into shared functions
import { setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/serialization.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export function initServer() {
    //registerMutationTrigger({ act, actSelf })

    initWasmHasher()
    loadCardbase()
}

function loadCardbase() {
    const cardbasePath = resolve('../../public/assets/cardbase.json')
    const cardbase = JSON.parse(readFileSync(cardbasePath, 'utf-8'))
    setGameResources('cardbase', cardbase)
}
