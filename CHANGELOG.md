## [0.10.0] - 2026-09-02

Features:
- Migrated SCS to a new home with hopefully 100% uptime
- New judge role with full visibility over the cards
- New aid : display total vote/ballot count near player names.
- Keep minion cards visible in the uncontrolled region
- Refresh an iimported deck

Bugfix:
- Better stability when the lobby is crowded
- In pupeteer mode, deduplicate the opponent's hand in duel
- Lot of small bugfixes

## [0.9.2] - 2026-08-09

Features:
- Control right bar layout
- Smoother "Move To Bottom of Lib" ( 👉 Heart of Nizchetus )

Bugfix:
- Idle kick increased to 2h for ousted players
- Scroll player list in the lobby

## [0.9.1] - 2026-07-20

Features:
- From the log, browse unlocked cards during an unlock all
- A card dropped from hand outside of any play area is now considered played

Bugfix:
- Fix black rectangles replacing cards on lower-end hardware
- Prevent incorrect counters positionning
- Lot of subtle fixes on drag'n'drop

## [0.9.0] - 2026-07-14

Features:
- New Puppeteer mode : load 5 decks and manage each player in turn
- Flip a coin & roll a d6 ( 👉 Malkav cards )
- Quick move from Ash Heap ( 👉 Ashur Tablets )
- Visual notification when passing turn
- Configure a custom tabletop background
- Support VTESDeck import

Bugfix:
- Arrows are redrawn properly when switching focus mode on/off

## [0.8.0] - 2026-07-06

Features:
- Add a new Focus Mode
- Rearrange the stacks under the play area, and make the edge more visible
- Reduce torpor / uncontrolled scale to gain some space
- Rearrange GameTopArea buttons
- Move cards/cardGroups with numpad keys

## [0.7.2] - 2026-06-20

Features:
- Save/Reload games in SCS ( with anti-cheat )
- Delete saved games. Alert on obsolete saved gamed.
- Suggest become a vampire on embraces-like
- Show/Hide hour in logs
- Detect and warn when WebGL is unavailable

Bugfix:
- Correctly determine next player after an oust
- Fix orange counter key binding display
- Fix a lot of corner-case invisible bug

## [0.7.1] - 2026-05-21

Features:
- Add orange counter to manage 2 sources of counters
- SCS has tighter rules in place on the allowed author of actions
- Hide play area of ousted players
- Textual decklists are now imported in-house, which avoids the krcg API roundtrip
- Suggest page reloading when the browser version is not up to date

Bugfix:
- Fix errors araising at end of games because of long history
- Correctly load multiple precon with the same name
- Fix edge-case bugs where the bot could not resume saved games

## [0.7.0] - 2026-05-04

Features:
- Succubus Club Server, Finally !
- Only the owner of a stack can reveal it

Bugfix:
- Archive history to improve performances in late game
- Fix log auto-scroll

## [0.6.3] - 2026-03-30

Bugfix:
- Address game unresponsiveness when history grows large ( at the end of games )

## [0.6.2] - 2026-02-25

Features:
- Add an option at multiplayer game creation to disable aids
- Pin a close up card by clicking it ( helps with looking at rulings )
- Add deck explore to deck history
- Burn from top of library/crypt
- Use 2P rules for the bot

Bugfix:
- Address critical memory issues that slowed everything down in 0.6.1
- Fix timer desync between players
- Prevent log scrolling when not viewing the bottom
- Fix Deck content counting
- Prevent keyboard shortcuts to trigger when updating user preferences
- Don't open pool panel when selecting a target

## [0.6.1] - 2026-01-30

Features:
- Add an option at multiplayer game creation to disable aids
- Pin a close up card by clicking it ( helps with looking at rulings )
- Add deck explore to deck history

Bugfix:
- Prevent log scrolling when not viewing the bottom
- Fix Deck content counting
- Prevent keyboard shortcuts to trigger when updating user preferences
- Don't open pool panel when selecting a target

## [0.6.0] - 2026-01-15

Features:
- Declare an action with a minion
- Seating control in the lobby
- Browse the content of a decklist
- Increase initial player scale
- Track blood / pool in the logs

Bugfix:
- Prevent flipped card names to leak into logs
- Don't glow flipped cards
- Prevent influence on vampires from other players
- Remove the burn button on minions in controlled area

## [0.5.3] - 2025-12-15

Features:
- Change sizing of Ready/Torpor/Uncontrolled areas
- Reorganize context menu with infrequent commands
- Lock/Unlock command
- Invalid decklists is now a warning instead of error

Bugfix:
- Minion are always displayed on top of other cards
- Fix drag over hand and play areas
- Handle timer during reconnection
- Fix Turn counter on oust
- Remove counters when a card leav the play area

## [0.5.2] - 2025-12-09

Features:
- Cards can be pinged
- Shuffle lib/crypt on right click
- Import a deck from Amaranth
- All actions are now cancellable

Bugfix:
- Card grouping is now opt-in instead of automatic
- Fix stealth/intercept for the bot

## [0.5.1] - 2025-12-04

Features:
- Highlight cards usable "during" the current phase
- List connected spectators
- Edit name of an imported deck
- Chose world alignment in preferences
- Enhance card grouping

Bugfix:
- A ton of fixes on drag'n'drop scaling/offset
- "Move to the bottom" works again

## [0.5.0] - 2025-11-27

Features:
- Dedicated UI for 2 players
- User preferences for disabling UI features
- Card grouping in play
- Alignment guides in play
- Highlight cards in hands usable in the current phase
- Animate card lock/unlock

Bugfix:
- Last oust now gives 2 VP
- Cards dragged on lib/crypt now always go on top
- Prevent infinite loop on the bot

## [0.4.1] - 2025-11-17

Features:
- Optionnal 2 hours timer
- Quick reveal a top card
- New command to remove a card from the game
- Alert on conflicting keyboard shortcuts
- Align the tabletop to the right on wide screens

Bugfix:
- Arrows and selection area now works onto the top area

## [0.4.0] - 2025-11-13

Features:
- New interface layout
- User-defined keyboard shortcuts
- Overlay "discard" on cards in hand

Bugfix:
- Fix markers display
- Fix bot stealth & blocking

## [0.3.1] - 2025-11-03

Features:
- Card rulings in the right column
- Spectate a game
- Passwords on game rooms

## [0.3.0] - 2025-10-30

Features:
- Add overlays when pointer is over a card
- Control card scale in play area
- Ensure decklists are valid ( crypt 12+ & lib 60-90)

## [0.2.3] - 2025-10-25

Features:
- Add V5 Sabbat set
- Menu button to leave the game

Bugfix:
- Handle room name with special characters
- More robust resource fetching
- Become a vampire/minion only in ready region

## [0.2.2] - 2025-10-17

Features:
- Connectivity now handled by a realtime messaging server instead of Peer2Peer

## [0.2.1] - 2025-10-07

Features:
- Player target declaration
- Custom markers

Bugfix:
- Discard bot's action modifier
- Blocking the bot work again

## [0.2.0] - 2025-10-06

Features:
- Target declaration

Bugfix:
- Card revelation after a drag outside stack
- Stack scroll and hand reordering when zoomed out
- No pause time for humans in train mode

## [0.1.7] - 2025-10-02

Bugfix:
- Fix base/advanced vampire detection

## [0.1.6] - 2025-09-30

Features:
- Show top/bottom of stack
- Better image caching

Bugfix:
- Don't leak data through logs after a resync
- +/= shortcut for add blood on non-firefox browsers
- Correct bot log ordering

## [0.1.5] - 2025-09-29

Bugfix:
- Fix incorrect behaviour after resync

## [0.1.4] - 2025-09-26

Enhancements on the network code.
Minor bugfixes.

## [0.1.3] - 2025-09-24

Features:
- Vastly improved network code

Bugfix:
- Any card can attempt to block
- Display greater hand size

## [0.1.2] - 2025-09-18

Features:
- Add a head's up to the Manual on first game startup
- Reconnection alert
- Disable camera controls while waiting for a better UX

Bugfix:
- Fix an XSS vulnerability in the chat

## [0.1.1] - 2025-09-16

First fixes after public release :
 - Beta banner
 - Mobile view
 - Add command for "Move to Ash Heap"
 - Quick clean of Top Area for bot play
 - Minor bug fixes

## [0.1.0] - 2025-09-15

Initial beta release.