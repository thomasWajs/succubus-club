"""
Script to download VDB resource files from GitHub repository.
Downloads specific JSON files needed for the project.
"""

import os
import requests
import json
from io import BytesIO

from PIL import Image
from const import DOWNLOAD_BASE_URL, FILES_TO_DOWNLOAD, RESOURCES_DIR, LOCAL_CARD_IMAGE_DIR, DOWNLOAD_CARDS_IMAGE_URL, \
    CARDS_IMAGE_API_URL, IMAGE_CACHE_FILE, LOCAL_DISCIPLINE_IMAGE_DIR, DOWNLOAD_DISCIPLINE_IMAGE_URL, \
    DISCIPLINE_IMAGE_API_URL, REMOTE_CARD_IMAGE_EXTENSION, LOCAL_CARD_IMAGE_EXTENSION


def download_one_file(url, local_path):
    """Download a file from URL and save it to local path."""
    try:
        print(f"Downloading {url}...")
        response = requests.get(url)
        response.raise_for_status()

        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        # Save the file
        with open(local_path, 'wb') as f:
            f.write(response.content)

        print(f"✓ Saved to {local_path}")
        return True

    except requests.RequestException as e:
        print(f"✗ Error downloading {url}: {e}")
        return False
    except IOError as e:
        print(f"✗ Error saving {local_path}: {e}")
        return False


def download_one_card_image(url, local_path):
    """Download a card image from URL and save it converted to the format of local path."""
    try:
        print(f"Downloading {url}...")
        response = requests.get(url)
        response.raise_for_status()

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        with Image.open(BytesIO(response.content)) as image:
            image.convert('RGB').save(local_path)

        print(f"✓ Saved to {local_path}")
        return True

    except requests.RequestException as e:
        print(f"✗ Error downloading {url}: {e}")
        return False
    except IOError as e:
        print(f"✗ Error converting or saving {local_path}: {e}")
        return False


def download_vdb_resource_files():
    """Main function to download all required VDB resource files."""

    print("Starting VDB resource download...")
    print(f"Target directory: {os.path.abspath(RESOURCES_DIR)}")
    print("-" * 50)

    successful_downloads = 0
    total_files = len(FILES_TO_DOWNLOAD)

    for file_info in FILES_TO_DOWNLOAD:
        source_path = file_info["source"]
        target_filename = file_info["target"]

        url = f"{DOWNLOAD_BASE_URL}/{source_path}"
        local_path = os.path.join(RESOURCES_DIR, target_filename)

        if download_one_file(url, local_path):
            successful_downloads += 1
        print()

    print("-" * 50)
    print(f"Download complete: {successful_downloads}/{total_files} files downloaded successfully")

    if successful_downloads < total_files:
        print("Some downloads failed. Please check the error messages above.")
        return 1
    else:
        print("All files downloaded successfully!")
        return 0


def download_vdb_discipline_images():
    """Download all discipline images from VDB into the local disciplines directory."""
    print("Downloading discipline images...")
    print(f"Local directory: {os.path.abspath(LOCAL_DISCIPLINE_IMAGE_DIR)}")
    print(f"Remote source: {DOWNLOAD_DISCIPLINE_IMAGE_URL}")
    print("-" * 50)

    # Create local directory if it doesn't exist
    os.makedirs(LOCAL_DISCIPLINE_IMAGE_DIR, exist_ok=True)

    try:
        # Get list of remote files using GitHub Contents API (lists a single directory)
        print("Fetching remote file list from GitHub Contents API...")

        response = requests.get(DISCIPLINE_IMAGE_API_URL)
        response.raise_for_status()

        contents = response.json()

        # Keep only files (blobs), skip nested subdirectories
        remote_files = [item['name'] for item in contents if item.get('type') == 'file']

        print(f"Found {len(remote_files)} files in the disciplines directory")

    except requests.RequestException as e:
        print(f"✗ Error fetching remote file list: {e}")
        return 1
    except (ValueError, KeyError) as e:
        print(f"✗ Error parsing remote file list: {e}")
        return 1

    if not remote_files:
        print("No discipline images found on remote repository.")
        return 1

    print("-" * 50)

    successful_downloads = 0
    failed_downloads = 0

    for filename in sorted(remote_files):
        remote_url = f"{DOWNLOAD_DISCIPLINE_IMAGE_URL}/{filename}"
        local_path = os.path.join(LOCAL_DISCIPLINE_IMAGE_DIR, filename)

        if download_one_file(remote_url, local_path):
            successful_downloads += 1
        else:
            failed_downloads += 1

    print("-" * 50)
    print(f"Discipline image download complete: {successful_downloads} downloaded, {failed_downloads} failed")

    if failed_downloads > 0:
        print("Some downloads failed. Please check the error messages above.")
        return 1
    else:
        print("All discipline images downloaded successfully!")
        return 0


def download_vdb_missing_images():
    """Download all card images from VDB that are missing or outdated locally, converted to webp."""
    print("Checking for missing card images...")
    print(f"Local directory: {os.path.abspath(LOCAL_CARD_IMAGE_DIR)}")
    print(f"Remote source: {DOWNLOAD_CARDS_IMAGE_URL}")
    print("-" * 50)

    # Create local directory if it doesn't exist
    os.makedirs(LOCAL_CARD_IMAGE_DIR, exist_ok=True)

    try:
        # Get list of remote files using GitHub API (tree of the card image directory only)
        print(f"Fetching remote file list from GitHub Git Trees API...")

        response = requests.get(CARDS_IMAGE_API_URL)
        response.raise_for_status()

        tree_data = response.json()

        if tree_data.get('truncated'):
            print("⚠ Remote file list is truncated, some images may be missed")

        # Map each local filename to the SHA of its remote source image (used as a version identifier)
        remote_files = {}
        for item in tree_data.get('tree', []):
            if item['type'] == 'blob' and item['path'].endswith(REMOTE_CARD_IMAGE_EXTENSION):
                base_name = item['path'][:-len(REMOTE_CARD_IMAGE_EXTENSION)]
                remote_files[base_name + LOCAL_CARD_IMAGE_EXTENSION] = item['sha']

        print(f"Found {len(remote_files)} {REMOTE_CARD_IMAGE_EXTENSION} files on remote repository")

    except requests.RequestException as e:
        print(f"✗ Error fetching remote file list: {e}")
        return 1
    except (ValueError, KeyError) as e:
        print(f"✗ Error parsing remote file list: {e}")
        return 1

    if not remote_files:
        print("No card images found on remote repository.")
        return 1

    # Load cache of the remote SHAs of previously downloaded files
    local_cache = {}
    if os.path.exists(IMAGE_CACHE_FILE):
        try:
            with open(IMAGE_CACHE_FILE, 'r') as f:
                local_cache = json.load(f)
            print(f"Loaded cache with {len(local_cache)} entries")
        except (IOError, json.JSONDecodeError) as e:
            print(f"⚠ Could not load cache file, will rebuild: {e}")
            local_cache = {}

    # Get list of local image files
    try:
        local_files = {
            f for f in os.listdir(LOCAL_CARD_IMAGE_DIR)
            if f.endswith(LOCAL_CARD_IMAGE_EXTENSION)
        }

        print(f"Found {len(local_files)} {LOCAL_CARD_IMAGE_EXTENSION} files locally")

    except OSError as e:
        print(f"✗ Error reading local directory: {e}")
        return 1

    # Find missing files (in remote but not local)
    missing_files = set(remote_files.keys()) - local_files

    # Find outdated files (cached remote SHA doesn't match current remote SHA).
    # Local files are converted, so their own SHA can't be compared to the remote one :
    # a local file without cache entry is assumed up to date and its remote SHA is cached.
    outdated_files = []
    existing_files = set(remote_files.keys()) & local_files
    files_seeded = 0

    print(f"Checking {len(existing_files)} existing files for updates...")

    for filename in existing_files:
        remote_sha = remote_files[filename]
        cached_sha = local_cache.get(filename)

        if cached_sha is None:
            local_cache[filename] = remote_sha
            files_seeded += 1
        elif cached_sha != remote_sha:
            outdated_files.append(filename)

    if files_seeded > 0:
        print(f"Assumed {files_seeded} uncached files up to date")

    # Find orphaned files (in local but not in remote)
    orphaned_files = local_files - set(remote_files.keys())

    print(f"Found {len(missing_files)} missing files")
    print(f"Found {len(outdated_files)} outdated files")
    if orphaned_files:
        print(f"Found {len(orphaned_files)} orphaned files (exist locally but not on remote)")

    # Clean up cache entries for orphaned files
    for filename in orphaned_files:
        local_cache.pop(filename, None)

    files_to_download = list(missing_files) + outdated_files

    successful_downloads = 0
    failed_downloads = 0

    if files_to_download:
        print(f"Total files to download/update: {len(files_to_download)}")
        print("-" * 50)

        for filename in sorted(files_to_download):
            remote_filename = filename[:-len(LOCAL_CARD_IMAGE_EXTENSION)] + REMOTE_CARD_IMAGE_EXTENSION
            remote_url = f"{DOWNLOAD_CARDS_IMAGE_URL}/{remote_filename}"
            local_path = os.path.join(LOCAL_CARD_IMAGE_DIR, filename)

            if download_one_card_image(remote_url, local_path):
                successful_downloads += 1
                # Update cache with the new SHA
                local_cache[filename] = remote_files[filename]
            else:
                failed_downloads += 1
    else:
        print("✓ All files are up to date!")

    # Save updated cache
    try:
        with open(IMAGE_CACHE_FILE, 'w') as f:
            json.dump(local_cache, f, indent=4)
        print(f"✓ Cache updated")
    except IOError as e:
        print(f"⚠ Could not save cache file: {e}")

    print("-" * 50)
    print(f"Image download complete: {successful_downloads} downloaded/updated, {failed_downloads} failed")

    if failed_downloads > 0:
        print("Some downloads failed. Please check the error messages above.")
        return 1
    else:
        print("All missing images downloaded successfully!")
        return 0
