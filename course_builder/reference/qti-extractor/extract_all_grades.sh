#!/bin/bash
# Extract all QTI assessments by grade level (3-12)
# This will create 10 separate JSON files, one for each grade

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         QTI Grade-Level Extraction Script                 ║"
echo "║         Extracting all assessments (Grades 3-12)          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Start timer
start_time=$(date +%s)

# Array of grades to extract
grades=(3 4 5 6 7 8 9 10 11 12)

# Loop through each grade
for grade in "${grades[@]}"
do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📚 Starting Grade $grade extraction..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Run extraction
  python3 extract_qti_assessments.py --grade "$grade" --all
  
  # Check if successful
  if [ $? -eq 0 ]; then
    echo "✅ Grade $grade extraction complete!"
  else
    echo "❌ Error extracting Grade $grade"
  fi
  
  echo ""
done

# Calculate total time
end_time=$(date +%s)
duration=$((end_time - start_time))
minutes=$((duration / 60))
seconds=$((duration % 60))

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    EXTRACTION COMPLETE                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "⏱️  Total time: ${minutes} minutes ${seconds} seconds"
echo "📁 Files created:"
ls -lh qti_grade_*_data.json 2>/dev/null | awk '{print "   • " $9 " (" $5 ")"}'
echo ""
echo "🎉 All grades extracted successfully!"
echo "💡 Open dashboard.html to view the data"
echo ""


