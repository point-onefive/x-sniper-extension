// content.js - X Sniper
// IMPORTANT: Everything must be inside this guard to prevent duplicate listeners

if (!window.__xSniperLoaded) {
  window.__xSniperLoaded = true;
  console.log('[X Sniper] Loaded (first time only)');

  // Navigate directly to search URL with correct query
  window.__xSniper_navigateToSearch = function(minLikes) {
    const query = `min_faves:${minLikes} filter:media -filter:retweets`;
    const encoded = encodeURIComponent(query);
    const url = `https://x.com/search?q=${encoded}&src=typed_query&f=live`;
    console.log('[X Sniper] Navigating to: ' + url);
    window.location.href = url;
    return { success: true };
  };

  // Dismiss any popups/modals that might block interaction
  window.__xSniper_dismissPopups = function() {
    let dismissed = 0;
    
    // Common X popup dismiss patterns
    const dismissSelectors = [
      // Close buttons (X icons)
      '[data-testid="xMigrationBottomBar"] [role="button"]', // Migration banner
      '[aria-label="Close"]',
      '[data-testid="app-bar-close"]',
      // "Not now" / "Maybe later" / dismiss buttons
      '[role="button"][tabindex="0"]',
    ];
    
    // Look for modal/dialog backdrops and try to close them
    const layers = document.querySelectorAll('[data-testid="sheetDialog"], [role="dialog"], [aria-modal="true"]');
    
    for (const layer of layers) {
      // Try to find close button within the modal
      const closeBtn = layer.querySelector('[aria-label="Close"], [data-testid="app-bar-close"]');
      if (closeBtn) {
        console.log('[X Sniper] Dismissing modal via close button');
        closeBtn.click();
        dismissed++;
        continue;
      }
      
      // Look for "Not now", "Maybe later", "No thanks", "Check it out" type buttons to dismiss
      const buttons = layer.querySelectorAll('[role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        if (text.includes('not now') || text.includes('maybe later') || text.includes('no thanks') || 
            text.includes('dismiss') || text.includes('skip') || text.includes('close') ||
            text.includes('got it') || text.includes('ok')) {
          console.log('[X Sniper] Dismissing modal via: ' + btn.textContent);
          btn.click();
          dismissed++;
          break;
        }
      }
    }
    
    // Also check for the bottom sheets/drawers that X uses
    const bottomSheet = document.querySelector('[data-testid="BottomSheet"]');
    if (bottomSheet) {
      const closeBtn = bottomSheet.querySelector('[aria-label="Close"], [role="button"]');
      if (closeBtn) {
        console.log('[X Sniper] Dismissing bottom sheet');
        closeBtn.click();
        dismissed++;
      }
    }
    
    // Try pressing Escape key as fallback
    if (layers.length > 0 && dismissed === 0) {
      console.log('[X Sniper] Pressing Escape to dismiss modal');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      dismissed++;
    }
    
    return { dismissed };
  };

  // Check if the page is healthy (not rate limited, loaded properly)
  window.__xSniper_checkPageHealth = function() {
    // First try to dismiss any popups
    window.__xSniper_dismissPopups();
    
    // Check for error messages that indicate rate limiting or issues
    const bodyText = document.body?.innerText || '';
    const pageContent = document.documentElement?.innerHTML || '';
    
    // Signs of rate limiting or errors
    const errorSigns = [
      'Something went wrong',
      'Try again',
      'Rate limit',
      'temporarily limited',
      'unusual activity',
      'Hmm...this page doesn',
      'took too long to load'
    ];
    
    for (const sign of errorSigns) {
      if (bodyText.includes(sign) || pageContent.includes(sign)) {
        console.log('[X Sniper] Detected possible issue: ' + sign);
        return { healthy: false, reason: 'rate_limited' };
      }
    }
    
    // Check if there's actual content on the page
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    const hasMainContent = document.querySelector('[data-testid="primaryColumn"]');
    
    // If we're on search and see no tweets after load, might be an issue
    if (window.location.href.includes('/search') && tweets.length === 0 && hasMainContent) {
      // Give it a bit more time - could just be slow
      console.log('[X Sniper] No tweets found on search page');
      return { healthy: true, reason: 'no_tweets' }; // Not necessarily unhealthy
    }
    
    // If no main content at all, page didn't load
    if (!hasMainContent) {
      console.log('[X Sniper] No main content found - page may not have loaded');
      return { healthy: false, reason: 'no_content' };
    }
    
    return { healthy: true };
  };

  // Click Latest tab if needed
  window.__xSniper_clickLatest = async function() {
    console.log('[X Sniper] Clicking Latest...');
    await new Promise(r => setTimeout(r, 1000));
    
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      if (tab.textContent && tab.textContent.toLowerCase().includes('latest')) {
        tab.click();
        return { success: true };
      }
    }
    return { success: true };
  };

  // Scan tweets
  window.__xSniper_scanTweets = async function(minFollowers, maxAgeMinutes, repliedTweets) {
    repliedTweets = repliedTweets || [];
    const maxAgeSeconds = maxAgeMinutes * 60;
    
    console.log('[X Sniper] Scanning: <' + maxAgeMinutes + 'm old');
    
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    console.log('[X Sniper] Found ' + articles.length + ' tweets');
    
    for (let i = 0; i < Math.min(articles.length, 10); i++) {
      const article = articles[i];
      
      try {
        const statusLink = article.querySelector('a[href*="/status/"]');
        if (!statusLink) continue;
        
        const href = statusLink.getAttribute('href');
        const match = href.match(/\/status\/(\d+)/);
        if (!match) continue;
        
        const tweetId = match[1];
        
        if (repliedTweets.includes(tweetId)) {
          console.log('[X Sniper] Already replied to ' + tweetId);
          continue;
        }
        
        const userLink = article.querySelector('a[href^="/"][role="link"]');
        if (!userLink) continue;
        
        const authorHref = userLink.getAttribute('href');
        const author = authorHref.replace('/', '');
        
        const timeEl = article.querySelector('time');
        if (!timeEl) continue;
        
        const datetime = timeEl.getAttribute('datetime');
        const tweetTime = new Date(datetime).getTime();
        const ageSeconds = Math.floor((Date.now() - tweetTime) / 1000);
        
        const ageStr = ageSeconds < 60 ? ageSeconds + 's' : Math.floor(ageSeconds / 60) + 'm';
        
        console.log('[X Sniper] Tweet #' + i + ': @' + author + ', ' + ageStr + ' old');
        
        if (ageSeconds <= maxAgeSeconds) {
          return { found: true, candidate: { id: tweetId, author: author, age: ageStr } };
        }
      } catch (e) {
        console.log('[X Sniper] Error: ' + e.message);
      }
    }
    
    return { found: false };
  };

  // Check followers
  window.__xSniper_checkFollowers = async function(author, minFollowers) {
    console.log('[X Sniper] Checking @' + author + ' followers...');
    
    // Dismiss any popups first
    window.__xSniper_dismissPopups();
    await new Promise(r => setTimeout(r, 300));
    
    try {
      const profileLinks = document.querySelectorAll('a[href="/' + author + '"]');
      let clicked = false;
      
      for (const link of profileLinks) {
        if (!link.href.includes('/status/')) {
          link.click();
          clicked = true;
          break;
        }
      }
      
      if (!clicked) return { success: false, error: 'Profile link not found' };
      
      await new Promise(r => setTimeout(r, 2500));
      
      // Dismiss any popups that appeared after clicking profile (like Communities popup)
      window.__xSniper_dismissPopups();
      await new Promise(r => setTimeout(r, 500));
      
      // Parse followers
      const links = document.querySelectorAll('a[href$="/verified_followers"], a[href$="/followers"]');
      let followers = 0;
      
      for (const link of links) {
        const text = link.textContent || '';
        const match = text.match(/([\d,.]+)\s*([KMB]?)/i);
        if (match) {
          let num = parseFloat(match[1].replace(/,/g, ''));
          const suffix = (match[2] || '').toUpperCase();
          if (suffix === 'K') num *= 1000;
          if (suffix === 'M') num *= 1000000;
          if (suffix === 'B') num *= 1000000000;
          followers = Math.floor(num);
          break;
        }
      }
      
      console.log('[X Sniper] @' + author + ' has ' + followers + ' followers');
      
      return { success: true, followers: followers, meetsThreshold: followers >= minFollowers };
      
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  // Helper: Insert text using execCommand (works with contenteditable)
  async function insertTextIntoEditor(element, text) {
    console.log('[X Sniper] insertTextIntoEditor called');
    
    // Find the contenteditable div
    const editable = element.querySelector('[contenteditable="true"]') || element;
    console.log('[X Sniper] Found editable:', editable.tagName, editable.getAttribute('contenteditable'));
    
    // Focus and click
    editable.focus();
    await new Promise(r => setTimeout(r, 100));
    editable.click();
    await new Promise(r => setTimeout(r, 100));
    
    // Place cursor at start
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    
    await new Promise(r => setTimeout(r, 100));
    
    // Method 1: execCommand insertText
    console.log('[X Sniper] Trying execCommand insertText...');
    const result = document.execCommand('insertText', false, text);
    console.log('[X Sniper] execCommand result:', result);
    
    if (!result || !editable.textContent) {
      // Method 2: Direct DOM manipulation with events
      console.log('[X Sniper] Falling back to direct insertion...');
      
      // Create a text node
      const textNode = document.createTextNode(text);
      editable.innerHTML = '';
      editable.appendChild(textNode);
      
      // Move cursor to end
      range.selectNodeContents(editable);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Fire input event
      editable.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data: text
      }));
    }
    
    await new Promise(r => setTimeout(r, 300));
    
    const content = editable.textContent || editable.innerText || '';
    console.log('[X Sniper] Final content:', content.substring(0, 50));
    return content;
  }

  // Reply to tweet
  window.__xSniper_replyToTweet = async function(tweetId, replyText) {
    console.log('[X Sniper] Replying with: ' + replyText);
    
    // Dismiss any popups first
    window.__xSniper_dismissPopups();
    await new Promise(r => setTimeout(r, 300));
    
    try {
      // Find tweet
      let article = null;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      
      for (const a of articles) {
        if (a.querySelector('a[href*="/status/' + tweetId + '"]')) {
          article = a;
          break;
        }
      }
      
      if (!article) {
        window.scrollTo(0, 300);
        await new Promise(r => setTimeout(r, 1000));
        
        const articles2 = document.querySelectorAll('article[data-testid="tweet"]');
        for (const a of articles2) {
          if (a.querySelector('a[href*="/status/' + tweetId + '"]')) {
            article = a;
            break;
          }
        }
      }
      
      if (!article) return { success: false, error: 'Tweet not found' };
      
      // Click reply button
      const replyBtn = article.querySelector('[data-testid="reply"]');
      if (!replyBtn) return { success: false, error: 'Reply button not found' };
      
      replyBtn.click();
      await new Promise(r => setTimeout(r, 2000));
      
      // Find reply box - try multiple selectors
      let replyBox = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!replyBox) {
        replyBox = document.querySelector('[data-testid="tweetTextarea_0RichTextInputContainer"]');
      }
      if (!replyBox) {
        replyBox = document.querySelector('[role="textbox"]');
      }
      if (!replyBox) {
        // Look in the modal
        const modal = document.querySelector('[aria-modal="true"]');
        if (modal) {
          replyBox = modal.querySelector('[contenteditable="true"]');
        }
      }
      
      console.log('[X Sniper] Reply box found:', !!replyBox);
      if (!replyBox) return { success: false, error: 'Reply box not found' };
      
      // Type the reply
      console.log('[X Sniper] Typing reply...');
      const typed = await insertTextIntoEditor(replyBox, replyText);
      console.log('[X Sniper] Typed content: "' + typed.substring(0, 30) + '..."');
      
      // Wait for UI to update
      await new Promise(r => setTimeout(r, 1000));
      
      // Check if send button is enabled
      let sendBtn = document.querySelector('[data-testid="tweetButton"]');
      if (!sendBtn) {
        // Try in modal
        const modal = document.querySelector('[aria-modal="true"]');
        if (modal) {
          sendBtn = modal.querySelector('[data-testid="tweetButton"]');
        }
      }
      
      if (!sendBtn) return { success: false, error: 'Send button not found' };
      
      // Check various disabled states
      const isDisabled = sendBtn.disabled || 
                         sendBtn.getAttribute('aria-disabled') === 'true' ||
                         sendBtn.hasAttribute('disabled');
      
      if (isDisabled) {
        console.log('[X Sniper] Send button still disabled, text may not have registered');
        return { success: false, error: 'Send button disabled - text not registered' };
      }
      
      console.log('[X Sniper] Clicking send...');
      sendBtn.click();
      await new Promise(r => setTimeout(r, 2000));
      
      return { success: true };
      
    } catch (err) {
      console.log('[X Sniper] Reply error: ' + err.message);
      return { success: false, error: err.message };
    }
  };

  // Go back
  window.__xSniper_goBack = function() {
    window.history.back();
    return { success: true };
  };

  // Scroll top
  window.__xSniper_scrollTop = function() {
    window.scrollTo(0, 0);
    return { success: true };
  };

  // Message handler - ONLY registered once
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    console.log('[X Sniper] Msg:', msg.type);
    
    if (msg.type === 'NAVIGATE_SEARCH') {
      respond(window.__xSniper_navigateToSearch(msg.minLikes));
      return false;
    }
    if (msg.type === 'CLICK_LATEST') {
      window.__xSniper_clickLatest().then(respond);
      return true;
    }
    if (msg.type === 'SCAN_TWEETS') {
      window.__xSniper_scanTweets(msg.minFollowers, msg.maxAge, msg.repliedTweets).then(respond);
      return true;
    }
    if (msg.type === 'CHECK_FOLLOWERS') {
      window.__xSniper_checkFollowers(msg.author, msg.minFollowers).then(respond);
      return true;
    }
    if (msg.type === 'REPLY_TO_TWEET') {
      window.__xSniper_replyToTweet(msg.tweetId, msg.reply).then(respond);
      return true;
    }
    if (msg.type === 'GO_BACK') {
      respond(window.__xSniper_goBack());
      return false;
    }
    if (msg.type === 'SCROLL_TOP') {
      respond(window.__xSniper_scrollTop());
      return false;
    }
    if (msg.type === 'CHECK_PAGE_HEALTH') {
      respond(window.__xSniper_checkPageHealth());
      return false;
    }
    if (msg.type === 'DISMISS_POPUPS') {
      respond(window.__xSniper_dismissPopups());
      return false;
    }
    return false;
  });

  console.log('[X Sniper] Ready');
}
