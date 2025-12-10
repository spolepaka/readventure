#!/usr/bin/env python3
"""
QC Results Dashboard - Analyze Question and Explanation QC Results

Usage:
    streamlit run qc_dashboard.py -- --results-dir outputs/qc_results

Features:
- View overall stats for questions and explanations
- Filter by question type (guiding/quiz), source (original/generated)
- Sort and analyze individual check results
- Compare original vs generated question quality
"""

import streamlit as st
import pandas as pd
import json
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional
import plotly.express as px
import plotly.graph_objects as go


def load_qc_results(results_dir: Path) -> Dict[str, Any]:
    """Load all QC result files from directory."""
    results = {
        'question_qc': None,
        'explanation_qc': None,
        'summary': None
    }
    
    # Find most recent files
    question_files = sorted(results_dir.glob("question_qc_v2_*.json"), reverse=True)
    explanation_files = sorted(results_dir.glob("explanation_qc_v2_*.json"), reverse=True)
    summary_file = results_dir / "summary_report.json"
    
    if question_files:
        with open(question_files[0]) as f:
            results['question_qc'] = json.load(f)
        results['question_file'] = question_files[0].name
    
    if explanation_files:
        with open(explanation_files[0]) as f:
            results['explanation_qc'] = json.load(f)
        results['explanation_file'] = explanation_files[0].name
    
    if summary_file.exists():
        with open(summary_file) as f:
            results['summary'] = json.load(f)
    
    return results


def parse_question_results(results: List[Dict]) -> pd.DataFrame:
    """Parse question QC results into a DataFrame."""
    rows = []
    for r in results:
        question_id = r.get('question_id', '')
        
        # Determine source and type
        is_sibling = '_sibling_' in question_id
        source = 'generated' if is_sibling else 'original'
        
        # Extract question type from ID
        if question_id.startswith('guiding'):
            q_type = 'guiding'
        elif question_id.startswith('quiz'):
            q_type = 'quiz'
        else:
            q_type = 'unknown'
        
        # Extract parent ID for siblings
        if is_sibling:
            parent_id = question_id.rsplit('_sibling_', 1)[0]
        else:
            parent_id = question_id
        
        row = {
            'question_id': question_id,
            'parent_id': parent_id,
            'question_type': q_type,
            'source': source,
            'overall_score': r.get('overall_score', 0),
            'passed': r.get('overall_score', 0) >= 0.7,
            'checks_passed': r.get('total_checks_passed', 0),
            'checks_total': r.get('total_checks_run', 0),
        }
        
        # Add individual checks
        for check_name, check_data in r.get('checks', {}).items():
            if isinstance(check_data, dict):
                row[f'check_{check_name}'] = check_data.get('score', 0) == 1
            else:
                row[f'check_{check_name}'] = check_data
        
        rows.append(row)
    
    return pd.DataFrame(rows)


def parse_explanation_results(results: List[Dict]) -> pd.DataFrame:
    """Parse explanation QC results into a DataFrame."""
    rows = []
    for r in results:
        question_id = r.get('question_id', '')
        option_label = r.get('option_label', '')
        
        # Determine source and type
        is_sibling = '_sibling_' in question_id
        source = 'generated' if is_sibling else 'original'
        
        # Extract question type from ID
        if question_id.startswith('guiding'):
            q_type = 'guiding'
        elif question_id.startswith('quiz'):
            q_type = 'quiz'
        else:
            q_type = 'unknown'
        
        # Extract parent ID for siblings
        if is_sibling:
            parent_id = question_id.rsplit('_sibling_', 1)[0]
        else:
            parent_id = question_id
        
        row = {
            'question_id': question_id,
            'option_label': option_label,
            'full_id': f"{question_id}:{option_label}",
            'parent_id': parent_id,
            'question_type': q_type,
            'source': source,
            'is_correct': r.get('is_correct', False),
            'overall_score': r.get('overall_score', 0),
            'passed': r.get('overall_score', 0) >= 0.7,
            'checks_passed': r.get('total_checks_passed', 0),
            'checks_total': r.get('total_checks_run', 0),
        }
        
        # Add individual checks
        for check_name, check_data in r.get('checks', {}).items():
            if isinstance(check_data, dict):
                row[f'check_{check_name}'] = check_data.get('passed', False)
            else:
                row[f'check_{check_name}'] = check_data
        
        rows.append(row)
    
    return pd.DataFrame(rows)


def render_overview_stats(question_df: pd.DataFrame, explanation_df: pd.DataFrame):
    """Render overview statistics."""
    st.header("📊 Overview Statistics")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("Question QC")
        if question_df is not None and len(question_df) > 0:
            total = len(question_df)
            passed = question_df['passed'].sum()
            avg_score = question_df['overall_score'].mean()
            
            metric_cols = st.columns(3)
            metric_cols[0].metric("Total", total)
            metric_cols[1].metric("Passed", f"{passed} ({passed/total:.0%})")
            metric_cols[2].metric("Avg Score", f"{avg_score:.0%}")
        else:
            st.warning("No question QC data available")
    
    with col2:
        st.subheader("Explanation QC")
        if explanation_df is not None and len(explanation_df) > 0:
            total = len(explanation_df)
            passed = explanation_df['passed'].sum()
            avg_score = explanation_df['overall_score'].mean()
            
            metric_cols = st.columns(3)
            metric_cols[0].metric("Total", total)
            metric_cols[1].metric("Passed", f"{passed} ({passed/total:.0%})")
            metric_cols[2].metric("Avg Score", f"{avg_score:.0%}")
        else:
            st.warning("No explanation QC data available")


def render_comparison_charts(question_df: pd.DataFrame, explanation_df: pd.DataFrame):
    """Render comparison charts for original vs generated."""
    st.header("📈 Original vs Generated Comparison")
    
    tab1, tab2 = st.tabs(["Question QC", "Explanation QC"])
    
    with tab1:
        if question_df is not None and len(question_df) > 0:
            # Group by source
            source_stats = question_df.groupby('source').agg({
                'passed': ['sum', 'count'],
                'overall_score': 'mean'
            }).reset_index()
            source_stats.columns = ['source', 'passed', 'total', 'avg_score']
            source_stats['pass_rate'] = source_stats['passed'] / source_stats['total']
            
            col1, col2 = st.columns(2)
            
            with col1:
                fig = px.bar(
                    source_stats, 
                    x='source', 
                    y='pass_rate',
                    color='source',
                    title='Pass Rate by Source',
                    labels={'pass_rate': 'Pass Rate', 'source': 'Source'},
                    color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
                )
                fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
                st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                fig = px.bar(
                    source_stats, 
                    x='source', 
                    y='avg_score',
                    color='source',
                    title='Average Score by Source',
                    labels={'avg_score': 'Average Score', 'source': 'Source'},
                    color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
                )
                fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
                st.plotly_chart(fig, use_container_width=True)
            
            # By question type and source
            type_source_stats = question_df.groupby(['question_type', 'source']).agg({
                'passed': ['sum', 'count'],
                'overall_score': 'mean'
            }).reset_index()
            type_source_stats.columns = ['question_type', 'source', 'passed', 'total', 'avg_score']
            type_source_stats['pass_rate'] = type_source_stats['passed'] / type_source_stats['total']
            
            fig = px.bar(
                type_source_stats, 
                x='question_type', 
                y='pass_rate',
                color='source',
                barmode='group',
                title='Pass Rate by Question Type and Source',
                labels={'pass_rate': 'Pass Rate', 'question_type': 'Question Type'},
                color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
            )
            fig.update_layout(yaxis_tickformat='.0%')
            st.plotly_chart(fig, use_container_width=True)
    
    with tab2:
        if explanation_df is not None and len(explanation_df) > 0:
            # Group by source
            source_stats = explanation_df.groupby('source').agg({
                'passed': ['sum', 'count'],
                'overall_score': 'mean'
            }).reset_index()
            source_stats.columns = ['source', 'passed', 'total', 'avg_score']
            source_stats['pass_rate'] = source_stats['passed'] / source_stats['total']
            
            col1, col2 = st.columns(2)
            
            with col1:
                fig = px.bar(
                    source_stats, 
                    x='source', 
                    y='pass_rate',
                    color='source',
                    title='Pass Rate by Source',
                    labels={'pass_rate': 'Pass Rate', 'source': 'Source'},
                    color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
                )
                fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
                st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                fig = px.bar(
                    source_stats, 
                    x='source', 
                    y='avg_score',
                    color='source',
                    title='Average Score by Source',
                    labels={'avg_score': 'Average Score', 'source': 'Source'},
                    color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
                )
                fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
                st.plotly_chart(fig, use_container_width=True)
            
            # By correct/incorrect answer type
            answer_stats = explanation_df.groupby(['is_correct', 'source']).agg({
                'passed': ['sum', 'count'],
                'overall_score': 'mean'
            }).reset_index()
            answer_stats.columns = ['is_correct', 'source', 'passed', 'total', 'avg_score']
            answer_stats['pass_rate'] = answer_stats['passed'] / answer_stats['total']
            answer_stats['answer_type'] = answer_stats['is_correct'].map({True: 'Correct Answer', False: 'Incorrect Answer'})
            
            fig = px.bar(
                answer_stats, 
                x='answer_type', 
                y='pass_rate',
                color='source',
                barmode='group',
                title='Pass Rate by Answer Type and Source',
                labels={'pass_rate': 'Pass Rate', 'answer_type': 'Answer Type'},
                color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
            )
            fig.update_layout(yaxis_tickformat='.0%')
            st.plotly_chart(fig, use_container_width=True)


def render_check_analysis(question_df: pd.DataFrame, explanation_df: pd.DataFrame):
    """Render analysis of individual checks."""
    st.header("🔍 Check Analysis")
    
    tab1, tab2 = st.tabs(["Question Checks", "Explanation Checks"])
    
    with tab1:
        if question_df is not None and len(question_df) > 0:
            # Get check columns
            check_cols = [c for c in question_df.columns if c.startswith('check_')]
            
            if check_cols:
                # Calculate pass rates for each check
                check_stats = []
                for col in check_cols:
                    check_name = col.replace('check_', '')
                    for source in ['original', 'generated']:
                        mask = question_df['source'] == source
                        if mask.sum() > 0:
                            pass_rate = question_df.loc[mask, col].mean()
                            check_stats.append({
                                'check': check_name,
                                'source': source,
                                'pass_rate': pass_rate
                            })
                
                check_df = pd.DataFrame(check_stats)
                
                fig = px.bar(
                    check_df, 
                    x='check', 
                    y='pass_rate',
                    color='source',
                    barmode='group',
                    title='Pass Rate by Check (Original vs Generated)',
                    labels={'pass_rate': 'Pass Rate', 'check': 'Check'},
                    color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
                )
                fig.update_layout(yaxis_tickformat='.0%', xaxis_tickangle=-45)
                st.plotly_chart(fig, use_container_width=True)
                
                # Show checks with biggest gaps
                st.subheader("Checks with Largest Quality Gaps")
                pivot_df = check_df.pivot(index='check', columns='source', values='pass_rate').reset_index()
                if 'original' in pivot_df.columns and 'generated' in pivot_df.columns:
                    pivot_df['gap'] = pivot_df['original'] - pivot_df['generated']
                    pivot_df = pivot_df.sort_values('gap', ascending=False)
                    
                    st.dataframe(
                        pivot_df.style.format({
                            'original': '{:.0%}',
                            'generated': '{:.0%}',
                            'gap': '{:+.0%}'
                        }),
                        use_container_width=True
                    )
    
    with tab2:
        if explanation_df is not None and len(explanation_df) > 0:
            # Get check columns
            check_cols = [c for c in explanation_df.columns if c.startswith('check_')]
            
            if check_cols:
                # Calculate pass rates for each check
                check_stats = []
                for col in check_cols:
                    check_name = col.replace('check_', '')
                    for source in ['original', 'generated']:
                        mask = explanation_df['source'] == source
                        if mask.sum() > 0:
                            pass_rate = explanation_df.loc[mask, col].mean()
                            check_stats.append({
                                'check': check_name,
                                'source': source,
                                'pass_rate': pass_rate
                            })
                
                check_df = pd.DataFrame(check_stats)
                
                fig = px.bar(
                    check_df, 
                    x='check', 
                    y='pass_rate',
                    color='source',
                    barmode='group',
                    title='Pass Rate by Check (Original vs Generated)',
                    labels={'pass_rate': 'Pass Rate', 'check': 'Check'},
                    color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'}
                )
                fig.update_layout(yaxis_tickformat='.0%', xaxis_tickangle=-45)
                st.plotly_chart(fig, use_container_width=True)


def render_detailed_table(question_df: pd.DataFrame, explanation_df: pd.DataFrame):
    """Render detailed filterable tables."""
    st.header("📋 Detailed Results")
    
    tab1, tab2 = st.tabs(["Question Results", "Explanation Results"])
    
    with tab1:
        if question_df is not None and len(question_df) > 0:
            col1, col2, col3 = st.columns(3)
            
            with col1:
                source_filter = st.multiselect(
                    "Source",
                    options=['original', 'generated'],
                    default=['original', 'generated'],
                    key='q_source'
                )
            
            with col2:
                type_filter = st.multiselect(
                    "Question Type",
                    options=['guiding', 'quiz'],
                    default=['guiding', 'quiz'],
                    key='q_type'
                )
            
            with col3:
                status_filter = st.multiselect(
                    "Status",
                    options=['Passed', 'Failed'],
                    default=['Passed', 'Failed'],
                    key='q_status'
                )
            
            # Apply filters
            filtered_df = question_df.copy()
            filtered_df = filtered_df[filtered_df['source'].isin(source_filter)]
            filtered_df = filtered_df[filtered_df['question_type'].isin(type_filter)]
            
            status_map = {'Passed': True, 'Failed': False}
            status_values = [status_map[s] for s in status_filter]
            filtered_df = filtered_df[filtered_df['passed'].isin(status_values)]
            
            # Sort options
            sort_col = st.selectbox(
                "Sort by",
                options=['overall_score', 'question_id', 'checks_passed'],
                key='q_sort'
            )
            sort_order = st.radio("Order", ['Descending', 'Ascending'], horizontal=True, key='q_order')
            
            filtered_df = filtered_df.sort_values(
                sort_col, 
                ascending=(sort_order == 'Ascending')
            )
            
            # Display columns
            display_cols = ['question_id', 'question_type', 'source', 'overall_score', 'passed', 'checks_passed', 'checks_total']
            check_cols = [c for c in filtered_df.columns if c.startswith('check_')]
            
            st.write(f"Showing {len(filtered_df)} questions")
            
            # Format and display
            display_df = filtered_df[display_cols + check_cols].copy()
            display_df['overall_score'] = display_df['overall_score'].apply(lambda x: f"{x:.0%}")
            display_df['passed'] = display_df['passed'].apply(lambda x: '✅' if x else '❌')
            for col in check_cols:
                display_df[col] = display_df[col].apply(lambda x: '✅' if x else '❌')
            
            st.dataframe(display_df, use_container_width=True, height=400)
            
            # Download button
            csv = filtered_df.to_csv(index=False)
            st.download_button(
                "Download Filtered Results",
                csv,
                "question_qc_filtered.csv",
                "text/csv"
            )
    
    with tab2:
        if explanation_df is not None and len(explanation_df) > 0:
            col1, col2, col3, col4 = st.columns(4)
            
            with col1:
                source_filter = st.multiselect(
                    "Source",
                    options=['original', 'generated'],
                    default=['original', 'generated'],
                    key='e_source'
                )
            
            with col2:
                type_filter = st.multiselect(
                    "Question Type",
                    options=['guiding', 'quiz'],
                    default=['guiding', 'quiz'],
                    key='e_type'
                )
            
            with col3:
                answer_filter = st.multiselect(
                    "Answer Type",
                    options=['Correct', 'Incorrect'],
                    default=['Correct', 'Incorrect'],
                    key='e_answer'
                )
            
            with col4:
                status_filter = st.multiselect(
                    "Status",
                    options=['Passed', 'Failed'],
                    default=['Passed', 'Failed'],
                    key='e_status'
                )
            
            # Apply filters
            filtered_df = explanation_df.copy()
            filtered_df = filtered_df[filtered_df['source'].isin(source_filter)]
            filtered_df = filtered_df[filtered_df['question_type'].isin(type_filter)]
            
            answer_map = {'Correct': True, 'Incorrect': False}
            answer_values = [answer_map[a] for a in answer_filter]
            filtered_df = filtered_df[filtered_df['is_correct'].isin(answer_values)]
            
            status_map = {'Passed': True, 'Failed': False}
            status_values = [status_map[s] for s in status_filter]
            filtered_df = filtered_df[filtered_df['passed'].isin(status_values)]
            
            # Sort options
            sort_col = st.selectbox(
                "Sort by",
                options=['overall_score', 'question_id', 'checks_passed'],
                key='e_sort'
            )
            sort_order = st.radio("Order", ['Descending', 'Ascending'], horizontal=True, key='e_order')
            
            filtered_df = filtered_df.sort_values(
                sort_col, 
                ascending=(sort_order == 'Ascending')
            )
            
            # Display columns
            display_cols = ['full_id', 'question_type', 'source', 'is_correct', 'overall_score', 'passed', 'checks_passed', 'checks_total']
            check_cols = [c for c in filtered_df.columns if c.startswith('check_')]
            
            st.write(f"Showing {len(filtered_df)} explanations")
            
            # Format and display
            display_df = filtered_df[display_cols + check_cols].copy()
            display_df['overall_score'] = display_df['overall_score'].apply(lambda x: f"{x:.0%}")
            display_df['passed'] = display_df['passed'].apply(lambda x: '✅' if x else '❌')
            display_df['is_correct'] = display_df['is_correct'].apply(lambda x: '✅ Correct' if x else '❌ Incorrect')
            for col in check_cols:
                display_df[col] = display_df[col].apply(lambda x: '✅' if x else '❌')
            
            st.dataframe(display_df, use_container_width=True, height=400)
            
            # Download button
            csv = filtered_df.to_csv(index=False)
            st.download_button(
                "Download Filtered Results",
                csv,
                "explanation_qc_filtered.csv",
                "text/csv"
            )


def render_family_view(question_df: pd.DataFrame):
    """Render view grouping originals with their siblings."""
    st.header("👨‍👩‍👧‍👦 Question Families (Original + Siblings)")
    
    if question_df is None or len(question_df) == 0:
        st.warning("No question data available")
        return
    
    # Group by parent_id
    families = question_df.groupby('parent_id')
    
    # Calculate family stats
    family_stats = []
    for parent_id, group in families:
        original = group[group['source'] == 'original']
        siblings = group[group['source'] == 'generated']
        
        stats = {
            'parent_id': parent_id,
            'question_type': group['question_type'].iloc[0],
            'original_score': original['overall_score'].iloc[0] if len(original) > 0 else None,
            'original_passed': original['passed'].iloc[0] if len(original) > 0 else None,
            'num_siblings': len(siblings),
            'siblings_avg_score': siblings['overall_score'].mean() if len(siblings) > 0 else None,
            'siblings_passed': siblings['passed'].sum() if len(siblings) > 0 else 0,
            'siblings_total': len(siblings)
        }
        family_stats.append(stats)
    
    family_df = pd.DataFrame(family_stats)
    
    # Summary metrics
    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Question Families", len(family_df))
    with col2:
        if family_df['original_passed'].notna().sum() > 0:
            orig_pass_rate = family_df['original_passed'].mean()
            st.metric("Original Pass Rate", f"{orig_pass_rate:.0%}")
    with col3:
        if family_df['siblings_total'].sum() > 0:
            sib_pass_rate = family_df['siblings_passed'].sum() / family_df['siblings_total'].sum()
            st.metric("Sibling Pass Rate", f"{sib_pass_rate:.0%}")
    
    # Filter by question type
    type_filter = st.multiselect(
        "Filter by Question Type",
        options=['guiding', 'quiz'],
        default=['guiding', 'quiz'],
        key='family_type'
    )
    
    filtered_family_df = family_df[family_df['question_type'].isin(type_filter)]
    
    # Display table
    display_df = filtered_family_df.copy()
    display_df['original_score'] = display_df['original_score'].apply(lambda x: f"{x:.0%}" if pd.notna(x) else '-')
    display_df['original_passed'] = display_df['original_passed'].apply(lambda x: '✅' if x else '❌' if pd.notna(x) else '-')
    display_df['siblings_avg_score'] = display_df['siblings_avg_score'].apply(lambda x: f"{x:.0%}" if pd.notna(x) else '-')
    display_df['siblings_pass_rate'] = filtered_family_df.apply(
        lambda r: f"{r['siblings_passed']}/{r['siblings_total']}" if r['siblings_total'] > 0 else '-', 
        axis=1
    )
    
    st.dataframe(
        display_df[['parent_id', 'question_type', 'original_score', 'original_passed', 
                   'num_siblings', 'siblings_avg_score', 'siblings_pass_rate']],
        use_container_width=True
    )
    
    # Expandable details for each family
    st.subheader("Family Details")
    
    selected_family = st.selectbox(
        "Select a question family to view details",
        options=filtered_family_df['parent_id'].tolist()
    )
    
    if selected_family:
        family_questions = question_df[question_df['parent_id'] == selected_family]
        
        st.write(f"**Family: {selected_family}**")
        
        for _, row in family_questions.iterrows():
            source_badge = "🔵 Original" if row['source'] == 'original' else "🟣 Generated"
            status_badge = "✅" if row['passed'] else "❌"
            
            with st.expander(f"{source_badge} {row['question_id']} - {row['overall_score']:.0%} {status_badge}"):
                check_cols = [c for c in row.index if c.startswith('check_')]
                
                cols = st.columns(4)
                for i, col in enumerate(check_cols):
                    check_name = col.replace('check_', '')
                    check_status = '✅' if row[col] else '❌'
                    cols[i % 4].write(f"{check_status} {check_name}")


def main():
    st.set_page_config(
        page_title="QC Results Dashboard",
        page_icon="📊",
        layout="wide"
    )
    
    st.title("📊 QC Results Dashboard")
    st.markdown("Analyze Question and Explanation Quality Control Results")
    
    # Sidebar for configuration
    with st.sidebar:
        st.header("⚙️ Configuration")
        
        # Default to the qc_results directory
        default_dir = Path(__file__).parent / "outputs" / "qc_results"
        
        results_dir = st.text_input(
            "Results Directory",
            value=str(default_dir),
            help="Path to the directory containing QC result files"
        )
        
        results_path = Path(results_dir)
        
        if not results_path.exists():
            st.error(f"Directory not found: {results_dir}")
            return
        
        # Load results
        results = load_qc_results(results_path)
        
        st.success("✅ Results loaded")
        
        if results.get('question_file'):
            st.write(f"📄 Question QC: {results['question_file']}")
        if results.get('explanation_file'):
            st.write(f"📄 Explanation QC: {results['explanation_file']}")
        
        if results.get('summary'):
            st.divider()
            st.subheader("Summary Report")
            summary = results['summary']
            st.write(f"**Mode:** {summary.get('mode', 'N/A')}")
            st.write(f"**Time:** {summary.get('total_time_seconds', 0):.1f}s")
    
    # Parse results into DataFrames
    question_df = None
    explanation_df = None
    
    if results.get('question_qc'):
        question_df = parse_question_results(results['question_qc'])
    
    if results.get('explanation_qc'):
        explanation_df = parse_explanation_results(results['explanation_qc'])
    
    # Render dashboard sections
    render_overview_stats(question_df, explanation_df)
    
    st.divider()
    render_comparison_charts(question_df, explanation_df)
    
    st.divider()
    render_check_analysis(question_df, explanation_df)
    
    st.divider()
    render_family_view(question_df)
    
    st.divider()
    render_detailed_table(question_df, explanation_df)


if __name__ == "__main__":
    main()
