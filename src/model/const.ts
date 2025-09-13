export enum RegionName {
    Library = 'Library',
    Crypt = 'Crypt',
    AshHeap = 'Ash Heap',
    Removed = 'Removed',
    Hand = 'Hand',
    Uncontrolled = 'Uncontrolled',
    Torpor = 'Torpor',
    Controlled = 'Controlled',
}

export enum CardRegionVisibility {
    Hidden = 'Hidden',
    VisibleToController = 'Controller',
    VisibleToAll = 'All',
}

export enum TurnPhase {
    Unlock = 'Unlock',
    Master = 'Master',
    Minion = 'Minion',
    Influence = 'Influence',
    Discard = 'Discard',
}

export const TurnSequence = [
    TurnPhase.Unlock,
    TurnPhase.Master,
    TurnPhase.Minion,
    TurnPhase.Influence,
    TurnPhase.Discard,
]

export enum CombatStep {
    BeforeRange = 'BeforeRange',
    Range = 'Range',
    BeforeStrike = 'BeforeStrike',
    Strike = 'Strike',
    DamageResolution = 'DamageResolution',
    Press = 'Press',
    EndOfRound = 'EndOfRound',
}

export const CombatSequence = [
    CombatStep.BeforeRange,
    CombatStep.Range,
    CombatStep.BeforeStrike,
    CombatStep.Strike,
    CombatStep.DamageResolution,
    CombatStep.Press,
    CombatStep.EndOfRound,
]

export enum LibraryCardType {
    Master = 'Master',
    Action = 'Action',
    PoliticalAction = 'Political Action',
    Ally = 'Ally',
    Equipment = 'Equipment',
    Retainer = 'Retainer',
    ActionModifier = 'Action Modifier',
    Reaction = 'Reaction',
    Combat = 'Combat',
    Event = 'Event',
    Conviction = 'Conviction',
    Power = 'Power',
    Reflex = 'Reflex',
}

export const ACTION_TYPES = [
    LibraryCardType.Action,
    LibraryCardType.PoliticalAction,
    LibraryCardType.Ally,
    LibraryCardType.Equipment,
    LibraryCardType.Retainer,
    LibraryCardType.ActionModifier,
]

export enum Sect {
    Camarilla = 'Camarilla',
    Sabbat = 'Sabbat',
    Laibon = 'Laibon',
    Independent = 'Independent',
    Anarch = 'Anarch',
    Imbued = 'Imbued',
}

export enum Trait {
    BlackHand = 'Black Hand',
    Infernal = 'Infernal',
    RedList = 'Red List',
    Seraph = 'Seraph',
}

export enum Path {
    PathOfCaine = 'Path Of Caine',
    PathOfCathari = 'Path Of Cathari',
    PathOfDeath = 'Path Of Death',
    PathOfPower = 'Path Of Power',
}

export const Markers = {
    Sect: [Sect.Anarch, Sect.Camarilla, Sect.Independent, Sect.Laibon, Sect.Sabbat],
    Trait: [Trait.BlackHand, Trait.Infernal, Trait.RedList, Trait.Seraph],
    Path: [Path.PathOfCaine, Path.PathOfCathari, Path.PathOfDeath, Path.PathOfPower],
}
export type Marker = (typeof Markers)[keyof typeof Markers][number]

export enum Discipline {
    Abombwe = 'Abombwe',
    Animalism = 'Animalism',
    Auspex = 'Auspex',
    BloodSorcery = 'Sorcery',
    Celerity = 'Celerity',
    Chimerstry = 'Chimerstry',
    Daimoinon = 'Daimoinon',
    Dementation = 'Dementation',
    Dominate = 'Dominate',
    Fortitude = 'Fortitude',
    Melpominee = 'Melpominee',
    Mytherceria = 'Mytherceria',
    Necromancy = 'Necromancy',
    Obeah = 'Obeah',
    Obfuscate = 'Obfuscate',
    Oblivion = 'Oblivion',
    Obtenebration = 'Obtenebration',
    Potence = 'Potence',
    Presence = 'Presence',
    Protean = 'Protean',
    Quietus = 'Quietus',
    Sanguinus = 'Sanguinus',
    Serpentis = 'Serpentis',
    Spiritus = 'Spiritus',
    Temporis = 'Temporis',
    Thanatosis = 'Thanatosis',
    Valeren = 'Valeren',
    Vicissitude = 'Vicissitude',
    Visceratika = 'Visceratika',
}

export enum DisciplineLevel {
    INFERIOR = 1,
    SUPERIOR = 2,
}

export const INITIAL_HAND_SIZE = 7
export const INITIAL_CRYPT_SIZE = 4
export const INITIAL_POOL = 30

export const DEFAULT_MPA = 1 // masterPhaseActions
export const DEFAULT_TRANSFERS = 4
export const DEFAULT_DPA = 1 // discardPhaseActions

export const LEAVE_TORPOR_COST = 2
