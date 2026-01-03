/* ============================================
   SHOPIFY SHOP-CHAT-AGENT - UPDATED UI/UX JS
   Handles: Floating Buttons, Menu, History Panel
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
      chatBubble: '.shop-ai-chat-bubble',
      primaryBtn: '.shop-ai-primary-btn',
      secondaryBtn: '.shop-ai-secondary-btn',
      messagesContainer: '.shop-ai-chat-messages',
      inputField: '.shop-ai-chat-input input',
      sendBtn: '.shop-ai-chat-send, .shop-ai-send-btn',
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

  // ============================================
  // DOM ELEMENTS
  // ============================================
  
  let elements = {};

  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    // Set viewport height for mobile
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', setViewportHeight);

    // Cache DOM elements
    cacheElements();

    // Load chat history from storage
    loadChatHistory();

    // Inject new UI elements if not present
    injectUIElements();

    // Bind events
    bindEvents();

    // Show floating buttons with animation
    showFloatingButtons();
  }

  function cacheElements() {
    elements = {
      container: document.querySelector(CONFIG.selectors.container),
      floatingGroup: document.querySelector(CONFIG.selectors.floatingGroup),
      chatWindow: document.querySelector(CONFIG.selectors.chatWindow),
      chatBubble: document.querySelector(CONFIG.selectors.chatBubble),
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
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
  }

  // ============================================
  // UI INJECTION (For Missing Elements)
  // ============================================
  
  function injectUIElements() {
    const container = elements.container;
    if (!container) return;

    // Inject floating buttons if not present
    if (!elements.floatingGroup) {
      const floatingHTML = createFloatingButtonsHTML();
      container.insertAdjacentHTML('afterbegin', floatingHTML);
      elements.floatingGroup = container.querySelector(CONFIG.selectors.floatingGroup);
    }

    // Inject menu dropdown if not present in header
    if (!elements.dropdownMenu && elements.chatWindow) {
      const headerActions = elements.chatWindow.querySelector('.shop-ai-header-actions');
      if (headerActions) {
        // Add menu button if not present
        if (!headerActions.querySelector('.shop-ai-menu-btn')) {
          const menuBtnHTML = createMenuButtonHTML();
          const closeBtn = headerActions.querySelector('.shop-ai-chat-close');
          if (closeBtn) {
            closeBtn.insertAdjacentHTML('beforebegin', menuBtnHTML);
          } else {
            headerActions.insertAdjacentHTML('afterbegin', menuBtnHTML);
          }
        }
        
        // Add dropdown menu
        const dropdownHTML = createDropdownMenuHTML();
        headerActions.insertAdjacentHTML('beforeend', dropdownHTML);
        elements.menuBtn = headerActions.querySelector('.shop-ai-menu-btn');
        elements.dropdownMenu = headerActions.querySelector(CONFIG.selectors.dropdownMenu);
      }
    }

    // Inject history panel if not present
    if (!elements.historyPanel && elements.chatWindow) {
      const historyHTML = createHistoryPanelHTML();
      elements.chatWindow.insertAdjacentHTML('beforeend', historyHTML);
      elements.historyPanel = elements.chatWindow.querySelector(CONFIG.selectors.historyPanel);
      elements.historyList = elements.chatWindow.querySelector(CONFIG.selectors.historyList);
      elements.backBtn = elements.chatWindow.querySelector(CONFIG.selectors.backBtn);
    }

    // Re-cache elements after injection
    cacheElements();
  }

  function createFloatingButtonsHTML() {
    return `
      <div class="shop-ai-floating-group">
        <button class="shop-ai-secondary-btn" data-action="open-chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>Chat with our AI</span>
        </button>
        
        <button class="shop-ai-secondary-btn" data-action="open-chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>Help me choose</span>
        </button>
        
        <button class="shop-ai-primary-btn" data-action="open-chat">
          <span class="shop-ai-sparkle-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path class="shop-ai-sparkle-main" d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="currentColor"/>
              <path class="shop-ai-sparkle-small-1" d="M19 14L19.5 16.5L22 17L19.5 17.5L19 20L18.5 17.5L16 17L18.5 16.5L19 14Z" fill="currentColor"/>
              <path class="shop-ai-sparkle-small-2" d="M5 14L5.5 16.5L8 17L5.5 17.5L5 20L4.5 17.5L2 17L4.5 16.5L5 14Z" fill="currentColor"/>
            </svg>
          </span>
          <span>Ask our AI</span>
        </button>
      </div>
    `;
  }

  function createMenuButtonHTML() {
    return `
      <button class="shop-ai-header-btn shop-ai-menu-btn" data-action="toggle-menu" aria-label="Menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="12" cy="5" r="1.5"/>
          <circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
    `;
  }

  function createDropdownMenuHTML() {
    return `
      <div class="shop-ai-dropdown-menu">
        <button class="shop-ai-menu-item" data-action="new-chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            <line x1="12" y1="8" x2="12" y2="14"/>
            <line x1="9" y1="11" x2="15" y2="11"/>
          </svg>
          <span>Start a new chat</span>
        </button>
        <button class="shop-ai-menu-item" data-action="show-history">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
          <span>View recent chats</span>
        </button>
        <div class="shop-ai-menu-divider"></div>
        <button class="shop-ai-menu-item danger" data-action="end-chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span>End chat</span>
        </button>
      </div>
    `;
  }

  function createHistoryPanelHTML() {
    return `
      <div class="shop-ai-history-panel">
        <div class="shop-ai-history-header">
          <button class="shop-ai-back-btn" data-action="hide-history" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15,18 9,12 15,6"/>
            </svg>
          </button>
          <h3>Recent Chats</h3>
        </div>
        <div class="shop-ai-history-list">
          <!-- History items will be populated here -->
        </div>
      </div>
    `;
  }

  // ============================================
  // EVENT BINDING
  // ============================================
  
  function bindEvents() {
    // Use event delegation for dynamically added elements
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (state.isMenuOpen && elements.dropdownMenu) {
        const isMenuClick = elements.dropdownMenu.contains(e.target);
        const isMenuBtnClick = elements.menuBtn && elements.menuBtn.contains(e.target);
        
        if (!isMenuClick && !isMenuBtnClick) {
          closeMenu();
        }
      }
    });
  }

  function handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) {
      // Handle legacy selectors
      handleLegacyClick(e);
      return;
    }

    const action = target.dataset.action;

    switch (action) {
      case 'open-chat':
        openChat();
        break;
      case 'close-chat':
        closeChat();
        break;
      case 'toggle-menu':
        toggleMenu();
        break;
      case 'new-chat':
        startNewChat();
        break;
      case 'show-history':
        showHistory();
        break;
      case 'hide-history':
        hideHistory();
        break;
      case 'end-chat':
        endChat();
        break;
      case 'load-chat':
        const chatId = target.dataset.chatId;
        if (chatId) loadChatFromHistory(chatId);
        break;
    }
  }

  function handleLegacyClick(e) {
    // Handle legacy chat bubble click
    if (e.target.closest('.shop-ai-chat-bubble')) {
      openChat();
      return;
    }

    // Handle legacy close button
    if (e.target.closest('.shop-ai-chat-close')) {
      closeChat();
      return;
    }

    // Handle floating buttons without data-action
    if (e.target.closest('.shop-ai-primary-btn') || e.target.closest('.shop-ai-secondary-btn')) {
      openChat();
      return;
    }
  }

  function handleKeydown(e) {
    // Close chat on Escape
    if (e.key === 'Escape') {
      if (state.isHistoryOpen) {
        hideHistory();
      } else if (state.isMenuOpen) {
        closeMenu();
      } else if (state.isOpen) {
        closeChat();
      }
    }
  }

  // ============================================
  // CHAT ACTIONS
  // ============================================
  
  function openChat() {
    state.isOpen = true;

    // Hide floating buttons
    if (elements.floatingGroup) {
      elements.floatingGroup.classList.add(CONFIG.classes.hidden);
    }

    // Hide legacy bubble
    if (elements.chatBubble) {
      elements.chatBubble.classList.add(CONFIG.classes.hidden);
    }

    // Show chat window
    if (elements.chatWindow) {
      elements.chatWindow.classList.add(CONFIG.classes.active);
      elements.chatWindow.classList.remove(CONFIG.classes.closing);
    }

    // Add body class for mobile
    document.body.classList.add(CONFIG.classes.chatOpen);

    // Focus input
    setTimeout(() => {
      if (elements.inputField) {
        elements.inputField.focus();
      }
    }, 300);
  }

  function closeChat() {
    state.isOpen = false;

    // Close menu and history first
    closeMenu();
    hideHistory();

    // Add closing animation
    if (elements.chatWindow) {
      elements.chatWindow.classList.add(CONFIG.classes.closing);
    }

    // Remove body class
    document.body.classList.remove(CONFIG.classes.chatOpen);

    // After animation, hide window and show buttons
    setTimeout(() => {
      if (elements.chatWindow) {
        elements.chatWindow.classList.remove(CONFIG.classes.active, CONFIG.classes.closing);
      }

      // Show floating buttons
      if (elements.floatingGroup) {
        elements.floatingGroup.classList.remove(CONFIG.classes.hidden);
        showFloatingButtons();
      }

      // Show legacy bubble
      if (elements.chatBubble) {
        elements.chatBubble.classList.remove(CONFIG.classes.hidden);
      }
    }, 250);
  }

  function showFloatingButtons() {
    if (!elements.floatingGroup) return;

    const buttons = elements.floatingGroup.querySelectorAll('.shop-ai-secondary-btn, .shop-ai-primary-btn');
    buttons.forEach((btn, index) => {
      btn.classList.remove(CONFIG.classes.visible);
      setTimeout(() => {
        btn.classList.add(CONFIG.classes.visible);
      }, index * 50);
    });
  }

  // ============================================
  // MENU ACTIONS
  // ============================================
  
  function toggleMenu() {
    state.isMenuOpen = !state.isMenuOpen;
    
    if (elements.dropdownMenu) {
      elements.dropdownMenu.classList.toggle(CONFIG.classes.active, state.isMenuOpen);
    }
  }

  function closeMenu() {
    state.isMenuOpen = false;
    
    if (elements.dropdownMenu) {
      elements.dropdownMenu.classList.remove(CONFIG.classes.active);
    }
  }

  function startNewChat() {
    closeMenu();

    // Save current chat to history before clearing
    saveChatToHistory();

    // Clear messages (trigger your existing clear logic)
    if (elements.messagesContainer) {
      // Keep only the welcome message or clear all
      const welcomeMessage = `
        <div class="shop-ai-message assistant">
          Starting a fresh conversation! 🌟 How can I help you today?
        </div>
      `;
      elements.messagesContainer.innerHTML = welcomeMessage;
    }

    // Dispatch custom event for external handling
    dispatchEvent('shop-ai-new-chat');
  }

  function endChat() {
    closeMenu();

    // Save to history
    saveChatToHistory();

    // Show end message
    if (elements.messagesContainer) {
      const endMessage = document.createElement('div');
      endMessage.className = 'shop-ai-message assistant';
      endMessage.textContent = 'Chat ended. Thank you for chatting with us! Feel free to start a new conversation anytime. 👋';
      elements.messagesContainer.appendChild(endMessage);
      scrollToBottom();
    }

    // Dispatch custom event
    dispatchEvent('shop-ai-end-chat');
  }

  // ============================================
  // HISTORY ACTIONS
  // ============================================
  
  function showHistory() {
    closeMenu();
    state.isHistoryOpen = true;

    renderHistory();

    if (elements.historyPanel) {
      elements.historyPanel.classList.add(CONFIG.classes.active);
    }
  }

  function hideHistory() {
    state.isHistoryOpen = false;

    if (elements.historyPanel) {
      elements.historyPanel.classList.remove(CONFIG.classes.active);
    }
  }

  function renderHistory() {
    if (!elements.historyList) return;

    if (state.chatHistory.length === 0) {
      elements.historyList.innerHTML = `
        <div class="shop-ai-empty-history">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
          <p>No chat history yet</p>
        </div>
      `;
      return;
    }

    elements.historyList.innerHTML = state.chatHistory.map(chat => `
      <button class="shop-ai-history-item" data-action="load-chat" data-chat-id="${chat.id}">
        <span class="shop-ai-history-title">${escapeHTML(chat.title)}</span>
        <span class="shop-ai-history-preview">${escapeHTML(chat.preview)}</span>
        <span class="shop-ai-history-date">${chat.date}</span>
      </button>
    `).join('');
  }

  function loadChatFromHistory(chatId) {
    const chat = state.chatHistory.find(c => c.id === chatId);
    if (!chat || !chat.messages) return;

    hideHistory();

    // Restore messages
    if (elements.messagesContainer && chat.messages) {
      elements.messagesContainer.innerHTML = chat.messages;
      scrollToBottom();
    }

    // Dispatch custom event
    dispatchEvent('shop-ai-load-chat', { chatId, chat });
  }

  function saveChatToHistory() {
    if (!elements.messagesContainer) return;

    const messages = elements.messagesContainer.innerHTML;
    const messageElements = elements.messagesContainer.querySelectorAll('.shop-ai-message');
    
    if (messageElements.length <= 1) return; // Don't save if only welcome message

    // Get preview from last user message
    const userMessages = elements.messagesContainer.querySelectorAll('.shop-ai-message.user');
    const lastUserMessage = userMessages[userMessages.length - 1];
    const preview = lastUserMessage ? 
      lastUserMessage.textContent.slice(0, 50) + (lastUserMessage.textContent.length > 50 ? '...' : '') :
      'No messages';

    const chatEntry = {
      id: Date.now().toString(),
      title: 'Chat session',
      preview: preview,
      date: getRelativeTime(new Date()),
      messages: messages,
      timestamp: Date.now()
    };

    state.chatHistory.unshift(chatEntry);

    // Keep only last 20 chats
    if (state.chatHistory.length > 20) {
      state.chatHistory = state.chatHistory.slice(0, 20);
    }

    // Save to localStorage
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.chatHistory));
    } catch (e) {
      console.warn('Could not save chat history:', e);
    }
  }

  function loadChatHistory() {
    try {
      const saved = localStorage.getItem(CONFIG.storageKey);
      if (saved) {
        state.chatHistory = JSON.parse(saved);
        // Update relative dates
        state.chatHistory = state.chatHistory.map(chat => ({
          ...chat,
          date: getRelativeTime(new Date(chat.timestamp))
        }));
      }
    } catch (e) {
      console.warn('Could not load chat history:', e);
      state.chatHistory = [];
    }
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function scrollToBottom() {
    if (elements.messagesContainer) {
      elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }

  function dispatchEvent(eventName, detail = {}) {
    const event = new CustomEvent(eventName, { detail, bubbles: true });
    document.dispatchEvent(event);
  }

  // ============================================
  // PUBLIC API
  // ============================================
  
  window.ShopAIChat = {
    open: openChat,
    close: closeChat,
    toggleMenu: toggleMenu,
    showHistory: showHistory,
    hideHistory: hideHistory,
    startNewChat: startNewChat,
    endChat: endChat,
    getState: () => ({ ...state }),
    getHistory: () => [...state.chatHistory]
  };

  // ============================================
  // INITIALIZE
  // ============================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();