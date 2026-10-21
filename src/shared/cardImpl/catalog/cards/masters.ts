import {
    actionIsHunt,
    actionIsUndirected,
    actionSuccessful,
    actorIs,
    aMinion,
    aVampire,
    armTrigger,
    bleedIntercept,
    blockerIsBearer,
    bloodToPool,
    bloodToPoolBetween,
    bloodPerHostage,
    bloodToUncontrolled,
    burnInTorpor,
    burnSelf,
    defineCard,
    discardFromHand,
    drawCryptRemoveUncontrolled,
    gainPool,
    gainBlood,
    gainBloodActor,
    gainBloodBearer,
    handSize,
    handSizeThisTurn,
    intercept,
    lockSelf,
    moveBlood,
    preventDamage,
    putOnMinion,
    raisePlayCost,
    stealth,
    unlockActor,
} from '@/shared/cardImpl/catalog/builders.ts'

export const MASTER_CARDS = [
    defineCard('100620', 'Elder Library', [
        { kind: 'master', staysInPlay: 'standalone', effects: [handSize(1)] },
    ]),
    defineCard('100135', 'Barrens, The', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [{ activate: 'lock', effects: [discardFromHand] }],
        },
    ]),
    defineCard('102180', 'Wider View', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                { activate: 'transfer', transfers: 1, effects: [drawCryptRemoveUncontrolled] },
                { activate: 'transfer', transfers: 4, effects: [burnSelf, gainPool(2)] },
            ],
        },
    ]),
    defineCard('101104', 'Life in the City', [
        {
            kind: 'master',
            onPlay: { target: 'readyVampireBelowCapacity', effects: [gainBlood(1)] },
        },
    ]),
    defineCard('100108', 'Asylum Hunting Ground', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
    defineCard('100297', 'Carfax Abbey', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    sect: 'Anarch',
                    extraWithBaron: true,
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
    // Any amount of blood of a vampire you control, in torpor too. The +1 pool for each Villein on the target
    // comes from the Villein
    defineCard('101217', 'Minion Tap', [
        { kind: 'master', onPlay: { target: 'vampireWithBlood', effects: [bloodToPool] } },
    ]),
    // Put on a vampire that holds blood ( in torpor too ), 2 to 5 blood of it become pool. The cost of +1 pool
    // is for each Villein already on the vampire, and for a Minion Tap played on it. A vampire with 0 blood
    // is a legal target of the card but never worth it: it is not offered
    defineCard('102121', 'Villein', [
        {
            ...putOnMinion(aVampire(), [raisePlayCost(1, '101217', '102121')]),
            onPlay: { target: 'vampireWithBlood', effects: [bloodToPoolBetween(2, 5)] },
        },
    ]),
    // Put on a vampire, in torpor too. The master phase ability is used once per turn
    defineCard('100199', 'Blood Doll', [putOnMinion(aVampire(), [moveBlood(1)])]),
    // The Blood Doll that can be burned when it is played and a vampire of another Methuselah as
    // the host are not modelled. The ability is used once per turn, in the unlock phase
    defineCard('102113', 'Vessel', [putOnMinion(aVampire(), [moveBlood(1, { phase: 'unlock' })])]),
    // A Nosferatu antitribu is not a Nosferatu. The clan requirement of the card is the cardbase's
    defineCard('101070', 'Labyrinth, The', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'lockForAction',
                    minion: aVampire({ clan: 'Nosferatu' }),
                    effects: [stealth(1)],
                },
            ],
        },
    ]),
    // Only the first ability is modelled: the minion is one of the Methuselah's own. The second one ( lock
    // and burn 1 pool to give a minion of another Methuselah +1 intercept ) is not
    defineCard('101067', 'KRCG News Radio', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                { activate: 'lockForReaction', minion: aMinion(), effects: [intercept(1)] },
            ],
        },
    ]),
    // The requirement ( a ready Anarch ) is the cardbase's. The +1 intercept is for an Anarch you control whose
    // block attempt stands. The blood is for an Anarch that hunted successfully ( a hunt that gains nothing is
    // not successful: not checked, the bot only uses it for a vampire with room )
    defineCard('100052', 'Anarch Free Press, The', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'lockForReaction',
                    minion: aVampire({ sect: 'Anarch' }),
                    effects: [intercept(1)],
                },
            ],
            triggers: [
                {
                    on: 'actionResolved',
                    mode: 'optional',
                    when: [
                        actionSuccessful,
                        actionIsHunt,
                        actorIs({ controller: 'self', sect: 'Anarch' }),
                    ],
                    cost: lockSelf,
                    effects: [gainBloodActor(1)],
                },
            ],
        },
    ]),
    // Only the unlock is modelled ( the clan requirement is the cardbase's ): lock the card as a Nosferatu of
    // yours announces an undirected action, and the Nosferatu unlocks if the action is successful. Burning the
    // card to bring a Nosferatu out of torpor is not modelled
    defineCard('102149', 'Warsaw Station', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            triggers: [
                {
                    on: 'actionDeclared',
                    mode: 'optional',
                    when: [actorIs({ controller: 'self', clan: 'Nosferatu' }), actionIsUndirected],
                    cost: lockSelf,
                    effects: [
                        armTrigger({
                            on: 'actionResolved',
                            mode: 'auto',
                            when: [actionSuccessful],
                            effects: [unlockActor],
                        }),
                    ],
                },
            ],
        },
    ]),
    // The counters are kept in the blood of the card. Each other Methuselah burns a pool or a blood of a vampire
    // for each counter in its unlock phase: the choice is made by the engine, see standingCards.ts. The pool
    // is moved only when it does not empty it
    defineCard('101811', 'Smiling Jack, The Anarch', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            burnable: true,
            whileInPlay: [{ type: 'poolToCounters', amount: 1 }, { type: 'othersBurnPerCounter' }],
        },
    ]),
    // Not modelled: the political action half of the trigger ( politics ), and the one archetype per vampire
    // beyond the copies of Rebel
    defineCard('101564', 'Rebel', [
        {
            ...putOnMinion(aVampire(), [], { onePerMinion: true }),
            triggers: [
                {
                    on: 'blockDeclared',
                    mode: 'optional',
                    when: [blockerIsBearer, actorIs({ titled: true })],
                    limit: 'oncePerTurn',
                    effects: [gainBloodBearer(1)],
                },
            ],
        },
    ]),
    // The printed card can be put on any ready vampire. Only a vampire of another Methuselah is offered: on a
    // vampire of the player it can only hurt. The effects are those of standingCards.ts
    defineCard('100698', 'Fame', [
        {
            ...putOnMinion(aVampire({ ready: true, whose: 'other' }), []),
            whileInPlay: [
                { type: 'bearerTorporBurnsPool', amount: 3 },
                { type: 'unlockBurnsPoolWhileBearerInTorpor', amount: 1 },
            ],
        },
    ]),
    // The counters are kept in the blood of the card. Each use locks the card and adds a counter, and the third
    // use burns it. The hand size is used in the discard phase ( the extra cards are drawn at once and discarded
    // back at the end of the turn ), the other two in the unlock phase of the player. The vampire in the uncontrolled
    // region is a vampire ( an imbued is not modelled )
    defineCard('100588', 'Dreams of the Sphinx', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            lockCounters: { burnAt: 3 },
            abilities: [
                { activate: 'lockUse', window: 'discardPhase', effects: [handSizeThisTurn(2)] },
                {
                    activate: 'lockUse',
                    window: 'unlockPhase',
                    needsEdge: true,
                    effects: [gainPool(1)],
                },
                { activate: 'lockUse', window: 'unlockPhase', effects: [bloodToUncontrolled(1)] },
            ],
        },
    ]),
    // Put on a ready vampire of another Methuselah ( on a vampire of the player it can only hurt ). The effects are
    // those of standingCards.ts: the minions of the others enter combat with the vampire with +1 stealth, and the
    // vampire burns the card with +1 stealth, an action directed at whoever played it
    defineCard('100897', 'Haven Uncovered', [
        {
            ...putOnMinion(aVampire({ ready: true, whose: 'other' }), []),
            whileInPlay: [
                { type: 'bearerCanBeFought', stealth: 1 },
                { type: 'bearerBurnsCard', stealth: 1 },
            ],
        },
    ]),
    // Stays in play until the influence phase of its controller, which burns it and a pool for each ready minion of
    // their prey. The pool gained is for a ready minion of the prey burned or sent to torpor in a combat
    defineCard('100794', 'Frontal Assault', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            whileInPlay: [
                { type: 'combatWithPrey' },
                { type: 'poolWhenPreyLosesMinion', amount: 1 },
                { type: 'influenceBurnsSelfAndPoolPerPreyMinion' },
            ],
        },
    ]),
    // The hostage counters are kept by the engine and only count while the card is in play. In the unlock phase the
    // bot only frees a vampire of its own, paid by one of its own vampires: any vampire of any Methuselah can in the
    // printed card, and a human frees by hand
    defineCard('100303', "Carver's Meat Packing and Storage", [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            whileInPlay: [{ type: 'hostageOnTorpor', maxCapacity: 3 }],
            abilities: [
                { activate: 'lockUse', window: 'masterPhase', effects: [bloodPerHostage] },
                { activate: 'freeHostage', cost: 2 },
            ],
        },
    ]),
    // On a ready vampire you control. The bleed intercept only counts for the bleeds directed at its
    // controller, the prevention is once per combat and the card burns once the vampire is in torpor
    defineCard('100866', 'Guardian Angel', [
        putOnMinion(aVampire({ ready: true }), [bleedIntercept(1), preventDamage(1), burnInTorpor]),
    ]),
    // The clan requirement is the cardbase's
    defineCard('101808', 'Slum Hunting Ground', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
    defineCard('102150', 'Warzone Hunting Ground', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
]
