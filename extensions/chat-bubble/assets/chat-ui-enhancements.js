/* ============================================
   PREMIUM SHOPIFY AI CHAT - ENHANCED UI LOGIC
   Features: Backend MCP Cart Integration, Checkout URL, 10+ products
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
      backBtn: '.shop-ai-back-btn',
      checkoutBtnContainer: '.shop-ai-checkout-container' // New
    },
    classes: {
      active: 'active',
      visible: 'visible',
      hidden: 'hidden',
      closing: 'closing',
      chatOpen: 'shop-ai-chat-open'
    },
    // Derive backend cart URL relative to chat API, assuming standard structure
    // If chat is at /chat, cart is at /api/cart
    cartApiUrl: (window.shopChatConfig?.apiUrl || '/chat').replace('/chat', '/api/cart'),
    maxProductsToDisplay: 12 
  };

  // ============================================
  // STATE
  // ============================================
  
  let state = {
    isOpen: false,
    isMenuOpen: false,
    isHistoryOpen: false,
    chatHistory: [],
    currentProducts: [],
    mcpCartId: localStorage.getItem('shopAiMcpCartId') || null, // Persist backend cart ID
    checkoutUrl: null
  };

  let elements = {};

  // ============================================
  // INITIALIZATIONs
  // ============================================
  
  function init() {
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    
    cacheElements();
    injectUIElements();
    bindEvents();
    
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
  // UI INJECTIONs
  // ============================================
  
  function injectUIElements() {
    const container = elements.container;
    if (!container) return;

    // ... (Existing floating buttons logic) ...
    if (!elements.floatingGroup) {
      container.insertAdjacentHTML('afterbegin', createFloatingButtonsHTML());
      elements.floatingGroup = container.querySelector(CONFIG.selectors.floatingGroup);
    }

    // ... (Existing chat window logic) ...
    if (!elements.chatWindow) {
      container.insertAdjacentHTML('beforeend', createChatWindowHTML());
      elements.chatWindow = container.querySelector(CONFIG.selectors.chatWindow);
      elements.messagesContainer = elements.chatWindow.querySelector(CONFIG.selectors.messagesContainer);
      elements.inputField = elements.chatWindow.querySelector(CONFIG.selectors.inputField);
      elements.sendBtn = elements.chatWindow.querySelector(CONFIG.selectors.sendBtn);
      elements.closeBtn = elements.chatWindow.querySelector(CONFIG.selectors.closeBtn);
    }
    
    // Add Checkout Button Container if missing
    if (!elements.chatWindow.querySelector('.shop-ai-checkout-container')) {
        const inputArea = elements.chatWindow.querySelector('.shop-ai-chat-input');
        const checkoutDiv = document.createElement('div');
        checkoutDiv.className = 'shop-ai-checkout-container';
        // Insert before input area
        inputArea.parentNode.insertBefore(checkoutDiv, inputArea);
    }
    
    // ... (Existing menu logic) ...
    const headerActions = elements.chatWindow.querySelector('.shop-ai-header-actions');
    if (headerActions && !headerActions.querySelector('.shop-ai-menu-btn')) {
      headerActions.insertAdjacentHTML('afterbegin', createMenuButtonHTML());
      headerActions.insertAdjacentHTML('beforeend', createDropdownMenuHTML());
      elements.menuBtn = headerActions.querySelector('.shop-ai-menu-btn');
      elements.dropdownMenu = headerActions.querySelector(CONFIG.selectors.dropdownMenu);
    }
  }

  // --- HTML TEMPLATES (Reuse existing ones, just ensure consistencys) ---
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
          <span class="shop-ai-sparkle-icon">✨</span>
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
             <div class="shop-ai-header-info">
               <h3>Shopping Assistant</h3>
               <p><span class="shop-ai-status-dot"></span> Online now</p>
             </div>
           </div>
           <div class="shop-ai-header-actions">
             <button class="shop-ai-header-btn shop-ai-chat-close" data-action="close-chat">✕</button>
           </div>
        </div>
        <div class="shop-ai-chat-messages">
          <div class="shop-ai-message assistant">
            Hello! 👋 I can help you find products and create a cart for you.
          </div>
        </div>
        <div class="shop-ai-chat-input">
          <div class="shop-ai-input-wrapper">
            <input type="text" placeholder="Ask me anything..." />
            <button class="shop-ai-send-btn" data-action="send-message">➤</button>
          </div>
        </div>
      </div>
    `;
  }
  
  function createMenuButtonHTML() { return `<button class="shop-ai-header-btn shop-ai-menu-btn" data-action="toggle-menu">⋮</button>`; }
  
  function createDropdownMenuHTML() {
    return `
      <div class="shop-ai-dropdown-menu">
        <button class="shop-ai-menu-item" data-action="new-chat"><span>Start new chat</span></button>
        <button class="shop-ai-menu-item danger" data-action="close-chat"><span>Close</span></button>
      </div>
    `;
  }

  // ============================================
  // EVENT HANDLING
  // ============================================
  
  function bindEvents() {
    document.addEventListener('click', handleClick);
    if (elements.inputField) {
      elements.inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
      });
    }
  }

  function handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) {
      if (state.isMenuOpen && elements.dropdownMenu && !elements.dropdownMenu.contains(e.target)) closeMenu();
      return;
    }

    const action = target.dataset.action;
    switch (action) {
      case 'open-chat': openChat(); break;
      case 'close-chat': closeChat(); break;
      case 'toggle-menu': toggleMenu(); break;
      case 'new-chat': startNewChat(); break;
      case 'send-message': handleSendMessage(); break;
      case 'add-to-cart': handleAddToCart(target); break;
      case 'view-product': handleViewProduct(target); break;
      case 'checkout': handleCheckout(); break; // New
    }
  }

  // ============================================
  // ACTIONS
  // ============================================
  
  function openChat() {
    state.isOpen = true;
    if (elements.chatWindow) elements.chatWindow.classList.add(CONFIG.classes.active, CONFIG.classes.visible);
    if (elements.floatingGroup) elements.floatingGroup.classList.add(CONFIG.classes.hidden);
    setTimeout(() => elements.inputField?.focus(), 300);
  }

  function closeChat() {
    state.isOpen = false;
    closeMenu();
    if (elements.chatWindow) elements.chatWindow.classList.remove(CONFIG.classes.active, CONFIG.classes.visible);
    if (elements.floatingGroup) elements.floatingGroup.classList.remove(CONFIG.classes.hidden);
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
    btns.forEach(btn => btn.classList.add(CONFIG.classes.visible));
  }

  // ============================================
  // MESSAGING
  // ============================================

  function handleSendMessage() {
    const text = elements.inputField.value.trim();
    if (!text) return;
    
    // Existing chat.js handles the message sending logic via ShopAIChat object
    // We just trigger it here to ensure UI sync
    if (window.ShopAIChat && window.ShopAIChat.send) {
        window.ShopAIChat.send(text);
    }
    
    elements.inputField.value = '';
  }

  // ============================================
  // PRODUCT DISPLAY & CART LOGIC
  // ============================================

  // Exposed method called by chat.js when "product_results" event arrives
  window.ShopAIChat.displayProducts = function(products) {
    if (!products || products.length === 0) return;

    const displayProducts = products.slice(0, CONFIG.maxProductsToDisplay);
    const gridDiv = document.createElement('div');
    gridDiv.className = 'shop-ai-product-grid';
    
    displayProducts.forEach((product, index) => {
      const card = createProductCard(product, index);
      gridDiv.appendChild(card);
    });

    // Append to messages
    const msgs = document.querySelector(CONFIG.selectors.messagesContainer);
    if (msgs) {
        msgs.appendChild(gridDiv);
        msgs.scrollTop = msgs.scrollHeight;
    }
  };

  function createProductCard(product, index) {
    const card = document.createElement('div');
    card.className = 'shop-ai-product-card';
    card.innerHTML = `
      <img src="${product.image_url || ''}" alt="${product.title}" class="shop-ai-product-image" loading="lazy" />
      <div class="shop-ai-product-info">
        <h4 class="shop-ai-product-title">${product.title}</h4>
        <div class="shop-ai-product-price">${product.price || ''}</div>
        <div class="shop-ai-product-actions">
          <button class="shop-ai-product-btn shop-ai-product-btn-primary" 
            data-action="add-to-cart"
            data-variant-id="${product.variantId}" 
            data-product-title="${product.title}">
            Add to Cart
          </button>
          ${product.url ? `<button class="shop-ai-product-btn shop-ai-product-btn-secondary" data-action="view-product" data-product-url="${product.url}">View</button>` : ''}
        </div>
      </div>
    `;
    return card;
  }

  // ============================================
  // BACKEND CART OPERATIONS
  // ============================================

  async function handleAddToCart(button) {
    const variantId = button.dataset.variantId;
    const title = button.dataset.productTitle;
    
    if (!variantId) {
      showToast('Cannot add: Missing variant ID.', 'error');
      return;
    }

    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Adding...';

    try {
        // CALL BACKEND API to use Storefront MCP
        const response = await fetch(CONFIG.cartApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variantId: variantId,
                quantity: 1,
                cartId: state.mcpCartId, // Send existing MCP cart ID if we have one
                conversationId: sessionStorage.getItem('shopAiConversationId')
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            showToast(`${title} added to cart!`);
            
            // Save Cart ID for future adds
            if (data.cartId) {
                state.mcpCartId = data.cartId;
                localStorage.setItem('shopAiMcpCartId', data.cartId);
            }

            // Enable Checkout Button
            if (data.checkoutUrl) {
                state.checkoutUrl = data.checkoutUrl;
                updateCheckoutButton(data.checkoutUrl);
            }
        } else {
            throw new Error(data.message || 'Error adding to cart');
        }
    } catch (error) {
        console.error('Cart error:', error);
        showToast('Failed to add to cart. ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
  }

  function updateCheckoutButton(url) {
    const container = document.querySelector('.shop-ai-checkout-container');
    if (container) {
        container.innerHTML = `
            <button class="shop-ai-checkout-btn" data-action="checkout">
               Checkout Now (MCP Cart)
            </button>
        `;
        container.style.display = 'block';
    }
  }

  function handleCheckout() {
    if (state.checkoutUrl) {
        window.open(state.checkoutUrl, '_blank');
    }
  }

  function handleViewProduct(button) {
    const url = button.dataset.productUrl;
    if (url) window.open(url, '_blank');
  }

  function startNewChat() {
     const msgs = document.querySelector(CONFIG.selectors.messagesContainer);
     if (msgs) msgs.innerHTML = '<div class="shop-ai-message assistant">Started new chat.</div>';
     state.mcpCartId = null;
     state.checkoutUrl = null;
     const co = document.querySelector('.shop-ai-checkout-container');
     if(co) co.style.display = 'none';
     localStorage.removeItem('shopAiMcpCartId');
     if (window.ShopAIChat && window.ShopAIChat.startNewChat) window.ShopAIChat.startNewChat();
  }

  function showToast(msg, type='success') {
    const toast = document.createElement('div');
    toast.className = `shop-ai-toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
