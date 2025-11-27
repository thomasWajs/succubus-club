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