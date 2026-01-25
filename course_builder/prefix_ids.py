#!/usr/bin/env python3
"""
ID Prefix Script

Adds "rv_" prefix to all IDs in JSON and CSV files to distinguish them from 
existing production data.

Usage:
    python prefix_ids.py <folder_path>
    python prefix_ids.py final_deliverables_grade3
    python prefix_ids.py final_deliverables_grade3 --dry-run
    python prefix_ids.py final_deliverables_grade3 --prefix "custom_"

Example:
    Before: article_101001, quiz_302005, guiding_21014
    After:  rv_article_101001, rv_quiz_302005, rv_guiding_21014
"""

import os
import sys
import json
import csv
import argparse
from pathlib import Path
from typing import Dict, List, Any, Set
import re
import shutil
from datetime import datetime


# ID fields to prefix in the data
ID_FIELDS = [
    'article_id',
    'question_id', 
    'stimulus_id',
    'section_id',
    'parent_question_id',
    'sourcedId',
    'identifier',
]

# Patterns that indicate an ID value (to catch IDs in any field)
ID_PATTERNS = [
    r'^article_\d+',
    r'^quiz_\d+',
    r'^guiding_\d+',
    r'^test_guiding_\d+',
    r'^test_quiz',
    r'^answer_\d+',
    r'^compres_',
]


def should_prefix_value(value: str, prefix: str) -> bool:
    """Check if a value looks like an ID and doesn't already have the prefix."""
    if not isinstance(value, str) or not value:
        return False
    
    # Already has prefix
    if value.startswith(prefix):
        return False
    
    # Check if it matches any ID pattern
    for pattern in ID_PATTERNS:
        if re.match(pattern, value):
            return True
    
    return False


def prefix_value(value: str, prefix: str) -> str:
    """Add prefix to an ID value."""
    if should_prefix_value(value, prefix):
        return f"{prefix}{value}"
    return value


def process_dict(data: Dict, prefix: str, stats: Dict) -> Dict:
    """Recursively process a dictionary and prefix IDs."""
    result = {}
    
    for key, value in data.items():
        if isinstance(value, dict):
            result[key] = process_dict(value, prefix, stats)
        elif isinstance(value, list):
            result[key] = process_list(value, prefix, stats)
        elif isinstance(value, str):
            # Check if this is an ID field or the value looks like an ID
            if key in ID_FIELDS or should_prefix_value(value, prefix):
                new_value = prefix_value(value, prefix)
                if new_value != value:
                    stats['ids_prefixed'] += 1
                result[key] = new_value
            else:
                result[key] = value
        else:
            result[key] = value
    
    return result


def process_list(data: List, prefix: str, stats: Dict) -> List:
    """Recursively process a list and prefix IDs."""
    result = []
    
    for item in data:
        if isinstance(item, dict):
            result.append(process_dict(item, prefix, stats))
        elif isinstance(item, list):
            result.append(process_list(item, prefix, stats))
        elif isinstance(item, str):
            new_value = prefix_value(item, prefix)
            if new_value != item:
                stats['ids_prefixed'] += 1
            result.append(new_value)
        else:
            result.append(item)
    
    return result


def process_json_file(filepath: Path, prefix: str, dry_run: bool) -> Dict:
    """Process a JSON file and prefix all IDs."""
    stats = {'ids_prefixed': 0, 'file': str(filepath)}
    
    print(f"  Processing JSON: {filepath.name}")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if isinstance(data, list):
        new_data = process_list(data, prefix, stats)
    elif isinstance(data, dict):
        new_data = process_dict(data, prefix, stats)
    else:
        print(f"    ⚠️ Unexpected data type: {type(data)}")
        return stats
    
    if not dry_run and stats['ids_prefixed'] > 0:
        # Backup original
        backup_path = filepath.with_suffix(filepath.suffix + '.backup')
        if not backup_path.exists():
            shutil.copy(filepath, backup_path)
        
        # Write updated file
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(new_data, f, indent=2, ensure_ascii=False)
        print(f"    ✅ Prefixed {stats['ids_prefixed']} IDs")
    else:
        print(f"    {'[DRY RUN] Would prefix' if dry_run else 'Found'} {stats['ids_prefixed']} IDs")
    
    return stats


def process_csv_file(filepath: Path, prefix: str, dry_run: bool) -> Dict:
    """Process a CSV file and prefix all IDs."""
    stats = {'ids_prefixed': 0, 'file': str(filepath)}
    
    print(f"  Processing CSV: {filepath.name}")
    
    # Read CSV
    with open(filepath, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)
    
    if not fieldnames:
        print(f"    ⚠️ No headers found")
        return stats
    
    # Process each row
    new_rows = []
    for row in rows:
        new_row = {}
        for key, value in row.items():
            if key in ID_FIELDS or should_prefix_value(value or '', prefix):
                new_value = prefix_value(value or '', prefix)
                if new_value != value:
                    stats['ids_prefixed'] += 1
                new_row[key] = new_value
            else:
                new_row[key] = value
        new_rows.append(new_row)
    
    if not dry_run and stats['ids_prefixed'] > 0:
        # Backup original
        backup_path = filepath.with_suffix(filepath.suffix + '.backup')
        if not backup_path.exists():
            shutil.copy(filepath, backup_path)
        
        # Write updated file
        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(new_rows)
        print(f"    ✅ Prefixed {stats['ids_prefixed']} IDs")
    else:
        print(f"    {'[DRY RUN] Would prefix' if dry_run else 'Found'} {stats['ids_prefixed']} IDs")
    
    return stats


def process_folder(folder_path: Path, prefix: str, dry_run: bool) -> List[Dict]:
    """Process all JSON and CSV files in a folder."""
    all_stats = []
    
    print(f"\n{'='*60}")
    print(f"ID Prefix Script")
    print(f"{'='*60}")
    print(f"Folder: {folder_path}")
    print(f"Prefix: '{prefix}'")
    print(f"Dry run: {dry_run}")
    print(f"{'='*60}\n")
    
    if not folder_path.exists():
        print(f"❌ Error: Folder does not exist: {folder_path}")
        return all_stats
    
    # Find all JSON and CSV files
    json_files = list(folder_path.glob('*.json'))
    csv_files = list(folder_path.glob('*.csv'))
    
    print(f"Found {len(json_files)} JSON files and {len(csv_files)} CSV files\n")
    
    # Process JSON files
    for filepath in sorted(json_files):
        # Skip backup files
        if '.backup' in filepath.suffixes:
            continue
        stats = process_json_file(filepath, prefix, dry_run)
        all_stats.append(stats)
    
    # Process CSV files
    for filepath in sorted(csv_files):
        if '.backup' in filepath.suffixes:
            continue
        stats = process_csv_file(filepath, prefix, dry_run)
        all_stats.append(stats)
    
    # Summary
    total_prefixed = sum(s['ids_prefixed'] for s in all_stats)
    files_modified = sum(1 for s in all_stats if s['ids_prefixed'] > 0)
    
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"Files processed: {len(all_stats)}")
    print(f"Files with IDs to prefix: {files_modified}")
    print(f"Total IDs {'prefixed' if not dry_run else 'to prefix'}: {total_prefixed}")
    
    if dry_run:
        print(f"\n🔒 This was a DRY RUN - no files were modified")
        print(f"   Run without --dry-run to apply changes")
    else:
        print(f"\n✅ Changes applied. Backup files created with .backup extension")
    
    return all_stats


def main():
    parser = argparse.ArgumentParser(
        description='Add prefix to all IDs in JSON and CSV files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python prefix_ids.py final_deliverables_grade3 --dry-run
  python prefix_ids.py final_deliverables_grade3
  python prefix_ids.py final_deliverables_grade3 --prefix "test_"
        """
    )
    
    parser.add_argument('folder', type=str, help='Folder containing JSON/CSV files')
    parser.add_argument('--prefix', type=str, default='rv_', help='Prefix to add (default: rv_)')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be changed without modifying files')
    
    args = parser.parse_args()
    
    folder_path = Path(args.folder)
    if not folder_path.is_absolute():
        # Make relative to script directory
        script_dir = Path(__file__).parent
        folder_path = script_dir / folder_path
    
    process_folder(folder_path, args.prefix, args.dry_run)


if __name__ == "__main__":
    main()
