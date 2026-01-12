// background.js
// Flow: navigate to search URL -> scan -> check profile -> reply -> repeat

let activeTabId = null;
let isRunning = false;
let checkedAuthors = new Set(); // Track authors we've already checked this session
let sessionReplies = []; // Track successful replies this session { author, followers }
let sessionLimit = 5; // Current session limit (set when starting)
let consecutiveErrors = 0; // Track consecutive errors for auto-pause
const MAX_CONSECUTIVE_ERRORS = 3; // Pause after this many errors in a row

async function log(text, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `[${timestamp}] ${text}`;
  const logEntry = { timestamp, message: fullMessage, type };
  
  console.log('[Sniper ' + timestamp + '] ' + text);
  
  // Store log in chrome.storage so it persists even when popup is closed
  try {
    const data = await chrome.storage.local.get(['logs']);
    const logs = data.logs || [];
    logs.push(logEntry);
    // Keep only last 100 logs
    if (logs.length > 100) logs.shift();
    await chrome.storage.local.set({ logs });
  } catch (e) {
    console.error('Failed to save log:', e);
  }
  
  // Also try to send to popup if it's open
  chrome.runtime.sendMessage({ type: 'LOG', text, logType: type }).catch(() => {});
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Countdown with live updates to popup
async function countdownWithUpdates(totalMs, label) {
  const totalSecs = Math.round(totalMs / 1000);
  for (let remaining = totalSecs; remaining > 0; remaining--) {
    if (!isRunning) return; // Stop if sniper was stopped
    chrome.runtime.sendMessage({ 
      type: 'COUNTDOWN', 
      remaining, 
      total: totalSecs,
      label 
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
  }
  // Clear countdown
  chrome.runtime.sendMessage({ type: 'COUNTDOWN', remaining: 0, label: '' }).catch(() => {});
}

async function injectAndWait() {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ['content.js']
    });
  } catch (e) {}
  await new Promise(r => setTimeout(r, 500));
}

async function sendToContent(message) {
  try {
    await injectAndWait();
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch (e) {
    log('⚠️ Connection error: ' + e.message, 'error');
    return null;
  }
}

function waitForPageLoad() {
  return new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === activeTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 2500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

// Check if X page loaded properly or shows error/rate limit signs
async function checkPageHealth() {
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, { type: 'CHECK_PAGE_HEALTH' });
    return result;
  } catch (e) {
    return { healthy: false, reason: 'connection_failed' };
  }
}

async function removeUsedReply(usedReply) {
  const settings = await chrome.storage.local.get(['replies']);
  const replies = (settings.replies || '').split('\n').map(r => r.trim()).filter(r => r);
  const index = replies.indexOf(usedReply);
  if (index > -1) {
    replies.splice(index, 1);
    await chrome.storage.local.set({ replies: replies.join('\n') });
    log('🔄 Removed used reply from bank (' + replies.length + ' remaining)', 'info');
    // Notify popup to refresh
    chrome.runtime.sendMessage({ type: 'REPLIES_UPDATED', count: replies.length }).catch(() => {});
  }
}

async function runCycle() {
  if (!isRunning) return;
  
  // Reset session replies if this is a fresh start (count is 0)
  const preCheck = await chrome.storage.local.get(['sessionCount']);
  if ((preCheck.sessionCount || 0) === 0) {
    sessionReplies = [];
  }
  
  const settings = await chrome.storage.local.get([
    'isRunning', 'sessionCount', 'sessionLimit', 'minFollowers', 'minLikes',
    'maxAge', 'cooldownMin', 'cooldownMax', 'scanMin', 'scanMax',
    'replies', 'repliedTweets'
  ]);
  
  if (!settings.isRunning) {
    isRunning = false;
    return;
  }
  
  const sessionCount = settings.sessionCount || 0;
  sessionLimit = settings.sessionLimit || 5;
  const minLikes = settings.minLikes || 20;
  const minFollowers = settings.minFollowers || 1000000;
  const maxAge = settings.maxAge || 1;
  
  if (sessionCount >= sessionLimit) {
    log('🎉 SESSION COMPLETE! Successfully sent ' + sessionCount + '/' + sessionLimit + ' replies!', 'success');
    log('🏆 Great work! The sniper has finished this session.', 'success');
    await chrome.storage.local.set({ isRunning: false });
    isRunning = false;
    // Send completion alert with session details
    chrome.runtime.sendMessage({ 
      type: 'SESSION_COMPLETE', 
      reason: 'limit_reached',
      count: sessionCount,
      limit: sessionLimit,
      replies: sessionReplies
    }).catch(() => {});
    sessionReplies = []; // Reset for next session
    return;
  }
  
  // Check if we have replies available BEFORE starting the cycle
  const replies = (settings.replies || '').split('\n').map(r => r.trim()).filter(r => r);
  if (replies.length === 0) {
    log('⚠️ REPLY BANK EMPTY! Add more replies to continue.', 'error');
    log('📝 Session ended: ' + sessionCount + '/' + sessionLimit + ' replies sent before running out.', 'warn');
    await chrome.storage.local.set({ isRunning: false });
    isRunning = false;
    // Send alert
    chrome.runtime.sendMessage({ 
      type: 'SESSION_COMPLETE', 
      reason: 'no_replies',
      count: sessionCount,
      limit: sessionLimit
    }).catch(() => {});
    return;
  }
  
  try {
    // STEP 1: Navigate to search
    const query = `min_faves:${minLikes} filter:media -filter:retweets`;
    log('🔍 Loading search: ' + query, 'action');
    
    await sendToContent({ type: 'NAVIGATE_SEARCH', minLikes: minLikes });
    await waitForPageLoad();
    
    // Check if user stopped during page load
    if (!isRunning) return;
    
    // Check if page loaded properly
    const health = await checkPageHealth();
    if (!health.healthy) {
      consecutiveErrors++;
      if (health.reason === 'rate_limited') {
        log('⚠️ X may be rate limiting - page shows error or is slow to load', 'error');
      } else if (health.reason === 'no_content') {
        log('⚠️ Page loaded but no content found - possible connection issue', 'error');
      } else {
        log('⚠️ Page failed to load properly', 'error');
      }
      
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log('🛑 Too many consecutive errors (' + consecutiveErrors + '). Auto-pausing to protect your account.', 'error');
        log('💡 Tip: Check your internet connection and make sure X isn\'t showing any warnings.', 'warn');
        await chrome.storage.local.set({ isRunning: false });
        isRunning = false;
        chrome.runtime.sendMessage({ 
          type: 'SESSION_COMPLETE', 
          reason: 'errors',
          count: sessionCount,
          limit: sessionLimit,
          replies: sessionReplies
        }).catch(() => {});
        return;
      }
      
      // Wait longer before retry (check if still running first)
      if (!isRunning) return;
      log('⏳ Waiting 30s before retry...', 'warn');
      await countdownWithUpdates(30000, 'Error recovery');
      if (isRunning) runCycle();
      return;
    }
    
    // Reset error counter on successful page load
    consecutiveErrors = 0;
    
    // STEP 2: Scan for fresh tweets
    log('👀 Scanning for tweets <' + maxAge + 'm old...', 'info');
    
    const scanResult = await sendToContent({
      type: 'SCAN_TWEETS',
      minFollowers: minFollowers,
      maxAge: maxAge,
      repliedTweets: settings.repliedTweets || []
    });
    
    if (!scanResult?.found || !scanResult.candidate) {
      log('😴 No fresh tweets found, waiting...', 'scan');
      scheduleNextCycle(settings);
      return;
    }
    
    const candidate = scanResult.candidate;
    
    // Check if we already processed this author this session
    if (checkedAuthors.has(candidate.author)) {
      log('⏭️ Already checked @' + candidate.author + ' this session, skipping', 'scan');
      
      // Add to replied list so we skip this tweet - fetch fresh data to avoid race conditions
      const freshData = await chrome.storage.local.get(['repliedTweets']);
      const repliedTweets = freshData.repliedTweets || [];
      repliedTweets.push(candidate.id);
      if (repliedTweets.length > 200) repliedTweets.shift();
      await chrome.storage.local.set({ repliedTweets });
      
      scheduleNextCycle(settings);
      return;
    }
    
    log('🐦 Found potential target: @' + candidate.author + ' (tweet is ' + candidate.age + ' old)', 'info');
    
    // STEP 3: Check followers
    log('👤 Clicking profile to check followers...', 'action');
    checkedAuthors.add(candidate.author); // Mark as checked
    
    const followerResult = await sendToContent({
      type: 'CHECK_FOLLOWERS',
      author: candidate.author,
      minFollowers: minFollowers
    });
    
    if (!followerResult?.success) {
      log('❌ Failed to check followers: ' + (followerResult?.error || 'unknown'), 'error');
      scheduleNextCycle(settings);
      return;
    }
    
    const followers = followerResult.followers || 0;
    
    if (!followerResult.meetsThreshold) {
      log('👎 @' + candidate.author + ' has ' + formatNumber(followers) + ' followers (need ' + formatNumber(minFollowers) + '+), skipping', 'scan');
      scheduleNextCycle(settings);
      return;
    }
    
    // STEP 4: We have a match!
    log('🎯 TARGET ACQUIRED! @' + candidate.author + ' has ' + formatNumber(followers) + ' followers - ENGAGING!', 'match');
    
    // Re-fetch replies in case they changed
    const freshSettings = await chrome.storage.local.get(['replies']);
    const replies = (freshSettings.replies || '').split('\n').map(r => r.trim()).filter(r => r);
    if (replies.length === 0) {
      log('⚠️ REPLY BANK EMPTY! Add more replies to continue.', 'error');
      await chrome.storage.local.set({ isRunning: false });
      isRunning = false;
      chrome.runtime.sendMessage({ 
        type: 'SESSION_COMPLETE', 
        reason: 'no_replies',
        count: sessionCount,
        limit: sessionLimit,
        replies: sessionReplies
      }).catch(() => {});
      sessionReplies = []; // Reset for next session
      return;
    }
    
    const selectedReply = replies[Math.floor(Math.random() * replies.length)];
    log('💬 Picked reply (' + replies.length + ' in bank): "' + selectedReply.substring(0, 50) + (selectedReply.length > 50 ? '...' : '') + '"', 'action');
    
    // STEP 5: Send reply
    log('📤 Submitting reply to @' + candidate.author + '\'s tweet...', 'action');
    
    const replyResult = await sendToContent({
      type: 'REPLY_TO_TWEET',
      tweetId: candidate.id,
      reply: selectedReply
    });
    
    if (!replyResult?.success) {
      log('❌ Reply failed: ' + (replyResult?.error || 'unknown'), 'error');
      scheduleNextCycle(settings);
      return;
    }
    
    // SUCCESS!
    consecutiveErrors = 0; // Reset error counter on success
    const newCount = sessionCount + 1;
    
    // IMPORTANT: Fetch fresh repliedTweets to avoid race condition / stale data causing double posts
    const freshData = await chrome.storage.local.get(['repliedTweets']);
    const repliedTweets = freshData.repliedTweets || [];
    repliedTweets.push(candidate.id);
    if (repliedTweets.length > 200) repliedTweets.shift();
    
    // Track this successful reply for session summary
    sessionReplies.push({ author: candidate.author, followers: followers });

    await chrome.storage.local.set({ sessionCount: newCount, repliedTweets });
    log('✅ REPLY POSTED! Successfully commented on @' + candidate.author + '\'s tweet! (' + newCount + '/' + sessionLimit + ' this session)', 'success');
    
    // Remove used reply from bank
    await removeUsedReply(selectedReply);
    
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', isRunning: true, sessionCount: newCount }).catch(() => {});
    
    // Check if we've reached the limit - if so, skip cooldown and end session
    if (newCount >= sessionLimit) {
      log('🎉 SESSION COMPLETE! Successfully sent ' + newCount + '/' + sessionLimit + ' replies!', 'success');
      log('🏆 Great work! The sniper has finished this session.', 'success');
      await chrome.storage.local.set({ isRunning: false });
      isRunning = false;
      chrome.runtime.sendMessage({ 
        type: 'SESSION_COMPLETE', 
        reason: 'limit_reached',
        count: newCount,
        limit: sessionLimit,
        replies: sessionReplies
      }).catch(() => {});
      sessionReplies = [];
      return;
    }
    
    // Check if reply bank is now empty - if so, skip cooldown and end session
    const remainingReplies = await chrome.storage.local.get(['replies']);
    const repliesLeft = (remainingReplies.replies || '').split('\n').map(r => r.trim()).filter(r => r);
    if (repliesLeft.length === 0) {
      log('⚠️ REPLY BANK EMPTY! Add more replies to continue.', 'error');
      log('📝 Session ended: ' + newCount + '/' + sessionLimit + ' replies sent before running out.', 'warn');
      await chrome.storage.local.set({ isRunning: false });
      isRunning = false;
      chrome.runtime.sendMessage({ 
        type: 'SESSION_COMPLETE', 
        reason: 'no_replies',
        count: newCount,
        limit: sessionLimit,
        replies: sessionReplies
      }).catch(() => {});
      sessionReplies = [];
      return;
    }
    
    // Cooldown after successful reply (only if not done and have more replies)
    const cooldown = randomDelay(
      (settings.cooldownMin || 30) * 1000,
      (settings.cooldownMax || 60) * 1000
    );
    log('⏳ Cooldown: ' + Math.round(cooldown/1000) + 's before next search...', 'warn');
    await countdownWithUpdates(cooldown, 'Cooldown');
    
    // After cooldown, go directly to next cycle (no additional scan delay)
    if (isRunning) runCycle();
    return;
    
  } catch (err) {
    log('❌ Error: ' + err.message, 'error');
  }
  
  scheduleNextCycle(settings);
}

function scheduleNextCycle(settings) {
  if (!isRunning) return;
  
  const delay = randomDelay(
    (settings.scanMin || 8) * 1000,
    (settings.scanMax || 15) * 1000
  );
  log('🔄 Next scan in ' + Math.round(delay/1000) + 's...', 'info');
  
  // Run countdown then trigger next cycle
  countdownWithUpdates(delay, 'Next scan').then(() => {
    if (isRunning) runCycle();
  });
}

async function startSniper(tabId) {
  activeTabId = tabId;
  isRunning = true;
  checkedAuthors.clear(); // Reset checked authors for new session
  sessionReplies = []; // Reset session replies
  consecutiveErrors = 0; // Reset error counter
  await chrome.storage.local.set({ sessionCount: 0 });
  
  // Log startup with settings summary
  const settings = await chrome.storage.local.get([
    'minFollowers', 'minLikes', 'maxAge', 'sessionLimit',
    'cooldownMin', 'cooldownMax', 'scanMin', 'scanMax', 'replies'
  ]);
  
  const replies = (settings.replies || '').split('\n').map(r => r.trim()).filter(r => r);
  const minFollowers = settings.minFollowers || 1000000;
  const minLikes = settings.minLikes || 20;
  const maxAge = settings.maxAge || 1;
  sessionLimit = settings.sessionLimit || 5;
  
  log('🚀 Starting sniper! Target: ' + formatNumber(minFollowers) + '+ followers, ' + 
      minLikes + '+ likes, <' + maxAge + 'm old | Limit: ' + sessionLimit + ' replies | Bank: ' + replies.length, 'success');
  
  runCycle();
}

function stopSniper() {
  isRunning = false;
  checkedAuthors.clear();
  activeTabId = null;
  log('🛑 Sniper stopped', 'warn');
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'START_SNIPER') {
    startSniper(msg.tabId);
    respond({ success: true });
  } else if (msg.type === 'STOP_SNIPER') {
    // Return session data before stopping so popup can show summary
    const summaryData = {
      success: true,
      count: sessionReplies.length,
      limit: sessionLimit,
      replies: [...sessionReplies]
    };
    stopSniper();
    respond(summaryData);
  }
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    chrome.storage.local.set({ isRunning: false });
    stopSniper();
  }
});
