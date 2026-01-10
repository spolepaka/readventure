#!/usr/bin/env python3
"""
QC Results Dashboard - Analyze Question and Explanation QC Results

Usage:
    streamlit run qc_dashboard.py

Features:
- Two main tabs: Questions QC and Explanations QC
- Click on any row to see full details (passage, question, answers, explanations)
- Hover on failed checks to see LLM reasoning
- Filter by question type, source, status
- Compare original vs generated question quality
"""

import streamlit as st
import pandas as pd
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
import plotly.express as px
import plotly.graph_objects as go


# Default pass threshold
DEFAULT_PASS_THRESHOLD = 0.8


def is_valid_explanation_data(data: List[Dict]) -> bool:
    """Check if data has the expected structure for explanation QC results."""
    if not data:
        return False
    sample = data[0]
    return 'option_label' in sample and 'is_correct' in sample


def load_qc_results(results_dir: Path) -> Dict[str, Any]:
    """Load all QC result files from directory."""
    results = {
        'question_qc': None,
        'question_qc_raw': None,
        'explanation_qc': None,
        'explanation_qc_raw': None,
        'summary': None
    }
    
    # Find question QC files
    merged_file = results_dir / "question_qc_merged.json"
    if merged_file.exists():
        with open(merged_file) as f:
            data = json.load(f)
            results['question_qc'] = data
            results['question_qc_raw'] = {r.get('question_id'): r for r in data}
        results['question_file'] = merged_file.name
    else:
        question_files = sorted(results_dir.glob("question_qc_v3_*.json"), reverse=True)
        if not question_files:
            question_files = sorted(results_dir.glob("question_qc_v2_*.json"), reverse=True)
        if question_files:
            with open(question_files[0]) as f:
                data = json.load(f)
                results['question_qc'] = data
                results['question_qc_raw'] = {r.get('question_id'): r for r in data}
            results['question_file'] = question_files[0].name
    
    # Find explanation QC files
    explanation_merged = results_dir / "explanation_qc_merged.json"
    if explanation_merged.exists():
        try:
            with open(explanation_merged) as f:
                data = json.load(f)
            if is_valid_explanation_data(data):
                results['explanation_qc'] = data
                results['explanation_qc_raw'] = {r.get('question_id'): r for r in data}
                results['explanation_file'] = explanation_merged.name
        except Exception:
            pass
    
    if not results.get('explanation_qc'):
        explanation_files = sorted(results_dir.glob("explanation_qc_v2_*.json"), reverse=True)
        for exp_file in explanation_files:
            if '_summary' in exp_file.name:
                continue
            try:
                with open(exp_file) as f:
                    data = json.load(f)
                if is_valid_explanation_data(data):
                    results['explanation_qc'] = data
                    results['explanation_qc_raw'] = {r.get('question_id'): r for r in data}
                    results['explanation_file'] = exp_file.name
                    break
            except Exception:
                continue
    
    # Load summary report
    summary_file = results_dir / "summary_report.json"
    if summary_file.exists():
        with open(summary_file) as f:
            results['summary'] = json.load(f)
    
    return results


def load_input_data(results_dir: Path) -> Optional[pd.DataFrame]:
    """Load the input CSV with full question/passage data."""
    # Try to find the input file
    possible_paths = [
        results_dir.parent / "qb_extended_rewritten.csv",
        results_dir.parent / "qb_extended_combined.csv",
        results_dir.parent / "outputs" / "qb_extended_rewritten.csv",
        results_dir.parent / "outputs" / "qb_extended_combined.csv",
    ]
    
    for path in possible_paths:
        if path.exists():
            try:
                return pd.read_csv(path)
            except Exception:
                continue
    return None


def parse_question_results(results: List[Dict], pass_threshold: float = DEFAULT_PASS_THRESHOLD) -> pd.DataFrame:
    """Parse question QC results into a DataFrame."""
    rows = []
    for r in results:
        question_id = r.get('question_id', '')
        
        is_sibling = '_sibling_' in question_id
        source = 'generated' if is_sibling else 'original'
        
        if question_id.startswith('guiding'):
            q_type = 'guiding'
        elif question_id.startswith('quiz'):
            q_type = 'quiz'
        else:
            q_type = 'unknown'
        
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
            'passed': r.get('overall_score', 0) >= pass_threshold,
            'checks_passed': r.get('total_checks_passed', 0),
            'checks_total': r.get('total_checks_run', 0),
        }
        
        for check_name, check_data in r.get('checks', {}).items():
            if isinstance(check_data, dict):
                row[f'check_{check_name}'] = check_data.get('score', 0) == 1
            else:
                row[f'check_{check_name}'] = check_data
        
        rows.append(row)
    
    return pd.DataFrame(rows)


def parse_explanation_results(results: List[Dict], pass_threshold: float = DEFAULT_PASS_THRESHOLD) -> pd.DataFrame:
    """Parse explanation QC results into a DataFrame."""
    rows = []
    for r in results:
        question_id = r.get('question_id', '')
        option_label = r.get('option_label', '')
        
        is_sibling = '_sibling_' in question_id
        source = 'generated' if is_sibling else 'original'
        
        if question_id.startswith('guiding'):
            q_type = 'guiding'
        elif question_id.startswith('quiz'):
            q_type = 'quiz'
        else:
            q_type = 'unknown'
        
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
            'passed': r.get('overall_score', 0) >= pass_threshold,
            'checks_passed': r.get('total_checks_passed', 0),
            'checks_total': r.get('total_checks_run', 0),
        }
        
        for check_name, check_data in r.get('checks', {}).items():
            if isinstance(check_data, dict):
                row[f'check_{check_name}'] = check_data.get('passed', False)
            else:
                row[f'check_{check_name}'] = check_data
        
        rows.append(row)
    
    return pd.DataFrame(rows)


def render_question_detail(question_id: str, raw_results: Dict, input_df: Optional[pd.DataFrame]):
    """Render detailed view for a question."""
    if question_id not in raw_results:
        st.warning(f"No data found for {question_id}")
        return
    
    qc_data = raw_results[question_id]
    
    # Try to get full question data from input CSV
    question_data = None
    if input_df is not None and 'question_id' in input_df.columns:
        matches = input_df[input_df['question_id'] == question_id]
        if len(matches) > 0:
            question_data = matches.iloc[0].to_dict()
    
    st.subheader(f"📋 Question: {question_id}")
    
    # Score summary
    score = qc_data.get('overall_score', 0)
    passed = qc_data.get('total_checks_passed', 0)
    total = qc_data.get('total_checks_run', 0)
    
    col1, col2, col3 = st.columns(3)
    col1.metric("Score", f"{score:.0%}")
    col2.metric("Checks Passed", f"{passed}/{total}")
    col3.metric("Status", "✅ Passed" if score >= 0.8 else "❌ Failed")
    
    st.divider()
    
    # Passage
    if question_data and question_data.get('passage_text'):
        with st.expander("📖 Passage", expanded=False):
            st.markdown(question_data['passage_text'])
    
    # Question and Options
    st.markdown("**Question:**")
    if question_data and question_data.get('question'):
        st.info(question_data['question'])
    else:
        st.info(qc_data.get('question_preview', 'N/A'))
    
    st.markdown("**Answer Options:**")
    correct_answer = qc_data.get('correct_answer', '') or (question_data.get('correct_answer', '') if question_data else '')
    
    for i, letter in enumerate(['A', 'B', 'C', 'D'], 1):
        option_text = question_data.get(f'option_{i}', 'N/A') if question_data else 'N/A'
        is_correct = letter == correct_answer
        icon = "✅" if is_correct else "⬜"
        st.markdown(f"{icon} **{letter})** {option_text}")
    
    # Explanations
    if question_data:
        with st.expander("💬 Explanations", expanded=False):
            for i, letter in enumerate(['A', 'B', 'C', 'D'], 1):
                exp_text = question_data.get(f'option_{i}_explanation', 'N/A')
                is_correct = letter == correct_answer
                st.markdown(f"**{letter}) {'(Correct)' if is_correct else ''}**")
                st.caption(exp_text)
                st.markdown("---")
    
    st.divider()
    
    # QC Checks with LLM reasoning
    st.markdown("**🔍 QC Check Results:**")
    
    checks = qc_data.get('checks', {})
    
    for check_name, check_data in checks.items():
        if isinstance(check_data, dict):
            score_val = check_data.get('score', 0)
            passed_val = score_val == 1 if 'score' in check_data else check_data.get('passed', False)
            response = check_data.get('response', check_data.get('reason', 'No details available'))
            
            icon = "✅" if passed_val else "❌"
            
            with st.expander(f"{icon} **{check_name}**", expanded=not passed_val):
                if passed_val:
                    st.success("Check passed")
                else:
                    st.error("Check failed")
                st.markdown("**LLM Analysis:**")
                st.markdown(response)


def render_explanation_detail(full_id: str, raw_results: Dict, input_df: Optional[pd.DataFrame]):
    """Render detailed view for an explanation."""
    # full_id format: "question_id:option_label" e.g., "quiz_302006_sibling_1_A:A"
    
    # Parse the full_id
    parts = full_id.split(':')
    if len(parts) == 2:
        search_question_id, search_option = parts
    else:
        search_question_id = full_id
        search_option = ''
    
    # Find the matching result using multiple strategies
    exp_data = None
    original_question_id = None
    
    for qid, data in raw_results.items():
        data_original_qid = data.get('original_question_id', '')
        data_option = data.get('option_label', '')
        data_question_id = data.get('question_id', '')
        
        # Strategy 1: Direct key match (qid is the question_id like quiz_302005_A)
        # search_question_id from full_id "quiz_302005_A:A" is "quiz_302005_A"
        if qid == search_question_id:
            exp_data = data
            original_question_id = data_original_qid
            break
        
        # Strategy 2: Match original_question_id + option_label
        if data_original_qid == search_question_id and data_option == search_option:
            exp_data = data
            original_question_id = data_original_qid
            break
        
        # Strategy 3: data's question_id matches search_question_id
        if data_question_id == search_question_id:
            exp_data = data
            original_question_id = data_original_qid
            break
        
        # Strategy 4: Full ID match (unlikely but for completeness)
        if qid == full_id:
            exp_data = data
            original_question_id = data_original_qid
            break
    
    if not exp_data:
        st.warning(f"No data found for {full_id}")
        st.caption(f"Searched for question_id='{search_question_id}', option='{search_option}'")
        return
    
    # Use original_question_id for looking up in input_df
    if not original_question_id:
        original_question_id = search_question_id
    
    option_label = exp_data.get('option_label', '') or search_option
    is_correct = exp_data.get('is_correct', False)
    
    # Try to get full question data using original_question_id
    question_data = None
    if input_df is not None and 'question_id' in input_df.columns:
        matches = input_df[input_df['question_id'] == original_question_id]
        if len(matches) > 0:
            question_data = matches.iloc[0].to_dict()
    
    st.subheader(f"💬 Explanation: {original_question_id} - Option {option_label}")
    
    # Score summary
    score = exp_data.get('overall_score', 0)
    passed = exp_data.get('total_checks_passed', 0)
    total = exp_data.get('total_checks_run', 0)
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Score", f"{score:.0%}")
    col2.metric("Checks Passed", f"{passed}/{total}")
    col3.metric("Status", "✅ Passed" if score >= 0.8 else "❌ Failed")
    col4.metric("Answer Type", "✅ Correct" if is_correct else "❌ Wrong")
    
    st.divider()
    
    # Passage
    if question_data and question_data.get('passage_text'):
        with st.expander("📖 Passage", expanded=False):
            st.markdown(question_data['passage_text'])
    
    # Question
    st.markdown("**Question:**")
    if question_data and question_data.get('question'):
        st.info(question_data['question'])
    
    # The specific option and explanation
    opt_idx = ord(option_label) - ord('A') + 1 if option_label else 1
    option_text = question_data.get(f'option_{opt_idx}', 'N/A') if question_data else 'N/A'
    explanation_text = question_data.get(f'option_{opt_idx}_explanation', 'N/A') if question_data else 'N/A'
    
    st.markdown(f"**Option {option_label}:** {option_text}")
    st.markdown(f"**Explanation being evaluated:**")
    st.warning(explanation_text)
    
    st.divider()
    
    # QC Checks with LLM reasoning
    st.markdown("**🔍 QC Check Results:**")
    
    checks = exp_data.get('checks', {})
    
    for check_name, check_data in checks.items():
        if isinstance(check_data, dict):
            passed_val = check_data.get('passed', check_data.get('score', 0) == 1)
            reason = check_data.get('reason', check_data.get('response', 'No details available'))
            
            icon = "✅" if passed_val else "❌"
            
            with st.expander(f"{icon} **{check_name}**", expanded=not passed_val):
                if passed_val:
                    st.success("Check passed")
                else:
                    st.error("Check failed")
                st.markdown("**LLM Analysis:**")
                st.markdown(reason)


def render_questions_tab(question_df: pd.DataFrame, raw_results: Dict, input_df: Optional[pd.DataFrame], pass_threshold: float):
    """Render the Questions QC tab content."""
    if question_df is None or len(question_df) == 0:
        st.warning("No question QC data available")
        return
    
    # Overview Stats
    st.header("📊 Overview")
    
    total = len(question_df)
    passed = question_df['passed'].sum()
    failed = total - passed
    avg_score = question_df['overall_score'].mean()
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Questions", total)
    col2.metric("Passed", f"{passed} ({passed/total:.1%})")
    col3.metric("Failed", f"{failed} ({failed/total:.1%})")
    col4.metric("Avg Score", f"{avg_score:.1%}")
    
    # By Source
    st.subheader("By Source")
    col1, col2 = st.columns(2)
    
    for source, col in [('original', col1), ('generated', col2)]:
        mask = question_df['source'] == source
        if mask.sum() > 0:
            src_total = mask.sum()
            src_passed = question_df.loc[mask, 'passed'].sum()
            src_avg = question_df.loc[mask, 'overall_score'].mean()
            with col:
                st.markdown(f"**{'🔵 Original' if source == 'original' else '🟣 Generated'}**")
                st.write(f"Total: {src_total} | Passed: {src_passed} ({src_passed/src_total:.1%}) | Avg: {src_avg:.1%}")
    
    st.divider()
    
    # Charts
    st.header("📈 Comparison Charts")
    
    source_stats = question_df.groupby('source').agg({
        'passed': ['sum', 'count'],
        'overall_score': 'mean'
    }).reset_index()
    source_stats.columns = ['source', 'passed', 'total', 'avg_score']
    source_stats['pass_rate'] = source_stats['passed'] / source_stats['total']
    
    col1, col2 = st.columns(2)
    
    with col1:
        fig = px.bar(source_stats, x='source', y='pass_rate', color='source',
                     title='Pass Rate by Source', labels={'pass_rate': 'Pass Rate', 'source': 'Source'},
                     color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'})
        fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
        st.plotly_chart(fig, use_container_width=True, key="q_pass_rate")
    
    with col2:
        fig = px.bar(source_stats, x='source', y='avg_score', color='source',
                     title='Average Score by Source', labels={'avg_score': 'Average Score', 'source': 'Source'},
                     color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'})
        fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
        st.plotly_chart(fig, use_container_width=True, key="q_avg_score")
    
    st.divider()
    
    # Check Analysis
    st.header("🔍 Check Analysis")
    
    check_cols = [c for c in question_df.columns if c.startswith('check_')]
    
    if check_cols:
        check_stats = []
        for col in check_cols:
            check_name = col.replace('check_', '')
            for source in ['original', 'generated']:
                mask = question_df['source'] == source
                if mask.sum() > 0:
                    pass_rate = question_df.loc[mask, col].mean()
                    check_stats.append({'check': check_name, 'source': source, 'pass_rate': pass_rate})
        
        check_df = pd.DataFrame(check_stats)
        
        fig = px.bar(check_df, x='check', y='pass_rate', color='source', barmode='group',
                     title='Pass Rate by Check', labels={'pass_rate': 'Pass Rate', 'check': 'Check'},
                     color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'})
        fig.update_layout(yaxis_tickformat='.0%', xaxis_tickangle=-45)
        st.plotly_chart(fig, use_container_width=True, key="q_check_analysis")
    
    st.divider()
    
    # Detailed Results with Click-to-View
    st.header("📋 Detailed Results")
    st.caption("👆 Click on any row to see full details including passage, question, answers, and LLM reasoning")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        source_filter = st.multiselect("Source", options=['original', 'generated'], default=['original', 'generated'], key='q_filter_source')
    with col2:
        type_filter = st.multiselect("Question Type", options=['guiding', 'quiz'], default=['guiding', 'quiz'], key='q_filter_type')
    with col3:
        status_filter = st.multiselect("Status", options=['Passed', 'Failed'], default=['Passed', 'Failed'], key='q_filter_status')
    
    # Apply filters
    filtered_df = question_df.copy()
    if source_filter:
        filtered_df = filtered_df[filtered_df['source'].isin(source_filter)]
    if type_filter:
        filtered_df = filtered_df[filtered_df['question_type'].isin(type_filter)]
    status_map = {'Passed': True, 'Failed': False}
    status_values = [status_map[s] for s in status_filter]
    if status_values:
        filtered_df = filtered_df[filtered_df['passed'].isin(status_values)]
    
    # Sort
    sort_col = st.selectbox("Sort by", options=['overall_score', 'question_id', 'checks_passed'], key='q_sort')
    sort_order = st.radio("Order", ['Descending', 'Ascending'], horizontal=True, key='q_order')
    filtered_df = filtered_df.sort_values(sort_col, ascending=(sort_order == 'Ascending'))
    
    st.write(f"Showing {len(filtered_df)} questions")
    
    # Show summary table with clickable rows
    display_df = filtered_df[['question_id', 'source', 'overall_score', 'passed', 'checks_passed', 'checks_total']].copy()
    display_df['score_display'] = display_df['overall_score'].apply(lambda x: f"{x:.0%}")
    display_df['status'] = display_df['passed'].apply(lambda x: '✅' if x else '❌')
    
    # Use dataframe with row selection
    event = st.dataframe(
        display_df[['question_id', 'source', 'score_display', 'status', 'checks_passed', 'checks_total']].rename(columns={
            'score_display': 'Score',
            'status': 'Status',
            'checks_passed': 'Passed',
            'checks_total': 'Total'
        }),
        use_container_width=True,
        height=350,
        selection_mode="single-row",
        on_select="rerun",
        key="q_table"
    )
    
    # Show detail view if row selected
    if event and event.selection and event.selection.rows:
        selected_idx = event.selection.rows[0]
        selected_question = display_df.iloc[selected_idx]['question_id']
        st.divider()
        render_question_detail(selected_question, raw_results, input_df)


def render_explanations_tab(explanation_df: pd.DataFrame, raw_results: Dict, input_df: Optional[pd.DataFrame], pass_threshold: float):
    """Render the Explanations QC tab content."""
    if explanation_df is None or len(explanation_df) == 0:
        st.warning("⚠️ No explanation QC data available")
        st.info("""
        **To generate explanation QC data:**
        1. Run the explanation QC pipeline on your rewritten explanations
        2. The output file should have `option_label` and `is_correct` fields
        3. File format: `explanation_qc_*.json` in the `outputs/qc_results/` directory
        """)
        return
    
    # Overview Stats
    st.header("📊 Overview")
    
    total = len(explanation_df)
    passed = explanation_df['passed'].sum()
    failed = total - passed
    avg_score = explanation_df['overall_score'].mean()
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Explanations", total)
    col2.metric("Passed", f"{passed} ({passed/total:.1%})")
    col3.metric("Failed", f"{failed} ({failed/total:.1%})")
    col4.metric("Avg Score", f"{avg_score:.1%}")
    
    # By Source
    st.subheader("By Source")
    col1, col2 = st.columns(2)
    
    for source, col in [('original', col1), ('generated', col2)]:
        mask = explanation_df['source'] == source
        if mask.sum() > 0:
            src_total = mask.sum()
            src_passed = explanation_df.loc[mask, 'passed'].sum()
            src_avg = explanation_df.loc[mask, 'overall_score'].mean()
            with col:
                st.markdown(f"**{'🔵 Original' if source == 'original' else '🟣 Generated'}**")
                st.write(f"Total: {src_total} | Passed: {src_passed} ({src_passed/src_total:.1%}) | Avg: {src_avg:.1%}")
    
    # By Answer Type
    st.subheader("By Answer Type")
    col1, col2 = st.columns(2)
    
    for is_correct, col in [(True, col1), (False, col2)]:
        mask = explanation_df['is_correct'] == is_correct
        if mask.sum() > 0:
            ans_total = mask.sum()
            ans_passed = explanation_df.loc[mask, 'passed'].sum()
            ans_avg = explanation_df.loc[mask, 'overall_score'].mean()
            with col:
                st.markdown(f"**{'✅ Correct Answer' if is_correct else '❌ Incorrect Answer'}**")
                st.write(f"Total: {ans_total} | Passed: {ans_passed} ({ans_passed/ans_total:.1%}) | Avg: {ans_avg:.1%}")
    
    st.divider()
    
    # Charts
    st.header("📈 Comparison Charts")
    
    col1, col2 = st.columns(2)
    
    with col1:
        source_stats = explanation_df.groupby('source').agg({'passed': ['sum', 'count'], 'overall_score': 'mean'}).reset_index()
        source_stats.columns = ['source', 'passed', 'total', 'avg_score']
        source_stats['pass_rate'] = source_stats['passed'] / source_stats['total']
        
        fig = px.bar(source_stats, x='source', y='pass_rate', color='source',
                     title='Pass Rate by Source', labels={'pass_rate': 'Pass Rate'},
                     color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'})
        fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
        st.plotly_chart(fig, use_container_width=True, key="e_pass_rate_source")
    
    with col2:
        answer_stats = explanation_df.groupby('is_correct').agg({'passed': ['sum', 'count']}).reset_index()
        answer_stats.columns = ['is_correct', 'passed', 'total']
        answer_stats['pass_rate'] = answer_stats['passed'] / answer_stats['total']
        answer_stats['answer_type'] = answer_stats['is_correct'].map({True: 'Correct', False: 'Incorrect'})
        
        fig = px.bar(answer_stats, x='answer_type', y='pass_rate', color='answer_type',
                     title='Pass Rate by Answer Type',
                     color_discrete_map={'Correct': '#28A745', 'Incorrect': '#DC3545'})
        fig.update_layout(yaxis_tickformat='.0%', showlegend=False)
        st.plotly_chart(fig, use_container_width=True, key="e_pass_rate_answer")
    
    st.divider()
    
    # Check Analysis
    st.header("🔍 Check Analysis")
    
    check_cols = [c for c in explanation_df.columns if c.startswith('check_')]
    
    if check_cols:
        check_stats = []
        for col in check_cols:
            check_name = col.replace('check_', '')
            for source in ['original', 'generated']:
                mask = explanation_df['source'] == source
                if mask.sum() > 0:
                    pass_rate = explanation_df.loc[mask, col].mean()
                    check_stats.append({'check': check_name, 'source': source, 'pass_rate': pass_rate})
        
        check_df = pd.DataFrame(check_stats)
        
        fig = px.bar(check_df, x='check', y='pass_rate', color='source', barmode='group',
                     title='Pass Rate by Check', labels={'pass_rate': 'Pass Rate'},
                     color_discrete_map={'original': '#2E86AB', 'generated': '#A23B72'})
        fig.update_layout(yaxis_tickformat='.0%', xaxis_tickangle=-45)
        st.plotly_chart(fig, use_container_width=True, key="e_check_analysis")
    
    st.divider()
    
    # Detailed Results with Click-to-View
    st.header("📋 Detailed Results")
    st.caption("👆 Click on any row to see full details including passage, question, explanation text, and LLM reasoning")
    
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        source_filter = st.multiselect("Source", options=['original', 'generated'], default=['original', 'generated'], key='e_filter_source')
    with col2:
        type_filter = st.multiselect("Question Type", options=['guiding', 'quiz'], default=['guiding', 'quiz'], key='e_filter_type')
    with col3:
        answer_filter = st.multiselect("Answer Type", options=['Correct', 'Incorrect'], default=['Correct', 'Incorrect'], key='e_filter_answer')
    with col4:
        status_filter = st.multiselect("Status", options=['Passed', 'Failed'], default=['Passed', 'Failed'], key='e_filter_status')
    
    # Apply filters
    filtered_df = explanation_df.copy()
    if source_filter:
        filtered_df = filtered_df[filtered_df['source'].isin(source_filter)]
    if type_filter:
        filtered_df = filtered_df[filtered_df['question_type'].isin(type_filter)]
    answer_map = {'Correct': True, 'Incorrect': False}
    answer_values = [answer_map[a] for a in answer_filter]
    if answer_values:
        filtered_df = filtered_df[filtered_df['is_correct'].isin(answer_values)]
    status_map = {'Passed': True, 'Failed': False}
    status_values = [status_map[s] for s in status_filter]
    if status_values:
        filtered_df = filtered_df[filtered_df['passed'].isin(status_values)]
    
    # Sort
    sort_col = st.selectbox("Sort by", options=['overall_score', 'question_id', 'checks_passed'], key='e_sort')
    sort_order = st.radio("Order", ['Descending', 'Ascending'], horizontal=True, key='e_order')
    filtered_df = filtered_df.sort_values(sort_col, ascending=(sort_order == 'Ascending'))
    
    st.write(f"Showing {len(filtered_df)} explanations")
    
    # Show summary table with clickable rows
    display_df = filtered_df[['full_id', 'question_id', 'option_label', 'source', 'is_correct', 'overall_score', 'passed', 'checks_passed', 'checks_total']].copy()
    display_df['score_display'] = display_df['overall_score'].apply(lambda x: f"{x:.0%}")
    display_df['status'] = display_df['passed'].apply(lambda x: '✅' if x else '❌')
    display_df['correct'] = display_df['is_correct'].apply(lambda x: '✅' if x else '❌')
    
    # Use dataframe with row selection
    event = st.dataframe(
        display_df[['full_id', 'source', 'correct', 'score_display', 'status', 'checks_passed', 'checks_total']].rename(columns={
            'full_id': 'ID',
            'correct': 'Correct?',
            'score_display': 'Score',
            'status': 'Status',
            'checks_passed': 'Passed',
            'checks_total': 'Total'
        }),
        use_container_width=True,
        height=350,
        selection_mode="single-row",
        on_select="rerun",
        key="e_table"
    )
    
    # Show detail view if row selected
    if event and event.selection and event.selection.rows:
        selected_idx = event.selection.rows[0]
        selected_exp = display_df.iloc[selected_idx]['full_id']
        st.divider()
        render_explanation_detail(selected_exp, raw_results, input_df)


def main():
    st.set_page_config(
        page_title="QC Results Dashboard",
        page_icon="📊",
        layout="wide"
    )
    
    st.title("📊 QC Results Dashboard")
    
    # Sidebar
    with st.sidebar:
        st.header("⚙️ Configuration")
        
        default_dir = Path(__file__).parent / "outputs" / "qc_results"
        
        results_dir = st.text_input("Results Directory", value=str(default_dir))
        results_path = Path(results_dir)
        
        if not results_path.exists():
            st.error(f"Directory not found: {results_dir}")
            return
        
        # Load results
        results = load_qc_results(results_path)
        
        # Load input data for detailed views
        input_df = load_input_data(results_path)
        
        st.subheader("📂 Loaded Files")
        
        if results.get('question_file'):
            st.success(f"✅ Questions: {results['question_file']}")
        else:
            st.warning("⚠️ No question QC data found")
        
        if results.get('explanation_file'):
            st.success(f"✅ Explanations: {results['explanation_file']}")
        else:
            st.warning("⚠️ No explanation QC data found")
        
        if input_df is not None:
            st.info(f"📄 Input data: {len(input_df)} questions loaded")
        else:
            st.warning("⚠️ Could not load input CSV for detailed views")
        
        st.divider()
        st.subheader("🎯 Pass Threshold")
        pass_threshold_pct = st.slider("Pass Score Threshold", min_value=50, max_value=100,
                                       value=int(DEFAULT_PASS_THRESHOLD * 100), step=5, format="%d%%")
        pass_threshold = pass_threshold_pct / 100.0
        st.caption(f"Current: {pass_threshold_pct}%")
    
    # Parse results
    question_df = None
    explanation_df = None
    
    if results.get('question_qc'):
        question_df = parse_question_results(results['question_qc'], pass_threshold)
    
    if results.get('explanation_qc'):
        explanation_df = parse_explanation_results(results['explanation_qc'], pass_threshold)
    
    # Main tabs
    tab1, tab2 = st.tabs(["📝 Questions QC", "💬 Explanations QC"])
    
    with tab1:
        render_questions_tab(question_df, results.get('question_qc_raw', {}), input_df, pass_threshold)
    
    with tab2:
        render_explanations_tab(explanation_df, results.get('explanation_qc_raw', {}), input_df, pass_threshold)


if __name__ == "__main__":
    main()
