##########
# Path
##########

RESOURCES_DIR = "./resources"
ASSETS_DIR = "../public/assets"
LOCAL_CARD_IMAGE_DIR = ASSETS_DIR + "/cards/en-EN"

PRECON_FILE_NAME = "preconDecks.json"
SETS_AND_PRECONS_FILE_NAME = "setsAndPrecons.json"
TWD_DECKS_FILE_NAME = "twdDecks.json"

INPUT_CARDBASE_LIB_PATH = RESOURCES_DIR + '/cardbase_lib.json'
INPUT_CARDBASE_CRYPT_PATH = RESOURCES_DIR + '/cardbase_crypt.json'
TWD_DECKS_PATH = RESOURCES_DIR + '/' + TWD_DECKS_FILE_NAME
INPUT_CARDS_DIR = ASSETS_DIR + '/cards/en-EN'

OUTPUT_CARDBASE_PATH = ASSETS_DIR + '/cardbase.json'
OUTPUT_ATLAS_DIR = ASSETS_DIR + '/atlas'

##########
# Url
##########

DOWNLOAD_BASE_URL = "https://raw.githubusercontent.com/smeea/vdb/master"
DOWNLOAD_CARDS_IMAGE_URL = DOWNLOAD_BASE_URL + "/frontend/public/images/cards/en-EN"
CARDS_IMAGE_API_URL = "https://api.github.com/repos/smeea/vdb/git/trees/master"

# Files to download with their source paths and target filenames
FILES_TO_DOWNLOAD = [
    {
        "source": "frontend/public/data/precon_decks.json",
        "target": PRECON_FILE_NAME
    },
    {
        "source": "frontend/public/data/cardbase_crypt.json",
        "target": "cardbase_crypt.json"
    },
    {
        "source": "frontend/public/data/cardbase_lib.json",
        "target": "cardbase_lib.json"
    },
    {
        "source": "frontend/src/assets/data/setsAndPrecons.json",
        "target": SETS_AND_PRECONS_FILE_NAME
    },
    {
        "source": "misc/cards-update/twd_decks.json",
        "target": TWD_DECKS_FILE_NAME
    }
]

##########
# Atlas
##########

# Nb cards in the Atlas. Use a square number to optimize space in the atlas
FREQUENT_CARDS_ATLAS_SIZE = 13 ** 2
TWD_DATE_CUTOFF = '2015-01-01'

CARD_HEIGHT = 500
CARD_WIDTH = 358
IMAGE_MODE = 'RGB'

##########
# Cardbase
##########

CRYPT_KEYS = [
    'adv',
    'capacity',
    'clan',
    'disciplines',
    'group',
    'id',
    'imageName',
    'name',
    'sect',
    # 'text',
    'title',
]

LIB_KEYS = [
    'blood',
    'clan',
    'discipline',
    'id',
    'imageName',
    'name',
    'pool',
    'requirement',
    # 'text',
    'type',
]
