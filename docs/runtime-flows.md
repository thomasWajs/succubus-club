# Runtime Flows

This document captures the most important runtime paths in Succubus Club. Use it when changing startup, game setup, multiplayer, persistence, or resync behavior.

## Client Startup

```mermaid
sequenceDiagram
    participant Browser
    participant Main as main.ts
    participant Db as Dexie DbUserProfile
    participant Vue as Vue app
    participant Pinia
    participant Router
    participant Resources as resource loaders
    participant Monitors as idle/version monitors

    Browser->>Main: load bundle
    Main->>Main: init global error handling and Sentry
    Main->>Db: load or create user profile
    Main->>Pinia: create and install stores
    Main->>Router: install router
    Main->>Vue: mount SuccubusApp
    Main->>Monitors: start idle and version monitoring
    Main->>Resources: load card/game resources when screen is supported
    Resources-->>Pinia: resourcesAreReady = true
```

Key files:

- `src/client/main.ts`
- `src/client/initClient.ts`
- `src/client/store/core.ts`
- `src/client/resources/index.ts`

## Game Screen Creation

```mermaid
sequenceDiagram
    participant Router
    participant GameScreen as ui/screen/Game.vue
    participant Play as game/Play.vue
    participant Phavuer
    participant Phaser
    participant Store as core store
    participant Scenes as Preloader/Tabletop

    Router->>GameScreen: enter /game after guard passes
    GameScreen->>Play: render game layer
    Play->>Phavuer: create PhavuerGame when resourcesAreReady
    Phavuer->>Phaser: create Phaser.Game
    Play->>Store: setPhaserGame(game)
    Phavuer->>Scenes: mount Preloader and Tabletop scenes
    Play->>Phaser: disable context menu, bind input blocking
```

Cleanup runs in `Play.vue` on unmount: destroy Phaser, clear the stored game reference, and reset state.

## Local Mutation Dispatch

```mermaid
sequenceDiagram
    participant Input as UI or game object
    participant Registry as gameMutations registry
    participant ClientMut as client mutation dispatcher
    participant Mut as GameMutation instance
    participant State as GameState
    participant History
    participant Mode as game type
    participant Network as multiplayer broadcast

    Input->>Registry: actSelf(params)
    Registry->>ClientMut: create mutation
    ClientMut->>Mut: canApply()
    alt valid
        ClientMut->>Mut: apply()
        Mut->>State: updateGameState()
        ClientMut->>History: addGameMutation()
        alt multiplayer
            ClientMut->>Network: broadcastGameMutation()
        end
    else invalid
        ClientMut->>Input: warning alert
    end
```

Key files:

- `src/shared/state/gameMutations.ts`
- `src/client/state/gameMutations.ts`
- `src/client/multiplayer/room.ts`
- `src/client/multiplayer/sync.ts`

## Ably Multiplayer Launch

```mermaid
sequenceDiagram
    participant Host
    participant Ably as Ably room channel
    participant Store as Firebase/gameState gateway
    participant Peer

    Host->>Host: setupMultiplayerGame or setupSavedGame
    Host->>Store: store serialized multiplayer game
    Store-->>Host: gameStateId
    Host->>Ably: publish LaunchGame(gameStateId)
    Ably-->>Peer: LaunchGame
    Peer->>Store: fetch serialized game
    Store-->>Peer: SerializedMultiplayerGame
    Peer->>Peer: receiveLaunchGame and applyInitialGameState
```

Ably mode uses client-side authority for launch and mutation propagation. Resync is peer-supplied: a client publishes a `RequestResync` message with a temporary sync channel, peers answer with game-state snapshot IDs, and the requester applies the newest state by Lamport clock.

## SCS Multiplayer Launch

```mermaid
sequenceDiagram
    participant Client
    participant Ws as SCS WebSocket
    participant Rooms as server rooms.ts
    participant Game as server gameState.ts
    participant Db as SQLite persistence
    participant Peers

    Client->>Ws: SetUser
    Client->>Ws: JoinRoom(roomId, passwordHash)
    Ws->>Rooms: add player to room
    Client->>Ws: Deck(deckList)
    Ws->>Rooms: store and broadcast edulcorated deck
    Client->>Ws: RollSeating
    Rooms->>Db: save room seating
    Rooms-->>Peers: RollSeating
    Client->>Ws: SetupGame
    Rooms->>Game: create or load game state
    Game->>Db: persist room with game state
    Rooms-->>Peers: LaunchGame(serializedGame tailored per player)
```

SCS launch performs server-side validation for seating, saved-game restore, game state creation, and recipient-specific hidden-card filtering.

## SCS Mutation Flow

```mermaid
sequenceDiagram
    participant Client
    participant Ws as wsServer.ts
    participant Game as server gameState.ts
    participant Shared as shared mutation
    participant Db as SQLite
    participant Peers

    Client->>Ws: GameMutation(message)
    Ws->>Game: handleGameMutation
    Game->>Game: validate identified user, room, rate limit
    Game->>Shared: unpackGameMutation()
    Game->>Shared: mutation.canApply()
    alt ordered conflict
        Game-->>Client: MutationRejected
    else valid
        Game->>Shared: mutation.apply()
        Game->>Game: add to room history and clocks
        Game->>Db: saveRoom(room)
        Game-->>Peers: broadcast tailored mutation + knownCards
    end
```

The server rejects invalid or conflicting authoritative mutations. Clients receiving `MutationRejected` cancel their local optimistic mutation through `receiveRejectedMutation`.

## Synchronization Model

```mermaid
flowchart TB
    Mutation["GameMutation"]
    Merge["Merge\ncommutative or tolerant changes"]
    Ordered["Ordered\nper-object vector clock"]
    Exclusive["Exclusive\nonly allowed player may apply"]
    Lamport["Global Lamport clock\nwhole-state recency"]
    Vector["Object vector clocks\nordered mutation causality"]
    Conflict["Conflict handling\nclient resolution or SCS rejection"]
    Resync["Resync\nserialized game + history + clocks"]

    Mutation --> Merge
    Mutation --> Ordered
    Mutation --> Exclusive
    Ordered --> Vector
    Vector --> Conflict
    Mutation --> Lamport
    Lamport --> Resync
```

Important behavior:

- `MutationSyncMode.Merge`: applies without per-object ordering.
- `MutationSyncMode.Ordered`: includes a vector clock version for a `versioningId`.
- `MutationSyncMode.Exclusive`: validates the allowed player before applying.
- Ably mode resolves some concurrent ordered conflicts on the client.
- SCS mode rejects concurrent ordered conflicts at the server.
- Resync compares serialized state hashes and Lamport versions before replacing local state.

## Focus Mode Seating Layouts

During gameplay, seating geometry and visual scaling are recalculated dynamically on the client inside [Tabletop.vue](file:///D:/Otros/vtes/succubus-club/src/client/game/scenes/Tabletop.vue):
- **Standard Mode Seating**: Arranges players relative to the local user (`selfPlayer`) who is fixed at the bottom-center. Neighbors are placed clockwise starting with the Prey.
- **Focus Mode Seating**: Re-anchors the seating index around the currently active player (`activePlayer`) whose turn it is. This dynamically rotates the table context, centering the player who has the current game impulse:
  - Active Player: Bottom-center (`scale = FOCUS_MODE_SCALE` ~ 0.985).
  - Prey: Middle-left (`scale = FOCUS_MODE_SCALE`).
  - Predator: Middle-right (`scale = FOCUS_MODE_SCALE`).
  - Other far-away players: Positioned top-left/top-right (`scale = FOCUS_MODE_FARAWAY_PLAYER_SCALE` ~ 0.45).
- **Duel Mode Seating**: When exactly 2 players are visible, a custom two-player horizontal layout splits the screen evenly.

## Hidden Card Knowledge


Hidden card handling is split between state visibility logic and serialization:

- Client and server use `shared/state/cardVisibility.ts` to answer visibility questions.
- SCS uses `getKnownCards` and `getSerializedGame` in `server/gameState.ts` to tailor launch/resync payloads.
- Unknown cards have sensitive card attributes removed from serialized payloads.
- SCS shuffling regenerates card OIDs for shuffled regions so clients cannot track hidden card positions.

## Persistence And Recovery

```mermaid
flowchart LR
    Client["Client"]
    IndexedDb["IndexedDB via Dexie"]
    Firebase["Firebase gateways"]
    Server["SCS server"]
    SQLite["SQLite rooms table"]

    Client --> IndexedDb
    Client --> Firebase
    Client --> Server
    Server --> SQLite
```

Client persistence:

- user profile and permanent ID
- selected/created decks
- saved games
- preferences and key bindings

SCS persistence:

- room ID and password hash
- user deck lists
- seating
- game ID
- global and object clocks
- serialized game state
- serialized history

`persistence.ts` opens SQLite only around individual operations to support Railway/serverless sleeping behavior.

## External API Functions

The `api` directory contains Vercel-style functions:

- `ablyAuth.mjs`: creates Ably token requests in production.
- `sentryTunnel.mjs`: validates and forwards Sentry envelopes.
- `firebaseConfig.mjs`: initializes Firebase for API-side jobs.
- `pruneGameRooms.mjs` and `pruneGameStates.mjs`: maintenance endpoints for cloud data.
- `version.mjs`: version endpoint.

## Operational Notes

- Vite dev port is configured as `666`, while the AGENTS quick reference mentions `localhost:5173`. Prefer the checked-in Vite config unless it changes.
- SCS defaults to `WS_PORT=3001`.
- SCS SQLite defaults to `../../data/game-server.db` relative to `src/server`.
- Production builds upload source maps through the Sentry Vite plugin when `SENTRY_AUTH_TOKEN` is available.
