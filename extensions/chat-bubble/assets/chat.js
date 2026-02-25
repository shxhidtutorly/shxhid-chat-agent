/**
 * Shopify Chat Agent - Production Ready
 * ✅ CHANGES:
 * - Products show in GRID ROWS (3 per row)
 * - Text shows BEFORE products
 * - Click product to open MODAL POPUP
 * - Email popup on FIRST CHAT only
 * - Only ONE valid checkout link (no duplicates)
 */

(function () {
  'use strict';

  const ShopAIChat = {
    state: {
      isOpen: false,
      isThinking: false,
      conversationId: sessionStorage.getItem('shopAiConversationId') || null,
      visitorId: sessionStorage.getItem('shopAiVisitorId') || null,
      emailCaptured: localStorage.getItem('shopAiEmailCaptured') === 'true',
      emailPopupShown: sessionStorage.getItem('shopAiEmailPopupShown') === 'true',
      isFirstMessage: !sessionStorage.getItem('shopAiConversationId'), // ✅ Track first message
      buffer: '',
      placeholderIndex: 0,
      chatHistory: JSON.parse(localStorage.getItem('shopAiChatHistory') || '[]'),
      cartId: sessionStorage.getItem('shopAiCartId') || null,
      checkoutUrl: sessionStorage.getItem('shopAiCheckoutUrl') || null,
      selectedProduct: null,
      selectedProductModal: null, // ✅ For modal popup
      isCartUpdating: false,
      addedByProductId: JSON.parse(sessionStorage.getItem('shopAiAddedByProductId') || '{}'),
      productDataMap: new Map(),
      lastCheckoutUrlShown: null,
    },

    placeholders: [
      'Ask me anything...',
      'Search for products',
      'What do you need?',
      'Tell me a product name...',
    ],

    elements: {},

    init() {
      this.elements = {
        floatingGroup: document.getElementById('shop-ai-floating-group'),
        modal: document.getElementById('shop-ai-modal'),
        backdrop: document.getElementById('shop-ai-backdrop'),
        messages: document.getElementById('shop-ai-messages'),
        input: document.getElementById('shop-ai-input'),
        sendBtn: document.getElementById('shop-ai-send-btn'),
        closeBtn: document.getElementById('shop-ai-close-btn'),
        menuBtn: document.getElementById('shop-ai-menu-btn'),
        menuDropdown: document.getElementById('shop-ai-menu'),
        suggestions: document.getElementById('shop-ai-suggestions'),
        historyPanel: document.getElementById('shop-ai-history-panel'),
        historyList: document.getElementById('shop-ai-history-list'),
        backBtn: document.getElementById('shop-ai-back-btn'),
      };

      if (!this.elements.modal) {
        console.error('❌ Modal element not found');
        return;
      }

      this.bindEvents();
      this.startPlaceholderRotation();
      this.restoreState();
      this.exposeAPI();
      
      console.log('✅ ShopAIChat initialized');
    },

    bindEvents() {
      // Floating triggers
      document.querySelectorAll('[data-trigger]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.open();
        });
      });

      // Close handlers
      if (this.elements.closeBtn) {
        this.elements.closeBtn.addEventListener('click', () => this.close());
      }
      if (this.elements.backdrop) {
        this.elements.backdrop.addEventListener('click', () => this.close());
      }

      // Input & send
      if (this.elements.sendBtn) {
        this.elements.sendBtn.addEventListener('click', () => this.send());
      }
      if (this.elements.input) {
        this.elements.input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.send();
          }
        });
        // Activate/deactivate send button based on input
        this.elements.input.addEventListener('input', () => {
          if (this.elements.sendBtn) {
            this.elements.sendBtn.classList.toggle('active', !!this.elements.input.value.trim());
          }
        });
      }

      // 3-dot menu toggle
      if (this.elements.menuBtn) {
        this.elements.menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.elements.menuDropdown?.classList.toggle('active');
        });
      }

      // Menu item actions (delegated)
      if (this.elements.menuDropdown) {
        this.elements.menuDropdown.addEventListener('click', (e) => {
          const item = e.target.closest('[data-action]');
          if (!item) return;
          const action = item.dataset.action;
          this.elements.menuDropdown.classList.remove('active');
          if (action === 'new') this.startNewChat();
          if (action === 'history') this.openHistory();
          if (action === 'end') { this.startNewChat(); this.close(); }
        });
      }

      // History panel back button
      if (this.elements.backBtn) {
        this.elements.backBtn.addEventListener('click', () => this.closeHistory());
      }

      // Close menu when clicking outside
      document.addEventListener('click', (e) => {
        if (this.elements.menuDropdown?.classList.contains('active') &&
            !this.elements.menuBtn?.contains(e.target) &&
            !this.elements.menuDropdown?.contains(e.target)) {
          this.elements.menuDropdown.classList.remove('active');
        }
      });

      // Escape key closes modal
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.state.isOpen) this.close();
      });

      // ✅ Document-level delegation for product buttons
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-product-action]');
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const action = btn.dataset.productAction;
        const productId = btn.dataset.productId;

        if (action === 'view-product') {
          this.handleViewProduct(productId);
        } else if (action === 'add-to-cart') {
          this.handleAddToCart(productId);
        } else if (action === 'go-to-cart') {
          this.handleGoToCart();
        } else if (action === 'modal-open') {
          this.handleOpenProductModal(productId);
        } else if (action === 'modal-close') {
          this.handleCloseProductModal();
        }
      });
    },

    startPlaceholderRotation() {
      setInterval(() => {
        if (this.elements.input && !this.elements.input.value) {
          this.state.placeholderIndex = (this.state.placeholderIndex + 1) % this.placeholders.length;
          this.elements.input.placeholder = this.placeholders[this.state.placeholderIndex];
        }
      }, 5000);
    },

    open() {
      // ✅ Show email popup on FIRST chat only
      if (this.state.isFirstMessage && !this.state.emailCaptured && !this.state.emailPopupShown) {
        this.showEmailPopup();
        this.state.emailPopupShown = true;
        sessionStorage.setItem('shopAiEmailPopupShown', 'true');
      }

      // ✅ FIX: CSS uses body.shop-ai-open to control modal/backdrop visibility
      document.body.classList.add('shop-ai-open');
      // Hide floating launcher buttons when modal is open
      if (this.elements.floatingGroup) {
        this.elements.floatingGroup.classList.add('hidden');
      }
      this.state.isOpen = true;
      this.elements.input?.focus();
    },

    close() {
      // ✅ FIX: Remove body class to hide modal/backdrop via CSS
      document.body.classList.remove('shop-ai-open');
      // Show floating launcher buttons again
      if (this.elements.floatingGroup) {
        this.elements.floatingGroup.classList.remove('hidden');
      }
      this.state.isOpen = false;
    },

    // ✅ NEW: Show email popup
    showEmailPopup() {
      const modal = document.createElement('div');
      modal.id = 'shop-ai-email-modal';
      modal.className = 'shop-ai-email-popup';
      modal.innerHTML = `
        <div class="shop-ai-email-popup-content">
          <h3>Get Exclusive Deals! 💌</h3>
          <p>Sign up for updates and special offers</p>
          <input type="email" id="shop-ai-email-input" placeholder="your@email.com" />
          <button id="shop-ai-email-submit">Subscribe</button>
          <button id="shop-ai-email-skip" class="skip">Skip for now</button>
        </div>
      `;

      document.body.appendChild(modal);

      document.getElementById('shop-ai-email-submit')?.addEventListener('click', () => {
        const email = document.getElementById('shop-ai-email-input')?.value;
        if (email && email.includes('@')) {
          console.log('📧 Email captured:', email);
          this.state.emailCaptured = true;
          localStorage.setItem('shopAiEmailCaptured', 'true');
          modal.remove();
          // Send to backend
          this.captureEmail(email);
        }
      });

      document.getElementById('shop-ai-email-skip')?.addEventListener('click', () => {
        modal.remove();
      });
    },

    async captureEmail(email) {
      try {
        const leadsUrl = window.shopChatConfig?.leadsUrl;
        if (!leadsUrl) {
          console.warn('Leads URL not configured');
          return;
        }
        await fetch(leadsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            visitorId: this.state.visitorId,
            conversationId: this.state.conversationId,
            shop_domain: window.shopChatConfig?.shopDomain || '',
          })
        });
      } catch (e) {
        console.warn('Email capture failed:', e);
      }
    },

    async send(messageArg) {
      // Accept message from argument (suggestion buttons) or from input field
      const message = (typeof messageArg === 'string' && messageArg.trim())
        ? messageArg.trim()
        : this.elements.input?.value?.trim();
      if (!message) return;

      // Mark first message sent and hide suggestions
      if (this.state.isFirstMessage) {
        this.state.isFirstMessage = false;
        if (this.elements.suggestions) {
          this.elements.suggestions.classList.remove('visible');
          this.elements.suggestions.style.display = 'none';
        }
      }

      this.addMessage(message, 'user');
      if (this.elements.input) this.elements.input.value = '';

      if (!this.state.conversationId) {
        this.state.conversationId = 'conv_' + Date.now();
        sessionStorage.setItem('shopAiConversationId', this.state.conversationId);
      }

      this.showThinking();

      try {
        const apiUrl = window.shopChatConfig?.apiUrl;
        if (!apiUrl || apiUrl === '/chat') {
          throw new Error('Chat API URL not configured. Set Backend API URL in theme editor.');
        }

        console.log('📡 Sending to:', apiUrl);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversation_id: this.state.conversationId,
            prompt_type: window.shopChatConfig?.promptType || 'standardAssistant',
            shop_domain: window.shopChatConfig?.shopDomain || ''
          })
        });

        // Check for non-OK responses (404 = proxy not configured, 502 = backend down)
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error('❌ API response:', response.status, errorText.substring(0, 200));
          throw new Error(`Server returned ${response.status}`);
        }

        // Verify we got a stream, not an HTML error page
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('text/html')) {
          console.error('❌ Received HTML instead of SSE — check backend URL');
          throw new Error('Received HTML response instead of stream. Backend URL may be wrong.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let currentAssistantMsg = null;
        let buffer = '';
        let fullText = '';
        let productsReceived = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const chunk of parts) {
            const line = chunk.trim();
            if (!line) continue;

            const jsonStr = line.startsWith('data:') ? line.slice(5).trim() : line;
            let data;
            try {
              data = JSON.parse(jsonStr);
            } catch (err) {
              continue;
            }

            if (data.type === 'id' && data.conversation_id) {
              this.state.conversationId = data.conversation_id;
              sessionStorage.setItem('shopAiConversationId', data.conversation_id);
            }

            if (data.type === 'thinking_state') {
              this.updateThinkingState(data.state);
            }

            if (data.type === 'chunk') {
              if (this.state.isThinking) {
                this.removeThinking();
              }
              fullText += data.chunk;
              if (!currentAssistantMsg) {
                currentAssistantMsg = this.addMessage('', 'assistant');
              }
              const bubble = currentAssistantMsg.querySelector('.shop-ai-bubble');
              if (bubble) {
                bubble.innerHTML = this.parseMarkdown(fullText);
                this.scrollToBottom();
              }
            }

            if (data.type === 'product_results') {
              if (!productsReceived) {
                this.removeThinking();
                this.renderProductsGrid(data.products || []);
                productsReceived = true;
              }
            }

            if (data.type === 'cart_updated') {
              this.removeThinking();
              if (data.checkout_url) {
                this.updateCheckoutState(data.checkout_url, data.cart?.id);
              }
            }

            if (data.type === 'message_complete' || data.type === 'end_turn') {
              this.removeThinking();
              currentAssistantMsg = null;
              fullText = '';
            }

            if (data.type === 'error') {
              this.removeThinking();
              this.addMessage(data.error || 'An error occurred', 'assistant');
            }
          }
        }

        this.removeThinking();
      } catch (err) {
        this.removeThinking();
        console.error('❌ Chat error:', err);
        this.addMessage('Sorry, there was an error. Please try again.', 'assistant');
      }
    },

    addMessage(content, role) {
      const msgDiv = document.createElement('div');
      msgDiv.className = `shop-ai-message ${role}`;

      const bubble = document.createElement('div');
      bubble.className = 'shop-ai-bubble';
      
      if (role === 'assistant') {
        bubble.innerHTML = this.parseMarkdown(content);
      } else {
        bubble.textContent = content;
      }

      msgDiv.appendChild(bubble);
      this.elements.messages?.appendChild(msgDiv);
      this.scrollToBottom();
      return msgDiv;
    },

    parseMarkdown(text) {
      if (!text || typeof text !== 'string') return '<p></p>';

      let cleaned = text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, 
          (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);

      const html = cleaned
        .split('\n')
        .filter(line => line.trim())
        .join('<br>');

      return `<p>${html}</p>`;
    },

    showThinking(text) {
      if (this.state.isThinking) return;
      this.state.isThinking = true;

      const container = document.createElement('div');
      container.id = 'shop-ai-thinking';
      container.className = 'shop-ai-thinking-container';
      container.innerHTML = '<div class="shop-ai-thinking-dots"><span></span><span></span><span></span></div><span class="shop-ai-thinking-text">' + (text || 'Thinking...') + '</span>';

      this.elements.messages?.appendChild(container);
      this.scrollToBottom();
    },

    updateThinkingState(text) {
      const el = document.querySelector('#shop-ai-thinking .shop-ai-thinking-text');
      if (el) {
        el.style.opacity = '0';
        setTimeout(() => {
          el.textContent = text;
          el.style.opacity = '1';
        }, 150);
      } else {
        // No thinking indicator yet, show one
        if (!this.state.isThinking) {
          this.showThinking(text);
        }
      }
    },

    removeThinking() {
      const ui = document.getElementById('shop-ai-thinking');
      if (ui) ui.remove();
      this.state.isThinking = false;
    },

    // ✅ NEW: Products in GRID ROWS (3 per row)
    renderProductsGrid(products) {
      if (!products || !products.length) return;

      console.log(`📦 Rendering ${products.length} products in grid`);

      const container = document.createElement('div');
      container.className = 'shop-ai-product-grid';

      products.forEach((prod, idx) => {
        const productId = String(prod.id || `prod-${idx}`);
        this.state.productDataMap.set(productId, prod);

        const card = document.createElement('div');
        card.className = 'shop-ai-product-card';
        card.dataset.productId = productId;
        card.style.cursor = 'pointer';

        const img = document.createElement('img');
        img.className = 'shop-ai-product-image';
        img.src = prod.image_url || '';
        img.alt = prod.title || 'Product';
        img.loading = 'lazy';
        card.appendChild(img);

        const info = document.createElement('div');
        info.className = 'shop-ai-product-info';

        const title = document.createElement('h4');
        title.className = 'shop-ai-product-title';
        title.textContent = prod.title || 'Untitled';
        info.appendChild(title);

        const price = document.createElement('div');
        price.className = 'shop-ai-product-price';
        price.textContent = prod.price || 'Price on request';
        info.appendChild(price);

        const actions = document.createElement('div');
        actions.className = 'shop-ai-product-actions';

        // Only show View button if the product has a valid URL
        if (prod.url) {
          const viewBtn = document.createElement('button');
          viewBtn.type = 'button';
          viewBtn.className = 'shop-ai-product-btn shop-ai-product-btn-secondary';
          viewBtn.textContent = 'View';
          viewBtn.dataset.productAction = 'view-product';
          viewBtn.dataset.productId = productId;
          actions.appendChild(viewBtn);
        }

        const isAdded = this.state.addedByProductId[productId] === true;
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'shop-ai-product-btn shop-ai-product-btn-primary';
        addBtn.textContent = isAdded ? 'Go to Cart' : 'Add to Cart';
        addBtn.dataset.productAction = isAdded ? 'go-to-cart' : 'add-to-cart';
        addBtn.dataset.productId = productId;
        actions.appendChild(addBtn);

        // ✅ Click card to open modal
        card.addEventListener('click', (e) => {
          if (!e.target.closest('button')) {
            this.handleOpenProductModal(productId);
          }
        });

        info.appendChild(actions);
        card.appendChild(info);
        container.appendChild(card);
      });

      this.elements.messages?.appendChild(container);
      this.scrollToBottom();
    },

    // ✅ NEW: Product modal popup
    handleOpenProductModal(productId) {
      const product = this.state.productDataMap.get(productId);
      if (!product) return;

      const modal = document.createElement('div');
      modal.id = 'shop-ai-product-modal';
      modal.className = 'shop-ai-product-modal-overlay';

      const isAdded = this.state.addedByProductId[productId] === true;

      // Class names must match the CSS in chat-interface.liquid
      modal.innerHTML = `
        <div class="shop-ai-product-modal">
          <button class="shop-ai-product-modal-close" data-product-action="modal-close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          <div class="shop-ai-product-modal-left">
            <img src="${product.image_url}" alt="${product.title}" />
          </div>

          <div class="shop-ai-product-modal-right">
            <div class="shop-ai-product-modal-title">${product.title}</div>
            <div class="shop-ai-product-modal-price">${product.price}</div>
            <div class="shop-ai-product-modal-description">${product.description || 'Premium quality product'}</div>

            <div class="shop-ai-product-modal-actions">
              ${product.url ? `<button class="shop-ai-product-modal-secondary"
                data-product-action="view-product"
                data-product-id="${productId}">
                View on Store
              </button>` : ''}
              <button class="shop-ai-product-modal-primary"
                data-product-action="${isAdded ? 'go-to-cart' : 'add-to-cart'}"
                data-product-id="${productId}">
                ${isAdded ? 'Go to Cart' : 'Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      // Trigger CSS transition by adding active class on next frame
      requestAnimationFrame(() => modal.classList.add('active'));
      this.state.selectedProductModal = modal;
    },

    handleCloseProductModal() {
      if (this.state.selectedProductModal) {
        const modal = this.state.selectedProductModal;
        modal.classList.remove('active');
        this.state.selectedProductModal = null;
        // Remove from DOM after transition completes
        setTimeout(() => modal.remove(), 300);
      }
    },

    handleViewProduct(productId) {
      const product = this.state.productDataMap.get(productId);
      if (!product) return;

      const url = product.url || product.product_url;
      if (!url) {
        alert('Product page link not available');
        return;
      }

      console.log(`🔗 Opening product: ${url}`);
      window.open(url, '_blank');
    },

    async handleAddToCart(productId) {
      if (this.state.isCartUpdating) return;

      const product = this.state.productDataMap.get(productId);
      if (!product) return;

      const variantId = product.variant_id || product.merchandise_id;
      if (!variantId) {
        this.addMessage('Cannot add this product - missing variant.', 'assistant');
        return;
      }

      this.state.isCartUpdating = true;
      const button = document.querySelector(`[data-product-action="add-to-cart"][data-product-id="${productId}"]`);
      
      if (button) {
        button.textContent = 'Adding...';
        button.disabled = true;
      }

      try {
        const cartApiUrl = window.shopChatConfig?.cartUrl ||
          (window.shopChatConfig?.apiUrl || '/chat').replace('/chat', '/api/cart');
        
        const response = await fetch(cartApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId,
            quantity: 1,
            cartId: this.state.cartId,
            conversationId: this.state.conversationId,
            shop_domain: window.shopChatConfig?.shopDomain || ''
          })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (data.status === 'success' && data.checkoutUrl && data.cartId) {
          this.state.addedByProductId[productId] = true;
          sessionStorage.setItem('shopAiAddedByProductId', JSON.stringify(this.state.addedByProductId));

          this.updateCheckoutState(data.checkoutUrl, data.cartId);

          // Update all buttons for this product
          document.querySelectorAll(`[data-product-id="${productId}"]`).forEach(btn => {
            if (btn.dataset.productAction === 'add-to-cart') {
              btn.textContent = 'Go to Cart';
              btn.dataset.productAction = 'go-to-cart';
              btn.disabled = false;
            }
          });

          console.log(`✅ Product added!`);
          this.addMessage('Added to cart! 🎉', 'assistant');
        } else {
          throw new Error(data.message || 'Failed to add to cart');
        }
      } catch (err) {
        console.error('❌ Add to cart error:', err);
        if (button) {
          button.textContent = 'Add to Cart';
          button.disabled = false;
        }
        this.addMessage('Could not add to cart. Please try again.', 'assistant');
      } finally {
        this.state.isCartUpdating = false;
      }
    },

    handleGoToCart() {
      this.openCheckout();
    },

    updateCheckoutState(checkoutUrl, cartId) {
      if (checkoutUrl && checkoutUrl !== this.state.lastCheckoutUrlShown) {
        console.log(`💾 Storing checkoutUrl: ${checkoutUrl.substring(0, 60)}...`);
        this.state.checkoutUrl = checkoutUrl;
        this.state.lastCheckoutUrlShown = checkoutUrl;
        sessionStorage.setItem('shopAiCheckoutUrl', checkoutUrl);
      }
      if (cartId) {
        this.state.cartId = cartId;
        sessionStorage.setItem('shopAiCartId', cartId);
      }
    },

    openCheckout() {
      const url = this.state.checkoutUrl;
      
      console.log(`🔗 openCheckout() called`);

      if (!url || typeof url !== 'string') {
        console.error('❌ No checkout URL:', url);
        this.addMessage('Could not open cart.', 'assistant');
        return;
      }

      const safeUrl = String(url).trim();

      if (!safeUrl.startsWith('https://') && !safeUrl.startsWith('http://')) {
        console.error('❌ Invalid protocol:', safeUrl.substring(0, 30));
        this.addMessage('Invalid cart link.', 'assistant');
        return;
      }

      if (!safeUrl.includes('/cart/c/')) {
        console.error('❌ Invalid checkout path:', safeUrl.substring(0, 60));
        this.addMessage('Invalid cart link format.', 'assistant');
        return;
      }

      console.log(`✅ Opening checkout: ${safeUrl.substring(0, 60)}...`);
      
      try {
        window.open(safeUrl, '_blank');
      } catch (err) {
        console.warn('⚠️ Fallback to same window');
        window.location.href = safeUrl;
      }
    },

    scrollToBottom() {
      if (this.elements.messages) {
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
      }
    },

    startNewChat() {
      this.state.addedByProductId = {};
      this.state.cartId = null;
      this.state.checkoutUrl = null;
      this.state.lastCheckoutUrlShown = null;
      this.state.conversationId = null;
      this.state.isFirstMessage = true;
      this.state.productDataMap.clear();

      sessionStorage.removeItem('shopAiConversationId');
      sessionStorage.removeItem('shopAiCartId');
      sessionStorage.removeItem('shopAiCheckoutUrl');
      sessionStorage.removeItem('shopAiAddedByProductId');

      if (this.elements.messages) {
        this.elements.messages.innerHTML = '';
      }
      // Re-show suggestions
      if (this.elements.suggestions) {
        this.elements.messages?.appendChild(this.elements.suggestions);
        this.elements.suggestions.classList.add('visible');
      }
    },

    openHistory() {
      this.elements.historyPanel?.classList.add('active');
    },

    closeHistory() {
      this.elements.historyPanel?.classList.remove('active');
    },

    restoreState() {
      // Restore from session
    },

    openAndSend(message) {
      if (!this.state.isOpen) {
        this.open();
      }
      if (typeof message === 'string' && message.trim()) {
        setTimeout(() => this.send(message), 150);
      }
    },

    exposeAPI() {
      window.ShopAIChat = this;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopAIChat.init());
  } else {
    ShopAIChat.init();
  }

  window.ShopAIChat = ShopAIChat;
})();
