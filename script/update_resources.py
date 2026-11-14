import json
import os

from script.const import RESOURCES_DIR, PRECON_FILE_NAME, ASSETS_DIR, SETS_AND_PRECONS_FILE_NAME, \
    PRECON_SPECIAL_SET_KEYS, PRECON_MIN_LIBRARY_SIZE, PRECON_MAX_LIBRARY_SIZE, PRECON_MIN_CRYPT_SIZE
from script.download_vdb_resources import download_vdb_resource_files, download_vdb_missing_images
from script.generate_resource_files import generate_resource_files


def is_legal_precon(deck):
    """Return True if the deck is a playable one : 60 to 90 library cards and at least 12 crypt cards."""
    # Crypt card's id begins by 2, lib cards begin by 1
    crypt_size = sum(qty for card_id, qty in deck.items() if str(card_id)[0] == '2')
    library_size = sum(qty for card_id, qty in deck.items() if str(card_id)[0] == '1')
    return (
        PRECON_MIN_LIBRARY_SIZE <= library_size <= PRECON_MAX_LIBRARY_SIZE
        and crypt_size >= PRECON_MIN_CRYPT_SIZE
    )


def filter_precon_decks(precon_decks):
    """Keep the legal precon decks, plus every deck of the special sets ( 2 players ), and drop empty sets."""
    filtered = {}
    for set_code, decks in precon_decks.items():
        if set_code in PRECON_SPECIAL_SET_KEYS:
            kept_decks = decks
        else:
            kept_decks = {name: deck for name, deck in decks.items() if is_legal_precon(deck)}
        if kept_decks:
            filtered[set_code] = kept_decks
    return filtered


def filter_precon_file():
    precon_path = os.path.join(RESOURCES_DIR, PRECON_FILE_NAME)
    with open(precon_path, 'r', encoding='utf-8') as precon_file:
        precon_decks = json.load(precon_file)

    filtered_decks = filter_precon_decks(precon_decks)

    # newline='' keeps LF endings on Windows
    with open(precon_path, 'w', encoding='utf-8', newline='') as precon_file:
        json.dump(filtered_decks, precon_file, ensure_ascii=False, separators=(',', ':'))

    print(f"Filtered precon decks: kept {count_decks(filtered_decks)}/{count_decks(precon_decks)}")


def count_decks(precon_decks):
    return sum(len(decks) for decks in precon_decks.values())


def move_resource_files():
    print(f"Moving resource files to {os.path.abspath(ASSETS_DIR)}...")
    os.replace(
        os.path.join(RESOURCES_DIR, PRECON_FILE_NAME),
        os.path.join(ASSETS_DIR, PRECON_FILE_NAME)
    )

    os.replace(
        os.path.join(RESOURCES_DIR, SETS_AND_PRECONS_FILE_NAME),
        os.path.join(ASSETS_DIR, SETS_AND_PRECONS_FILE_NAME)
    )
    print("Resource files moved")


if __name__ == "__main__":
    download_vdb_resource_files()

    download_vdb_missing_images()

    generate_resource_files()

    filter_precon_file()

    move_resource_files()
