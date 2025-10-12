import re
import subprocess
import sys


def parse_latest_version_from_changelog(changelog_path):
    """Parse the latest version from CHANGELOG.md"""
    with open(changelog_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match the first version block
    version_pattern = r'## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\n\n(.*?)(?=\n## \[|$)'
    match = re.search(version_pattern, content, re.DOTALL)

    if not match:
        print("No version found in CHANGELOG.md")
        return None

    version = match.group(1)
    date = match.group(2)
    body = match.group(3)

    # Extract features
    features = []
    features_match = re.search(r'Features?:\n((?:- .+\n?)+)', body)
    if features_match:
        feature_lines = features_match.group(1).strip().split('\n')
        features = [line.strip('- ').strip() for line in feature_lines if line.strip()]

    # Extract bugfixes
    bugfixes = []
    bugfixes_match = re.search(r'Bugfix(?:es)?:\n((?:- .+\n?)+)', body)
    if bugfixes_match:
        bugfix_lines = bugfixes_match.group(1).strip().split('\n')
        bugfixes = [line.strip('- ').strip() for line in bugfix_lines if line.strip()]

    return {
        'version': version,
        'date': date,
        'features': features,
        'bugfixes': bugfixes
    }


def escape_string(s):
    """Escape single quotes for TypeScript strings"""
    return s.replace("'", "\\'")


def update_changelog_ts(changelog_data, ts_path):
    """Update changelog.ts with the new data"""
    features_str = ',\n        '.join([f"'{escape_string(feat)}'" for feat in changelog_data['features']])
    bugfixes_str = ',\n        '.join([f"'{escape_string(bug)}'" for bug in changelog_data['bugfixes']])

    ts_content = f"""export const latestChangelog = {{
    version: '{changelog_data['version']}',
    date: '{changelog_data['date']}',
    features: [
        {features_str}
    ],
    bugfixes: [
        {bugfixes_str}
    ],
}}
"""

    with open(ts_path, 'w', encoding='utf-8') as f:
        f.write(ts_content)


def main():
    changelog_path = '../CHANGELOG.md'
    ts_path = '../src/changelog.ts'

    # Parse the latest version from CHANGELOG.md
    changelog_data = parse_latest_version_from_changelog(changelog_path)

    if not changelog_data:
        print("Failed to parse CHANGELOG.md")
        return

    # Check if there are features
    if not changelog_data['features']:
        print(f"Version {changelog_data['version']} has no features. Skipping update.")
        return

    # Update changelog.ts
    update_changelog_ts(changelog_data, ts_path)
    print(f"✓ Updated changelog.ts with version {changelog_data['version']}")
    print(f"  Features: {len(changelog_data['features'])}")
    print(f"  Bugfixes: {len(changelog_data['bugfixes'])}")

    # Run Prettier on the generated file
    try:
        subprocess.run(f'npx prettier --write {ts_path}',
                       check=True, capture_output=True, text=True, shell=True)
        print("✓ Formatted changelog.ts with Prettier")
    except subprocess.CalledProcessError as e:
        print(f"⚠ Warning: Failed to run Prettier: {e.stderr}", file=sys.stderr)
    except FileNotFoundError:
        print("⚠ Warning: npm not found. Skipping Prettier formatting.", file=sys.stderr)


if __name__ == '__main__':
    main()
