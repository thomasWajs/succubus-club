import glob
import itertools
import json
import math
import os
import re
from collections import Counter

from PIL import Image

from const import CARD_WIDTH, CARD_HEIGHT, IMAGE_MODE, INPUT_CARDBASE_LIB_PATH, \
    INPUT_CARDBASE_CRYPT_PATH, \
    CRYPT_KEYS, LIB_KEYS, OUTPUT_CARDBASE_PATH, OUTPUT_ATLAS_DIR, INPUT_CARDS_DIR, \
    LOCAL_DISCIPLINE_IMAGE_DIR, OUTPUT_DISCIPLINE_SPRITE_PATH, DISCIPLINE_CODE_BY_NAME
from script.const import FREQUENT_CARDS_ATLAS_SIZE, RECENT_CARDS_ATLAS_SIZE, TWD_DECKS_PATH, \
    TWD_DATE_CUTOFF, NB_ATLAS_FILE, RECENT_CARDS_DATE_CUTOFF, SETS_AND_PRECONS_PATH


def is_crypt(card_dict):
    # Crypt card's id begins by 2, lib cards begin by 1
    return str(card_dict['id'])[0] == '2'


def get_recent_sets(sets_and_precons):
    """Return the set of set codes whose release date is strictly after RECENT_CARDS_DATE_CUTOFF."""
    return {
        set_code
        for set_code, set_data in sets_and_precons.items()
        if set_data.get('date', '') > RECENT_CARDS_DATE_CUTOFF
    }


def is_recent_card(card_dict, recent_sets):
    """Return True if the card exists only in sets that are newer than the cutoff."""
    card_sets = card_dict.get('set', {})
    if not card_sets:
        return False
    return all(s in recent_sets for s in card_sets)


def get_card_image_name(card_dict):
    canonical = re.sub(r'\W', '', card_dict['ascii']).lower()
    if is_crypt(card_dict):
        adv = card_dict.get('adv')
        is_advanced = adv and adv[0]
        canonical += f"g{card_dict['group'].lower()}{'adv' if is_advanced else ''}"

    return canonical


def find_best_factors(n):
    square_root_ceiled = math.ceil(math.sqrt(n))
    factor = square_root_ceiled

    # Webp cannot handle more than 16383 pixels in both dimensions,
    # which allow to fit 45 cards in width and 32 in height
    while n % factor != 0 and n // factor > 45 and factor > 32:
        factor -= 1

    if n % factor == 0:
        return n // factor, factor
    else:
        return square_root_ceiled, square_root_ceiled


def generate_atlas_files(cards, cardbase, output_name):
    # Create local directory if it doesn't exist
    os.makedirs(OUTPUT_ATLAS_DIR, exist_ok=True)
    output_webp_path = f'{OUTPUT_ATLAS_DIR}/{output_name}.webp'
    output_json_hash_path = f'{OUTPUT_ATLAS_DIR}/{output_name}.json'

    nb_images = len(cards)
    grid_width, grid_height = find_best_factors(nb_images)
    output_width = CARD_WIDTH * grid_width
    output_height = CARD_HEIGHT * grid_height
    output_image = Image.new(IMAGE_MODE, (output_width, output_height))

    frames = {}
    for j in range(grid_height):
        for i in range(grid_width):
            index = i + j * grid_width
            if index >= nb_images:
                continue

            x = i * CARD_WIDTH
            y = j * CARD_HEIGHT

            card_id = cards[index]
            card_dict = cardbase[card_id]
            image_name = card_dict['imageName']

            card_image = Image.open(f'{INPUT_CARDS_DIR}/{image_name}.webp')
            output_image.paste(card_image, (x, y))
            frames[image_name] = {'frame': {'x': x, 'y': y, 'w': CARD_WIDTH, 'h': CARD_HEIGHT}}

    output_image.save(output_webp_path)

    atlas_json_hash = {'frames': frames}
    with open(output_json_hash_path, "w") as output_atlas_file:
        json.dump(atlas_json_hash, output_atlas_file)


# Matches the root <svg ...> ... </svg> ; the discipline icons are single-root
# SVGs, so a capture of the attributes and the inner markup is enough.
_SVG_RE = re.compile(r'<svg\b([^>]*)>(.*)</svg>', re.DOTALL)
_VIEWBOX_RE = re.compile(r'viewBox="([^"]*)"')
_ROOT_FILL_RE = re.compile(r'\sfill="([^"]*)"')


def get_discipline_symbol_id(base_name):
    """Sprite symbol id for a discipline icon file ( name without extension ).

    Code-based ( pot / POT ) for a known discipline, else the filename itself so
    icons not yet mapped to a code ( vision, striga... ) stay available in the
    sprite for future use.
    """
    code = DISCIPLINE_CODE_BY_NAME.get(base_name)
    if code:
        return code
    if base_name.endswith("sup"):
        code = DISCIPLINE_CODE_BY_NAME.get(base_name[:-3])
        if code:
            return code.upper()
    return base_name


def generate_discipline_sprite():
    """Bundle every discipline SVG into a single sprite file of <symbol>s.

    The client injects this one file and references each icon via
    <use href="#id">, avoiding one network request per icon on first display.
    """
    symbols = []
    for svg_path in sorted(glob.glob(f'{LOCAL_DISCIPLINE_IMAGE_DIR}/*.svg')):
        base_name = os.path.splitext(os.path.basename(svg_path))[0]

        with open(svg_path, 'r', encoding='utf-8') as svg_file:
            content = svg_file.read()

        match = _SVG_RE.search(content)
        if not match:
            continue
        attributes, inner = match.group(1), match.group(2).strip()

        viewbox_match = _VIEWBOX_RE.search(attributes)
        viewbox = f' viewBox="{viewbox_match.group(1)}"' if viewbox_match else ''
        # A fill on the root ( rare ) would be lost when we keep only the inner
        # markup, so carry it onto the symbol.
        fill_match = _ROOT_FILL_RE.search(attributes)
        fill = f' fill="{fill_match.group(1)}"' if fill_match else ''

        symbol_id = get_discipline_symbol_id(base_name)
        symbols.append(f'<symbol id="{symbol_id}"{viewbox}{fill}>{inner}</symbol>')

    sprite = (
        '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'
        + ''.join(symbols)
        + '</svg>'
    )

    os.makedirs(os.path.dirname(OUTPUT_DISCIPLINE_SPRITE_PATH), exist_ok=True)
    # newline='' keeps LF endings on Windows ( the repo mandates LF ) instead of
    # letting Python rewrite them to CRLF.
    with open(OUTPUT_DISCIPLINE_SPRITE_PATH, 'w', encoding='utf-8', newline='') as sprite_file:
        sprite_file.write(sprite)


def generate_resource_files():
    generate_discipline_sprite()

    with (
        open(INPUT_CARDBASE_LIB_PATH, 'r') as cardbase_lib_file,
        open(INPUT_CARDBASE_CRYPT_PATH, 'r') as cardbase_crypt_file,
        open(TWD_DECKS_PATH, 'r', encoding="utf-8") as twd_decks_file,
        open(SETS_AND_PRECONS_PATH, 'r', encoding="utf-8") as sets_and_precons_file,
    ):
        cardbase_lib = json.load(cardbase_lib_file)
        cardbase_crypt = json.load(cardbase_crypt_file)
        twd_decks = json.load(twd_decks_file)
        sets_and_precons = json.load(sets_and_precons_file)

    seen_cards = Counter()
    for deck in twd_decks.values():
        # Keep only recent decks
        if deck['creation_date'] >= TWD_DATE_CUTOFF:
            seen_cards.update(deck['cards'].keys())

    recent_sets = get_recent_sets(sets_and_precons)
    recent_card_ids = []

    cardbase = {}

    for card_id, card_dict in itertools.chain(cardbase_crypt.items(), cardbase_lib.items()):

        card_dict['imageName'] = get_card_image_name(card_dict)

        if is_recent_card(card_dict, recent_sets):
            recent_card_ids.append(card_id)

        if is_crypt(card_dict):
            card_dict = {key: card_dict[key] for key in CRYPT_KEYS}
        else:
            card_dict = {key: card_dict[key] for key in LIB_KEYS}

        cardbase[card_id] = card_dict

    with open(OUTPUT_CARDBASE_PATH, 'w') as output_cardbase_file:
        json.dump(cardbase, output_cardbase_file)

    # Exclude recent cards from the frequent pool to avoid overlap
    for card_id in recent_card_ids:
        del seen_cards[card_id]

    frequent_cards = list(dict(seen_cards.most_common(FREQUENT_CARDS_ATLAS_SIZE * NB_ATLAS_FILE)).keys())
    for i in range(NB_ATLAS_FILE):
        generate_atlas_files(
            frequent_cards[i * FREQUENT_CARDS_ATLAS_SIZE:(i + 1) * FREQUENT_CARDS_ATLAS_SIZE],
            cardbase,
            f'frequent_{i}'
        )

    # Remove stale recent atlas files: their count is dynamic and may shrink
    # between builds, and an old single 'recent.webp' would otherwise linger.
    for stale in glob.glob(f'{OUTPUT_ATLAS_DIR}/recent*.webp') + glob.glob(f'{OUTPUT_ATLAS_DIR}/recent*.json'):
        os.remove(stale)

    # Split recent cards across several atlases, each capped at RECENT_CARDS_ATLAS_SIZE,
    # so no single atlas texture exceeds the GPU MAX_TEXTURE_SIZE limit.
    nb_recent_atlas = math.ceil(len(recent_card_ids) / RECENT_CARDS_ATLAS_SIZE)
    for i in range(nb_recent_atlas):
        generate_atlas_files(
            recent_card_ids[i * RECENT_CARDS_ATLAS_SIZE:(i + 1) * RECENT_CARDS_ATLAS_SIZE],
            cardbase,
            f'recent_{i}'
        )
