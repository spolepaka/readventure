#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["pandas", "requests"]
# ///
"""
Extract pilot data. One table. You decide what's valid.

Usage:
    ./analyze_pilot.py backup.sqlite 2025-12-09 2025-12-19

Requires (for assessments):
    VITE_TIMEBACK_CLIENT_ID
    VITE_TIMEBACK_CLIENT_SECRET
"""

import argparse
import os
import sqlite3
from datetime import datetime

import pandas as pd
import requests

TIMEBACK_API = 'https://api.alpha-1edtech.ai'
TIMEBACK_AUTH = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token'


def load_data(backup_path):
    conn = sqlite3.connect(backup_path)
    players = pd.read_sql("SELECT * FROM player WHERE total_raids > 0", conn)
    raids = pd.read_sql("SELECT * FROM performance_snapshot", conn)
    conn.close()
    return players, raids


def get_token():
    client_id = os.getenv('VITE_TIMEBACK_CLIENT_ID')
    client_secret = os.getenv('VITE_TIMEBACK_CLIENT_SECRET')
    if not client_id or not client_secret:
        return None
    try:
        response = requests.post(
            TIMEBACK_AUTH,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            data={'grant_type': 'client_credentials', 'client_id': client_id, 'client_secret': client_secret}
        )
        return response.json().get('access_token')
    except:
        return None


def fetch_assessments(players, token):
    if not token:
        return pd.DataFrame()
    
    print(f"Fetching assessments for {len(players)} students...", end=" ", flush=True)
    results = []
    for _, player in players.iterrows():
        if pd.isna(player.get('timeback_id')):
            continue
        
        url = f"{TIMEBACK_API}/ims/oneroster/gradebook/v1p2/assessmentResults/?filter=student.sourcedId='{player['timeback_id']}'&limit=3000&sort=scoreDate&orderBy=desc"
        try:
            response = requests.get(url, headers={'Authorization': f'Bearer {token}'}, timeout=15)
            for a in response.json().get('assessmentResults', []):
                metadata = a.get('metadata', {})
                cqpm = metadata.get('cqpm')
                grade = metadata.get('grade')
                if cqpm is not None and grade is not None:
                    source_id = a.get('assessmentLineItem', {}).get('sourcedId', '')
                    track = next((p for p in source_id.split('-') if p.startswith('track')), None)
                    results.append({
                        'player_id': player['id'],
                        'date': a.get('scoreDate', ''),
                        'cqpm': cqpm,
                        'track': track,
                    })
        except:
            continue
    
    print("done")
    return pd.DataFrame(results)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("backup", help="SQLite backup file")
    parser.add_argument("start", help="Pilot start (YYYY-MM-DD)")
    parser.add_argument("end", help="Pilot end (YYYY-MM-DD)")
    args = parser.parse_args()
    
    pilot_days = (datetime.strptime(args.end, '%Y-%m-%d') - datetime.strptime(args.start, '%Y-%m-%d')).days + 1
    
    players, raids = load_data(args.backup)
    token = get_token()
    assessments = fetch_assessments(players, token) if token else pd.DataFrame()
    
    rows = []
    for _, player in players.iterrows():
        p_raids = raids[raids['player_id'] == player['id']].copy()
        
        if len(p_raids) == 0:
            continue
        
        # Engagement
        total_min = p_raids['session_seconds'].sum() / 60
        if 'timestamp' in p_raids.columns:
            active_days = pd.to_datetime(p_raids['timestamp']).dt.date.nunique()
        else:
            active_days = len(p_raids)
        
        # XP (≥80% accuracy)
        p_raids['acc'] = p_raids['problems_correct'] / p_raids['problems_attempted'] * 100
        avg_acc = p_raids['acc'].mean()
        xp_raids = p_raids[p_raids['acc'] >= 80]
        xp_min = xp_raids['session_seconds'].sum() / 60
        
        # MR track (most XP time)
        mr_track = None
        if len(xp_raids) > 0 and 'track' in xp_raids.columns:
            track_time = xp_raids.groupby('track')['session_seconds'].sum()
            if len(track_time) > 0:
                mr_track = track_time.idxmax()
        
        # MR peak (best CQPM from 90s+ raids)
        mr_peak = None
        long_raids = p_raids[p_raids['session_seconds'] >= 90]
        if len(long_raids) > 0:
            long_raids = long_raids.copy()
            long_raids['cqpm'] = long_raids['problems_correct'] / long_raids['session_seconds'] * 60
            mr_peak = round(long_raids['cqpm'].max(), 1)
        
        # Assessments
        pre_cqpm = post_cqpm = pre_track = post_track = None
        if len(assessments) > 0:
            p_assess = assessments[assessments['player_id'] == player['id']]
            if len(p_assess) > 0:
                pre = p_assess[p_assess['date'] < args.start].sort_values('date')
                post = p_assess[p_assess['date'] >= args.end].sort_values('date')
                if len(pre) > 0:
                    pre_cqpm = pre.iloc[-1]['cqpm']
                    pre_track = pre.iloc[-1]['track']
                if len(post) > 0:
                    post_cqpm = post.iloc[0]['cqpm']
                    post_track = post.iloc[0]['track']
        
        # Alignment check
        aligned = "?"
        if mr_track and pre_track and post_track:
            if mr_track == pre_track == post_track:
                aligned = "✓"
            else:
                aligned = "✗"
        elif pre_track and post_track and pre_track == post_track:
            aligned = "~"  # Same test track, but MR different or unknown
        
        xp_pct = round(xp_min / total_min * 100) if total_min > 0 else 0
        
        rows.append({
            'name': player['name'],
            'grade': player['grade'],
            'days': active_days,
            'total_min': round(total_min, 0),
            'xp_min': round(xp_min, 0),
            'xp_pct': xp_pct,
            'acc': round(avg_acc, 0),
            'mr_track': mr_track,
            'mr_peak': mr_peak,
            'pre_track': pre_track,
            'pre': pre_cqpm,
            'post_track': post_track,
            'post': post_cqpm,
            'aligned': aligned,
        })
    
    df = pd.DataFrame(rows)
    df['gain'] = df['post'] - df['pre']
    df['min_per_1'] = df.apply(lambda r: round(r['xp_min'] / r['gain'], 1) if pd.notna(r['gain']) and r['gain'] > 0 else None, axis=1)
    
    # Sort: has gain first (by gain desc), then pre-only, then no data
    df['sort_key'] = df['gain'].fillna(-999)
    df = df.sort_values('sort_key', ascending=False).drop(columns=['sort_key'])
    
    # Output
    print(f"# Pilot Data: {args.start} → {args.end} ({pilot_days} days, {len(df)} students)\n")
    
    # Summary
    with_gain = df[df['gain'].notna()]
    if len(with_gain) > 0:
        avg_gain = with_gain['gain'].mean()
        improvers = (with_gain['gain'] > 0).sum()
        aligned_count = (df['aligned'] == '✓').sum()
        print(f"**Summary:** {len(with_gain)} with pre/post, avg gain: {avg_gain:+.1f}, {improvers}/{len(with_gain)} improved, {aligned_count} fully aligned\n")
    
    # One table
    print("| Student | G | Days | Total | XP | XP% | Acc | MR Track | MR Peak | Pre Trk | Pre | Post Trk | Post | Gain | Min/+1 | Aligned |")
    print("|---------|---|------|-------|----|----|-----|----------|---------|---------|-----|----------|------|------|--------|---------|")
    
    for _, r in df.iterrows():
        mr = r['mr_track'] or "-"
        mr_pk = f"{r['mr_peak']:.1f}" if pd.notna(r['mr_peak']) else "-"
        pre_tr = r['pre_track'] or "-"
        pre_v = f"{r['pre']:.0f}" if pd.notna(r['pre']) else "-"
        post_tr = r['post_track'] or "-"
        post_v = f"{r['post']:.0f}" if pd.notna(r['post']) else "-"
        gain_v = f"{r['gain']:+.0f}" if pd.notna(r['gain']) else "-"
        ratio = f"{r['min_per_1']:.1f}" if pd.notna(r['min_per_1']) else "-"
        
        print(f"| {r['name']} | {r['grade']} | {r['days']} | {r['total_min']:.0f} | {r['xp_min']:.0f} | {r['xp_pct']}% | {r['acc']:.0f}% | {mr} | {mr_pk} | {pre_tr} | {pre_v} | {post_tr} | {post_v} | {gain_v} | {ratio} | {r['aligned']} |")
    
    print()
    print("**Legend:** ✓ = all tracks aligned, ✗ = mismatch, ~ = pre/post same but MR different, ? = incomplete data")


if __name__ == "__main__":
    main()
