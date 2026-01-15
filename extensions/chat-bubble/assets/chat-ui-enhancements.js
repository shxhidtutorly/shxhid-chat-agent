/* ============================================
   SHOPIFY SHOP-CHAT-AGENT - LOGIC & UI
   Updated with Shimmer Effect & Enhanced UI
   ============================================ */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  
  const CONFIG = {
    selectors: {
      container: '.shop-ai-chat-container',
      floatingGroup: '.shop-ai-floating-group',
      chatWindow: '.shop-ai-chat-window',
      messagesContainer: '.shop-ai-chat-messages',
      inputField: '.shop-ai-chat-input input',
      sendBtn: '.shop-ai-send-btn',
      closeBtn: '.shop-ai-chat-close',
      menuBtn: '.shop-ai-menu-btn',
      dropdownMenu: '.shop-ai-dropdown-menu',
      historyPanel: '.shop-ai-history-panel',
      historyList: '.shop-ai-history-list',
      backBtn: '.shop-ai-back-btn'
    },
    classes: {
      active: 'active',
      visible: 'visible',
      hidden: 'hidden',
      closing: 'closing',
      chatOpen: 'shop-ai-chat-open'
    },
    storageKey: 'shop-ai-chat-history'
  };

  // ============================================
  // STATE
  // ============================================
  
  let state = {
    isOpen: false,
    isMenuOpen: false,
    isHistoryOpen: false,
    chatHistory: []
  };

  let elements = {};

  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    
    cacheElements();
    loadChatHistory();
    injectUIElements(); // Main Injection
    bindEvents();
    
    // Animate in buttons on load
    setTimeout(showFloatingButtons, 500);
  }

  function cacheElements() {
    elements = {
      container: document.querySelector(CONFIG.selectors.container),
      floatingGroup: document.querySelector(CONFIG.selectors.floatingGroup),
      chatWindow: document.querySelector(CONFIG.selectors.chatWindow),
      messagesContainer: document.querySelector(CONFIG.selectors.messagesContainer),
      inputField: document.querySelector(CONFIG.selectors.inputField),
      sendBtn: document.querySelector(CONFIG.selectors.sendBtn),
      closeBtn: document.querySelector(CONFIG.selectors.closeBtn),
      menuBtn: document.querySelector(CONFIG.selectors.menuBtn),
      dropdownMenu: document.querySelector(CONFIG.selectors.dropdownMenu),
      historyPanel: document.querySelector(CONFIG.selectors.historyPanel),
      historyList: document.querySelector(CONFIG.selectors.historyList),
      backBtn: document.querySelector(CONFIG.selectors.backBtn)
    };
  }

  function setViewportHeight() {
    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
  }

  // ============================================
  // UI INJECTION
  // ============================================
  
  function injectUIElements() {
    const container = elements.container;
    if (!container) return;

    // 1. Inject Floating Buttons (if missing)
    if (!elements.floatingGroup) {
      container.insertAdjacentHTML('afterbegin', createFloatingButtonsHTML());
      elements.floatingGroup = container.querySelector(CONFIG.selectors.floatingGroup);
    }

    // 2. Inject or Update Chat Window Structure
    if (!elements.chatWindow) {
      container.insertAdjacentHTML('beforeend', createChatWindowHTML());
      elements.chatWindow = container.querySelector(CONFIG.selectors.chatWindow);
      // Re-cache specific chat elements
      elements.messagesContainer = elements.chatWindow.querySelector(CONFIG.selectors.messagesContainer);
      elements.inputField = elements.chatWindow.querySelector(CONFIG.selectors.inputField);
      elements.sendBtn = elements.chatWindow.querySelector(CONFIG.selectors.sendBtn);
      elements.closeBtn = elements.chatWindow.querySelector(CONFIG.selectors.closeBtn);
    }
    
    // 3. Inject Menu & History (if missing inside window)
    const headerActions = elements.chatWindow.querySelector('.shop-ai-header-actions');
    if (headerActions && !headerActions.querySelector('.shop-ai-menu-btn')) {
      headerActions.insertAdjacentHTML('afterbegin', createMenuButtonHTML());
      headerActions.insertAdjacentHTML('beforeend', createDropdownMenuHTML());
      elements.menuBtn = headerActions.querySelector('.shop-ai-menu-btn');
      elements.dropdownMenu = headerActions.querySelector(CONFIG.selectors.dropdownMenu);
    }

    if (!elements.historyPanel) {
      elements.chatWindow.insertAdjacentHTML('beforeend', createHistoryPanelHTML());
      elements.historyPanel = elements.chatWindow.querySelector(CONFIG.selectors.historyPanel);
      elements.historyList = elements.chatWindow.querySelector(CONFIG.selectors.historyList);
      elements.backBtn = elements.chatWindow.querySelector(CONFIG.selectors.backBtn);
    }
  }

  // --- HTML TEMPLATES ---

  function createFloatingButtonsHTML() {
    return `
      <div class="shop-ai-floating-group">
        <button class="shop-ai-secondary-btn" data-action="open-chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>Chat with AI</span>
        </button>
        <button class="shop-ai-primary-btn" data-action="open-chat">
          <span class="shop-ai-sparkle-icon">
             <svg viewBox="0 0 24 24" fill="none">
              <path class="shop-ai-sparkle-main" d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="currentColor"/>
              <path class="shop-ai-sparkle-small-1" d="M19 14L19.5 16.5L22 17L19.5 17.5L19 20L18.5 17.5L16 17L18.5 16.5L19 14Z" fill="currentColor"/>
            </svg>
          </span>
          <span>Ask our AI</span>
        </button>
      </div>
    `;
  }

  function createChatWindowHTML() {
    return `
      <div class="shop-ai-chat-window">
        <div class="shop-ai-chat-header">
          <div class="shop-ai-header-left">
            <div class="shop-ai-avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div class="shop-ai-header-info">
              <h3>Creative Assistant</h3>
              <p><span class="shop-ai-status-dot"></span> Online now</p>
            </div>
          </div>
          <div class="shop-ai-header-actions">
            <button class="shop-ai-header-btn shop-ai-chat-close" data-action="close-chat">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div class="shop-ai-chat-messages">
          <div class="shop-ai-message assistant">
            Hello! 👋 I can help you find products, check stock, or answer technical questions. How can I help today?
          </div>
        </div>

        <div class="shop-ai-chat-input">
          <div class="shop-ai-input-wrapper">
            <input type="text" placeholder="Ask me anything..." />
            <button class="shop-ai-send-btn" data-action="send-message">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>

        <div class="shop-ai-status-footer">
          <span class="shop-ai-status-pill">Ready to help</span>
        </div>
      </div>
    `;
  }

  function createMenuButtonHTML() {
    return `<button class="shop-ai-header-btn shop-ai-menu-btn" data-action="toggle-menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>`;
  }

  function createDropdownMenuHTML() {
    return `
      <div class="shop-ai-dropdown-menu">
        <button class="shop-ai-menu-item" data-action="new-chat"><span>Start new chat</span></button>
        <button class="shop-ai-menu-item" data-action="show-history"><span>History</span></button>
        <div style="height:1px;background:var(--border-light);margin:4px 0"></div>
        <button class="shop-ai-menu-item danger" data-action="close-chat"><span>Close</span></button>
      </div>
    `;
  }

  function createHistoryPanelHTML() {
    return `
      <div class="shop-ai-history-panel">
        <div class="shop-ai-history-header">
          <button class="shop-ai-back-btn" data-action="hide-history">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <h3>Recent Chats</h3>
        </div>
        <div class="shop-ai-history-list"></div>
      </div>
    `;
  }

  // ============================================
  // EVENT HANDLING
  // ============================================
  
  function bindEvents() {
    document.addEventListener('click', handleClick);
    
    // Input Enter Key
    if (elements.inputField) {
      elements.inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
      });
    }
  }

  function handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) {
      // Close menu if clicked outside
      if (state.isMenuOpen && elements.dropdownMenu && !elements.dropdownMenu.contains(e.target) && !elements.menuBtn.contains(e.target)) {
        closeMenu();
      }
      return;
    }

    const action = target.dataset.action;
    switch (action) {
      case 'open-chat': openChat(); break;
      case 'close-chat': closeChat(); break;
      case 'toggle-menu': toggleMenu(); break;
      case 'new-chat': startNewChat(); break;
      case 'show-history': showHistory(); break;
      case 'hide-history': hideHistory(); break;
      case 'send-message': handleSendMessage(); break;
    }
  }

  // ============================================
  // ACTIONS
  // ============================================
  
  function openChat() {
    state.isOpen = true;
    if (elements.chatWindow) elements.chatWindow.classList.add(CONFIG.classes.active, CONFIG.classes.visible);
    if (elements.chatWindow) elements.chatWindow.classList.remove(CONFIG.classes.closing);
    
    // HIDE FLOATING BUTTONS
    if (elements.floatingGroup) elements.floatingGroup.classList.add(CONFIG.classes.hidden);

    setTimeout(() => elements.inputField?.focus(), 300);
  }

  function closeChat() {
    state.isOpen = false;
    closeMenu();
    hideHistory();
    
    if (elements.chatWindow) {
      elements.chatWindow.classList.add(CONFIG.classes.closing);
      elements.chatWindow.classList.remove(CONFIG.classes.active);
    }

    setTimeout(() => {
      if (elements.chatWindow) elements.chatWindow.classList.remove(CONFIG.classes.closing, CONFIG.classes.visible);
      // SHOW FLOATING BUTTONS
      if (elements.floatingGroup) {
        elements.floatingGroup.classList.remove(CONFIG.classes.hidden);
        showFloatingButtons();
      }
    }, 300);
  }

  function toggleMenu() {
    state.isMenuOpen = !state.isMenuOpen;
    elements.dropdownMenu?.classList.toggle(CONFIG.classes.active, state.isMenuOpen);
  }

  function closeMenu() {
    state.isMenuOpen = false;
    elements.dropdownMenu?.classList.remove(CONFIG.classes.active);
  }

  function showFloatingButtons() {
    const btns = document.querySelectorAll('.shop-ai-secondary-btn, .shop-ai-primary-btn');
    btns.forEach((btn, i) => {
      btn.classList.remove(CONFIG.classes.visible);
      setTimeout(() => btn.classList.add(CONFIG.classes.visible), i * 100);
    });
  }

  // ============================================
  // MESSAGING & SHIMMER EFFECT
  // ============================================

  function handleSendMessage() {
    const text = elements.inputField.value.trim();
    if (!text) return;

    // Add User Message
    addMessage(text, 'user');
    elements.inputField.value = '';

    // SHOW SHIMMER (Thinking Effect)
    showThinkingShimmer();

    // Mock Response (Replace with your real API call)
    setTimeout(() => {
      removeThinkingShimmer();
      addMessage("I found some products for you. Here is the stock table:", 'assistant');
      
      // Example Table Render
      const tableHTML = `
        <table>
          <thead><tr><th>Model</th><th>Stock</th><th>Price</th></tr></thead>
          <tbody>
            <tr><td>AODD-15</td><td>12</td><td>$450</td></tr>
            <tr><td>AODD-20</td><td>5</td><td>$520</td></tr>
            <tr><td>PMP-X</td><td>Out</td><td>$300</td></tr>
          </tbody>
        </table>
      `;
      const msgDiv = document.createElement('div');
      msgDiv.className = 'shop-ai-message assistant';
      msgDiv.innerHTML = tableHTML;
      elements.messagesContainer.appendChild(msgDiv);
      scrollToBottom();
      
    }, 2000);
  }

  function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `shop-ai-message ${type}`;
    div.innerHTML = text.replace(/\n/g, '<br>'); // Simple formatting
    elements.messagesContainer.appendChild(div);
    scrollToBottom();
  }

  // --- NEW SHIMMER LOGIC ---
  function showThinkingShimmer() {
    // Check if exists
    if (elements.messagesContainer.querySelector('.shop-ai-typing-shimmer')) return;

    const shimmerDiv = document.createElement('div');
    shimmerDiv.className = 'shop-ai-typing-shimmer';
    // This HTML structure matches the CSS animation
    shimmerDiv.innerHTML = `<span class="shop-ai-shimmer-text">AI is thinking...</span>`;
    
    elements.messagesContainer.appendChild(shimmerDiv);
    scrollToBottom();
  }

  function removeThinkingShimmer() {
    const shimmer = elements.messagesContainer.querySelector('.shop-ai-typing-shimmer');
    if (shimmer) shimmer.remove();
  }

  function scrollToBottom() {
    if (elements.messagesContainer) {
      elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }
  }

  // History logic stubs (kept simple for UI demo)
  function showHistory() { 
    state.isHistoryOpen = true; 
    elements.historyPanel?.classList.add(CONFIG.classes.active); 
  }
  function hideHistory() { 
    state.isHistoryOpen = false; 
    elements.historyPanel?.classList.remove(CONFIG.classes.active); 
  }
  function startNewChat() {
    elements.messagesContainer.innerHTML = '<div class="shop-ai-message assistant">Starting fresh! How can I help?</div>';
    closeMenu();
  }
  function loadChatHistory() { /* Load from local storage logic here */ }

  // Expose API
  window.ShopAIChat = { open: openChat, close: closeChat };

  // Run
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
