#!/usr/bin/env python3
"""
Fetch Complete QTI Structure for an Alpha Read Article

This script fetches the full QTI structure for an article including:
- Assessment test (top-level container)
- All assessment sections
- All assessment items (questions) with full details
- All stimuli (reading passages)
- Raw XML for each component

Usage:
    python fetch_article_qti.py --article-id article_101001
    python fetch_article_qti.py --article-id article_101001 --output my_article.json
"""

import os
import json
import requests
import argparse
from typing import Dict, List, Optional
from datetime import datetime
from pathlib import Path

# API Configuration
QTI_API_BASE_URL = "https://qti.alpha-1edtech.ai/api"
COGNITO_URL = "https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token"

# Default credentials
CLIENT_ID = os.getenv("TIMEBACK_CLIENT_ID", "31rkusu8sloquan3cmcb9p8v33")
CLIENT_SECRET = os.getenv("TIMEBACK_CLIENT_SECRET", "1vv89lcl7lfu151ruccfts4hauefc0r1epdvaotbrgupvcif4cor")

# Paths
SCRIPT_DIR = Path(__file__).parent
OUTPUTS_DIR = SCRIPT_DIR / "outputs" / "qti_dumps"

# Global token
access_token = None


def get_oauth_token() -> str:
    """Get OAuth access token from Cognito."""
    global access_token
    
    if access_token:
        return access_token
    
    print("🔑 Obtaining OAuth token...")
    
    response = requests.post(
        COGNITO_URL,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET
        },
        timeout=30
    )
    response.raise_for_status()
    access_token = response.json()["access_token"]
    print("✅ Token obtained")
    return access_token


def get_auth_headers() -> Dict:
    """Get authorization headers for API requests."""
    return {
        "Authorization": f"Bearer {get_oauth_token()}",
        "Content-Type": "application/json"
    }


def fetch_assessment_test(test_id: str) -> Optional[Dict]:
    """Fetch assessment test with full raw response."""
    print(f"📋 Fetching assessment test: {test_id}")
    
    url = f"{QTI_API_BASE_URL}/assessment-tests/{test_id}"
    
    try:
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        print(f"❌ Error fetching test {test_id}: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"   Response: {e.response.text[:500]}")
        return None


def fetch_assessment_item(item_id: str) -> Optional[Dict]:
    """Fetch a single assessment item with full raw response."""
    print(f"   ❓ Fetching item: {item_id}")
    
    url = f"{QTI_API_BASE_URL}/assessment-items/{item_id}"
    
    try:
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            print(f"   ⚠️ Item not found: {item_id}")
            return None
        print(f"   ❌ Error fetching item {item_id}: {e}")
        return None


def fetch_stimulus(stimulus_id: str) -> Optional[Dict]:
    """Fetch a stimulus with full raw response."""
    print(f"   📄 Fetching stimulus: {stimulus_id}")
    
    url = f"{QTI_API_BASE_URL}/stimuli/{stimulus_id}"
    
    try:
        response = requests.get(url, headers=get_auth_headers(), timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            print(f"   ⚠️ Stimulus not found: {stimulus_id}")
            return None
        print(f"   ❌ Error fetching stimulus {stimulus_id}: {e}")
        return None


def extract_stimulus_ref_from_item(item_data: Dict) -> Optional[str]:
    """Extract stimulus reference identifier from item data or rawXml."""
    import re
    
    # Check if stimulus is directly in item_data
    if item_data.get('stimulus'):
        return item_data['stimulus'].get('identifier')
    
    # Check parsed content for qti-assessment-stimulus-ref
    content = item_data.get('content', {})
    if content:
        item = content.get('qti-assessment-item', {})
        stimulus_ref = item.get('qti-assessment-stimulus-ref', {})
        if isinstance(stimulus_ref, dict):
            attrs = stimulus_ref.get('_attributes', stimulus_ref)
            if attrs.get('identifier'):
                return attrs['identifier']
    
    # Check in rawXml - specifically look for qti-assessment-stimulus-ref
    raw_xml = item_data.get('rawXml', '')
    if 'qti-assessment-stimulus-ref' in raw_xml:
        # Extract identifier from qti-assessment-stimulus-ref element
        match = re.search(r'<qti-assessment-stimulus-ref[^>]+identifier="([^"]+)"', raw_xml)
        if match:
            return match.group(1)
    
    return None


def fetch_complete_article_qti(article_id: str) -> Dict:
    """
    Fetch complete QTI structure for an article.
    
    Returns a comprehensive dict with:
    - assessment_test: The top-level test structure
    - assessment_items: Dict of all items keyed by identifier
    - stimuli: Dict of all stimuli keyed by identifier
    - metadata: Extraction metadata
    """
    result = {
        "metadata": {
            "article_id": article_id,
            "extraction_date": datetime.now().isoformat(),
            "qti_api_url": QTI_API_BASE_URL,
        },
        "assessment_test": None,
        "assessment_items": {},
        "stimuli": {},
        "structure_summary": {
            "total_sections": 0,
            "total_items": 0,
            "total_stimuli": 0,
            "sections": []
        }
    }
    
    # 1. Fetch the assessment test
    test_data = fetch_assessment_test(article_id)
    if not test_data:
        print(f"❌ Could not fetch assessment test: {article_id}")
        return result
    
    result["assessment_test"] = test_data
    
    # 2. Process each test part and section
    collected_stimulus_ids = set()
    
    for test_part in test_data.get('qti-test-part', []):
        for section in test_part.get('qti-assessment-section', []):
            section_id = section.get('identifier', 'unknown')
            section_title = section.get('title', 'Unknown')
            
            result["structure_summary"]["total_sections"] += 1
            section_summary = {
                "identifier": section_id,
                "title": section_title,
                "sequence": section.get('sequence'),
                "item_count": 0,
                "item_ids": [],
                "stimulus_id": None
            }
            
            print(f"\n📂 Section: {section_title} ({section_id})")
            
            # 3. Fetch each item in the section
            for item_ref in section.get('qti-assessment-item-ref', []):
                item_id = item_ref.get('identifier')
                if not item_id:
                    continue
                
                item_data = fetch_assessment_item(item_id)
                if item_data:
                    result["assessment_items"][item_id] = item_data
                    result["structure_summary"]["total_items"] += 1
                    section_summary["item_count"] += 1
                    section_summary["item_ids"].append(item_id)
                    
                    # Extract stimulus reference
                    stimulus_id = extract_stimulus_ref_from_item(item_data)
                    if stimulus_id:
                        collected_stimulus_ids.add(stimulus_id)
                        section_summary["stimulus_id"] = stimulus_id
            
            result["structure_summary"]["sections"].append(section_summary)
    
    # 4. Fetch all unique stimuli
    print(f"\n📚 Fetching {len(collected_stimulus_ids)} stimuli...")
    for stimulus_id in sorted(collected_stimulus_ids):
        stimulus_data = fetch_stimulus(stimulus_id)
        if stimulus_data:
            result["stimuli"][stimulus_id] = stimulus_data
            result["structure_summary"]["total_stimuli"] += 1
    
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Fetch complete QTI structure for an Alpha Read article'
    )
    parser.add_argument('--article-id', type=str, default='article_101001',
                        help='Article ID to fetch (default: article_101001)')
    parser.add_argument('--output', type=str, default=None,
                        help='Output JSON file path')
    
    args = parser.parse_args()
    
    # Ensure output directory exists
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Determine output path
    output_file = args.output or str(OUTPUTS_DIR / f"{args.article_id}_complete_qti.json")
    
    print("="*60)
    print("FETCH COMPLETE QTI STRUCTURE")
    print("="*60)
    print(f"Article ID: {args.article_id}")
    print(f"Output: {output_file}")
    print("="*60)
    
    # Fetch complete structure
    result = fetch_complete_article_qti(args.article_id)
    
    # Save to file
    print(f"\n💾 Saving to: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    # Print summary
    print("\n" + "="*60)
    print("EXTRACTION COMPLETE")
    print("="*60)
    print(f"   Sections: {result['structure_summary']['total_sections']}")
    print(f"   Items: {result['structure_summary']['total_items']}")
    print(f"   Stimuli: {result['structure_summary']['total_stimuli']}")
    print(f"   Output: {output_file}")
    print("="*60)
    
    # Print section breakdown
    print("\nSection Breakdown:")
    for section in result['structure_summary']['sections']:
        print(f"  {section['sequence']}. {section['title']}")
        print(f"     Items: {section['item_count']} | Stimulus: {section['stimulus_id'] or 'None'}")
    
    return result


if __name__ == "__main__":
    main()
