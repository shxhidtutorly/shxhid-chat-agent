/* ============================================
   PREMIUM SHOPIFY AI CHAT - ENHANCED UI LOGIC
   Features: Direct cart addition, 10+ products, toast notifications
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
    storageKey: 'shop-ai-chat-history',
    maxProductsToDisplay: 10 // Display minimum 10 products
  };

  // ============================================
  // STATE
  // ============================================
  
  let state = {
    isOpen: false,
    isMenuOpen: false,
    isHistoryOpen: false,
    chatHistory: [],
    currentProducts: []
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
  // UI INJECTION
  // ============================================
  
  function injectUIElements() {
    const container = elements.container;
    if (!container) return;

    if (!elements.floatingGroup) {
      container.insertAdjacentHTML('afterbegin', createFloatingButtonsHTML());
      elements.floatingGroup = container.querySelector(CONFIG.selectors.floatingGroup);
    }

    if (!elements.chatWindow) {
      container.insertAdjacentHTML('beforeend', createChatWindowHTML());
      elements.chatWindow = container.querySelector(CONFIG.selectors.chatWindow);
      elements.messagesContainer = elements.chatWindow.querySelector(CONFIG.selectors.messagesContainer);
      elements.inputField = elements.chatWindow.querySelector(CONFIG.selectors.inputField);
      elements.sendBtn = elements.chatWindow.querySelector(CONFIG.selectors.sendBtn);
      elements.closeBtn = elements.chatWindow.querySelector(CONFIG.selectors.closeBtn);
    }
    
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
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div class="shop-ai-header-info">
              <h3>Shopping Assistant</h3>
              <p><span class="shop-ai-status-dot"></span> Online now</p>
            </div>
          </div>
          <div class="shop-ai-header-actions">
            <button class="shop-ai-header-btn shop-ai-chat-close" data-action="close-chat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div class="shop-ai-chat-messages">
          <div class="shop-ai-message assistant">
            Hello! 👋 I can help you find products, check availability, or answer questions. What are you looking for today?
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
        <div style="height:1px;background:var(--border-color);margin:4px 0"></div>
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
    
    if (elements.inputField) {
      elements.inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
      });
    }
  }

  function handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) {
      if (state.isMenuOpen && elements.dropdownMenu && 
          !elements.dropdownMenu.contains(e.target) && 
          !elements.menuBtn.contains(e.target)) {
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
      case 'add-to-cart': handleAddToCart(target); break;
      case 'view-product': handleViewProduct(target); break;
    }
  }

  // ============================================
  // ACTIONS
  // ============================================
  
  function openChat() {
    state.isOpen = true;
    if (elements.chatWindow) {
      elements.chatWindow.classList.add(CONFIG.classes.active, CONFIG.classes.visible);
      elements.chatWindow.classList.remove(CONFIG.classes.closing);
    }
    
    if (elements.floatingGroup) {
      elements.floatingGroup.classList.add(CONFIG.classes.hidden);
    }

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
      if (elements.chatWindow) {
        elements.chatWindow.classList.remove(CONFIG.classes.closing, CONFIG.classes.visible);
      }
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
  // MESSAGING & PRODUCT DISPLAY
  // ============================================

  function handleSendMessage() {
    const text = elements.inputField.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    elements.inputField.value = '';

    showThinkingShimmer();

    // TODO: Replace with actual API call
    setTimeout(() => {
      removeThinkingShimmer();
      
      // Mock product response
      const mockProducts = generateMockProducts(12);
      displayProducts(mockProducts);
      
      addMessage("I found 12 products that match your search. Browse them above and click 'Add to Cart' to purchase.", 'assistant');
    }, 1500);
  }

  function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `shop-ai-message ${type}`;
    div.innerHTML = text.replace(/\n/g, '<br>');
    elements.messagesContainer.appendChild(div);
    scrollToBottom();
  }

  // ============================================
  // PRODUCT DISPLAY - NEW FUNCTION
  // ============================================

  function displayProducts(products) {
    if (!products || products.length === 0) return;

    // Limit to CONFIG.maxProductsToDisplay
    const displayProducts = products.slice(0, CONFIG.maxProductsToDisplay);
    state.currentProducts = displayProducts;

    const gridDiv = document.createElement('div');
    gridDiv.className = 'shop-ai-product-grid';
    
    displayProducts.forEach((product, index) => {
      const card = createProductCard(product, index);
      gridDiv.appendChild(card);
    });

    elements.messagesContainer.appendChild(gridDiv);
    scrollToBottom();
  }

  function createProductCard(product, index) {
    const card = document.createElement('div');
    card.className = 'shop-ai-product-card';
    card.dataset.productId = product.id;
    card.dataset.variantId = product.variantId || '';
    
    card.innerHTML = `
      <img 
        src="${product.image_url || '/placeholder.jpg'}" 
        alt="${product.title}"
        class="shop-ai-product-image"
        loading="lazy"
      />
      <div class="shop-ai-product-info">
        <h4 class="shop-ai-product-title">${product.title}</h4>
        <div class="shop-ai-product-price">${product.price || 'Price not available'}</div>
        <div class="shop-ai-product-actions">
          <button 
            class="shop-ai-product-btn shop-ai-product-btn-primary" 
            data-action="add-to-cart"
            data-product-id="${product.id}"
            data-variant-id="${product.variantId || ''}"
            data-product-title="${product.title}"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            Add to Cart
          </button>
          ${product.url ? `
          <button 
            class="shop-ai-product-btn shop-ai-product-btn-secondary" 
            data-action="view-product"
            data-product-url="${product.url}"
          >
            View
          </button>
          ` : ''}
        </div>
      </div>
    `;
    
    return card;
  }

  // ============================================
  // CART OPERATIONS - DIRECT API CALLS
  // ============================================

  async function handleAddToCart(button) {
    const variantId = button.dataset.variantId;
    const productTitle = button.dataset.productTitle;
    
    if (!variantId) {
      showToast('Unable to add product. Missing variant information.', 'error');
      return;
    }

    // Show loading state
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/>
      </svg>
      Adding...
    `;

    try {
      // Extract numeric variant ID if it's a Shopify GID
      let numericVariantId = variantId;
      if (typeof variantId === 'string' && variantId.includes('gid://shopify/ProductVariant/')) {
        numericVariantId = variantId.replace('gid://shopify/ProductVariant/', '');
      }

      // Call Shopify AJAX Cart API
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [{
            id: numericVariantId,
            quantity: 1
          }]
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add to cart');
      }

      const data = await response.json();
      
      // Success! Show toast notification
      showToast(`${productTitle} added to cart!`, 'success');
      
      // Update cart count if there's a cart counter on the page
      updateCartCount();
      
      // Reset button
      button.disabled = false;
      button.innerHTML = originalText;
      
    } catch (error) {
      console.error('Error adding to cart:', error);
      showToast('Failed to add product to cart. Please try again.', 'error');
      
      // Reset button
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }

  function handleViewProduct(button) {
    const productUrl = button.dataset.productUrl;
    if (productUrl) {
      window.open(productUrl, '_blank');
    }
  }

  async function updateCartCount() {
    try {
      const response = await fetch('/cart.js');
      const cart = await response.json();
      
      // Update cart count elements (common selectors)
      const cartCounters = document.querySelectorAll('[data-cart-count], .cart-count, #CartCount');
      cartCounters.forEach(counter => {
        counter.textContent = cart.item_count;
      });
    } catch (error) {
      console.error('Error updating cart count:', error);
    }
  }

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================

  function showToast(message, type = 'success') {
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.shop-ai-toast');
    existingToasts.forEach(toast => toast.remove());

    const toast = document.createElement('div');
    toast.className = `shop-ai-toast ${type}`;
    
    const icon = type === 'success' 
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    
    toast.innerHTML = `
      <div class="shop-ai-toast-icon" style="color: ${type === 'success' ? 'var(--success-color)' : 'var(--danger-color)'};">
        ${icon}
      </div>
      <div class="shop-ai-toast-text">${message}</div>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================
  // SHIMMER EFFECT
  // ============================================

  function showThinkingShimmer() {
    if (elements.messagesContainer.querySelector('.shop-ai-typing-shimmer')) return;

    const shimmerDiv = document.createElement('div');
    shimmerDiv.className = 'shop-ai-typing-shimmer';
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

  // ============================================
  // MOCK DATA (Replace with actual API)
  // ============================================

  function generateMockProducts(count) {
    const products = [];
    for (let i = 1; i <= count; i++) {
      products.push({
        id: `product-${i}`,
        variantId: `${40000000 + i}`,
        title: `Premium Product ${i}`,
        price: `$${(Math.random() * 100 + 20).toFixed(2)}`,
        image_url: `https://picsum.photos/seed/${i}/400/400`,
        url: `/products/product-${i}`
      });
    }
    return products;
  }

  // ============================================
  // HISTORY (Stub)
  // ============================================

  function showHistory() { 
    state.isHistoryOpen = true; 
    elements.historyPanel?.classList.add(CONFIG.classes.active); 
  }
  
  function hideHistory() { 
    state.isHistoryOpen = false; 
    elements.historyPanel?.classList.remove(CONFIG.classes.active); 
  }
  
  function startNewChat() {
    elements.messagesContainer.innerHTML = '<div class="shop-ai-message assistant">Starting fresh! How can I help you today?</div>';
    state.currentProducts = [];
    closeMenu();
  }
  
  function loadChatHistory() { 
    // Load from localStorage or API
  }

  // ============================================
  // PUBLIC API
  // ============================================

  window.ShopAIChat = { 
    open: openChat, 
    close: closeChat,
    displayProducts: displayProducts,
    showToast: showToast
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

// Add spin animation for loading state
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);
