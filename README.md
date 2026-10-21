<p style="text-align: center;" align="center">
<img align="center" src="/public/assets/welcomeSign.png" />
</p>

## Play Vampire: The Eternal Struggle against bots in your browser

This is the bots-only edition of [Succubus Club](https://github.com/thomasWajs/succubus-club),
the V:TES platform by Thomas Wajs. You play one seat against bots; the
zero-vtes rules engine runs each game on its server (engine.krcg.org) and
enforces the rules.

- **Browser-based**: no download, no account
- **Your decks**: the preconstructed decks, your own list, or an import from VDB, vtesdecks or Amaranth
- **Games recorded**: each game is recorded on the engine's server, anonymously, and kept two years to improve the engine and the bots

## Feedback and Support

Report issues on the [GitHub issues page](https://github.com/lionel-panhaleux/succubus-club/issues/).

## 🤓 For Developers

### Tech Stack

- **Frontend**: [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/)
- **Game Engine**: [Phaser 3](https://phaser.io/) + [Phavuer](https://github.com/laineus/phavuer)
- **State Management**: [Pinia](https://pinia.vuejs.org/)
- **Build Tool**: [Vite](https://vite.dev/)
- **Scripting**: [Python](https://www.python.org/)
- **Rules engine**: zero-vtes, reached over its protocol (`src/client/engine/`)

### Development

All standard stuff :

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 🙏 Acknowledgements

Most of the game resources used in this app are provided by [smeea](https://github.com/smeea) through its awesome [VDB project](https://github.com/smeea/vdb). Many thanks to him for his work !

By transitivity, thanks to all the [people who have contributed to VDB](https://github.com/smeea/vdb?tab=readme-ov-file#acknowledgments)

Thanks to the creator&contributors of those awesome libs who saved me tons of time and headache :
 - [laineus](https://github.com/laineus) for [Phavuer](https://github.com/laineus/phavuer)
 - [Phaser Studio](https://github.com/phaserjs) for [Phaser](https://github.com/phaserjs/phaser)

A very special thanks to the crash-test team, who endured the pain of the buggy beta:
 - **Doman**
 - **Jim**
 - **Kuli**
 - **Ramirez**

✨ And a final shout out to my friends and first testers : **Braf & Shaz** ✨

## 💖 Backers

An immense thanks to the amazing people who have financially supported this project. Your support is the blood that keeps this project alive!
 - Juan Carlos Eruntalon
 - tryptych
 - Diego Farras

---

*Succubus Club is an unofficial fan project and is not affiliated with White Wolf Publishing or Paradox Interactive. Vampire: The Eternal Struggle and World of Darkness are registered trademarks.*