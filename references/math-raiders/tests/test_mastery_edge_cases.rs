fn main() {
    println!("Testing Mastery Level Edge Cases\n");
    
    // Test cases: (attempts, recent_responses, expected_level, description)
    let test_cases = vec![
        // Empty and very short strings
        (0, "", "Level 0", "Empty - no attempts"),
        (1, "F", "Level 1", "1 attempt - 1 correct"),
        (2, "FF", "Level 5", "2 attempts - 2 fast = Level 5"),
        
        // Exactly 3 attempts (last-3 window filled)
        (3, "FFF", "Level 5", "3 Fast = Level 5!"),
        (3, "FFW", "Level 5", "2 Fast = Level 5 (2+ fast threshold)"),
        (3, "FWW", "Level 1", "1 correct = Level 1"),
        (3, "WWW", "Level 0", "0 correct = Level 0"),
        (3, "MMM", "Level 2", "3 correct (medium) = Level 2 (accurate but slow)"),
        
        // 4-5 attempts (last 3 used)
        (4, "FFFF", "Level 5", "4/4 Fast = Level 5"),
        (4, "FWFF", "Level 5", "3/4 Fast = Level 5"),
        (4, "MMFF", "Level 5", "2 Fast = Level 5 (2+ fast threshold)"),
        (5, "FFFFF", "Level 5", "5/5 Fast = Level 5"),
        (5, "WFFFF", "Level 5", "4/5 Fast = Level 5"),
        (5, "WWFFF", "Level 5", "3/5 Fast = Level 5"),
        (5, "WWWFF", "Level 5", "2/5 Fast = Level 5 (2+ fast threshold)"),
        
        // 6-10 attempts (only last 3 used)
        (6, "WFFFFF", "Level 5", "Last 3: FFF = Level 5"),
        (7, "WWFFFFF", "Level 5", "Last 3: FFF = Level 5"),
        (8, "WWWFFFFF", "Level 5", "Last 3: FFF = Level 5"),
        (9, "WWWWFFFFF", "Level 5", "Last 3: FFF = Level 5"),
        (10, "WWWWWFFFFF", "Level 5", "Last 3: FFF = Level 5"),
        
        // Exactly 10 (longer sequence)
        (10, "FFFFFWWWWW", "Level 0", "Last 3: WWW = Level 0"),
        (10, "MWFFFFFMFF", "Level 5", "Last 3: MFF = Level 5"),
        
        // More than 10 (longer sequence)
        (11, "FWWWWWFFFFF", "Level 5", "Long sequence, last 3: FFF"),
        (12, "FFWWWWWFFFFF", "Level 5", "Long sequence, last 3: FFF"),
    ];
    
    for (attempts, responses, expected, description) in test_cases {
        let level = calculate_level(attempts, responses);
        let last_3 = get_last_3(responses);
        let status = if level == expected { "✅" } else { "❌" };
        
        println!("{} {} - {}", status, description, responses);
        println!("   Attempts: {}, Last 3: '{}', Result: {}", 
            attempts, last_3, level);
        if level != expected {
            println!("   ERROR: Expected {}", expected);
        }
        println!();
    }
}

fn get_last_3(responses: &str) -> String {
    if responses.len() <= 3 {
        responses.to_string()
    } else {
        let start = responses.len() - 3;
        responses[start..].to_string()
    }
}

fn calculate_level(attempts: u32, responses: &str) -> &'static str {
    // First check: empty case
    if attempts == 0 || responses.is_empty() {
        return "Level 0";
    }
    
    // Get last 3 characters (or all if fewer than 3)
    let last_3 = get_last_3(responses);
    
    // Count fast and correct
    let correct_count = last_3.chars().filter(|&c| c != 'W').count();
    let fast_count = last_3.chars().filter(|&c| c == 'F').count();
    
    // Calculate level (simplified: last 3, L5 = 2+ fast)
    if fast_count >= 2 {
        "Level 5"  // 2+ fast in last 3 (consistent, not lucky)
    } else if correct_count >= 2 {
        "Level 2"  // Accurate but slow (2+ correct)
    } else if correct_count >= 1 {
        "Level 1"  // Practicing
    } else {
        "Level 0"  // All wrong
    }
    // Note: Levels 3-4 (speed tiers) would need threshold multiplier logic
}





