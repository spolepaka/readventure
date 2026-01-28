// Simple test to verify reset times work correctly
// Run this from the client directory after server is deployed

console.log("=== Testing Daily Reset Times ===");

// Test the reset logic manually
const RESET_HOUR_UTC = 8; // midnight PST = 8am UTC
const hour_in_micros = 60 * 60 * 1_000_000;
const day_in_micros = 24 * hour_in_micros;

function is_new_day_pst(last_micros: number, current_micros: number): boolean {
    const offset_micros = RESET_HOUR_UTC * hour_in_micros;
    const last_offset = last_micros - offset_micros;
    const current_offset = current_micros - offset_micros;
    
    const last_day = Math.floor(last_offset / day_in_micros);
    const current_day = Math.floor(current_offset / day_in_micros);
    
    return current_day > last_day;
}

// Base: Sept 28, 2024 00:00:00 UTC
const base_micros = 1727481600 * 1_000_000;

const test_cases = [
    { name: "UTC midnight cross", last_h: 23, curr_h: 1 },    // 23:00 -> 01:00 UTC
    { name: "PST midnight cross", last_h: 7, curr_h: 9 },     // 07:00 -> 09:00 UTC (11pm -> 1am PST)
    { name: "Same PST day", last_h: 9, curr_h: 15 },          // 09:00 -> 15:00 UTC (1am -> 7am PST)
    { name: "Exact PST midnight", last_h: 7, curr_h: 8 },     // 07:00 -> 08:00 UTC (11pm -> 12am PST)
];

console.log("Test Name                | UTC Time    | Result");
console.log("-".repeat(50));

for (const test of test_cases) {
    const last = base_micros + test.last_h * hour_in_micros;
    const current = base_micros + test.curr_h * hour_in_micros;
    
    const is_new = is_new_day_pst(last, current);
    const expected = test.name.includes("PST midnight");
    const status = is_new === expected ? "✓" : "✗";
    
    console.log(`${test.name.padEnd(24)} | ${test.last_h}:00 -> ${test.curr_h}:00 | ${is_new} ${status}`);
}

console.log("\n✓ = working as expected");
console.log("Daily reset happens at midnight PST (3am EST, 8am UTC)");

// Time zone examples
console.log("\n=== When it's midnight PST (daily reset) ===");
console.log("PST: 12:00 AM (midnight)");
console.log("MST: 1:00 AM");
console.log("CST: 2:00 AM");
console.log("EST: 3:00 AM");
console.log("UTC: 8:00 AM");
console.log("\nAll US players see reset while sleeping!");

// To test on server:
console.log("\n=== To test on live server ===");
console.log("1. Deploy the server with updated reset code");
console.log("2. Call the test_reset_times reducer from client");
console.log("3. Check server logs for results");






