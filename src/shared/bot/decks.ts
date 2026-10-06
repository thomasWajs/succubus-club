import {
    ASYLUM_HUNTING_GROUND_ID,
    BEHIND_YOU_ID,
    DEFLECTION_ID,
    ELDER_LIBRARY_ID,
    GOVERN_ID,
    LOST_IN_CROWDS_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { DeckList } from '@/shared/types/gateway.ts'

export const GovernDeck = <DeckList>{
    [ASYLUM_HUNTING_GROUND_ID]: 1,
    [BEHIND_YOU_ID]: 8,
    [DEFLECTION_ID]: 8,
    [ELDER_LIBRARY_ID]: 1,
    [GOVERN_ID]: 32,
    [LOST_IN_CROWDS_ID]: 12,

    '201634': 1,
    '201626': 1,
    '201617': 1,
    '201628': 1,
    '201632': 1,
    '201532': 1,
    '201640': 1,
    '201548': 1,
    '201543': 1,
    '201627': 1,
    '201569': 1,
    '201533': 1,
}

// The Malkavian precon of reference ( .claude/docs/precon_malkav_v5.txt ) without the cards the
// bot decks drop for now: Spying Mission, Revelations, Dreams of the Sphinx ( replacements to find )
export const MalkavDeck = <DeckList>{
    '100108': 1, // Asylum Hunting Ground
    '100135': 1, // The Barrens
    '100199': 4, // Blood Doll
    '100236': 4, // Bonding
    '100362': 4, // Cloak the Gathering
    '100401': 4, // Conditioning
    '100518': 5, // Deflection
    '100620': 1, // Elder Library
    '100680': 5, // Eyes of Argus
    '100687': 4, // Faceless Night
    '100765': 2, // Foreshadowing Destruction
    '100845': 12, // Govern the Unaligned
    '101104': 2, // Life in the City
    '101125': 4, // Lost in Crowds
    '101321': 5, // On the Qui Vive
    '101913': 4, // Swallowed by the Night
    '101949': 5, // Telepathic Misdirection
    '102180': 1, // Wider View

    '201530': 2, // Alexander Silverson
    '201532': 2, // Andi Liu
    '201533': 1, // Ashley
    '201543': 1, // Colette
    '201544': 2, // Donny Kowalczyk
    '201546': 1, // Dr. Stephen Norton
    '201548': 1, // Gelasia Fotiou
    '201559': 1, // Meaghan
    '201569': 1, // Sully
}

// The Brujah precon of reference ( .claude/docs/precon_brujah_v5 ) without the cards the bot decks
// drop for now: Delaying Tactics, Heroic Might, Fame, Guardian Angel, Haven Uncovered, Carver's Meat
// Packing and Storage, Frontal Assault, 47th Street Royals, The Anarch Free Press ( replacements to
// find ). The cards the engine cannot play yet stay in the deck: a bot never plays them.
export const BrujahDeck = <DeckList>{
    '100199': 4, // Blood Doll
    '100297': 1, // Carfax Abbey
    '100597': 4, // Dust Up
    '100640': 6, // Enchant Kindred
    '100959': 6, // Immortal Grapple
    '101239': 2, // Monkey Wrench
    '101321': 2, // On the Qui Vive
    '101523': 2, // Pursuit
    '101532': 5, // Quickness
    '101772': 2, // Show of Force
    '101798': 4, // Slam
    '101945': 4, // Taste of Vitae
    '101993': 5, // Torn Signpost
    '102150': 1, // Warzone Hunting Ground
    '102215': 4, // Roundhouse
    '102218': 2, // Bait and Switch
    '102229': 6, // Line Brawl
    '102230': 6, // Organized Resistance

    '200132': 1, // Ariane
    '201576': 2, // Aline Gadeke
    '201579': 2, // Atiena
    '201581': 1, // Brandon Grime
    '201585': 1, // Elen Kamjian
    '201609': 1, // Octane
    '201610': 1, // Rayne
    '201612': 1, // Siarhei Levchenko
    '201613': 1, // Theo Bell
    '201614': 1, // Valeriya Zinovieva
}
