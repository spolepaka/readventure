#!/usr/bin/env python3
"""
QC Dashboard v2 - Smart Data Analysis Tool
==========================================
An interactive dashboard for analyzing QC results with visual insights,
filtering, grouping, and drill-down capabilities.

Run with: streamlit run qc_dashboard_v2.py
"""

import streamlit as st
import pandas as pd
import json
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from pathlib import Path
from typing import Dict, List, Any, Optional
from collections import Counter
import re

# Page config
st.set_page_config(
    page_title="QC Analysis Dashboard v2",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for better styling
st.markdown("""
<style>
    .metric-card {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 10px;
        padding: 20px;
        border: 1px solid #0f3460;
    }
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
    }
    .stTabs [data-baseweb="tab"] {
        background-color: #1a1a2e;
        border-radius: 8px;
        padding: 10px 20px;
    }
    .stTabs [aria-selected="true"] {
        background-color: #0f3460;
    }
    div[data-testid="stMetricValue"] {
        font-size: 2.5rem;
    }
    .insight-box {
        background: #1a1a2e;
        border-left: 4px solid #e94560;
        padding: 15px;
        margin: 10px 0;
        border-radius: 0 8px 8px 0;
    }
</style>
""", unsafe_allow_html=True)

# Constants
DEFAULT_RESULTS_DIR = Path("outputs/qc_results")
PASS_THRESHOLD = 0.8

CHECK_DESCRIPTIONS = {
    'grammatical_parallel': 'All options follow same grammar pattern',
    'plausibility': 'Distractors are believable but wrong',
    'homogeneity': 'All options from same category',
    'specificity_balance': 'Options have similar detail levels',
    'standard_alignment': 'Question matches CCSS standard',
    'clarity_precision': 'Question is clear and unambiguous',
    'single_correct_answer': 'Only one answer is correct',
    'passage_reference': 'References actual passage content',
    'too_close': 'Distractors not too similar to correct',
    'difficulty_assessment': 'Appropriate for grade level',
    'length_check': 'Answer lengths are balanced'
}

CHECK_CATEGORIES = {
    'distractor': ['grammatical_parallel', 'plausibility', 'homogeneity', 'specificity_balance', 'too_close', 'length_check'],
    'question': ['standard_alignment', 'clarity_precision', 'single_correct_answer', 'passage_reference', 'difficulty_assessment']
}


@st.cache_data
def load_qc_data(results_dir: Path) -> tuple:
    """Load all QC data from the results directory."""
    question_qc = []
    explanation_qc = {}
    
    # Load question QC
    qc_path = results_dir / "question_qc_merged.json"
    if qc_path.exists():
        with open(qc_path, 'r') as f:
            question_qc = json.load(f)
    
    # Load explanation QC
    exp_path = results_dir / "explanation_qc_merged.json"
    if exp_path.exists():
        with open(exp_path, 'r') as f:
            explanation_qc = json.load(f)
    
    return question_qc, explanation_qc


@st.cache_data
def load_question_bank(results_dir: Path) -> Optional[pd.DataFrame]:
    """Load the question bank CSV."""
    possible_paths = [
        results_dir.parent / "qb_extended_all_131_rewritten.csv",
        results_dir.parent / "qb_extended_rewritten.csv",
        results_dir.parent / "qb_extended_combined.csv",
    ]
    
    for path in possible_paths:
        if path.exists():
            return pd.read_csv(path)
    return None


def get_source(question_id: str) -> str:
    """Determine if question is original or generated."""
    return "generated" if "_sibling_" in question_id else "original"


def process_qc_data(qc_data: List[Dict]) -> pd.DataFrame:
    """Process QC data into a DataFrame for analysis."""
    records = []
    
    for q in qc_data:
        qid = q.get('question_id', '')
        checks = q.get('checks', {})
        
        record = {
            'question_id': qid,
            'source': get_source(qid),
            'article_id': q.get('article_id', ''),
            'overall_score': q.get('overall_score', 0),
            'passed': q.get('overall_score', 0) >= PASS_THRESHOLD,
            'total_checks': q.get('total_checks_run', 11),
            'passed_checks': q.get('total_checks_passed', 0),
            'question_preview': q.get('question_preview', '')[:100],
        }
        
        # Add individual check results
        for check_name in CHECK_DESCRIPTIONS.keys():
            check_data = checks.get(check_name, {})
            if isinstance(check_data, dict):
                record[f'{check_name}_passed'] = check_data.get('score', 1) == 1
                record[f'{check_name}_reason'] = check_data.get('response', '')
            else:
                record[f'{check_name}_passed'] = True
                record[f'{check_name}_reason'] = ''
        
        records.append(record)
    
    return pd.DataFrame(records)


def extract_failure_patterns(df: pd.DataFrame, check_name: str, top_n: int = 5) -> List[Dict]:
    """Extract common patterns from failure reasons."""
    failed_reasons = df[~df[f'{check_name}_passed']][f'{check_name}_reason'].dropna().tolist()
    
    if not failed_reasons:
        return []
    
    # Simple pattern extraction - group by key phrases
    patterns = Counter()
    for reason in failed_reasons:
        # Extract first sentence or key phrase
        reason_lower = reason.lower()[:200]
        
        # Common pattern keywords
        if 'too long' in reason_lower or 'too short' in reason_lower:
            patterns['Length imbalance'] += 1
        elif 'not plausible' in reason_lower or 'obviously wrong' in reason_lower or 'implausible' in reason_lower:
            patterns['Obviously wrong/implausible'] += 1
        elif 'grammar' in reason_lower or 'grammatical' in reason_lower:
            patterns['Grammar mismatch'] += 1
        elif 'alignment' in reason_lower or 'standard' in reason_lower or 'rl.' in reason_lower or 'ri.' in reason_lower:
            patterns['Standard mismatch'] += 1
        elif 'difficult' in reason_lower or 'grade' in reason_lower or 'advanced' in reason_lower:
            patterns['Difficulty inappropriate'] += 1
        elif 'similar' in reason_lower or 'close' in reason_lower:
            patterns['Options too similar'] += 1
        elif 'ambiguous' in reason_lower or 'unclear' in reason_lower:
            patterns['Ambiguous wording'] += 1
        elif 'passage' in reason_lower or 'text' in reason_lower:
            patterns['Passage reference issue'] += 1
        elif 'multiple' in reason_lower or 'correct' in reason_lower:
            patterns['Multiple correct answers'] += 1
        else:
            patterns['Other issues'] += 1
    
    return [{'pattern': p, 'count': c} for p, c in patterns.most_common(top_n)]


# ============================================================
# MAIN APP
# ============================================================

def main():
    st.title("📊 QC Analysis Dashboard v2")
    st.caption("Smart data analysis for question quality control")
    
    # Sidebar
    with st.sidebar:
        st.header("⚙️ Configuration")
        
        results_dir = st.text_input(
            "Results Directory",
            value=str(DEFAULT_RESULTS_DIR),
            help="Path to QC results folder"
        )
        results_path = Path(results_dir)
        
        st.divider()
        
        # Load data
        with st.spinner("Loading data..."):
            qc_data, exp_qc = load_qc_data(results_path)
            question_bank = load_question_bank(results_path)
        
        if not qc_data:
            st.error("❌ No QC data found!")
            return
        
        # Process data
        df = process_qc_data(qc_data)
        
        # Show loaded files
        st.subheader("📁 Loaded Files")
        
        qc_file = results_path / "question_qc_merged.json"
        exp_file = results_path / "explanation_qc_merged.json"
        
        if qc_file.exists():
            st.success(f"✅ Question QC: {len(qc_data):,} questions")
        else:
            st.error("❌ Question QC: Not found")
        
        if exp_file.exists():
            st.success(f"✅ Explanation QC: {len(exp_qc):,} items")
        else:
            st.warning("⚠️ Explanation QC: Not found")
        
        if question_bank is not None:
            st.success(f"✅ Question Bank: {len(question_bank):,} rows")
        else:
            st.warning("⚠️ Question Bank CSV: Not found")
        
        st.divider()
        
        # Pass threshold
        st.subheader("🎯 Pass Threshold")
        pass_threshold_pct = st.slider(
            "Score threshold",
            min_value=50,
            max_value=100,
            value=80,
            step=5,
            format="%d%%",
            help="Questions scoring at or above this threshold are considered 'Passed'"
        )
        global PASS_THRESHOLD
        PASS_THRESHOLD = pass_threshold_pct / 100.0
        
        st.divider()
        
        # Summary stats
        st.subheader("📊 Quick Stats")
        total_q = len(df)
        passed_q = len(df[df['overall_score'] >= PASS_THRESHOLD])
        st.metric("Total Questions", f"{total_q:,}")
        st.metric("Passing", f"{passed_q:,}", delta=f"{passed_q/total_q*100:.1f}%")
        
        # Use full dataset (filters will be per-tab)
        filtered_df = df.copy()
        # Recalculate passed based on threshold
        filtered_df['passed'] = filtered_df['overall_score'] >= PASS_THRESHOLD
    
    # Main content - Tabs
    tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs([
        "🏠 Overview",
        "🔍 Failure Analysis", 
        "⚔️ Original vs Generated",
        "📚 By Article",
        "🔬 Question Inspector",
        "📈 Patterns & Insights"
    ])
    
    # ============================================================
    # TAB 1: OVERVIEW
    # ============================================================
    with tab1:
        st.header("🏠 Overview")
        
        # Calculate stats for ALL data
        total = len(filtered_df)
        passed = len(filtered_df[filtered_df['passed']])
        failed = total - passed
        pass_rate = (passed / total * 100) if total > 0 else 0
        avg_score = filtered_df['overall_score'].mean() * 100
        
        # Original stats
        orig_df = filtered_df[filtered_df['source'] == 'original']
        orig_total = len(orig_df)
        orig_passed = len(orig_df[orig_df['passed']])
        orig_failed = orig_total - orig_passed
        orig_pass_rate = (orig_passed / orig_total * 100) if orig_total > 0 else 0
        
        # Generated stats
        gen_df = filtered_df[filtered_df['source'] == 'generated']
        gen_total = len(gen_df)
        gen_passed = len(gen_df[gen_df['passed']])
        gen_failed = gen_total - gen_passed
        gen_pass_rate = (gen_passed / gen_total * 100) if gen_total > 0 else 0
        
        # ========== TOP SUMMARY BOX ==========
        st.markdown("""
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #0d2137 100%); 
                    border-radius: 15px; padding: 25px; margin-bottom: 20px;
                    border: 2px solid #2d5a87;">
        """, unsafe_allow_html=True)
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("### 📊 Overall")
            st.markdown(f"""
            **Total:** {total:,} questions  
            **Passed:** {passed:,} ({pass_rate:.1f}%)  
            **Failed:** {failed:,} ({100-pass_rate:.1f}%)
            """)
        
        with col2:
            st.markdown("### 📝 Original Questions")
            orig_color = "🟢" if orig_pass_rate >= 90 else ("🟡" if orig_pass_rate >= 80 else "🔴")
            st.markdown(f"""
            **Total:** {orig_total:,} questions  
            **Passed:** {orig_passed:,} ({orig_pass_rate:.1f}%) {orig_color}  
            **Failed:** {orig_failed:,} ({100-orig_pass_rate:.1f}%)
            """)
        
        with col3:
            st.markdown("### ✨ Generated Questions")
            gen_color = "🟢" if gen_pass_rate >= 90 else ("🟡" if gen_pass_rate >= 80 else "🔴")
            st.markdown(f"""
            **Total:** {gen_total:,} questions  
            **Passed:** {gen_passed:,} ({gen_pass_rate:.1f}%) {gen_color}  
            **Failed:** {gen_failed:,} ({100-gen_pass_rate:.1f}%)
            """)
        
        st.markdown("</div>", unsafe_allow_html=True)
        
        # Key metrics cards
        st.divider()
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            st.metric("Total Questions", f"{total:,}")
        with col2:
            st.metric("Overall Pass Rate", f"{pass_rate:.1f}%")
        with col3:
            st.metric("Avg Score", f"{avg_score:.1f}%")
        with col4:
            st.metric("Articles", filtered_df['article_id'].nunique())
        
        st.divider()
        
        # Charts
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("📊 Pass/Fail by Source")
            
            source_stats = pd.DataFrame({
                'source': ['Original', 'Generated'],
                'passed': [orig_passed, gen_passed],
                'failed': [orig_failed, gen_failed],
                'pass_rate': [orig_pass_rate, gen_pass_rate]
            })
            
            fig = go.Figure()
            fig.add_trace(go.Bar(
                name='Passed',
                x=source_stats['source'],
                y=source_stats['passed'],
                marker_color='#00d26a',
                text=source_stats.apply(lambda r: f"{r['passed']:,} ({r['pass_rate']:.1f}%)", axis=1),
                textposition='inside',
                textfont=dict(size=14, color='white')
            ))
            fig.add_trace(go.Bar(
                name='Failed',
                x=source_stats['source'],
                y=source_stats['failed'],
                marker_color='#e94560',
                text=source_stats['failed'].apply(lambda x: f"{x:,}"),
                textposition='inside',
                textfont=dict(size=14, color='white')
            ))
            fig.update_layout(
                barmode='stack',
                height=350,
                showlegend=True,
                legend=dict(orientation='h', yanchor='bottom', y=1.02)
            )
            st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            st.subheader("📈 Score Distribution")
            
            fig = px.histogram(
                filtered_df,
                x='overall_score',
                nbins=20,
                color='source',
                color_discrete_map={'original': '#e94560', 'generated': '#00d26a'},
                opacity=0.7,
                labels={'overall_score': 'Score', 'source': 'Source'}
            )
            fig.add_vline(x=PASS_THRESHOLD, line_dash="dash", line_color="yellow",
                         annotation_text=f"Pass threshold ({PASS_THRESHOLD*100:.0f}%)")
            fig.update_layout(height=350, bargap=0.1)
            st.plotly_chart(fig, use_container_width=True)
    
    # ============================================================
    # TAB 2: FAILURE ANALYSIS
    # ============================================================
    with tab2:
        st.header("🔍 Failure Analysis")
        
        # Source toggle
        failure_source = st.radio(
            "Analyze failures for:",
            ['All', 'Original Only', 'Generated Only'],
            horizontal=True
        )
        
        if failure_source == 'Original Only':
            analysis_df = filtered_df[filtered_df['source'] == 'original']
        elif failure_source == 'Generated Only':
            analysis_df = filtered_df[filtered_df['source'] == 'generated']
        else:
            analysis_df = filtered_df
        
        st.divider()
        
        # Calculate failure counts per check
        check_failures = {}
        for check_name in CHECK_DESCRIPTIONS.keys():
            col_name = f'{check_name}_passed'
            if col_name in analysis_df.columns:
                failed_count = len(analysis_df[~analysis_df[col_name]])
                check_failures[check_name] = failed_count
        
        # Sort by failure count
        sorted_checks = sorted(check_failures.items(), key=lambda x: x[1], reverse=True)
        
        col1, col2 = st.columns([2, 1])
        
        with col1:
            st.subheader("📊 Failures by Check Type")
            
            check_df = pd.DataFrame(sorted_checks, columns=['check', 'failures'])
            check_df['description'] = check_df['check'].map(CHECK_DESCRIPTIONS)
            
            fig = px.bar(
                check_df,
                y='check',
                x='failures',
                orientation='h',
                color='failures',
                color_continuous_scale='Reds',
                hover_data=['description']
            )
            fig.update_layout(height=500, yaxis={'categoryorder': 'total ascending'})
            st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            st.subheader("📝 Check Categories")
            
            distractor_fails = sum(check_failures.get(c, 0) for c in CHECK_CATEGORIES['distractor'])
            question_fails = sum(check_failures.get(c, 0) for c in CHECK_CATEGORIES['question'])
            
            fig = go.Figure(data=[go.Pie(
                labels=['Distractor Issues', 'Question Issues'],
                values=[distractor_fails, question_fails],
                marker_colors=['#e94560', '#f39c12'],
                hole=0.4
            )])
            fig.update_layout(height=300)
            st.plotly_chart(fig, use_container_width=True)
            
            st.markdown(f"""
            **Distractor Issues:** {distractor_fails:,}
            - Grammar, plausibility, homogeneity, length
            
            **Question Issues:** {question_fails:,}
            - Standard alignment, clarity, correctness
            """)
        
        st.divider()
        
        # Drill-down: Select a check to see WHY it's failing
        st.subheader("🔎 Drill Down: Why Checks Fail")
        
        selected_check = st.selectbox(
            "Select a check to analyze failure reasons:",
            options=[c for c, _ in sorted_checks if check_failures.get(c, 0) > 0],
            format_func=lambda x: f"{x} ({check_failures.get(x, 0)} failures)"
        )
        
        if selected_check:
            patterns = extract_failure_patterns(analysis_df, selected_check)
            
            if patterns:
                col1, col2 = st.columns(2)
                
                with col1:
                    st.markdown(f"**Common failure patterns for `{selected_check}`:**")
                    pattern_df = pd.DataFrame(patterns)
                    fig = px.pie(pattern_df, names='pattern', values='count',
                                color_discrete_sequence=px.colors.sequential.Reds_r)
                    fig.update_layout(height=300)
                    st.plotly_chart(fig, use_container_width=True)
                
                with col2:
                    st.markdown("**Sample failure reasons:**")
                    failed_samples = analysis_df[~analysis_df[f'{selected_check}_passed']][
                        ['question_id', f'{selected_check}_reason']
                    ].head(5)
                    
                    for _, row in failed_samples.iterrows():
                        with st.expander(f"📝 {row['question_id']}"):
                            st.write(row[f'{selected_check}_reason'][:500])
    
    # ============================================================
    # TAB 3: ORIGINAL VS GENERATED
    # ============================================================
    with tab3:
        st.header("⚔️ Original vs Generated Comparison")
        
        orig_df = filtered_df[filtered_df['source'] == 'original']
        gen_df = filtered_df[filtered_df['source'] == 'generated']
        
        if len(orig_df) == 0 or len(gen_df) == 0:
            st.warning("Need both original and generated questions for comparison")
        else:
            # Radar chart comparison
            st.subheader("📊 Check Pass Rates Comparison")
            
            # Calculate pass rates per check for each source
            check_names = list(CHECK_DESCRIPTIONS.keys())
            orig_rates = []
            gen_rates = []
            
            for check in check_names:
                col = f'{check}_passed'
                if col in orig_df.columns:
                    orig_rates.append(orig_df[col].mean() * 100)
                    gen_rates.append(gen_df[col].mean() * 100)
                else:
                    orig_rates.append(100)
                    gen_rates.append(100)
            
            fig = go.Figure()
            
            fig.add_trace(go.Scatterpolar(
                r=orig_rates,
                theta=check_names,
                fill='toself',
                name='Original',
                line_color='#e94560'
            ))
            
            fig.add_trace(go.Scatterpolar(
                r=gen_rates,
                theta=check_names,
                fill='toself',
                name='Generated',
                line_color='#00d26a'
            ))
            
            fig.update_layout(
                polar=dict(radialaxis=dict(visible=True, range=[0, 100])),
                showlegend=True,
                height=500
            )
            
            st.plotly_chart(fig, use_container_width=True)
            
            # Detailed comparison table
            st.subheader("📋 Check-by-Check Comparison")
            
            comparison_data = []
            for i, check in enumerate(check_names):
                orig_rate = orig_rates[i]
                gen_rate = gen_rates[i]
                diff = gen_rate - orig_rate
                
                comparison_data.append({
                    'Check': check,
                    'Original': f"{orig_rate:.1f}%",
                    'Generated': f"{gen_rate:.1f}%",
                    'Δ (Gen - Orig)': f"{diff:+.1f}%",
                    'Winner': '🟢 Generated' if diff > 0 else ('🔴 Original' if diff < 0 else '🟡 Tie')
                })
            
            comparison_df = pd.DataFrame(comparison_data)
            st.dataframe(comparison_df, use_container_width=True, hide_index=True)
            
            # Summary insights
            st.subheader("💡 Key Insights")
            
            gen_wins = sum(1 for d in comparison_data if 'Generated' in d['Winner'])
            orig_wins = sum(1 for d in comparison_data if 'Original' in d['Winner'])
            
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Checks where Generated is better", gen_wins)
            with col2:
                st.metric("Checks where Original is better", orig_wins)
            with col3:
                st.metric("Ties", len(check_names) - gen_wins - orig_wins)
    
    # ============================================================
    # TAB 4: BY ARTICLE
    # ============================================================
    with tab4:
        st.header("📚 Article Analysis")
        
        # Article summary
        article_stats = filtered_df.groupby('article_id').agg({
            'passed': ['sum', 'count'],
            'overall_score': 'mean'
        }).reset_index()
        article_stats.columns = ['article_id', 'passed', 'total', 'avg_score']
        article_stats['failed'] = article_stats['total'] - article_stats['passed']
        article_stats['pass_rate'] = article_stats['passed'] / article_stats['total'] * 100
        article_stats = article_stats.sort_values('failed', ascending=False)
        
        col1, col2 = st.columns([2, 1])
        
        with col1:
            st.subheader("📊 Articles with Most Failures")
            
            top_failing = article_stats[article_stats['failed'] > 0].head(15)
            
            fig = px.bar(
                top_failing,
                x='article_id',
                y='failed',
                color='pass_rate',
                color_continuous_scale='RdYlGn',
                hover_data=['total', 'passed', 'avg_score']
            )
            fig.update_layout(height=400, xaxis_tickangle=-45)
            st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            st.subheader("📈 Article Stats")
            
            perfect_articles = len(article_stats[article_stats['failed'] == 0])
            problem_articles = len(article_stats[article_stats['failed'] >= 2])
            
            st.metric("Perfect Articles (0 failures)", perfect_articles)
            st.metric("Problem Articles (2+ failures)", problem_articles)
            st.metric("Avg Questions/Article", f"{article_stats['total'].mean():.1f}")
        
        st.divider()
        
        # Article heatmap
        st.subheader("🗺️ Article × Check Heatmap")
        
        # Build heatmap data
        heatmap_data = []
        for article in article_stats['article_id'].head(20):  # Top 20 articles
            article_df = filtered_df[filtered_df['article_id'] == article]
            row = {'article_id': article}
            for check in CHECK_DESCRIPTIONS.keys():
                col = f'{check}_passed'
                if col in article_df.columns:
                    row[check] = len(article_df[~article_df[col]])
            heatmap_data.append(row)
        
        heatmap_df = pd.DataFrame(heatmap_data).set_index('article_id')
        
        if not heatmap_df.empty:
            fig = px.imshow(
                heatmap_df,
                labels=dict(x="Check", y="Article", color="Failures"),
                color_continuous_scale='Reds',
                aspect='auto'
            )
            fig.update_layout(height=500)
            st.plotly_chart(fig, use_container_width=True)
        
        st.divider()
        
        # Article deep dive
        st.subheader("🔎 Article Deep Dive")
        
        selected_article = st.selectbox(
            "Select an article to explore:",
            options=article_stats['article_id'].tolist(),
            format_func=lambda x: f"{x} ({article_stats[article_stats['article_id']==x]['failed'].values[0]} failures)"
        )
        
        if selected_article:
            article_questions = filtered_df[filtered_df['article_id'] == selected_article].sort_values('overall_score')
            
            st.markdown(f"**{len(article_questions)} questions in this article:**")
            
            # Show questions
            for _, row in article_questions.iterrows():
                status = "✅" if row['passed'] else "❌"
                score_pct = row['overall_score'] * 100
                
                with st.expander(f"{status} {row['question_id']} | {score_pct:.0f}%"):
                    st.write(f"**Preview:** {row['question_preview']}")
                    st.write(f"**Source:** {row['source']}")
                    
                    # Show failed checks
                    failed_checks = []
                    for check in CHECK_DESCRIPTIONS.keys():
                        if not row.get(f'{check}_passed', True):
                            failed_checks.append(check)
                    
                    if failed_checks:
                        st.error(f"**Failed checks:** {', '.join(failed_checks)}")
    
    # ============================================================
    # TAB 5: QUESTION INSPECTOR
    # ============================================================
    with tab5:
        st.header("🔬 Question Inspector")
        
        # Filters
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            status_filter = st.selectbox(
                "Status",
                ['All', 'Passed Only', 'Failed Only']
            )
        
        with col2:
            article_filter = st.selectbox(
                "Article",
                ['All'] + sorted(filtered_df['article_id'].unique().tolist())
            )
        
        with col3:
            sort_by = st.selectbox(
                "Sort by",
                ['Score (Low to High)', 'Score (High to Low)', 'Question ID']
            )
        
        with col4:
            check_filter = st.multiselect(
                "Must have failed:",
                options=list(CHECK_DESCRIPTIONS.keys())
            )
        
        # Apply filters
        inspector_df = filtered_df.copy()
        
        if status_filter == 'Passed Only':
            inspector_df = inspector_df[inspector_df['passed']]
        elif status_filter == 'Failed Only':
            inspector_df = inspector_df[~inspector_df['passed']]
        
        if article_filter != 'All':
            inspector_df = inspector_df[inspector_df['article_id'] == article_filter]
        
        for check in check_filter:
            col = f'{check}_passed'
            if col in inspector_df.columns:
                inspector_df = inspector_df[~inspector_df[col]]
        
        # Sort
        if sort_by == 'Score (Low to High)':
            inspector_df = inspector_df.sort_values('overall_score')
        elif sort_by == 'Score (High to Low)':
            inspector_df = inspector_df.sort_values('overall_score', ascending=False)
        else:
            inspector_df = inspector_df.sort_values('question_id')
        
        st.info(f"📋 Showing {len(inspector_df)} questions")
        
        # Display questions
        for _, row in inspector_df.head(50).iterrows():
            status = "✅" if row['passed'] else "❌"
            score_pct = row['overall_score'] * 100
            
            # Count failed checks
            failed_count = sum(1 for c in CHECK_DESCRIPTIONS.keys() 
                             if not row.get(f'{c}_passed', True))
            
            with st.expander(
                f"{status} **{row['question_id']}** | Score: {score_pct:.0f}% | "
                f"{row['source'].upper()} | {failed_count} failed checks"
            ):
                col1, col2 = st.columns([2, 1])
                
                with col1:
                    st.markdown(f"**Question:** {row['question_preview']}...")
                    st.markdown(f"**Article:** {row['article_id']}")
                    
                    # Get full question data if available
                    if question_bank is not None:
                        q_data = question_bank[question_bank['question_id'] == row['question_id']]
                        if len(q_data) > 0:
                            q = q_data.iloc[0]
                            st.markdown("---")
                            st.markdown(f"**Full Question:** {q.get('question', 'N/A')}")
                            st.markdown(f"""
                            - A) {q.get('option_1', 'N/A')}
                            - B) {q.get('option_2', 'N/A')}
                            - C) {q.get('option_3', 'N/A')}
                            - D) {q.get('option_4', 'N/A')}
                            
                            **Correct:** {q.get('correct_answer', 'N/A')}
                            """)
                
                with col2:
                    st.markdown("**Check Results:**")
                    for check in CHECK_DESCRIPTIONS.keys():
                        passed = row.get(f'{check}_passed', True)
                        icon = "✅" if passed else "❌"
                        st.markdown(f"{icon} {check}")
                
                # Show failure reasons
                st.markdown("---")
                st.markdown("**Failure Details:**")
                for check in CHECK_DESCRIPTIONS.keys():
                    if not row.get(f'{check}_passed', True):
                        reason = row.get(f'{check}_reason', 'No reason provided')
                        st.error(f"**{check}:** {reason[:300]}...")
    
    # ============================================================
    # TAB 6: PATTERNS & INSIGHTS
    # ============================================================
    with tab6:
        st.header("📈 Patterns & Insights")
        
        if question_bank is not None:
            # Merge with question bank for more analysis
            merged_df = filtered_df.merge(
                question_bank[['question_id', 'CCSS', 'DOK', 'question_category']],
                on='question_id',
                how='left'
            )
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("📚 By CCSS Standard")
                
                if 'CCSS' in merged_df.columns:
                    ccss_stats = merged_df.groupby('CCSS').agg({
                        'passed': ['sum', 'count']
                    }).reset_index()
                    ccss_stats.columns = ['CCSS', 'passed', 'total']
                    ccss_stats['pass_rate'] = ccss_stats['passed'] / ccss_stats['total'] * 100
                    ccss_stats = ccss_stats.sort_values('pass_rate')
                    
                    fig = px.bar(
                        ccss_stats,
                        y='CCSS',
                        x='pass_rate',
                        orientation='h',
                        color='pass_rate',
                        color_continuous_scale='RdYlGn',
                        range_color=[70, 100]
                    )
                    fig.update_layout(height=400, yaxis={'categoryorder': 'total ascending'})
                    st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                st.subheader("🎯 By DOK Level")
                
                if 'DOK' in merged_df.columns:
                    dok_stats = merged_df.groupby('DOK').agg({
                        'passed': ['sum', 'count']
                    }).reset_index()
                    dok_stats.columns = ['DOK', 'passed', 'total']
                    dok_stats['pass_rate'] = dok_stats['passed'] / dok_stats['total'] * 100
                    
                    fig = px.bar(
                        dok_stats,
                        x='DOK',
                        y='pass_rate',
                        color='pass_rate',
                        color_continuous_scale='RdYlGn',
                        range_color=[70, 100],
                        text='pass_rate'
                    )
                    fig.update_traces(texttemplate='%{text:.1f}%', textposition='outside')
                    fig.update_layout(height=400)
                    st.plotly_chart(fig, use_container_width=True)
        
        st.divider()
        
        # Auto-generated insights
        st.subheader("💡 Auto-Generated Insights")
        
        insights = []
        
        # Insight 1: Best and worst checks
        check_pass_rates = {}
        for check in CHECK_DESCRIPTIONS.keys():
            col = f'{check}_passed'
            if col in filtered_df.columns:
                check_pass_rates[check] = filtered_df[col].mean() * 100
        
        if check_pass_rates:
            best_check = max(check_pass_rates, key=check_pass_rates.get)
            worst_check = min(check_pass_rates, key=check_pass_rates.get)
            insights.append(f"✅ **Best performing check:** `{best_check}` ({check_pass_rates[best_check]:.1f}% pass rate)")
            insights.append(f"❌ **Most problematic check:** `{worst_check}` ({check_pass_rates[worst_check]:.1f}% pass rate)")
        
        # Insight 2: Source comparison
        orig_pass = filtered_df[filtered_df['source'] == 'original']['passed'].mean() * 100 if len(filtered_df[filtered_df['source'] == 'original']) > 0 else 0
        gen_pass = filtered_df[filtered_df['source'] == 'generated']['passed'].mean() * 100 if len(filtered_df[filtered_df['source'] == 'generated']) > 0 else 0
        
        if gen_pass > orig_pass:
            insights.append(f"🚀 **Generated questions outperform originals** by {gen_pass - orig_pass:.1f} percentage points")
        elif orig_pass > gen_pass:
            insights.append(f"📝 **Original questions outperform generated** by {orig_pass - gen_pass:.1f} percentage points")
        
        # Insight 3: Article variability
        article_pass_rates = filtered_df.groupby('article_id')['passed'].mean() * 100
        if len(article_pass_rates) > 1:
            best_article = article_pass_rates.idxmax()
            worst_article = article_pass_rates.idxmin()
            insights.append(f"🏆 **Best article:** `{best_article}` ({article_pass_rates[best_article]:.1f}% pass rate)")
            insights.append(f"⚠️ **Needs attention:** `{worst_article}` ({article_pass_rates[worst_article]:.1f}% pass rate)")
        
        # Display insights
        for insight in insights:
            st.markdown(f"""
            <div class="insight-box">
            {insight}
            </div>
            """, unsafe_allow_html=True)
        
        st.divider()
        
        # Correlation analysis
        st.subheader("🔗 Check Correlations")
        st.caption("Which checks tend to fail together?")
        
        # Build correlation matrix
        check_cols = [f'{c}_passed' for c in CHECK_DESCRIPTIONS.keys() if f'{c}_passed' in filtered_df.columns]
        if check_cols:
            corr_df = filtered_df[check_cols].corr()
            corr_df.columns = [c.replace('_passed', '') for c in corr_df.columns]
            corr_df.index = [c.replace('_passed', '') for c in corr_df.index]
            
            fig = px.imshow(
                corr_df,
                color_continuous_scale='RdBu',
                range_color=[-1, 1],
                aspect='auto'
            )
            fig.update_layout(height=500)
            st.plotly_chart(fig, use_container_width=True)


if __name__ == "__main__":
    main()
