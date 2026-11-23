#!/usr/bin/env python3
"""Package the complete, rebuildable Harbour Shift source without build caches.

Preview (default): python3 scripts/package-source.py --dry-run
After final QA:    python3 scripts/package-source.py --write

The output is ../harbour-shift-source.zip. Before replacing an existing ZIP,
copy it into the task's work/source-zip-backups directory. This uses only the
Python standard library and never installs dependencies or runs native builds.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
OUTPUT = PROJECT.parent / 'harbour-shift-source.zip'
BACKUPS = PROJECT / '.build' / 'source-zip-backups'
ARCHIVE_ROOT = 'harbour-shift'
# Apply at every depth; notably ios/build, android/app/build and nested .cxx.
EXCLUDED_DIRECTORIES = {
    'node_modules', 'Pods', 'build', '.build', 'Build', '.cxx', '.externalNativeBuild', '.gradle',
    '.kotlin', '.expo', '.git', '.cache', '.parcel-cache', '.turbo', '.next',
    'DerivedData', 'derived-data', 'xcuserdata', '__pycache__', '.pytest_cache',
    '.mypy_cache', '.ruff_cache', 'coverage', 'dist', 'web-build', 'Carthage',
    'SourcePackages', 'Index.noindex', 'ModuleCache.noindex', 'Archives',
    'xcarchive', 'work', 'tmp', 'temp',
    '.wrangler', 'private', 'qa',
}
EXCLUDED_FILENAMES = {
    '.DS_Store', 'local.properties', '.xcode.env.local', '.env',
    'expo-env.d.ts', 'SOURCE_MANIFEST.json', 'ExportOptions.plist', 'UploadOptions.plist',
}
EXCLUDED_SUFFIXES = {
    '.pyc', '.pyo', '.tsbuildinfo', '.hprof', '.heapdump', '.xcuserstate',
    '.apk', '.aab', '.ipa', '.app', '.dSYM', '.xcarchive', '.xcresult',
    '.p8', '.p12', '.pem', '.key', '.jks', '.keystore', '.mobileprovision',
    '.enc', '.sqlite', '.sqlite3', '.db', '.log',
}
REQUIRED_FILES = {
    'App.tsx', 'app.json', 'package.json', 'package-lock.json', 'README.md',
    'src/GameProvider.tsx', 'src/data/landmarks.ts',
    'src/MultiplayerProvider.tsx', 'src/navigation.ts', 'shared/protocol.ts',
    'src/multiplayer/setup.ts', 'src/multiplayer/playerStatus.ts', 'src/multiplayer/time.ts', 'src/multiplayer/time.test.ts',
    'src/ui/ShiftTimeFields.tsx', 'src/ui/RestoreRoomExit.tsx', 'scripts/test-multiplayer-provider.cjs', 'src/ui/networkTask.ts', 'src/ui/networkTask.test.ts', 'docs/localization.md',
    'src/ui/ProfileScreen.tsx', 'src/ui/MultiplayerLobbyScreen.tsx', 'src/ui/RoomScreen.tsx',
    'src/ui/RoomLeaderboard.tsx', 'src/ui/LeaderboardScreen.tsx', 
    'src/i18n/index.tsx', 'src/i18n/store.ts', 'src/i18n/types.ts', 'src/i18n/translate.ts', 'src/i18n/en.ts',
    'src/i18n/zh.json', 'src/i18n/zh-templates.json', 'src/i18n/hans-characters.json',
    'scripts/audit-i18n.cjs', 'src/data/localities.ts', 'src/data/localities.test.ts',
    'assets/localities/anchors.json', 'assets/localities/provenance.json', 'assets/localities/NOTICE.md',
    'scripts/ingest-localities.py', 'assets/map/road-names-en.json',
    'assets/places/catalog.json', 'assets/places/provenance.json',
    'assets/places/NOTICE.md', 'assets/places/spatial-index.json',
    'assets/places/excluded-records.csv', 'assets/places/retail-aliases.json',
    'assets/services/stations.json', 'assets/services/provenance.json', 'assets/services/NOTICE.md',
    'src/data/serviceStations.ts', 'src/data/vehicleAccess.ts', 'src/data/serviceStations.test.ts',
    'src/map/VehicleMarker.tsx', 'src/map/useTripOverview.ts', 'src/map/surgeLayers.ts',
    'assets/map/districts.json', 'assets/map/harbour-sans-hk.otf', 'assets/map/OFL-NotoSansHK.txt', 'assets/map/SOURCES.md',
    'scripts/ingest-places.py', 'scripts/package-source.py', 
    'scripts/ingest-services.py', 'scripts/patch-maplibre-android.cjs',
    'scripts/ios-seed-qa.ts', 'scripts/ios-extract-qa-screenshots.py', 'scripts/ios-rebundle-simulator.sh',
    'docs/iteration-02-research.md', 'docs/android-build.md', 'docs/ios-build.md',
    'docs/iteration-03-energy-access.md',
    'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
    'android/gradlew', 'android/gradle/wrapper/gradle-wrapper.jar',
    'ios/Podfile', 'ios/Podfile.lock', 'ios/app.xcodeproj/project.pbxproj',
    'ios/app.xcworkspace/contents.xcworkspacedata',
    'ios/HarbourShiftQA/HarbourShiftUITests.swift',
    'scripts/test-package-source.py',
    'server/cloudflare/owned/production-entry.mjs',
    'server/cloudflare/owned/production.mjs',
    'server/cloudflare/owned/compute-adapter.mjs',
    'server/cloudflare/owned/fence-gate.mjs',
    'server/cloudflare/owned/build.mjs',
    'server/cloudflare/owned/production.test.mjs',
    'server/cloudflare/owned/build.test.mjs',
    'server/cloudflare/owned/wrangler.example.jsonc',
    'server/cloudflare/owned/README.md',
    'server/cloudflare/owned/schema/0000_multiplayer_rooms.sql',
    'server/cloudflare/owned/schema/0001_player_presence.sql',
    'server/cloudflare/owned/schema/0002_driver_accounts.sql',
    'server/cloudflare/owned/schema/0003_migration_write_fence.sql',
    'server/cloudflare/owned/schema/meta/_journal.json',
    'src/game/shiftDuration.ts', 'src/game/worldEvents.ts', 'shared/worldEvents.ts',
    'server/review.ts', 'server/mapLoading.test.ts',
    'src/ui/mapReadiness.ts', 'src/ui/mapReadiness.test.ts',
    'src/ui/gameProviderReadiness.test.ts', 'src/ui/OfferPlanningResume.tsx',
    'src/ui/offerPlanningResume.test.ts', 'src/audio/GameEffects.tsx',
    'src/audio/cues.ts', 'src/audio/sounds.ts', 'ios/app/HarbourSound.m',
    'android/app/src/main/java/com/ygl100/harbourshift/HarbourSoundPackage.kt',
    'shared/blindOrders.ts', 'shared/horns.ts', 'server/horns.ts', 'src/config/blindOrders.ts',
    'src/game/mapDemand.ts', 'src/game/commute.ts', 'src/game/traffic.ts',
    'src/ui/useDemandDisplay.ts', 'src/ui/MultiplayerHornButton.tsx', 'src/ui/FareRevealNotice.tsx',
    'assets/services/charging.json', 'assets/services/charging-excluded.json', 'docs/charging-data-and-model.md',
    'src/game/vehicleCapabilities.ts', 'src/ui/VehiclePicker.tsx', 'src/ui/chargingPresentation.ts',
    'src/ui/TrainingScreen.tsx', 'src/profile/ledger.ts', 'shared/trainingCourse.ts', 'shared/training.ts',
    'server/cloudflare/training.ts', 'server/cloudflare/owned/schema/0004_driver_training.sql',
    'shared/pro.ts', 'shared/elite.ts', 'shared/eliteCourse.ts', 'shared/airport.ts',
    'src/ui/ProScreen.tsx', 'src/ui/EliteScreen.tsx', 'src/ui/AirportDemandPanel.tsx',
    'server/cloudflare/pro.ts', 'server/cloudflare/elite.ts', 'server/airportQueue.ts',
    'server/cloudflare/owned/schema/0005_driver_pro.sql', 'server/cloudflare/owned/schema/0006_driver_elite.sql',
    'assets/sounds/harbour_horn.wav', 'ios/app/sounds/harbour_horn.wav',
    'android/app/src/main/res/raw/harbour_horn.wav',
}
for cue in ('tap', 'select', 'open', 'pause', 'resume', 'park', 'rest', 'service', 'complete', 'cancel', 'error', 'event'):
    REQUIRED_FILES.update({f'assets/sounds/harbour_{cue}.wav', f'ios/app/sounds/harbour_{cue}.wav', f'android/app/src/main/res/raw/harbour_{cue}.wav'})


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def excluded_file(relative: Path) -> bool:
    name = relative.name
    if name in EXCLUDED_FILENAMES or name.startswith('._'):
        return True
    if name.startswith('.dev.vars') or relative.suffix.lower() == '.enc':
        return True
    if name.startswith(('.metro-health-check', 'npm-debug.', 'yarn-debug.', 'yarn-error.')):
        return True
    if name.startswith('.env.') and not name.endswith(('.example', '.sample', '.template')):
        return True
    if name.endswith(('.orig', '.rej', '.tmp', '~')) or '.orig.' in name:
        return True
    return relative.suffix.lower() in {suffix.lower() for suffix in EXCLUDED_SUFFIXES}


def collect_files() -> tuple[list[Path], Counter]:
    files: list[Path] = []
    skipped: Counter = Counter()
    for folder, directories, filenames in os.walk(PROJECT, topdown=True, followlinks=False):
        root = Path(folder)
        keep = []
        for name in sorted(directories):
            path = root / name
            if name in EXCLUDED_DIRECTORIES or name.lower() in {'private', '.wrangler'} or path.suffix in {'.app', '.dSYM', '.xcarchive', '.xcresult'}:
                skipped[f'directory:{name}'] += 1
            elif path.is_symlink():
                raise RuntimeError(f'Unexpected source directory symlink: {path.relative_to(PROJECT)}')
            else:
                keep.append(name)
        directories[:] = keep
        for name in sorted(filenames):
            path = root / name
            relative = path.relative_to(PROJECT)
            if excluded_file(relative):
                skipped[f'file:{name}'] += 1
            elif path.is_symlink():
                raise RuntimeError(f'Unexpected source file symlink: {relative}')
            elif path.is_file():
                files.append(relative)
    files.sort(key=lambda path: path.as_posix())
    included = {path.as_posix() for path in files}
    missing = REQUIRED_FILES - included
    if missing:
        raise RuntimeError(f'Required source files absent/excluded: {sorted(missing)}')
    return files, skipped


# Match credentials only in an explicit credential context. Ordinary source,
# bundle/row SHA-256 values and public account/database IDs are not secrets.
SECRET_NAMES = (
    r'CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CLOUDFLARE_GLOBAL_API_KEY|'
    r'HARBOUR_STAGING_KEY|HARBOUR_MIGRATION_ADMIN_TOKEN|'
    r'HARBOUR_MIGRATION_ADMIN_BEARER|APPLE_APP_SPECIFIC_PASSWORD|'
    r'access_token|refresh_token|id_token|client_secret|'
    r'driverToken|resumeToken|adminToken|stagingKey'
)
CREDENTIAL_LITERAL = re.compile(
    r'(?<![A-Za-z0-9_])[\"\']?(?:' + SECRET_NAMES + r')[\"\']?\s*[:=]\s*[\"\']([^\"\'\r\n]+)[\"\']',
    re.IGNORECASE,
)
ENV_CREDENTIAL_LITERAL = re.compile(r'^\s*(?:' + SECRET_NAMES + r')\s*=\s*([^\s\r\n]+)\s*$', re.IGNORECASE | re.MULTILINE)
BEARER_LITERAL = re.compile(r'\bBearer[ \t]+([A-Za-z0-9_.~+/=\-]{24,})')
PRIVATE_KEY_LITERAL = re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')
TEXT_SOURCE_SUFFIXES = {'.py', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.toml', '.md', '.sql', '.sh', '.yml', '.yaml', '.plist', '.pbxproj'}


def credential_value(value: str) -> bool:
    value = value.strip().strip('\"\'')
    if len(value) < 24:
        return False
    if value.upper().startswith(('TEST_ONLY_', 'SYNTHETIC_', 'SYNTHETIC-', 'EXAMPLE_', 'PLACEHOLDER_', 'YOUR_')):
        return False
    if '<' in value or '>' in value or value.startswith(('${', 'process.env.', '$')):
        return False
    return bool(re.fullmatch(r'[A-Za-z0-9_.~+/=\-]+', value))


def credential_literal_issues(text: str) -> list[str]:
    issues = []
    if PRIVATE_KEY_LITERAL.search(text):
        issues.append('embedded-private-key')
    if any(credential_value(match.group(1)) for match in CREDENTIAL_LITERAL.finditer(text)):
        issues.append('credential-assignment')
    if any(credential_value(match.group(1)) for match in ENV_CREDENTIAL_LITERAL.finditer(text)):
        issues.append('credential-environment-value')
    if any(credential_value(match.group(1)) for match in BEARER_LITERAL.finditer(text)):
        issues.append('literal-bearer')
    return issues


def validate_no_credential_literals(files: list[Path]) -> None:
    problems = []
    for relative in files:
        if relative.suffix.lower() not in TEXT_SOURCE_SUFFIXES:
            continue
        # These are source/config/JSON files; never emit their contents in an
        # error. Streaming files in the ZIP remains a separate hash check.
        try:
            text = (PROJECT / relative).read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        issues = credential_literal_issues(text)
        if issues:
            problems.append({'path': relative.as_posix(), 'issues': issues})
    if problems:
        raise RuntimeError('Credential-like literals in source; values withheld: ' + json.dumps(problems))


def manifest_for(files: list[Path]) -> dict:
    catalog = json.loads((PROJECT / 'assets/places/catalog.json').read_text())
    provenance = json.loads((PROJECT / 'assets/places/provenance.json').read_text())
    if len(catalog['rows']) != provenance['retainedCount']:
        raise RuntimeError('POI catalogue and provenance counts disagree')
    package = json.loads((PROJECT / 'package.json').read_text())
    app = json.loads((PROJECT / 'app.json').read_text()).get('expo', {})
    return {
        'schemaVersion': 1,
        'project': package['name'],
        'version': package['version'],
        'appVersion': app.get('version'),
        'iosBuildNumber': app.get('ios', {}).get('buildNumber'),
        'androidVersionCode': app.get('android', {}).get('versionCode'),
        'poiCount': len(catalog['rows']),
        'notes': 'Source, offline data, documentation and native QA sources; dependency/build caches omitted. ZIP timestamps are fixed for reproducibility.',
        'files': [{'path': path.as_posix(), 'bytes': (PROJECT / path).stat().st_size,
                   'sha256': sha256(PROJECT / path)} for path in files],
    }


def write_entry(archive: zipfile.ZipFile, relative: str, data: bytes, executable=False):
    info = zipfile.ZipInfo(f'{ARCHIVE_ROOT}/{relative}', date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data, compresslevel=6)


def write_archive(files: list[Path], manifest: dict) -> None:
    # Build/verify a temporary archive first. A failed run preserves the old ZIP.
    with tempfile.NamedTemporaryFile(prefix='.harbour-shift-source-', suffix='.zip', dir=OUTPUT.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with zipfile.ZipFile(temporary, 'w') as archive:
            for path, expected in zip(files, manifest['files']):
                source = PROJECT / path
                data = source.read_bytes()
                if hashlib.sha256(data).hexdigest() != expected['sha256']:
                    raise RuntimeError(f'File changed while packaging; retry after QA freeze: {path}')
                write_entry(archive, path.as_posix(), data, bool(source.stat().st_mode & 0o111))
            write_entry(archive, 'SOURCE_MANIFEST.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode())
        with zipfile.ZipFile(temporary) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f'ZIP CRC check failed: {bad}')
            expected_names = {f'{ARCHIVE_ROOT}/{path.as_posix()}' for path in files} | {f'{ARCHIVE_ROOT}/SOURCE_MANIFEST.json'}
            if set(archive.namelist()) != expected_names:
                raise RuntimeError('ZIP entry list differs from reviewed manifest')
        if OUTPUT.exists():
            BACKUPS.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup = BACKUPS / f'harbour-shift-source-{stamp}-{sha256(OUTPUT)[:12]}.zip'
            shutil.copy2(OUTPUT, backup)
            if sha256(OUTPUT) != sha256(backup):
                raise RuntimeError('Previous ZIP backup verification failed; original not replaced')
            print(f'Previous ZIP backed up: {backup}')
        temporary.replace(OUTPUT)
        print(f'Wrote: {OUTPUT}')
        print(f'ZIP bytes: {OUTPUT.stat().st_size:,}; SHA256: {sha256(OUTPUT)}')
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--dry-run', action='store_true', help='Review files and hashes without writing a ZIP (default).')
    action.add_argument('--write', action='store_true', help='Write the final ZIP after QA is complete.')
    args = parser.parse_args()
    files, skipped = collect_files()
    validate_no_credential_literals(files)
    manifest = manifest_for(files)
    total = sum(row['bytes'] for row in manifest['files'])
    print(f'Version: {manifest["version"]}; appVersion: {manifest["appVersion"]}; iOS build: {manifest["iosBuildNumber"]}; Android code: {manifest["androidVersionCode"]}')
    print(f'Files: {len(files):,}; uncompressed bytes: {total:,}; POIs: {manifest["poiCount"]:,}')
    print('Included: source, all offline map/place data, provenance/NOTICE, docs, both native projects and synthetic test fixtures.')
    print('Excluded categories: ' + ', '.join(f'{key} ({count})' for key, count in sorted(skipped.items())))
    largest = sorted(manifest['files'], key=lambda row: row['bytes'], reverse=True)[:8]
    print('Largest included files: ' + ', '.join(f'{row["path"]} ({row["bytes"]:,})' for row in largest))
    if args.write:
        write_archive(files, manifest)
    else:
        print(f'DRY RUN ONLY; no ZIP or backup written. Final command: python3 scripts/package-source.py --write')


if __name__ == '__main__':
    main()
