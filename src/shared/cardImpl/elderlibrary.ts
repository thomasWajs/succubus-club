import { MasterCardImplementation } from '@/shared/cardImpl/base.ts'

// Unique location. +1 hand size.
export class ElderLibrary extends MasterCardImplementation {
    get staysInPlay() {
        return true
    }

    get handSizeBonus() {
        return 1
    }
}
