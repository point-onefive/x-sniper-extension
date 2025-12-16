// popup.js - Settings UI and controls

document.addEventListener('DOMContentLoaded', async () => {
  // Check if terms have been accepted
  const termsData = await chrome.storage.local.get(['termsAccepted']);
  const termsModal = document.getElementById('termsModal');
  const termsCheckbox = document.getElementById('termsCheckbox');
  const acceptTermsBtn = document.getElementById('acceptTermsBtn');
  const viewTermsLink = document.getElementById('viewTermsLink');
  
  if (!termsData.termsAccepted) {
    termsModal.classList.remove('hidden');
  }
  
  // Terms checkbox enables accept button
  termsCheckbox.addEventListener('change', () => {
    acceptTermsBtn.disabled = !termsCheckbox.checked;
  });
  
  // Accept terms
  acceptTermsBtn.addEventListener('click', async () => {
    if (termsCheckbox.checked) {
      await chrome.storage.local.set({ termsAccepted: true, termsAcceptedDate: new Date().toISOString() });
      termsModal.classList.add('hidden');
    }
  });
  
  // View terms link in footer
  viewTermsLink.addEventListener('click', (e) => {
    e.preventDefault();
    termsModal.classList.remove('hidden');
    termsCheckbox.checked = true;
    acceptTermsBtn.disabled = false;
  });
  
  // Elements
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const statsEl = document.getElementById('stats');
  const logEl = document.getElementById('log');
  
  // Settings inputs
  const minFollowersInput = document.getElementById('minFollowers');
  const minLikesInput = document.getElementById('minLikes');
  const maxAgeInput = document.getElementById('maxAge');
  const sessionLimitInput = document.getElementById('sessionLimit');
  const cooldownMinInput = document.getElementById('cooldownMin');
  const cooldownMaxInput = document.getElementById('cooldownMax');
  const scanMinInput = document.getElementById('scanMin');
  const scanMaxInput = document.getElementById('scanMax');
  const repliesTextarea = document.getElementById('replies');
  const replyCountEl = document.getElementById('replyCount');
  
  // Load saved settings
  const settings = await chrome.storage.local.get([
    'minFollowers',
    'minLikes',
    'maxAge', 
    'sessionLimit',
    'cooldownMin',
    'cooldownMax',
    'scanMin',
    'scanMax',
    'replies',
    'isRunning',
    'sessionCount',
    'logs'
  ]);
  
  // Apply settings to inputs (ensure no undefined values)
  minFollowersInput.value = settings.minFollowers !== undefined ? settings.minFollowers : 1000000;
  minLikesInput.value = settings.minLikes !== undefined ? settings.minLikes : 20;
  maxAgeInput.value = settings.maxAge !== undefined ? settings.maxAge : 1;
  sessionLimitInput.value = settings.sessionLimit !== undefined ? settings.sessionLimit : 5;
  cooldownMinInput.value = settings.cooldownMin !== undefined ? settings.cooldownMin : 10;
  cooldownMaxInput.value = settings.cooldownMax !== undefined ? settings.cooldownMax : 20;
  scanMinInput.value = settings.scanMin !== undefined ? settings.scanMin : 5;
  scanMaxInput.value = settings.scanMax !== undefined ? settings.scanMax : 10;
  repliesTextarea.value = settings.replies !== undefined ? settings.replies : '';
  
  // Update reply count
  updateReplyCount();
  
  // Show alert modal
  function showAlert(title, message, type = 'info') {
    // Remove any existing alert
    const existing = document.querySelector('.alert-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'alert-overlay';
    
    const bgColor = type === 'success' ? '#0d4228' : type === 'warning' ? '#3d2800' : '#192734';
    const borderColor = type === 'success' ? '#00ba7c' : type === 'warning' ? '#ffd000' : '#1d9bf0';
    
    overlay.innerHTML = `
      <div class="alert-box" style="background: ${bgColor}; border: 2px solid ${borderColor};">
        <div class="alert-title">${title}</div>
        <div class="alert-message">${message}</div>
        <button class="alert-btn" style="background: ${borderColor};">OK</button>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.alert-btn').addEventListener('click', () => {
      overlay.remove();
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  // Update status display
  function updateStatus(isRunning, sessionCount = 0, limit = null) {
    const sessionLimit = limit || parseInt(sessionLimitInput.value) || 10;
    statsEl.textContent = `${sessionCount} / ${sessionLimit}`;
    
    const runningNotice = document.getElementById('runningNotice');
    
    if (isRunning) {
      statusEl.textContent = 'RUNNING';
      statusEl.className = 'status running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      runningNotice.classList.remove('hidden');
    } else {
      statusEl.textContent = 'STOPPED';
      statusEl.className = 'status stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      runningNotice.classList.add('hidden');
    }
  }
  
  // Initialize status
  updateStatus(settings.isRunning ?? false, settings.sessionCount ?? 0, settings.sessionLimit ?? 10);
  
  // Load saved logs
  if (settings.logs && settings.logs.length > 0) {
    logEl.innerHTML = settings.logs.map(log => 
      `<div class="log-entry ${log.type || 'info'}">${log.message}</div>`
    ).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
  
  // Update reply count display
  function updateReplyCount() {
    const replies = repliesTextarea.value
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.length > 0);
    
    replyCountEl.textContent = `${replies.length} replies loaded`;
  }
  
  repliesTextarea.addEventListener('input', updateReplyCount);
  
  // Track last log count to detect new logs (declared early so addLog can update it)
  let lastLogCount = settings.logs?.length || 0;
  
  // Display log entry (no storage - background handles that)
  function displayLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }
  
  // Add log from popup (saves to storage too - for user actions)
  function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const fullMessage = `[${timestamp}] ${message}`;
    displayLog(fullMessage, type);
    
    // Save to storage and update lastLogCount to prevent duplicate display from polling
    chrome.storage.local.get(['logs'], (result) => {
      const logs = result.logs || [];
      logs.push({ timestamp, message: fullMessage, type });
      if (logs.length > 100) logs.shift();
      chrome.storage.local.set({ logs });
      // Update lastLogCount so polling doesn't re-display this log
      lastLogCount = logs.length;
    });
  }
  
  // Copy ChatGPT prompt
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const promptBox = document.getElementById('promptBox');
  
  if (copyPromptBtn && promptBox) {
    copyPromptBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(promptBox.textContent);
        const originalText = copyPromptBtn.textContent;
        copyPromptBtn.textContent = '✓ Copied!';
        copyPromptBtn.style.background = '#00ba7c';
        setTimeout(() => {
          copyPromptBtn.textContent = originalText;
          copyPromptBtn.style.background = '';
        }, 2000);
      } catch (e) {
        // Fallback: select text
        const range = document.createRange();
        range.selectNodeContents(promptBox);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        copyPromptBtn.textContent = 'Selected - Ctrl+C to copy';
      }
    });
  }
  
  // Format follower count for display
  function formatFollowers(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
  
  // Toast notification helper
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    
    // Auto-hide after 2 seconds
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }
  
  // Copy logs button
  const copyLogsBtn = document.getElementById('copyLogsBtn');
  if (copyLogsBtn) {
    copyLogsBtn.addEventListener('click', async () => {
      const logEntries = logEl.querySelectorAll('.log-entry');
      const logText = Array.from(logEntries).map(e => e.textContent).join('\n');
      
      try {
        await navigator.clipboard.writeText(logText);
        showToast('✓ Logs copied to clipboard!', 'success');
      } catch (e) {
        console.error('Failed to copy:', e);
        showToast('Failed to copy', 'warning');
      }
    });
  }
  
  // Clear logs button
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', async () => {
      logEl.innerHTML = '<div class="log-entry info">Logs cleared. Ready to snipe.</div>';
      await chrome.storage.local.set({ logs: [] });
      showToast('✓ Logs cleared!', 'success');
    });
  }
  
  // Save settings
  saveBtn.addEventListener('click', async () => {
    const replies = repliesTextarea.value
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.length > 0);
    
    if (replies.length === 0) {
      addLog('Error: Add at least one reply to the reply bank', 'error');
      return;
    }
    
    await chrome.storage.local.set({
      minFollowers: parseInt(minFollowersInput.value) || 750000,
      minLikes: parseInt(minLikesInput.value) || 20,
      maxAge: parseInt(maxAgeInput.value) || 40,
      sessionLimit: parseInt(sessionLimitInput.value) || 10,
      cooldownMin: parseInt(cooldownMinInput.value) || 10,
      cooldownMax: parseInt(cooldownMaxInput.value) || 20,
      scanMin: parseInt(scanMinInput.value) || 5,
      scanMax: parseInt(scanMaxInput.value) || 10,
      replies: repliesTextarea.value
    });
    
    // Visual feedback
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '✓ Saved!';
    saveBtn.style.background = '#00ba7c';
    setTimeout(() => {
      saveBtn.textContent = originalText;
      saveBtn.style.background = '';
    }, 2000);
    
    addLog(`Settings saved. ${replies.length} replies loaded.`, 'success');
  });
  
  // Start sniping
  startBtn.addEventListener('click', async () => {
    // Check if on x.com
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('x.com')) {
      addLog('Error: Navigate to x.com first', 'error');
      return;
    }
    
    // Check replies
    const replies = repliesTextarea.value
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.length > 0);
    
    if (replies.length === 0) {
      addLog('Error: Add replies to the reply bank first', 'error');
      return;
    }
    
    // Save settings first
    await chrome.storage.local.set({
      minFollowers: parseInt(minFollowersInput.value) || 750000,
      minLikes: parseInt(minLikesInput.value) || 20,
      maxAge: parseInt(maxAgeInput.value) || 40,
      sessionLimit: parseInt(sessionLimitInput.value) || 10,
      cooldownMin: parseInt(cooldownMinInput.value) || 10,
      cooldownMax: parseInt(cooldownMaxInput.value) || 20,
      scanMin: parseInt(scanMinInput.value) || 5,
      scanMax: parseInt(scanMaxInput.value) || 10,
      replies: repliesTextarea.value,
      isRunning: true,
      sessionCount: 0
    });
    
    // Clear logs for new session
    logEl.innerHTML = '';
    await chrome.storage.local.set({ logs: [] });
    lastLogCount = 0; // Reset log counter for new session
    
    updateStatus(true, 0, parseInt(sessionLimitInput.value) || 10);
    
    // Send start message to background (background will log the startup message)
    chrome.runtime.sendMessage({ type: 'START_SNIPER', tabId: tab.id });
  });
  
  // Stop sniping
  stopBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ isRunning: false });
    addLog('Sniper stopped by user', 'warn');
    
    // Hide countdown
    document.getElementById('countdownBar').classList.add('hidden');
    
    // Stop and get session summary
    chrome.runtime.sendMessage({ type: 'STOP_SNIPER' }, (response) => {
      if (response && response.count > 0) {
        // Build session summary
        let summaryHtml = '';
        if (response.replies && response.replies.length > 0) {
          const totalFollowers = response.replies.reduce((sum, r) => sum + r.followers, 0);
          const uniqueAuthors = [...new Set(response.replies.map(r => r.author))];
          summaryHtml = `<div style="margin-top: 12px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; font-size: 12px; line-height: 1.5;">`;
          summaryHtml += `<strong>📊 Session Summary:</strong><br>`;
          summaryHtml += `<span style="color: #1d9bf0;">Targets engaged:</span> ${uniqueAuthors.length} accounts<br>`;
          summaryHtml += `<span style="color: #00ba7c;">Combined reach:</span> ${formatFollowers(totalFollowers)} followers`;
          summaryHtml += `</div>`;
        }
        showAlert('📋 Session Stopped', 
          `You stopped the session after posting ${response.count}/${response.limit} replies.${summaryHtml}`, 
          'info');
      }
      updateStatus(false, 0, parseInt(sessionLimitInput.value) || 10);
    });
  });
  
  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LOG') {
      // Display the log and increment lastLogCount to prevent polling from re-displaying
      const timestamp = new Date().toLocaleTimeString();
      displayLog(`[${timestamp}] ${message.text}`, message.logType || 'info');
      lastLogCount++; // Prevent polling from showing this log again
    } else if (message.type === 'STATUS_UPDATE') {
      updateStatus(message.isRunning, message.sessionCount, message.sessionLimit || parseInt(sessionLimitInput.value) || 10);
    } else if (message.type === 'COUNTDOWN') {
      const countdownBar = document.getElementById('countdownBar');
      const countdownLabel = document.getElementById('countdownLabel');
      const countdownTimer = document.getElementById('countdownTimer');
      const countdownFill = document.getElementById('countdownFill');
      
      if (message.remaining > 0) {
        countdownBar.classList.remove('hidden');
        countdownLabel.textContent = message.label;
        countdownTimer.textContent = message.remaining + 's';
        const percent = (message.remaining / message.total) * 100;
        countdownFill.style.width = percent + '%';
      } else {
        countdownBar.classList.add('hidden');
      }
    } else if (message.type === 'SESSION_COMPLETE') {
      // Hide countdown and update status
      document.getElementById('countdownBar').classList.add('hidden');
      updateStatus(false, message.count, message.limit);
      
      // Build session summary
      let summaryHtml = '';
      if (message.replies && message.replies.length > 0) {
        const totalFollowers = message.replies.reduce((sum, r) => sum + r.followers, 0);
        const uniqueAuthors = [...new Set(message.replies.map(r => r.author))];
        summaryHtml = `<div style="margin-top: 12px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; font-size: 12px; line-height: 1.5;">`;
        summaryHtml += `<strong>📊 Session Summary:</strong><br>`;
        summaryHtml += `<span style="color: #1d9bf0;">Targets engaged:</span> ${uniqueAuthors.length} accounts<br>`;
        summaryHtml += `<span style="color: #00ba7c;">Combined reach:</span> ${formatFollowers(totalFollowers)} followers`;
        summaryHtml += `</div>`;
      }
      
      if (message.reason === 'limit_reached') {
        // Success - reached session limit
        showAlert('🎉 Session Complete!', 
          `Successfully posted ${message.count} replies! Great work!${summaryHtml}`, 
          'success');
      } else if (message.reason === 'no_replies') {
        // Stopped due to empty reply bank
        showAlert('⚠️ Reply Bank Empty', 
          `Posted ${message.count}/${message.limit} replies before running out. Add more replies to continue.${summaryHtml}`, 
          'warning');
      } else if (message.reason === 'errors') {
        // Stopped due to consecutive errors
        showAlert('🛑 Auto-Paused', 
          `Paused after multiple errors to protect your account. Posted ${message.count}/${message.limit} replies before stopping.<br><br><strong>Tips:</strong> Check your internet connection. If X is showing errors or warnings, wait 10-15 minutes before trying again.${summaryHtml}`, 
          'warning');
      }
    } else if (message.type === 'SCAN_STATUS') {
      if (message.status === 'searching') {
        statusEl.textContent = 'SCANNING';
        statusEl.className = 'status searching';
      } else if (message.status === 'cooldown') {
        statusEl.textContent = 'COOLDOWN';
        statusEl.className = 'status cooldown';
      }
    } else if (message.type === 'REPLIES_UPDATED') {
      // Reload replies from storage and update UI
      chrome.storage.local.get(['replies'], (result) => {
        repliesTextarea.value = result.replies || '';
        updateReplyCount();
      });
    }
  });
  
  // Poll for status updates and new logs (in case popup was closed and reopened)
  setInterval(async () => {
    const data = await chrome.storage.local.get(['isRunning', 'sessionCount', 'sessionLimit', 'logs']);
    if (data.isRunning !== undefined) {
      updateStatus(data.isRunning, data.sessionCount || 0, data.sessionLimit || 10);
    }
    
    // Check for new logs that were added while popup might have been closed
    const logs = data.logs || [];
    if (logs.length > lastLogCount) {
      // Add only the new logs
      for (let i = lastLogCount; i < logs.length; i++) {
        const log = logs[i];
        const entry = document.createElement('div');
        entry.className = `log-entry ${log.type || 'info'}`;
        entry.textContent = log.message;
        logEl.appendChild(entry);
      }
      logEl.scrollTop = logEl.scrollHeight;
      lastLogCount = logs.length;
    }
  }, 1000);
});

