/**
 * Shopify Chat Agent - Production Ready
 * Features:
 * - Product carousel with click-to-open modal
 * - Auto-expand textarea with smooth placeholder fade
 * - Chat history with conversation loading
 * - Email capture via built-in overlay
 * - SSE streaming with thinking indicators
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
      
      console.log('ShopAIChat initialized');
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
        // Auto-expand textarea + toggle send button
        this.elements.input.addEventListener('input', () => {
          const el = this.elements.input;
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 120) + 'px';
          if (this.elements.sendBtn) {
            this.elements.sendBtn.classList.toggle('active', !!el.value.trim());
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
        const input = this.elements.input;
        if (input && !input.value) {
          input.classList.add('placeholder-fade');
          setTimeout(() => {
            this.state.placeholderIndex = (this.state.placeholderIndex + 1) % this.placeholders.length;
            input.placeholder = this.placeholders[this.state.placeholderIndex];
            input.classList.remove('placeholder-fade');
          }, 300);
        }
      }, 4000);
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

    // Show email capture using the built-in overlay inside the chat modal
    showEmailPopup() {
      const overlay = document.getElementById('shop-ai-email-overlay');
      if (!overlay) return;

      overlay.classList.add('active');

      const submitBtn = document.getElementById('shop-ai-email-submit');
      const skipBtn = document.getElementById('shop-ai-email-skip');
      const emailInput = document.getElementById('shop-ai-email-input');
      const errorEl = document.getElementById('shop-ai-email-error');

      const closeOverlay = () => overlay.classList.remove('active');

      const onSubmit = () => {
        const email = emailInput?.value?.trim();
        if (email && email.includes('@') && email.includes('.')) {
          this.state.emailCaptured = true;
          localStorage.setItem('shopAiEmailCaptured', 'true');
          closeOverlay();
          this.captureEmail(email);
          submitBtn?.removeEventListener('click', onSubmit);
          skipBtn?.removeEventListener('click', onSkip);
        } else {
          if (errorEl) errorEl.classList.add('visible');
        }
      };

      const onSkip = () => {
        closeOverlay();
        submitBtn?.removeEventListener('click', onSubmit);
        skipBtn?.removeEventListener('click', onSkip);
      };

      submitBtn?.addEventListener('click', onSubmit);
      skipBtn?.addEventListener('click', onSkip);

      setTimeout(() => emailInput?.focus(), 300);
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
      if (this.elements.input) {
        this.elements.input.value = '';
        this.elements.input.style.height = 'auto';
      }
      if (this.elements.sendBtn) {
        this.elements.sendBtn.classList.remove('active');
      }

      if (!this.state.conversationId) {
        this.state.conversationId = 'conv_' + Date.now();
        sessionStorage.setItem('shopAiConversationId', this.state.conversationId);
      }

      // Save to history on first message of this conversation
      this.saveToHistory(message);

      this.showThinking();

      try {
        const apiUrl = window.shopChatConfig?.apiUrl;
        if (!apiUrl || apiUrl === '/chat') {
          throw new Error('Chat API URL not configured. Set Backend API URL in theme editor.');
        }

        // Send to backend

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

    // Products displayed as horizontal scroll carousel — NO buttons on cards
    // Click any card to open the product detail modal
    renderProductsGrid(products) {
      if (!products || !products.length) return;

      console.log(`Rendering ${products.length} products as carousel`);

      const container = document.createElement('div');
      container.className = 'shop-ai-product-grid';

      products.forEach((prod, idx) => {
        const productId = String(prod.id || `prod-${idx}`);
        this.state.productDataMap.set(productId, prod);

        const card = document.createElement('div');
        card.className = 'shop-ai-product-card';
        card.dataset.productId = productId;

        card.innerHTML = `
          <img class="shop-ai-product-image" src="${prod.image_url || ''}" alt="${(prod.title || 'Product').replace(/"/g, '&quot;')}" loading="lazy" />
          <div class="shop-ai-product-info">
            <h4 class="shop-ai-product-title">${prod.title || 'Untitled'}</h4>
            <div class="shop-ai-product-price">${prod.price || ''}</div>
          </div>
        `;

        card.addEventListener('click', () => {
          this.handleOpenProductModal(productId);
        });

        container.appendChild(card);
      });

      this.elements.messages?.appendChild(container);
      this.scrollToBottom();
    },

    // Product detail modal — shows image, price, description, View + Add to Cart
    handleOpenProductModal(productId) {
      const product = this.state.productDataMap.get(productId);
      if (!product) return;

      // Close any existing product modal first
      this.handleCloseProductModal();

      const modal = document.createElement('div');
      modal.id = 'shop-ai-product-modal';
      modal.className = 'shop-ai-product-modal-overlay';

      const isAdded = this.state.addedByProductId[productId] === true;
      const safeTitle = (product.title || 'Product').replace(/"/g, '&quot;');

      modal.innerHTML = `
        <div class="shop-ai-product-modal">
          <button class="shop-ai-product-modal-close" data-product-action="modal-close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          <div class="shop-ai-product-modal-left">
            <img src="${product.image_url || ''}" alt="${safeTitle}" />
          </div>

          <div class="shop-ai-product-modal-right">
            <div class="shop-ai-product-modal-title">${product.title || 'Product'}</div>
            <div class="shop-ai-product-modal-price">${product.price || 'Price on request'}</div>
            ${product.sku ? `<div class="shop-ai-product-modal-sku">SKU: ${product.sku}</div>` : ''}
            ${product.description ? `<div class="shop-ai-product-modal-description">${product.description}</div>` : ''}

            <div class="shop-ai-product-modal-actions">
              ${product.url ? `<a href="${product.url}" target="_blank" rel="noopener noreferrer" class="shop-ai-product-modal-secondary">
                View on Store
              </a>` : ''}
              ${(product.variant_id || product.merchandise_id) ? `<button class="shop-ai-product-modal-primary"
                data-product-action="${isAdded ? 'go-to-cart' : 'add-to-cart'}"
                data-product-id="${productId}">
                ${isAdded ? 'Go to Cart' : 'Add to Cart'}
              </button>` : ''}
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      requestAnimationFrame(() => modal.classList.add('active'));
      this.state.selectedProductModal = modal;

      // Close on backdrop click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.handleCloseProductModal();
      });
    },

    handleCloseProductModal() {
      if (this.state.selectedProductModal) {
        const m = this.state.selectedProductModal;
        m.classList.remove('active');
        this.state.selectedProductModal = null;
        setTimeout(() => m.remove(), 300);
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

      // Open product page
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

          // Product added successfully
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
        // Store checkout URL
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
      
      // Open checkout

      if (!url || typeof url !== 'string') {
        console.error('No checkout URL available');
        this.addMessage('Could not open cart.', 'assistant');
        return;
      }

      const safeUrl = String(url).trim();

      if (!safeUrl.startsWith('https://') && !safeUrl.startsWith('http://')) {
        console.error('Invalid protocol:', safeUrl.substring(0, 30));
        this.addMessage('Invalid cart link.', 'assistant');
        return;
      }

      if (!safeUrl.includes('/cart/c/')) {
        console.error('Invalid checkout path:', safeUrl.substring(0, 60));
        this.addMessage('Invalid cart link format.', 'assistant');
        return;
      }

      // Opening checkout
      
      try {
        window.open(safeUrl, '_blank');
      } catch (err) {
        console.warn('Popup blocked, using redirect');
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
      this.state.emailPopupShown = false;
      this.state.productDataMap.clear();

      sessionStorage.removeItem('shopAiConversationId');
      sessionStorage.removeItem('shopAiCartId');
      sessionStorage.removeItem('shopAiCheckoutUrl');
      sessionStorage.removeItem('shopAiAddedByProductId');
      sessionStorage.removeItem('shopAiEmailPopupShown');

      if (this.elements.messages) {
        this.elements.messages.innerHTML = '';
      }

      // Re-show suggestions — reset display AND add visible class
      if (this.elements.suggestions) {
        this.elements.suggestions.style.display = '';
        this.elements.messages?.appendChild(this.elements.suggestions);
        this.elements.suggestions.classList.add('visible');
      }

      // Reset input
      if (this.elements.input) {
        this.elements.input.value = '';
        this.elements.input.style.height = 'auto';
        this.elements.input.focus();
      }
      if (this.elements.sendBtn) {
        this.elements.sendBtn.classList.remove('active');
      }
    },

    openHistory() {
      this.elements.historyPanel?.classList.add('active');
      this.renderHistoryList();
    },

    closeHistory() {
      this.elements.historyPanel?.classList.remove('active');
    },

    renderHistoryList() {
      const list = this.elements.historyList;
      if (!list) return;

      const history = JSON.parse(localStorage.getItem('shopAiChatHistory') || '[]');

      if (!history.length) {
        list.innerHTML = '<div class="shop-ai-history-empty">No previous conversations yet</div>';
        return;
      }

      list.innerHTML = '';
      history.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'shop-ai-history-item';

        const timeStr = conv.timestamp
          ? new Date(conv.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';

        item.innerHTML = `
          <div class="shop-ai-history-item-title">${conv.title || 'Conversation'}</div>
          <div class="shop-ai-history-item-time">${timeStr}</div>
        `;

        item.addEventListener('click', () => this.loadConversation(conv.id));
        list.appendChild(item);
      });
    },

    async loadConversation(conversationId) {
      this.closeHistory();

      // Clear current messages
      if (this.elements.messages) {
        this.elements.messages.innerHTML = '';
      }

      // Set as current conversation
      this.state.conversationId = conversationId;
      this.state.isFirstMessage = false;
      sessionStorage.setItem('shopAiConversationId', conversationId);

      // Hide suggestions
      if (this.elements.suggestions) {
        this.elements.suggestions.classList.remove('visible');
        this.elements.suggestions.style.display = 'none';
      }

      this.showThinking('Loading conversation...');

      try {
        const apiUrl = window.shopChatConfig?.apiUrl;
        if (!apiUrl) throw new Error('API URL not configured');

        const historyUrl = `${apiUrl}?history=true&conversation_id=${encodeURIComponent(conversationId)}`;
        const response = await fetch(historyUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        this.removeThinking();

        if (data.messages && data.messages.length) {
          data.messages.forEach(msg => {
            if (msg.role === 'user' || msg.role === 'assistant') {
              const content = typeof msg.content === 'string' ? msg.content : '';
              if (content) this.addMessage(content, msg.role);
            }
          });
          this.scrollToBottom();
        } else {
          this.addMessage('This conversation has no messages.', 'assistant');
        }
      } catch (err) {
        this.removeThinking();
        console.error('Failed to load conversation:', err);
        this.addMessage('Could not load conversation history.', 'assistant');
      }
    },

    saveToHistory(firstMessage) {
      if (!this.state.conversationId) return;

      const history = JSON.parse(localStorage.getItem('shopAiChatHistory') || '[]');

      // Don't add duplicates
      if (history.some(h => h.id === this.state.conversationId)) return;

      history.unshift({
        id: this.state.conversationId,
        title: (firstMessage || 'Chat').substring(0, 60),
        timestamp: Date.now(),
      });

      // Keep only last 30
      if (history.length > 30) history.length = 30;

      localStorage.setItem('shopAiChatHistory', JSON.stringify(history));
    },

    restoreState() {
      // Restore from session — if there's an active conversation, hide suggestions
      if (this.state.conversationId) {
        this.state.isFirstMessage = false;
        if (this.elements.suggestions) {
          this.elements.suggestions.classList.remove('visible');
          this.elements.suggestions.style.display = 'none';
        }
      }
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
