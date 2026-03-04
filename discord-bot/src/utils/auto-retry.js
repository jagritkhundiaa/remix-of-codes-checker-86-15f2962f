// ============================================================
//  Auto-Retry — automatically retry rate-limited/timed-out items
//  Retries items that failed due to transient errors, not bad creds
// ============================================================

const RETRYABLE_ERRORS = [
  "rate limit",
  "429",
  "timeout",
  "abort",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "fetch failed",
  "network",
  "max retries",
];

function isRetryable(result) {
  // For check results
  if (result.status === "error") {
    const err = (result.error || "").toLowerCase();
    return RETRYABLE_ERRORS.some((k) => err.includes(k));
  }
  // For claim/changer results
  if (result.success === false) {
    const err = (result.error || "").toLowerCase();
    // Don't retry bad credentials
    if (err.includes("invalid") || err.includes("password") || err.includes("locked") || err.includes("credentials")) {
      return false;
    }
    return RETRYABLE_ERRORS.some((k) => err.includes(k));
  }
  return false;
}

/**
 * Wraps a batch processor to automatically retry failed items.
 * @param {Function} processFn - The original batch function (e.g. checkCodes, claimWlids)
 * @param {Array} allResults - Results from first run
 * @param {Array} originalItems - Original input items matching results by index
 * @param {number} maxRetries - Max retry rounds (default 2)
 * @param {Function} onRetryStart - Called when a retry round starts (retryRound, retryCount)
 * @returns {Array} Updated results with retried items merged in
 */
async function autoRetry(processFn, allResults, originalItems, maxRetries = 2, onRetryStart = null) {
  let results = [...allResults];
  
  for (let round = 1; round <= maxRetries; round++) {
    // Find retryable failures
    const retryIndices = [];
    const retryItems = [];
    
    for (let i = 0; i < results.length; i++) {
      if (isRetryable(results[i])) {
        retryIndices.push(i);
        retryItems.push(originalItems[i]);
      }
    }
    
    if (retryItems.length === 0) break;
    
    console.log(`[Auto-Retry] Round ${round}: retrying ${retryItems.length} items`);
    if (onRetryStart) onRetryStart(round, retryItems.length);
    
    // Wait before retry (exponential backoff)
    await new Promise((r) => setTimeout(r, 3000 * round));
    
    const retryResults = await processFn(retryItems);
    
    // Merge retry results back
    for (let i = 0; i < retryIndices.length; i++) {
      if (retryResults[i]) {
        results[retryIndices[i]] = retryResults[i];
      }
    }
    
    const stillFailed = retryResults.filter((r) => isRetryable(r)).length;
    console.log(`[Auto-Retry] Round ${round} complete: ${retryItems.length - stillFailed}/${retryItems.length} recovered`);
    
    if (stillFailed === 0) break;
  }
  
  return results;
}

module.exports = { autoRetry, isRetryable };
