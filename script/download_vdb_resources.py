"""
Script to download VDB resource files from GitHub repository.
Downloads specific JSON files needed for the project.
"""

import os
import requests
import json
import hashlib
from const import DOWNLOAD_BASE_URL, FILES_TO_DOWNLOAD, RESOURCES_DIR, LOCAL_CARD_IMAGE_DIR, DOWNLOAD_CARDS_IMAGE_URL, \
    CARDS_IMAGE_API_URL, IMAGE_CACHE_FILE


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
    try:
        with open(file_path, 'rb') as f:
            data = f.read()

        # Git prepends "blob {size}\0" to the content before hashing
        git_blob = f"blob {len(data)}\0".encode() + data
        sha1 = hashlib.sha1(git_blob).hexdigest()
        return sha1
    except IOError as e:
        print(f"⚠ Error computing SHA for {file_path}: {e}")
        return None


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
        remote_webp_files = {}
        for item in tree_data.get('tree', []):
            if (
                item['type'] == 'blob' and
                item['path'].startswith(cards_path_prefix) and
                item['path'].endswith('.webp')
            ):
                filename = item['path'].replace(cards_path_prefix, '')
                # Store filename with its SHA (used as a version identifier)
                remote_webp_files[filename] = item['sha']

        print(f"Found {len(remote_webp_files)} .webp files on remote repository")

    except requests.RequestException as e:
        print(f"✗ Error fetching remote file list: {e}")
        return 1
    except (ValueError, KeyError) as e:
        print(f"✗ Error parsing remote file list: {e}")
        return 1

    # Load cache of previously downloaded file SHAs
    local_cache = {}
    if os.path.exists(IMAGE_CACHE_FILE):
        try:
            with open(IMAGE_CACHE_FILE, 'r') as f:
                local_cache = json.load(f)
            print(f"Loaded cache with {len(local_cache)} entries")
        except (IOError, json.JSONDecodeError) as e:
            print(f"⚠ Could not load cache file, will rebuild: {e}")
            local_cache = {}

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

    # Find missing files (in remote but not local)
    missing_files = set(remote_webp_files.keys()) - local_webp_files

    # Find outdated files (local SHA doesn't match remote SHA)
    outdated_files = []
    existing_files = set(remote_webp_files.keys()) & local_webp_files

    print(f"Checking {len(existing_files)} existing files for updates...")
    files_checked = 0
    files_computed = 0

    for filename in existing_files:
        remote_sha = remote_webp_files[filename]
        cached_sha = local_cache.get(filename)

        # If no cached SHA, compute it from the local file
        if cached_sha is None:
            local_path = os.path.join(LOCAL_CARD_IMAGE_DIR, filename)
            cached_sha = compute_git_blob_sha(local_path)
            if cached_sha:
                # Store the computed SHA in cache
                local_cache[filename] = cached_sha
                files_computed += 1

        files_checked += 1
        if files_checked % 500 == 0:
            print(f"  Checked {files_checked}/{len(existing_files)} files...")

        if cached_sha != remote_sha:
            outdated_files.append(filename)

    if files_computed > 0:
        print(f"Computed SHA for {files_computed} uncached files")

    # Find orphaned files (in local but not in remote)
    orphaned_files = local_webp_files - set(remote_webp_files.keys())

    print(f"Found {len(missing_files)} missing files")
    print(f"Found {len(outdated_files)} outdated files")
    if orphaned_files:
        print(f"Found {len(orphaned_files)} orphaned files (exist locally but not on remote)")

    files_to_download = list(missing_files) + outdated_files

    if not files_to_download:
        print("✓ All files are up to date!")
        # Save cache even if no downloads (in case we computed new SHAs)
        if files_computed > 0:
            try:
                with open(IMAGE_CACHE_FILE, 'w') as f:
                    json.dump(local_cache, f, indent=4)
                print(f"✓ Cache updated with newly computed SHAs")
            except IOError as e:
                print(f"⚠ Could not save cache file: {e}")
        return 0

    print(f"Total files to download/update: {len(files_to_download)}")
    print("-" * 50)

    # Download missing and outdated files
    successful_downloads = 0
    failed_downloads = 0

    for filename in sorted(files_to_download):
        remote_url = f"{DOWNLOAD_CARDS_IMAGE_URL}/{filename}"
        local_path = os.path.join(LOCAL_CARD_IMAGE_DIR, filename)

        if download_one_file(remote_url, local_path):
            successful_downloads += 1
            # Update cache with the new SHA
            local_cache[filename] = remote_webp_files[filename]
        else:
            failed_downloads += 1

    # Clean up cache entries for orphaned files
    for filename in orphaned_files:
        if filename in local_cache:
            del local_cache[filename]

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
