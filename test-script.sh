DATA=$(cat)
HEADER_IDX=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | grep -n '"Source"' | tail -1 | cut -d: -f1 | awk '{print $1 - 1}')
START_IDX=$((HEADER_IDX + 1))
STOP_LINE=$(echo "$DATA" | jq -c '.[0].sheets[0].rows[]' | tail -n +$((START_IDX + 1)) | grep -in "TOTAL EXPENSES" | head -1 | cut -d: -f1)
if [ -n "$STOP_LINE" ]; then
  COUNT=$((STOP_LINE - 1))
else
  TOTAL=$(echo "$DATA" | jq '.[0].sheets[0].rows | length')
  COUNT=$((TOTAL - START_IDX))
fi
echo "{\"h\": $HEADER_IDX, \"s\": $START_IDX, \"n\": $COUNT}"