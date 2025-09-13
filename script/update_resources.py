import os

from script.const import RESOURCES_DIR, PRECON_FILE_NAME, ASSETS_DIR, SETS_AND_PRECONS_FILE_NAME
from script.download_vdb_resources import download_vdb_resource_files, download_vdb_missing_images
from script.generate_resource_files import generate_resource_files


def move_resource_files():
    os.replace(
        os.path.join(RESOURCES_DIR, PRECON_FILE_NAME),
        os.path.join(ASSETS_DIR, PRECON_FILE_NAME)
    )

    os.replace(
        os.path.join(RESOURCES_DIR, SETS_AND_PRECONS_FILE_NAME),
        os.path.join(ASSETS_DIR, SETS_AND_PRECONS_FILE_NAME)
    )


if __name__ == "__main__":
    download_vdb_resource_files()

    download_vdb_missing_images()

    generate_resource_files()

    move_resource_files()
