/**
 * Shop AI Chat - Enhanced Client-side Implementation v2.0
 * 
 * Features:
 * - Advanced Markdown parsing (headers, bold, italic, code, lists, etc.)
 * - Smooth animations and transitions
 * - Modern thinking/loading placeholders
 * - Auto-resizing textarea input
 * - Floating buttons UI with animations
 * - Menu and history panel integration
 * - Product cards display
 * - Authentication flow support
 */
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION & CONSTANTS
  // ============================================

  /**
   * Tool-specific placeholder messages with icons
   */
  const TOOL_PLACEHOLDERS = {
    'search_shop_catalog': { text: 'Searching products...', icon: '🔍' },
    'search_shop_policies': { text: 'Looking up policies...', icon: '📋' },
    'search_shop_policies_and_faqs': { text: 'Checking store info...', icon: '📖' },
    'get_cart': { text: 'Checking your cart...', icon: '🛒' },
    'update_cart': { text: 'Updating your cart...', icon: '🛒' },
    'add_to_cart': { text: 'Adding to cart...', icon: '➕' },
    'remove_from_cart': { text: 'Removing item...', icon: '🗑️' },
    'create_cart': { text: 'Creating your cart...', icon: '🛒' },
    'get_order_status': { text: 'Checking order status...', icon: '📦' },
    'get_most_recent_order_status': { text: 'Finding your order...', icon: '📦' },
    'initiate_return': { text: 'Processing return request...', icon: '↩️' },
    'default': { text: 'Thinking...', icon: '✨' }
  };

  /**
   * Animation durations (ms)
   */
  const ANIMATION = {
    fast: 150,
    normal: 250,
    slow: 400,
    bounce: 500
  };

  /**
   * Inject required CSS styles
   */
  const injectStyles = () => {
    if (document.getElementById('shop-ai-enhanced-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'shop-ai-enhanced-styles';
    styles.textContent = `
      /* Enhanced Thinking Placeholder */
      .shop-ai-thinking-placeholder {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 20px;
        background: linear-gradient(135deg, #f8f9fa 0%, #f0f2f5 100%);
        border-radius: 20px;
        border-bottom-left-radius: 6px;
        max-width: 200px;
        animation: shopAiSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      }

      .shop-ai-thinking-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        animation: shopAiPulse 1.5s ease-in-out infinite;
      }

      .shop-ai-thinking-text {
        font-size: 14px;
        color: #5f6368;
        font-weight: 500;
      }

      .shop-ai-thinking-dots {
        display: flex;
        gap: 4px;
        margin-left: 2px;
      }

      .shop-ai-thinking-dots span {
        width: 6px;
        height: 6px;
        background: #9aa0a6;
        border-radius: 50%;
        animation: shopAiDotBounce 1.4s ease-in-out infinite;
      }

      .shop-ai-thinking-dots span:nth-child(1) { animation-delay: 0s; }
      .shop-ai-thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
      .shop-ai-thinking-dots span:nth-child(3) { animation-delay: 0.3s; }

      /* Enhanced Message Styling */
      .shop-ai-message {
        animation: shopAiSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }

      .shop-ai-message.fade-in {
        animation: shopAiFadeIn 0.3s ease forwards;
      }

      /* Message Content Typography */
      .shop-ai-message-content {
        font-size: 15px;
        line-height: 1.65;
        color: #1a1a1a;
      }

      .shop-ai-message-content p {
        margin: 0 0 12px 0;
      }

      .shop-ai-message-content p:last-child {
        margin-bottom: 0;
      }

      .shop-ai-message-content h1,
      .shop-ai-message-content h2,
      .shop-ai-message-content h3,
      .shop-ai-message-content h4,
      .shop-ai-message-content h5,
      .shop-ai-message-content h6 {
        margin: 18px 0 10px 0;
        font-weight: 600;
        line-height: 1.3;
        color: #1a1a1a;
      }

      .shop-ai-message-content h1:first-child,
      .shop-ai-message-content h2:first-child,
      .shop-ai-message-content h3:first-child {
        margin-top: 0;
      }

      .shop-ai-message-content h1 { font-size: 20px; }
      .shop-ai-message-content h2 { font-size: 18px; }
      .shop-ai-message-content h3 { font-size: 16px; }
      .shop-ai-message-content h4,
      .shop-ai-message-content h5,
      .shop-ai-message-content h6 { font-size: 15px; }

      .shop-ai-message-content strong,
      .shop-ai-message-content b {
        font-weight: 600;
        color: #1a1a1a;
      }

      .shop-ai-message-content em,
      .shop-ai-message-content i {
        font-style: italic;
      }

      .shop-ai-message-content a {
        color: #1a1a1a;
        text-decoration: none;
        font-weight: 500;
        border-bottom: 1px solid rgba(26, 26, 26, 0.3);
        transition: border-color 0.2s ease, opacity 0.2s ease;
      }

      .shop-ai-message-content a:hover {
        border-bottom-color: #1a1a1a;
        opacity: 0.8;
      }

      .shop-ai-message-content ul,
      .shop-ai-message-content ol {
        margin: 12px 0;
        padding-left: 24px;
      }

      .shop-ai-message-content li {
        margin-bottom: 6px;
        line-height: 1.55;
      }

      .shop-ai-message-content li:last-child {
        margin-bottom: 0;
      }

      .shop-ai-message-content code {
        background: rgba(0, 0, 0, 0.06);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
        font-size: 0.9em;
        color: #1a1a1a;
      }

      .shop-ai-message-content pre {
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 14px 16px;
        border-radius: 10px;
        overflow-x: auto;
        margin: 14px 0;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
        font-size: 13px;
        line-height: 1.5;
      }

      .shop-ai-message-content pre code {
        background: transparent;
        padding: 0;
        color: inherit;
        font-size: inherit;
      }

      .shop-ai-message-content blockquote {
        margin: 14px 0;
        padding: 10px 16px;
        border-left: 3px solid #1a1a1a;
        background: rgba(0, 0, 0, 0.03);
        border-radius: 0 8px 8px 0;
        color: #5f6368;
        font-style: italic;
      }

      .shop-ai-message-content blockquote p:last-child {
        margin-bottom: 0;
      }

      .shop-ai-message-content hr {
        border: none;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(0,0,0,0.1), transparent);
        margin: 20px 0;
      }

      .shop-ai-message-content table {
        width: 100%;
        border-collapse: collapse;
        margin: 14px 0;
        font-size: 14px;
      }

      .shop-ai-message-content th,
      .shop-ai-message-content td {
        padding: 10px 12px;
        border: 1px solid #e0e0e0;
        text-align: left;
      }

      .shop-ai-message-content th {
        background: #f8f9fa;
        font-weight: 600;
      }

      /* User message link styling */
      .shop-ai-message.user .shop-ai-message-content a {
        color: #ffffff;
        border-bottom-color: rgba(255, 255, 255, 0.5);
      }

      .shop-ai-message.user .shop-ai-message-content a:hover {
        border-bottom-color: #ffffff;
      }

      .shop-ai-message.user .shop-ai-message-content code {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }

      /* Submit Button States */
      .shop-ai-send-btn,
      .shop-ai-chat-send {
        position: relative;
        overflow: hidden;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .shop-ai-send-btn.has-text,
      .shop-ai-chat-send.has-text {
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .shop-ai-send-btn.has-text:hover,
      .shop-ai-chat-send.has-text:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .shop-ai-send-btn.has-text:active,
      .shop-ai-chat-send.has-text:active {
        transform: scale(0.98);
      }

      /* Submit Spinner */
      .shop-ai-submit-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid transparent;
        border-top-color: currentColor;
        border-radius: 50%;
        animation: shopAiSpin 0.8s linear infinite;
      }

      /* Input Enhancements */
      .shop-ai-chat-input textarea,
      .shop-ai-chat-input input {
        transition: all 0.2s ease;
      }

      .shop-ai-chat-input textarea:focus,
      .shop-ai-chat-input input:focus {
        outline: none;
      }

      /* Animations */
      @keyframes shopAiSlideIn {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.97);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes shopAiFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes shopAiPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.8; }
      }

      @keyframes shopAiDotBounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-6px); }
      }

      @keyframes shopAiSpin {
        to { transform: rotate(360deg); }
      }

      @keyframes shopAiShimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }

      /* Skeleton Loading */
      .shop-ai-skeleton {
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: shopAiShimmer 1.5s infinite;
        border-radius: 8px;
      }

      /* Error Message Styling */
      .shop-ai-error-bubble {
        background: #fef2f2 !important;
        border: 1px solid #fecaca !important;
      }

      .shop-ai-error-bubble .shop-ai-message-content {
        color: #dc2626;
      }

      /* Smooth scrollbar */
      .shop-ai-chat-messages::-webkit-scrollbar {
        width: 6px;
      }

      .shop-ai-chat-messages::-webkit-scrollbar-track {
        background: transparent;
      }

      .shop-ai-chat-messages::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 10px;
      }

      .shop-ai-chat-messages::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }

      /* Product Card Enhancements */
      .shop-ai-product-card {
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
      }

      .shop-ai-product-card:hover {
        transform: translateY(-6px);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.12);
      }

      /* Input status text */
      .shop-ai-input-status {
        font-size: 12px;
        color: #9aa0a6;
        padding: 4px 20px 0;
        min-height: 18px;
        transition: color 0.2s ease;
      }

      .shop-ai-input-status.thinking {
        color: #1a1a1a;
      }

      /* Welcome message */
      .shop-ai-welcome-container {
        text-align: center;
        padding: 20px;
      }

      .shop-ai-welcome-icon {
        font-size: 32px;
        margin-bottom: 12px;
        animation: shopAiPulse 2s ease-in-out infinite;
      }
    `;
    document.head.appendChild(styles);
  };

  // ============================================
  // APPLICATION NAMESPACE
  // ============================================

  const ShopAIChat = {
    /**
     * State management
     */
    State: {
      isOpen: false,
      isMenuOpen: false,
      isHistoryOpen: false,
      isSubmitting: false,
      chatHistory: [],
      STORAGE_KEY: 'shop-ai-chat-history'
    },

    /**
     * UI-related elements and functionality
     */
    UI: {
      elements: {},
      isMobile: false,

      /**
       * Initialize UI elements and event listeners
       * @param {HTMLElement} container - The main container element
       */
      init: function(container) {
        if (!container) return;

        // Inject enhanced styles
        injectStyles();

        // Cache DOM elements
        this.elements = {
          container: container,
          floatingGroup: container.querySelector('#shop-ai-floating-group'),
          chatBubble: container.querySelector('.shop-ai-chat-bubble'),
          chatWindow: container.querySelector('#shop-ai-chat-window'),
          closeButton: container.querySelector('#shop-ai-close-btn'),
          menuButton: container.querySelector('#shop-ai-menu-btn'),
          dropdownMenu: container.querySelector('#shop-ai-dropdown-menu'),
          historyPanel: container.querySelector('#shop-ai-history-panel'),
          historyList: container.querySelector('#shop-ai-history-list'),
          backButton: container.querySelector('#shop-ai-back-btn'),
          chatInput: container.querySelector('#shop-ai-input'),
          sendButton: container.querySelector('#shop-ai-send-btn'),
          messagesContainer: container.querySelector('#shop-ai-messages'),
          inputStatus: container.querySelector('#shop-ai-input-status')
        };

        // Detect mobile device
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Set up event listeners
        this.setupEventListeners();

        // Fix for iOS Safari viewport height issues
        this.setupMobileViewport();

        // Load chat history
        ShopAIChat.History.load();

        // Show floating buttons with animation
        this.animateFloatingButtons();

        // Setup textarea auto-resize
        this.setupTextarea();
      },

      /**
       * Setup textarea for auto-resize
       */
      setupTextarea: function() {
        const { chatInput } = this.elements;
        if (!chatInput) return;

        // Ensure textarea element
        if (chatInput.tagName !== 'TEXTAREA') {
          // Convert input to textarea if needed
          const textarea = document.createElement('textarea');
          textarea.id = chatInput.id;
          textarea.className = chatInput.className;
          textarea.placeholder = chatInput.placeholder || 'Ask me anything!';
          textarea.rows = 1;
          chatInput.parentNode.replaceChild(textarea, chatInput);
          this.elements.chatInput = textarea;
        }

        // Set initial styles
        this.elements.chatInput.style.resize = 'none';
        this.elements.chatInput.style.overflow = 'hidden';
        this.elements.chatInput.style.minHeight = '24px';
        this.elements.chatInput.style.maxHeight = '120px';
      },

      /**
       * Set up all event listeners for UI interactions
       */
      setupEventListeners: function() {
        const { 
          floatingGroup, chatBubble, closeButton, menuButton, dropdownMenu,
          historyPanel, historyList, backButton, chatInput, sendButton, messagesContainer 
        } = this.elements;

        // Floating buttons click
        if (floatingGroup) {
          floatingGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('.shop-ai-secondary-btn, .shop-ai-primary-btn');
            if (btn) this.openChatWindow();
          });
        }

        // Legacy chat bubble click
        if (chatBubble) {
          chatBubble.addEventListener('click', () => this.openChatWindow());
        }

        // Close chat window
        if (closeButton) {
          closeButton.addEventListener('click', () => this.closeChatWindow());
        }

        // Menu toggle
        if (menuButton) {
          menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
          });
        }

        // Menu items
        if (dropdownMenu) {
          dropdownMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.shop-ai-menu-item');
            if (!item) return;
            
            const action = item.dataset.action;
            if (action === 'new-chat') ShopAIChat.History.startNewChat();
            else if (action === 'show-history') this.showHistory();
            else if (action === 'end-chat') ShopAIChat.History.endChat();
          });
        }

        // History back button
        if (backButton) {
          backButton.addEventListener('click', () => this.hideHistory());
        }

        // History item clicks
        if (historyList) {
          historyList.addEventListener('click', (e) => {
            const item = e.target.closest('.shop-ai-history-item');
            if (item) {
              const id = item.dataset.id;
              ShopAIChat.History.loadChat(id);
              this.hideHistory();
            }
          });
        }

        // Textarea input events
        if (chatInput) {
          chatInput.addEventListener('input', () => {
            this.autoResizeTextarea();
            this.updateSubmitButton();
          });

          chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!ShopAIChat.State.isSubmitting && chatInput.value.trim()) {
                ShopAIChat.Message.send(chatInput, messagesContainer);
              }
            }
          });

          // Focus animation
          chatInput.addEventListener('focus', () => {
            const wrapper = chatInput.closest('.shop-ai-input-wrapper');
            if (wrapper) wrapper.classList.add('focused');
          });

          chatInput.addEventListener('blur', () => {
            const wrapper = chatInput.closest('.shop-ai-input-wrapper');
            if (wrapper) wrapper.classList.remove('focused');
          });
        }

        // Send button click
        if (sendButton) {
          sendButton.addEventListener('click', () => {
            if (!ShopAIChat.State.isSubmitting && chatInput && chatInput.value.trim()) {
              ShopAIChat.Message.send(chatInput, messagesContainer);
            }
          });
        }

        // Close menu on outside click
        document.addEventListener('click', (e) => {
          if (ShopAIChat.State.isMenuOpen && dropdownMenu && menuButton) {
            if (!dropdownMenu.contains(e.target) && !menuButton.contains(e.target)) {
              this.closeMenu();
            }
          }
        });

        // Escape key handler
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            if (ShopAIChat.State.isHistoryOpen) this.hideHistory();
            else if (ShopAIChat.State.isMenuOpen) this.closeMenu();
            else if (ShopAIChat.State.isOpen) this.closeChatWindow();
          }
        });

        // Handle window resize
        window.addEventListener('resize', this.debounce(() => {
          this.setupMobileViewport();
          this.scrollToBottom();
        }, 100));

        // Auth link handler
        document.addEventListener('click', (event) => {
          if (event.target && event.target.classList.contains('shop-auth-trigger')) {
            event.preventDefault();
            if (window.shopAuthUrl) {
              ShopAIChat.Auth.openAuthPopup(window.shopAuthUrl);
            }
          }
        });
      },

      /**
       * Debounce utility
       */
      debounce: function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      },

      /**
       * Setup mobile-specific viewport adjustments
       */
      setupMobileViewport: function() {
        document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
      },

      /**
       * Auto-resize textarea based on content
       */
      autoResizeTextarea: function() {
        const { chatInput } = this.elements;
        if (!chatInput) return;
        
        // Reset height to auto to get proper scrollHeight
        chatInput.style.height = 'auto';
        
        // Calculate new height (capped at max)
        const newHeight = Math.min(chatInput.scrollHeight, 120);
        chatInput.style.height = newHeight + 'px';
        
        // Toggle overflow based on content
        chatInput.style.overflow = chatInput.scrollHeight > 120 ? 'auto' : 'hidden';
      },

      /**
       * Update submit button state
       */
      updateSubmitButton: function() {
        const { chatInput, sendButton, inputStatus } = this.elements;
        if (!chatInput || !sendButton) return;

        const hasText = chatInput.value.trim().length > 0;
        
        // Update button appearance
        sendButton.classList.toggle('has-text', hasText);

        if (ShopAIChat.State.isSubmitting) {
          sendButton.innerHTML = '<div class="shop-ai-submit-spinner"></div>';
          sendButton.disabled = true;
          if (inputStatus) {
            inputStatus.textContent = 'AI is thinking...';
            inputStatus.classList.add('thinking');
          }
        } else {
          // Modern paper plane icon
          sendButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 2L11 13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          `;
          sendButton.disabled = false;
          if (inputStatus) {
            inputStatus.textContent = hasText ? 'Press Enter to send' : 'Ready to help!';
            inputStatus.classList.remove('thinking');
          }
        }
      },

      /**
       * Animate floating buttons on show
       */
      animateFloatingButtons: function() {
        const { floatingGroup } = this.elements;
        if (!floatingGroup) return;

        const buttons = floatingGroup.querySelectorAll('.shop-ai-secondary-btn, .shop-ai-primary-btn');
        buttons.forEach((btn, i) => {
          btn.classList.remove('visible');
          setTimeout(() => btn.classList.add('visible'), i * 80 + 100);
        });
      },

      /**
       * Open chat window with animation
       */
      openChatWindow: function() {
        const { floatingGroup, chatBubble, chatWindow, chatInput } = this.elements;
        
        ShopAIChat.State.isOpen = true;

        if (floatingGroup) floatingGroup.classList.add('hidden');
        if (chatBubble) chatBubble.classList.add('hidden');
        
        if (chatWindow) {
          chatWindow.classList.add('active');
          chatWindow.classList.remove('closing');
        }

        document.body.classList.add('shop-ai-chat-open');

        // Focus input after animation
        setTimeout(() => {
          if (chatInput) chatInput.focus();
          this.scrollToBottom();
        }, ANIMATION.slow);
      },

      /**
       * Close chat window with animation
       */
      closeChatWindow: function() {
        const { floatingGroup, chatBubble, chatWindow, chatInput } = this.elements;
        
        ShopAIChat.State.isOpen = false;
        this.closeMenu();
        this.hideHistory();

        if (chatWindow) chatWindow.classList.add('closing');
        
        document.body.classList.remove('shop-ai-chat-open');
        
        if (this.isMobile && chatInput) chatInput.blur();

        setTimeout(() => {
          if (chatWindow) chatWindow.classList.remove('active', 'closing');
          if (floatingGroup) {
            floatingGroup.classList.remove('hidden');
            this.animateFloatingButtons();
          }
          if (chatBubble) chatBubble.classList.remove('hidden');
        }, ANIMATION.normal);
      },

      /**
       * Toggle menu
       */
      toggleMenu: function() {
        ShopAIChat.State.isMenuOpen = !ShopAIChat.State.isMenuOpen;
        const { dropdownMenu } = this.elements;
        if (dropdownMenu) {
          dropdownMenu.classList.toggle('active', ShopAIChat.State.isMenuOpen);
        }
      },

      /**
       * Close menu
       */
      closeMenu: function() {
        ShopAIChat.State.isMenuOpen = false;
        const { dropdownMenu } = this.elements;
        if (dropdownMenu) dropdownMenu.classList.remove('active');
      },

      /**
       * Show history panel
       */
      showHistory: function() {
        this.closeMenu();
        ShopAIChat.State.isHistoryOpen = true;
        ShopAIChat.History.render();
        const { historyPanel } = this.elements;
        if (historyPanel) historyPanel.classList.add('active');
      },

      /**
       * Hide history panel
       */
      hideHistory: function() {
        ShopAIChat.State.isHistoryOpen = false;
        const { historyPanel } = this.elements;
        if (historyPanel) historyPanel.classList.remove('active');
      },

      /**
       * Scroll messages container to bottom with smooth animation
       */
      scrollToBottom: function() {
        const { messagesContainer } = this.elements;
        if (messagesContainer) {
          requestAnimationFrame(() => {
            messagesContainer.scrollTo({
              top: messagesContainer.scrollHeight,
              behavior: 'smooth'
            });
          });
        }
      },

      /**
       * Show thinking placeholder with tool-specific message
       * @param {string} toolName - The tool being called
       */
      showThinkingPlaceholder: function(toolName) {
        const { messagesContainer } = this.elements;
        if (!messagesContainer) return;

        // Remove existing placeholder
        this.removeThinkingPlaceholder();

        const tool = TOOL_PLACEHOLDERS[toolName] || TOOL_PLACEHOLDERS['default'];
        
        const placeholder = document.createElement('div');
        placeholder.className = 'shop-ai-thinking-placeholder';
        placeholder.id = 'shop-ai-thinking-placeholder';
        placeholder.innerHTML = `
          <div class="shop-ai-thinking-icon">${tool.icon}</div>
          <span class="shop-ai-thinking-text">${tool.text}</span>
          <div class="shop-ai-thinking-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        `;
        
        messagesContainer.appendChild(placeholder);
        this.scrollToBottom();
      },

      /**
       * Update thinking placeholder message
       * @param {string} toolName - The tool name
       */
      updateThinkingPlaceholder: function(toolName) {
        const placeholder = document.getElementById('shop-ai-thinking-placeholder');
        if (placeholder) {
          const tool = TOOL_PLACEHOLDERS[toolName] || TOOL_PLACEHOLDERS['default'];
          const iconEl = placeholder.querySelector('.shop-ai-thinking-icon');
          const textEl = placeholder.querySelector('.shop-ai-thinking-text');
          if (iconEl) iconEl.textContent = tool.icon;
          if (textEl) textEl.textContent = tool.text;
        }
      },

      /**
       * Remove thinking placeholder with fade animation
       */
      removeThinkingPlaceholder: function() {
        const placeholder = document.getElementById('shop-ai-thinking-placeholder');
        if (placeholder) {
          placeholder.style.opacity = '0';
          placeholder.style.transform = 'translateY(-10px)';
          setTimeout(() => placeholder.remove(), ANIMATION.fast);
        }
      },

      /**
       * Show typing indicator (legacy)
       */
      showTypingIndicator: function() {
        this.showThinkingPlaceholder('default');
      },

      /**
       * Remove typing indicator (legacy)
       */
      removeTypingIndicator: function() {
        this.removeThinkingPlaceholder();
        
        // Also remove old-style typing indicator if present
        const { messagesContainer } = this.elements;
        if (messagesContainer) {
          const indicator = messagesContainer.querySelector('.shop-ai-typing-indicator');
          if (indicator) indicator.remove();
        }
      },

      /**
       * Clear input field
       */
      clearInput: function() {
        const { chatInput } = this.elements;
        if (chatInput) {
          chatInput.value = '';
          chatInput.style.height = 'auto';
          this.autoResizeTextarea();
          this.updateSubmitButton();
        }
      },

      /**
       * Set submitting state
       * @param {boolean} isSubmitting - Whether submitting
       */
      setSubmitting: function(isSubmitting) {
        ShopAIChat.State.isSubmitting = isSubmitting;
        this.updateSubmitButton();
        
        const { chatInput } = this.elements;
        if (chatInput) {
          chatInput.disabled = isSubmitting;
          if (!isSubmitting) chatInput.focus();
        }
      },

      /**
       * Display product results in the chat
       * @param {Array} products - Array of product data objects
       */
      displayProductResults: function(products) {
        const { messagesContainer } = this.elements;
        if (!messagesContainer) return;

        const productSection = document.createElement('div');
        productSection.classList.add('shop-ai-product-section');

        const header = document.createElement('div');
        header.classList.add('shop-ai-product-header');
        header.innerHTML = '<h4>🛍️ Matching Products</h4>';
        productSection.appendChild(header);

        const productsContainer = document.createElement('div');
        productsContainer.classList.add('shop-ai-product-grid');
        productSection.appendChild(productsContainer);

        if (!products || !Array.isArray(products) || products.length === 0) {
          const noProducts = document.createElement('p');
          noProducts.textContent = "No products found";
          noProducts.style.cssText = 'padding: 16px; color: #5f6368; text-align: center;';
          productsContainer.appendChild(noProducts);
        } else {
          products.forEach((product, index) => {
            const card = ShopAIChat.Product.createCard(product);
            // Stagger animation
            card.style.animationDelay = `${index * 100}ms`;
            productsContainer.appendChild(card);
          });
        }

        messagesContainer.appendChild(productSection);
        this.scrollToBottom();
      }
    },

    // ============================================
    // HISTORY MANAGEMENT
    // ============================================

    History: {
      /**
       * Load history from localStorage
       */
      load: function() {
        try {
          const saved = localStorage.getItem(ShopAIChat.State.STORAGE_KEY);
          if (saved) {
            ShopAIChat.State.chatHistory = JSON.parse(saved);
          }
        } catch (e) {
          console.warn('Could not load chat history:', e);
          ShopAIChat.State.chatHistory = [];
        }
      },

      /**
       * Save history to localStorage
       */
      save: function() {
        try {
          localStorage.setItem(
            ShopAIChat.State.STORAGE_KEY, 
            JSON.stringify(ShopAIChat.State.chatHistory)
          );
        } catch (e) {
          console.warn('Could not save chat history:', e);
        }
      },

      /**
       * Get relative time string
       * @param {number} timestamp - Unix timestamp
       * @returns {string} Relative time string
       */
      getRelativeTime: function(timestamp) {
        const diff = Date.now() - timestamp;
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        const days = Math.floor(hrs / 24);

        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        if (hrs < 24) return `${hrs}h ago`;
        if (days === 1) return 'Yesterday';
        return `${days}d ago`;
      },

      /**
       * Render history list
       */
      render: function() {
        const { historyList } = ShopAIChat.UI.elements;
        if (!historyList) return;

        if (!ShopAIChat.State.chatHistory.length) {
          historyList.innerHTML = `
            <div class="shop-ai-empty-history">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
              <p>No chat history yet</p>
            </div>
          `;
          return;
        }

        historyList.innerHTML = ShopAIChat.State.chatHistory.map(chat => `
          <button class="shop-ai-history-item" data-id="${chat.id}">
            <span class="shop-ai-history-title">${this.escapeHtml(chat.title)}</span>
            <span class="shop-ai-history-preview">${this.escapeHtml(chat.preview)}</span>
            <span class="shop-ai-history-date">${this.getRelativeTime(chat.timestamp)}</span>
          </button>
        `).join('');
      },

      /**
       * Escape HTML special characters
       * @param {string} str - String to escape
       * @returns {string} Escaped string
       */
      escapeHtml: function(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
      },

      /**
       * Save current chat to history
       */
      saveCurrent: function() {
        const { messagesContainer } = ShopAIChat.UI.elements;
        if (!messagesContainer) return;

        const msgs = messagesContainer.querySelectorAll('.shop-ai-message');
        if (msgs.length <= 1) return;

        const userMsgs = messagesContainer.querySelectorAll('.shop-ai-message.user');
        const lastUser = userMsgs[userMsgs.length - 1];
        const preview = lastUser ? lastUser.textContent.slice(0, 40) + (lastUser.textContent.length > 40 ? '...' : '') : 'Chat';

        ShopAIChat.State.chatHistory.unshift({
          id: Date.now().toString(),
          title: 'Chat',
          preview: preview,
          html: messagesContainer.innerHTML,
          conversationId: sessionStorage.getItem('shopAiConversationId'),
          timestamp: Date.now()
        });

        // Keep only last 20 chats
        if (ShopAIChat.State.chatHistory.length > 20) {
          ShopAIChat.State.chatHistory = ShopAIChat.State.chatHistory.slice(0, 20);
        }

        this.save();
      },

      /**
       * Load a chat from history
       * @param {string} id - Chat ID
       */
      loadChat: function(id) {
        const chat = ShopAIChat.State.chatHistory.find(c => c.id === id);
        const { messagesContainer } = ShopAIChat.UI.elements;
        
        if (chat && messagesContainer) {
          messagesContainer.innerHTML = chat.html;
          
          // Restore conversation ID if available
          if (chat.conversationId) {
            sessionStorage.setItem('shopAiConversationId', chat.conversationId);
          }
          
          ShopAIChat.UI.scrollToBottom();
        }
      },

      /**
       * Start a new chat
       */
      startNewChat: function() {
        ShopAIChat.UI.closeMenu();
        this.saveCurrent();

        const { messagesContainer } = ShopAIChat.UI.elements;
        if (messagesContainer) {
          const welcomeMessage = window.shopChatConfig?.welcomeMessage || "Starting fresh! ✨ How can I help you today?";
          messagesContainer.innerHTML = '';
          ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);
        }

        // Clear conversation ID
        sessionStorage.removeItem('shopAiConversationId');
      },

      /**
       * End current chat
       */
      endChat: function() {
        ShopAIChat.UI.closeMenu();
        this.saveCurrent();

        const { messagesContainer } = ShopAIChat.UI.elements;
        if (messagesContainer) {
          ShopAIChat.Message.add("Chat ended. Thanks for chatting with us! 👋 Have a great day!", 'assistant', messagesContainer);
        }
      }
    },

    // ============================================
    // MESSAGE HANDLING
    // ============================================

    Message: {
      /**
       * Send a message to the API
       * @param {HTMLElement} chatInput - The input element
       * @param {HTMLElement} messagesContainer - The messages container
       */
      send: async function(chatInput, messagesContainer) {
        const userMessage = chatInput.value.trim();
        if (!userMessage) return;

        const conversationId = sessionStorage.getItem('shopAiConversationId');

        // Add user message to chat
        this.add(userMessage, 'user', messagesContainer);

        // Clear input and set submitting state
        ShopAIChat.UI.clearInput();
        ShopAIChat.UI.setSubmitting(true);

        // Show initial thinking placeholder
        ShopAIChat.UI.showThinkingPlaceholder('default');

        try {
          await ShopAIChat.API.streamResponse(userMessage, conversationId, messagesContainer);
        } catch (error) {
          console.error('Error communicating with API:', error);
          ShopAIChat.UI.removeThinkingPlaceholder();
          this.addError("Sorry, I couldn't process your request. Please try again.", messagesContainer);
        } finally {
          ShopAIChat.UI.setSubmitting(false);
        }
      },

      /**
       * Add a message to the chat
       * @param {string} text - Message content
       * @param {string} sender - Message sender ('user' or 'assistant')
       * @param {HTMLElement} messagesContainer - The messages container
       * @returns {HTMLElement} The created message element
       */
      add: function(text, sender, messagesContainer) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('shop-ai-message', sender);

        if (sender === 'assistant') {
          messageElement.dataset.rawText = text;
          const formattedContent = ShopAIChat.Formatting.parseMarkdown(text);
          messageElement.innerHTML = `<div class="shop-ai-message-content">${formattedContent}</div>`;
        } else {
          // User messages - just text, no markdown
          messageElement.textContent = text;
        }

        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();

        return messageElement;
      },

      /**
       * Add an error message
       * @param {string} text - Error message
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addError: function(text, messagesContainer) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('shop-ai-message', 'assistant', 'shop-ai-error-bubble');
        messageElement.innerHTML = `<div class="shop-ai-message-content"><p>${ShopAIChat.Formatting.escapeHtml(text)}</p></div>`;
        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();
        return messageElement;
      },

      /**
       * Handle tool use - show thinking placeholder instead of tool message
       * @param {string} toolMessage - Tool use message content
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addToolUse: function(toolMessage, messagesContainer) {
        // Parse tool name from message
        const match = toolMessage.match(/Calling tool: (\w+)/);
        const toolName = match ? match[1] : 'default';
        
        // Show thinking placeholder instead of tool message
        ShopAIChat.UI.showThinkingPlaceholder(toolName);
      }
    },

    // ============================================
    // MARKDOWN FORMATTING
    // ============================================

    Formatting: {
      /**
       * Escape HTML special characters
       * @param {string} text - Text to escape
       * @returns {string} Escaped text
       */
      escapeHtml: function(text) {
        const map = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
      },

      /**
       * Parse markdown to HTML - comprehensive implementation
       * @param {string} text - Markdown text
       * @returns {string} HTML content
       */
      parseMarkdown: function(text) {
        if (!text) return '';

        let html = text;

        // First, protect code blocks from other transformations
        const codeBlocks = [];
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
          const index = codeBlocks.length;
          codeBlocks.push({ lang, code: this.escapeHtml(code.trim()) });
          return `__CODE_BLOCK_${index}__`;
        });

        // Protect inline code
        const inlineCode = [];
        html = html.replace(/`([^`]+)`/g, (match, code) => {
          const index = inlineCode.length;
          inlineCode.push(this.escapeHtml(code));
          return `__INLINE_CODE_${index}__`;
        });

        // Now escape remaining HTML
        html = this.escapeHtml(html);

        // Restore code blocks with proper formatting
        html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
          const block = codeBlocks[parseInt(index)];
          return `<pre><code class="language-${block.lang}">${block.code}</code></pre>`;
        });

        // Restore inline code
        html = html.replace(/__INLINE_CODE_(\d+)__/g, (match, index) => {
          return `<code>${inlineCode[parseInt(index)]}</code>`;
        });

        // Headers (must be at start of line)
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Horizontal rules (---, ***, ___)
        html = html.replace(/^(\s*[-*_]){3,}\s*$/gm, '<hr>');

        // Bold: **text** or __text__
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Italic: *text* or _text_ (single)
        html = html.replace(/(?<![*\\])\*([^*\n]+)\*(?![*])/g, '<em>$1</em>');
        html = html.replace(/(?<![_\\])_([^_\n]+)_(?![_])/g, '<em>$1</em>');

        // Strikethrough: ~~text~~
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // Links: [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
          // Handle authentication URLs
          if (url.includes('shopify.com/authentication') || url.includes('oauth/authorize')) {
            window.shopAuthUrl = url;
            return `<a href="#auth" class="shop-auth-trigger">${text}</a>`;
          }
          // Handle checkout URLs
          if (url.includes('/cart') || url.includes('checkout')) {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">click here to proceed to checkout</a>`;
          }
          return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        });

        // Images: ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;">');

        // Blockquotes: > text
        html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');
        // Merge consecutive blockquotes
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

        // Unordered lists: - item or * item or • item
        html = html.replace(/^[\s]*[-*•]\s+(.+)$/gm, '<li>$1</li>');

        // Ordered lists: 1. item
        html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');

        // Wrap consecutive <li> elements in <ul>
        html = html.replace(/(<li>[\s\S]*?<\/li>)(\s*<li>[\s\S]*?<\/li>)*/g, (match) => {
          return '<ul>' + match + '</ul>';
        });

        // Clean up nested list wrapping
        html = html.replace(/<\/ul>\s*<ul>/g, '');

        // Tables (basic support)
        const tableRegex = /^\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.+\|\s*\n?)+)/gm;
        html = html.replace(tableRegex, (match, headerRow, bodyRows) => {
          const headers = headerRow.split('|').map(h => h.trim()).filter(h => h);
          const rows = bodyRows.trim().split('\n').map(row => 
            row.split('|').map(cell => cell.trim()).filter(cell => cell)
          );
          
          let table = '<table><thead><tr>';
          headers.forEach(h => table += `<th>${h}</th>`);
          table += '</tr></thead><tbody>';
          rows.forEach(row => {
            table += '<tr>';
            row.forEach(cell => table += `<td>${cell}</td>`);
            table += '</tr>';
          });
          table += '</tbody></table>';
          return table;
        });

        // Paragraphs - handle double line breaks
        html = html.replace(/\n\n+/g, '</p><p>');

        // Single line breaks to <br>
        html = html.replace(/\n/g, '<br>');

        // Wrap in paragraph if needed
        if (!html.match(/^<(p|h[1-6]|ul|ol|pre|blockquote|table|hr)/)) {
          html = '<p>' + html + '</p>';
        }

        // Clean up empty paragraphs and extra whitespace
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>\s*<(ul|ol|pre|blockquote|table|h[1-6]|hr)/g, '<$1');
        html = html.replace(/<\/(ul|ol|pre|blockquote|table|h[1-6])>\s*<\/p>/g, '</$1>');
        html = html.replace(/<p><br>/g, '<p>');
        html = html.replace(/<br><\/p>/g, '</p>');
        html = html.replace(/<br>\s*<(ul|ol|pre|blockquote|table|h[1-6]|hr)/g, '<$1');
        html = html.replace(/<\/(ul|ol|pre|blockquote|table|h[1-6])><br>/g, '</$1>');
        html = html.replace(/<hr><br>/g, '<hr>');
        html = html.replace(/<br><hr>/g, '<hr>');

        return html;
      },

      /**
       * Format message content (legacy compatibility)
       * @param {HTMLElement} element - The element to format
       */
      formatMessageContent: function(element) {
        if (!element || !element.dataset.rawText) return;

        const rawText = element.dataset.rawText;
        const formattedContent = this.parseMarkdown(rawText);
        element.innerHTML = `<div class="shop-ai-message-content">${formattedContent}</div>`;
      },

      /**
       * Convert markdown to HTML (legacy compatibility)
       */
      convertMarkdownToHtml: function(text) {
        return this.parseMarkdown(text);
      }
    },

    // ============================================
    // API COMMUNICATION
    // ============================================

    API: {
      /**
       * Stream response from API
       * @param {string} userMessage - User's message
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - Messages container
       */
      streamResponse: async function(userMessage, conversationId, messagesContainer) {
        let currentMessageElement = null;

        try {
          const promptType = window.shopChatConfig?.promptType || "standardAssistant";
          const requestBody = JSON.stringify({
            message: userMessage,
            conversation_id: conversationId,
            prompt_type: promptType
          });

          const streamUrl = window.shopChatConfig?.apiUrl || 'https://shxhid-chat-agent-production.up.railway.app/chat';
          const shopId = window.shopId || window.shopChatConfig?.shopId;

          const response = await fetch(streamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
              'X-Shopify-Shop-Id': shopId
            },
            body: requestBody
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Create initial message element (hidden until content arrives)
          let messageElement = document.createElement('div');
          messageElement.classList.add('shop-ai-message', 'assistant');
          messageElement.innerHTML = '<div class="shop-ai-message-content"></div>';
          messageElement.dataset.rawText = '';
          messageElement.style.display = 'none';
          messagesContainer.appendChild(messageElement);
          currentMessageElement = messageElement;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  this.handleStreamEvent(
                    data, 
                    currentMessageElement, 
                    messagesContainer, 
                    userMessage,
                    (newElement) => { currentMessageElement = newElement; }
                  );
                } catch (e) {
                  console.error('Error parsing event data:', e);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error in streaming:', error);
          ShopAIChat.UI.removeThinkingPlaceholder();
          throw error;
        }
      },

      /**
       * Handle stream events
       */
      handleStreamEvent: function(data, currentMessageElement, messagesContainer, userMessage, updateCurrentElement) {
        switch (data.type) {
          case 'id':
            if (data.conversation_id) {
              sessionStorage.setItem('shopAiConversationId', data.conversation_id);
            }
            break;

          case 'chunk':
            // Remove thinking placeholder and show message
            ShopAIChat.UI.removeThinkingPlaceholder();
            currentMessageElement.style.display = '';
            
            currentMessageElement.dataset.rawText += data.chunk;
            
            // Update content with formatting
            const contentEl = currentMessageElement.querySelector('.shop-ai-message-content');
            if (contentEl) {
              contentEl.innerHTML = ShopAIChat.Formatting.parseMarkdown(currentMessageElement.dataset.rawText);
            }
            
            ShopAIChat.UI.scrollToBottom();
            break;

          case 'message_complete':
            ShopAIChat.UI.removeThinkingPlaceholder();
            currentMessageElement.style.display = '';
            
            // Final formatting
            const finalContent = currentMessageElement.querySelector('.shop-ai-message-content');
            if (finalContent) {
              finalContent.innerHTML = ShopAIChat.Formatting.parseMarkdown(currentMessageElement.dataset.rawText);
            }
            
            ShopAIChat.UI.scrollToBottom();
            break;

          case 'end_turn':
            ShopAIChat.UI.removeThinkingPlaceholder();
            ShopAIChat.UI.setSubmitting(false);
            break;

          case 'error':
            console.error('Stream error:', data.error);
            ShopAIChat.UI.removeThinkingPlaceholder();
            ShopAIChat.UI.setSubmitting(false);
            
            currentMessageElement.classList.add('shop-ai-error-bubble');
            const errorContent = currentMessageElement.querySelector('.shop-ai-message-content');
            if (errorContent) {
              errorContent.innerHTML = "<p>Sorry, something went wrong. Please try again.</p>";
            }
            currentMessageElement.style.display = '';
            break;

          case 'rate_limit_exceeded':
            console.error('Rate limit exceeded');
            ShopAIChat.UI.removeThinkingPlaceholder();
            ShopAIChat.UI.setSubmitting(false);
            
            currentMessageElement.classList.add('shop-ai-error-bubble');
            const rateLimitContent = currentMessageElement.querySelector('.shop-ai-message-content');
            if (rateLimitContent) {
              rateLimitContent.innerHTML = "<p>We're experiencing high traffic. Please try again in a moment.</p>";
            }
            currentMessageElement.style.display = '';
            break;

          case 'auth_required':
            sessionStorage.setItem('shopAiLastMessage', userMessage || '');
            break;

          case 'product_results':
            ShopAIChat.UI.removeThinkingPlaceholder();
            ShopAIChat.UI.displayProductResults(data.products);
            break;

          case 'tool_use':
            if (data.tool_use_message) {
              // Parse tool name and show appropriate placeholder
              const match = data.tool_use_message.match(/Calling tool: (\w+)/);
              const toolName = match ? match[1] : 'default';
              ShopAIChat.UI.showThinkingPlaceholder(toolName);
            }
            break;

          case 'new_message':
            // Format current message
            ShopAIChat.UI.removeThinkingPlaceholder();
            currentMessageElement.style.display = '';
            
            const newMsgContent = currentMessageElement.querySelector('.shop-ai-message-content');
            if (newMsgContent) {
              newMsgContent.innerHTML = ShopAIChat.Formatting.parseMarkdown(currentMessageElement.dataset.rawText);
            }

            // Show thinking for next message
            ShopAIChat.UI.showThinkingPlaceholder('default');

            // Create new message element
            const newMessageElement = document.createElement('div');
            newMessageElement.classList.add('shop-ai-message', 'assistant');
            newMessageElement.innerHTML = '<div class="shop-ai-message-content"></div>';
            newMessageElement.dataset.rawText = '';
            newMessageElement.style.display = 'none';
            messagesContainer.appendChild(newMessageElement);

            updateCurrentElement(newMessageElement);
            break;

          case 'content_block_complete':
            ShopAIChat.UI.showThinkingPlaceholder('default');
            break;
        }
      },

      /**
       * Fetch chat history from server
       */
      fetchChatHistory: async function(conversationId, messagesContainer) {
        try {
          const loadingEl = document.createElement('div');
          loadingEl.classList.add('shop-ai-thinking-placeholder');
          loadingEl.innerHTML = `
            <div class="shop-ai-thinking-icon">📜</div>
            <span class="shop-ai-thinking-text">Loading conversation...</span>
            <div class="shop-ai-thinking-dots"><span></span><span></span><span></span></div>
          `;
          messagesContainer.appendChild(loadingEl);

          const historyUrl = window.shopChatConfig?.apiUrl || 'https://shxhid-chat-agent-production.up.railway.app/chat';
          
          const response = await fetch(`${historyUrl}?history=true&conversation_id=${encodeURIComponent(conversationId)}`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            mode: 'cors'
          });

          loadingEl.remove();

          if (!response.ok) {
            throw new Error('Failed to fetch chat history');
          }

          const data = await response.json();

          if (!data.messages || data.messages.length === 0) {
            const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
            ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);
            return;
          }

          data.messages.forEach(message => {
            try {
              const contents = JSON.parse(message.content);
              for (const block of contents) {
                if (block.type === 'text') {
                  ShopAIChat.Message.add(block.text, message.role, messagesContainer);
                }
              }
            } catch (e) {
              ShopAIChat.Message.add(message.content, message.role, messagesContainer);
            }
          });

          ShopAIChat.UI.scrollToBottom();

        } catch (error) {
          console.error('Error fetching history:', error);
          
          const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
          ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);
          sessionStorage.removeItem('shopAiConversationId');
        }
      }
    },

    // ============================================
    // AUTHENTICATION HANDLING
    // ============================================

    Auth: {
      openAuthPopup: function(authUrl) {
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        const popup = window.open(
          authUrl,
          'ShopifyAuth',
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        if (popup) {
          popup.focus();
        } else {
          alert('Please allow popups for this site to complete authentication.');
        }

        const conversationId = sessionStorage.getItem('shopAiConversationId');
        if (conversationId) {
          const { messagesContainer } = ShopAIChat.UI.elements;
          ShopAIChat.Message.add(
            "🔐 Authentication in progress. Please complete the process in the popup window.",
            'assistant',
            messagesContainer
          );
          this.startTokenPolling(conversationId, messagesContainer);
        }
      },

      startTokenPolling: function(conversationId, messagesContainer) {
        if (!conversationId) return;

        const pollingId = 'polling_' + Date.now();
        sessionStorage.setItem('shopAiTokenPollingId', pollingId);

        let attempts = 0;
        const maxAttempts = 30;

        const poll = async () => {
          if (sessionStorage.getItem('shopAiTokenPollingId') !== pollingId) return;
          if (attempts >= maxAttempts) {
            ShopAIChat.Message.add(
              "Authentication timed out. Please try again.",
              'assistant',
              messagesContainer
            );
            return;
          }

          attempts++;

          try {
            const baseUrl = window.shopChatConfig?.apiUrl || 'https://shxhid-chat-agent-production.up.railway.app';
            const response = await fetch(
              `${baseUrl}/auth/token-status?conversation_id=${encodeURIComponent(conversationId)}`
            );
            
            if (!response.ok) throw new Error('Token check failed');
            
            const data = await response.json();

            if (data.status === 'authorized') {
              const message = sessionStorage.getItem('shopAiLastMessage');
              if (message) {
                sessionStorage.removeItem('shopAiLastMessage');
                setTimeout(() => {
                  ShopAIChat.Message.add(
                    "✅ Authorization successful! Continuing with your request...",
                    'assistant',
                    messagesContainer
                  );
                  ShopAIChat.UI.showThinkingPlaceholder('default');
                  ShopAIChat.API.streamResponse(message, conversationId, messagesContainer);
                }, 500);
              }
              sessionStorage.removeItem('shopAiTokenPollingId');
              return;
            }

            setTimeout(poll, 10000);
          } catch (error) {
            console.error('Token polling error:', error);
            setTimeout(poll, 10000);
          }
        };

        setTimeout(poll, 2000);
      }
    },
    // ============================================
    // PRODUCT CARDS
    // ============================================

    Product: {
      createCard: function(product) {
        const card = document.createElement('div');
        card.classList.add('shop-ai-product-card');

        // -------------------------
        // 1) IMAGE
        // -------------------------
        const imageContainer = document.createElement('div');
        imageContainer.classList.add('shop-ai-product-image');

        const image = document.createElement('img');
        // Backend already provides a full CDN image_url
        image.src = product.image_url || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        image.alt = product.title || 'Product';
        image.loading = 'lazy';
        image.onerror = function() {
          this.src = 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        };

        imageContainer.appendChild(image);
        card.appendChild(imageContainer);

        // -------------------------
        // 2) INFO WRAPPER
        // -------------------------
        const info = document.createElement('div');
        info.classList.add('shop-ai-product-info');

        // Title
        const title = document.createElement('h3');
        title.classList.add('shop-ai-product-title');

        // If backend ever adds a product URL, link the title. For now, most
        // of your responses have no URL, so we just show plain text.
        if (product.url) {
          const titleLink = document.createElement('a');
          titleLink.href = product.url;
          titleLink.target = '_blank';
          titleLink.rel = 'noopener noreferrer';
          titleLink.textContent = product.title || 'Untitled Product';
          title.appendChild(titleLink);
        } else {
          title.textContent = product.title || 'Untitled Product';
        }
        info.appendChild(title);

        // -------------------------
        // 3) PRICE (FROM price_range)
        // -------------------------
        const priceEl = document.createElement('p');
        priceEl.classList.add('shop-ai-product-price');

        // Your backend returns price_range: { min, max, currency }
        let priceText = '';
        if (product.price) {
          // If backend already normalized a price string, prefer that
          priceText = product.price;
        } else if (product.price_range) {
          const pr = product.price_range;
          const currency = pr.currency || '';
          if (pr.min && pr.max && pr.min !== pr.max) {
            priceText = `${pr.min} – ${pr.max} ${currency}`;
          } else if (pr.min) {
            priceText = `${pr.min} ${currency}`;
          }
        }

        priceEl.textContent = priceText;
        info.appendChild(priceEl);

        // -------------------------
        // 4) ADD TO CART BUTTON
        // -------------------------
        const button = document.createElement('button');
        button.classList.add('shop-ai-add-to-cart');
        button.textContent = 'Add to Cart';

        // Use product_id (gid) as ID; your backend uses product_id, not id
        button.dataset.productId = product.id || product.product_id || '';

        // If checkout_url exists, we could also support a direct link checkout:
        // (optional, uncomment if you want):
        //
        // if (product.checkout_url) {
        //   button.addEventListener('click', () => {
        //     window.open(product.checkout_url, '_blank', 'noopener,noreferrer');
        //   });
        // } else {
        //   // Fallback: send natural language message to the bot
        //   button.addEventListener('click', () => {
        //     const { chatInput, sendButton } = ShopAIChat.UI.elements;
        //     if (chatInput) {
        //       chatInput.value = `Add ${product.title} to my cart`;
        //       ShopAIChat.UI.autoResizeTextarea();
        //       ShopAIChat.UI.updateSubmitButton();
        //       if (sendButton) sendButton.click();
        //     }
        //   });
        // }

        // For now, we keep the original NL-based "add to cart" behavior:
        button.addEventListener('click', () => {
          const { chatInput, sendButton } = ShopAIChat.UI.elements;
          if (chatInput) {
            chatInput.value = `Add ${product.title} to my cart`;
            ShopAIChat.UI.autoResizeTextarea();
            ShopAIChat.UI.updateSubmitButton();
            if (sendButton) sendButton.click();
          }
        });

        info.appendChild(button);
        card.appendChild(info);

        return card;
      }
    },

    // ============================================
    // INITIALIZATION
    // ============================================

    init: function() {
      const container = document.querySelector('.shop-ai-chat-container');
      if (!container) {
        console.warn('Shop AI Chat: Container not found');
        return;
      }

      this.UI.init(container);

      const conversationId = sessionStorage.getItem('shopAiConversationId');
      const { messagesContainer } = this.UI.elements;

      if (conversationId && messagesContainer) {
        this.API.fetchChatHistory(conversationId, messagesContainer);
      } else if (messagesContainer) {
        const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
        this.Message.add(welcomeMessage, 'assistant', messagesContainer);
      }

      console.log('Shop AI Chat initialized successfully');
    }
  };

  // ============================================
  // BOOTSTRAP
  // ============================================

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      ShopAIChat.init();
    });
  } else {
    ShopAIChat.init();
  }

  // Expose global API for external use
  window.ShopAIChatAPI = {
    open: () => ShopAIChat.UI.openChatWindow(),
    close: () => ShopAIChat.UI.closeChatWindow(),
    toggle: () => ShopAIChat.State.isOpen ? ShopAIChat.UI.closeChatWindow() : ShopAIChat.UI.openChatWindow(),
    showThinking: (tool) => ShopAIChat.UI.showThinkingPlaceholder(tool),
    hideThinking: () => ShopAIChat.UI.removeThinkingPlaceholder(),
    scrollToBottom: () => ShopAIChat.UI.scrollToBottom(),
    sendMessage: (message) => {
      const { chatInput, messagesContainer } = ShopAIChat.UI.elements;
      if (chatInput && messagesContainer) {
        chatInput.value = message;
        ShopAIChat.Message.send(chatInput, messagesContainer);
      }
    },
    newChat: () => ShopAIChat.History.startNewChat(),
    getState: () => ({ ...ShopAIChat.State })
  };

})();
