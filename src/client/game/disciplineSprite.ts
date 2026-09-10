import { captureException } from '@/client/logging.ts'

// The discipline icons are served as a single committed SVG sprite ( generated
// by script/generate_resource_files.py ). It is fetched once and injected into
// the document ; every icon then renders as <use href="#id"> with no per-icon
// request. See src/shared/disciplineIcons.ts for the id convention.
const SPRITE_URL = '/assets/disciplines.svg'
const SPRITE_ELEMENT_ID = 'discipline-sprite'

let injected = false

export async function injectDisciplineSprite() {
    if (injected || document.getElementById(SPRITE_ELEMENT_ID)) {
        injected = true
        return
    }
    injected = true

    try {
        const response = await fetch(SPRITE_URL)
        const markup = await response.text()

        // Setting innerHTML on a container parses the <svg> sprite into real SVG
        // nodes ; the container itself carries the id so we never inject twice.
        const container = document.createElement('div')
        container.id = SPRITE_ELEMENT_ID
        container.style.display = 'none'
        container.innerHTML = markup
        document.body.prepend(container)
    } catch (error) {
        // Non-fatal : icons just won't render. Allow a later retry.
        injected = false
        captureException(error)
    }
}
