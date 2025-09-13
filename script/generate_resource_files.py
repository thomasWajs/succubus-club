import itertools
import json
import math
import os
import re
from collections import Counter

from PIL import Image

from const import CARD_WIDTH, CARD_HEIGHT, IMAGE_MODE, INPUT_CARDBASE_LIB_PATH, \
    INPUT_CARDBASE_CRYPT_PATH, \
    CRYPT_KEYS, LIB_KEYS, OUTPUT_CARDBASE_PATH, OUTPUT_ATLAS_DIR, INPUT_CARDS_DIR
from script.const import FREQUENT_CARDS_ATLAS_SIZE, TWD_DECKS_PATH, TWD_DATE_CUTOFF


def is_crypt(card_dict):
    # Crypt card's id begins by 2, lib cards begin by 1
    return str(card_dict['id'])[0] == '2'


def get_card_image_name(card_dict):
    canonical = re.sub(r'\W', '', card_dict['ascii']).lower()
    if is_crypt(card_dict):
        canonical += f"g{card_dict['group'].lower()}{'adv' if card_dict['adv'] else ''}"
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


def generate_resource_files():
    with (
        open(INPUT_CARDBASE_LIB_PATH, 'r') as cardbase_lib_file,
        open(INPUT_CARDBASE_CRYPT_PATH, 'r') as cardbase_crypt_file,
        open(TWD_DECKS_PATH, 'r', encoding="utf-8") as twd_decks_file,
    ):
        cardbase_lib = json.load(cardbase_lib_file)
        cardbase_crypt = json.load(cardbase_crypt_file)
        twd_decks = json.load(twd_decks_file)

    seen_cards = Counter()
    for deck in twd_decks.values():
        # Keep only recent decks
        if deck['creation_date'] >= TWD_DATE_CUTOFF:
            seen_cards.update(deck['cards'].keys())

    cardbase = {}

    for card_id, card_dict in itertools.chain(cardbase_crypt.items(), cardbase_lib.items()):

        card_dict['imageName'] = get_card_image_name(card_dict)

        if is_crypt(card_dict):
            card_dict = {key: card_dict[key] for key in CRYPT_KEYS}
        else:
            card_dict = {key: card_dict[key] for key in LIB_KEYS}

        cardbase[card_id] = card_dict

    with open(OUTPUT_CARDBASE_PATH, 'w') as output_cardbase_file:
        json.dump(cardbase, output_cardbase_file)

    generate_atlas_files(
        list(dict(seen_cards.most_common(FREQUENT_CARDS_ATLAS_SIZE)).keys()),
        cardbase,
        'frequent'
    )
