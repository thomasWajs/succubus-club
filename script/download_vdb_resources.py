"""
Script to download VDB resource files from GitHub repository.
Downloads specific JSON files needed for the project.
"""

import hashlib
import os
import requests
from const import DOWNLOAD_BASE_URL, FILES_TO_DOWNLOAD, RESOURCES_DIR, LOCAL_CARD_IMAGE_DIR, DOWNLOAD_CARDS_IMAGE_URL, \
    CARDS_IMAGE_API_URL, LOCAL_DISCIPLINE_IMAGE_DIR, DOWNLOAD_DISCIPLINE_IMAGE_URL, \
    DISCIPLINE_IMAGE_API_URL, CARD_IMAGE_EXTENSION


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


def compute_git_blob_sha(file_path):
    """Compute the Git blob SHA-1 hash for a file (same as GitHub uses)."""
    with open(file_path, 'rb') as f:
        data = f.read()

    # Git prepends "blob {size}\0" to the content before hashing
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


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
    """Download all card images from VDB that are missing or outdated locally."""
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

        # Map each filename to its remote Git blob SHA (used as a version identifier)
        remote_files = {
            item['path']: item['sha']
            for item in tree_data.get('tree', [])
            if item['type'] == 'blob' and item['path'].endswith(CARD_IMAGE_EXTENSION)
        }

        print(f"Found {len(remote_files)} {CARD_IMAGE_EXTENSION} files on remote repository")

    except requests.RequestException as e:
        print(f"✗ Error fetching remote file list: {e}")
        return 1
    except (ValueError, KeyError) as e:
        print(f"✗ Error parsing remote file list: {e}")
        return 1

    if not remote_files:
        print("No card images found on remote repository.")
        return 1

    # Get list of local image files
    try:
        local_files = {
            f for f in os.listdir(LOCAL_CARD_IMAGE_DIR)
            if f.endswith(CARD_IMAGE_EXTENSION)
        }

        print(f"Found {len(local_files)} {CARD_IMAGE_EXTENSION} files locally")

    except OSError as e:
        print(f"✗ Error reading local directory: {e}")
        return 1

    # Find missing files (in remote but not local)
    missing_files = set(remote_files.keys()) - local_files

    # Find outdated files (local SHA doesn't match remote SHA)
    existing_files = set(remote_files.keys()) & local_files

    print(f"Checking {len(existing_files)} existing files for updates...")

    outdated_files = [
        filename for filename in existing_files
        if compute_git_blob_sha(os.path.join(LOCAL_CARD_IMAGE_DIR, filename)) != remote_files[filename]
    ]

    # Find orphaned files (in local but not in remote)
    orphaned_files = local_files - set(remote_files.keys())

    print(f"Found {len(missing_files)} missing files")
    print(f"Found {len(outdated_files)} outdated files")
    if orphaned_files:
        print(f"Found {len(orphaned_files)} orphaned files (exist locally but not on remote)")

    files_to_download = list(missing_files) + outdated_files

    successful_downloads = 0
    failed_downloads = 0

    if files_to_download:
        print(f"Total files to download/update: {len(files_to_download)}")
        print("-" * 50)

        for filename in sorted(files_to_download):
            remote_url = f"{DOWNLOAD_CARDS_IMAGE_URL}/{filename}"
            local_path = os.path.join(LOCAL_CARD_IMAGE_DIR, filename)

            if download_one_file(remote_url, local_path):
                successful_downloads += 1
            else:
                failed_downloads += 1
    else:
        print("✓ All files are up to date!")

    print("-" * 50)
    print(f"Image download complete: {successful_downloads} downloaded/updated, {failed_downloads} failed")

    if failed_downloads > 0:
        print("Some downloads failed. Please check the error messages above.")
        return 1
    else:
        print("All missing images downloaded successfully!")
        return 0
