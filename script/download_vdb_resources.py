"""
Script to download VDB resource files from GitHub repository.
Downloads specific JSON files needed for the project.
"""

import os
import requests
from const import DOWNLOAD_BASE_URL, FILES_TO_DOWNLOAD, RESOURCES_DIR, LOCAL_CARD_IMAGE_DIR, DOWNLOAD_CARDS_IMAGE_URL, \
    CARDS_IMAGE_API_URL


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


def download_vdb_missing_images():
    """Download all card images in webp format from VDB that are missing locally."""
    print("Checking for missing card images...")
    print(f"Local directory: {os.path.abspath(LOCAL_CARD_IMAGE_DIR)}")
    print(f"Remote source: {DOWNLOAD_CARDS_IMAGE_URL}")
    print("-" * 50)

    # Create local directory if it doesn't exist
    os.makedirs(LOCAL_CARD_IMAGE_DIR, exist_ok=True)

    try:
        # Get list of remote files using GitHub API
        print(f"Fetching remote file list from GitHub Git Trees API...")

        response = requests.get(CARDS_IMAGE_API_URL, params={'recursive': '1'})
        response.raise_for_status()

        tree_data = response.json()

        # Filter for .webp files in the cards/en-EN directory
        cards_path_prefix = "frontend/public/images/cards/en-EN/"
        remote_webp_files = {
            item['path'].replace(cards_path_prefix, '')
            for item in tree_data.get('tree', [])
            if (item['type'] == 'blob' and
                item['path'].startswith(cards_path_prefix) and
                item['path'].endswith('.webp'))
        }

        print(f"Found {len(remote_webp_files)} .webp files on remote repository")

    except requests.RequestException as e:
        print(f"✗ Error fetching remote file list: {e}")
        return 1
    except (ValueError, KeyError) as e:
        print(f"✗ Error parsing remote file list: {e}")
        return 1

    # Get list of local .webp files
    try:
        if os.path.exists(LOCAL_CARD_IMAGE_DIR):
            local_webp_files = {
                f for f in os.listdir(LOCAL_CARD_IMAGE_DIR)
                if f.endswith('.webp')
            }
        else:
            local_webp_files = set()

        print(f"Found {len(local_webp_files)} .webp files locally")

    except OSError as e:
        print(f"✗ Error reading local directory: {e}")
        return 1

    # Find missing files
    missing_files = remote_webp_files - local_webp_files

    if not missing_files:
        print("✓ All remote .webp files are already present locally!")
        return 0

    print(f"Found {len(missing_files)} missing files to download")
    print("-" * 50)

    # Download missing files
    successful_downloads = 0
    failed_downloads = 0

    for filename in sorted(missing_files):
        remote_url = f"{DOWNLOAD_CARDS_IMAGE_URL}/{filename}"
        local_path = os.path.join(LOCAL_CARD_IMAGE_DIR, filename)

        if download_one_file(remote_url, local_path):
            successful_downloads += 1
        else:
            failed_downloads += 1

    print("-" * 50)
    print(f"Image download complete: {successful_downloads} downloaded, {failed_downloads} failed")

    if failed_downloads > 0:
        print("Some downloads failed. Please check the error messages above.")
        return 1
    else:
        print("All missing images downloaded successfully!")
        return 0
