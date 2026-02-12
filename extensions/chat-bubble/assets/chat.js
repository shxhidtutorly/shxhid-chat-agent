(function () {
  'use strict';

  // ✅ COMPLETE REWRITE - All issues fixed

  const ShopAIChat = {
    state: {
      isOpen: false,
      isThinking: false,
      conversationId: sessionStorage.getItem('shopAiConversationId') || null,
      visitorId: sessionStorage.getItem('shopAiVisitorId') || null,
      emailCaptured: localStorage.getItem('shopAiEmailCaptured') === 'true',
      emailPopupShown: sessionStorage.getItem('shopAiEmailPopupShown') === 'true',
      buffer: '',
      placeholderIndex: 0,
      chatHistory: JSON.parse(localStorage.getItem('shopAiChatHistory') || '[]'),
      cartId: sessionStorage.getItem('shopAiCartId') || null,
      checkoutUrl: sessionStorage.getItem('shopAiCheckoutUrl') || null,
      selectedProduct: null,
      isCartUpdating: false,
      addedByProductId: JSON.parse(sessionStorage.getItem('shopAiAddedByProductId') || '{}'),
      // ✅ Store product data per product ID
      productDataMap: new Map()
    },

    placeholders: [
      'Ask me anything...',
      'Suggest me products',
      'What else would you like to know?',
      'Need more details?',
      'Search by SKU or model',
      'Tell me about your requirements',
      'Looking for something specific?'
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
        emailOverlay: document.getElementById('shop-ai-email-overlay'),
        emailInput: document.getElementById('shop-ai-email-input'),
        emailSubmit: document.getElementById('shop-ai-email-submit'),
        emailSkip: document.getElementById('shop-ai-email-skip'),
        emailError: document.getElementById('shop-ai-email-error'),
        historyPanel: document.getElementById('shop-ai-history-panel'),
        historyList: document.getElementById('shop-ai-history-list'),
        backBtn: document.getElementById('shop-ai-back-btn')
      };

      if (!this.elements.modal) {
        console.error('❌ Chat modal not found in DOM');
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

      // Menu toggle
      if (this.elements.menuBtn) {
        this.elements.menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const expanded = this.elements.menuDropdown?.classList.toggle('active');
          this.elements.menuBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });
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
      }

      // Delegate product button clicks
      if (this.elements.messages) {
        this.elements.messages.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;

          const action = btn.dataset.action;
          const productId = btn.dataset.productId;

          if (action === 'view' && productId) {
            this.handleViewProduct(productId, e);
          } else if (action === 'add-to-cart' && productId) {
            this.handleAddToCart(productId, e);
          } else if (action === 'go-to-cart') {
            this.handleGoToCart(e);
          }
        });
      }
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
      this.elements.modal?.classList.add('active');
      this.elements.backdrop?.classList.add('active');
      this.state.isOpen = true;
      this.elements.input?.focus();
    },

    close() {
      this.elements.modal?.classList.remove('active');
      this.elements.backdrop?.classList.remove('active');
      this.state.isOpen = false;
    },

    async send() {
      const message = this.elements.input?.value?.trim();
      if (!message) return;

      this.addMessage(message, 'user');
      this.elements.input.value = '';

      if (!this.state.conversationId) {
        this.state.conversationId = 'conv_' + Date.now();
        sessionStorage.setItem('shopAiConversationId', this.state.conversationId);
      }

      this.showThinking();

      try {
        const apiUrl = window.shopChatConfig?.apiUrl;
        if (!apiUrl) throw new Error('Chat API URL not configured');

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversation_id: this.state.conversationId,
            prompt_type: window.shopChatConfig?.promptType || 'standardAssistant'
          })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let currentAssistantMsg = null;
        let buffer = '';
        let fullText = '';

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

            if (data.type === 'product_results') {
              this.removeThinking();
              this.renderProducts(data.products || []);
            }

            if (data.type === 'cart_updated') {
              this.removeThinking();
              if (data.checkout_url) {
                this.updateCheckoutState(data.checkout_url, data.cart?.id);
              }
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

    showThinking() {
      if (this.state.isThinking) return;
      this.state.isThinking = true;

      const container = document.createElement('div');
      container.id = 'shop-ai-thinking';
      container.className = 'shop-ai-thinking-container';
      container.innerHTML = '<div class="shop-ai-spinner"></div><p>Thinking...</p>';

      this.elements.messages?.appendChild(container);
      this.scrollToBottom();
    },

    removeThinking() {
      const ui = document.getElementById('shop-ai-thinking');
      if (ui) ui.remove();
      this.state.isThinking = false;
    },

    // ✅ CRITICAL: Render products with proper event handling
    renderProducts(products) {
      if (!products || !products.length) {
        console.warn('⚠️ No products to render');
        return;
      }

      console.log(`📦 Rendering ${products.length} products`);

      const container = document.createElement('div');
      container.className = 'shop-ai-product-container';

      products.forEach((prod, idx) => {
        const productId = String(prod.id || `prod-${idx}`);
        
        // ✅ Store product data for later use
        this.state.productDataMap.set(productId, prod);

        const card = document.createElement('div');
        card.className = 'shop-ai-product-card';
        card.dataset.productId = productId;

        // Image
        const img = document.createElement('img');
        img.className = 'shop-ai-product-image';
        img.src = prod.image_url || '';
        img.alt = prod.title || 'Product';
        img.loading = 'lazy';
        card.appendChild(img);

        // Info
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

        // Actions
        const actions = document.createElement('div');
        actions.className = 'shop-ai-product-actions';

        // ✅ View button with proper event delegation
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'shop-ai-product-btn shop-ai-product-btn-secondary';
        viewBtn.textContent = 'View';
        viewBtn.dataset.action = 'view';
        viewBtn.dataset.productId = productId;
        actions.appendChild(viewBtn);

        // ✅ Add to cart button with per-product state
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'shop-ai-product-btn shop-ai-product-btn-primary';
        
        const isAdded = this.state.addedByProductId[productId] === true;
        addBtn.textContent = isAdded ? 'Go to Cart' : 'Add to Cart';
        addBtn.dataset.action = isAdded ? 'go-to-cart' : 'add-to-cart';
        addBtn.dataset.productId = productId;
        actions.appendChild(addBtn);

        info.appendChild(actions);
        card.appendChild(info);
        container.appendChild(card);
      });

      this.elements.messages?.appendChild(container);
      this.scrollToBottom();
    },

    // ✅ Handle View button click
    handleViewProduct(productId, e) {
      e.preventDefault();
      e.stopPropagation();

      const product = this.state.productDataMap.get(productId);
      if (!product) {
        console.error('❌ Product not found:', productId);
        return;
      }

      const url = product.url || product.product_url;
      if (!url) {
        console.warn('⚠️ No product URL available');
        alert('Product page link not available');
        return;
      }

      console.log(`🔗 Opening product: ${url}`);
      window.open(url, '_blank');
    },

    // ✅ Handle Add to Cart button click
    async handleAddToCart(productId, e) {
      e.preventDefault();
      e.stopPropagation();

      if (this.state.isCartUpdating) {
        console.warn('⚠️ Cart update already in progress');
        return;
      }

      const product = this.state.productDataMap.get(productId);
      if (!product) {
        console.error('❌ Product not found:', productId);
        return;
      }

      const variantId = product.variant_id || product.merchandise_id;
      if (!variantId) {
        console.error('❌ Missing variant ID:', product);
        this.addMessage('Cannot add this product - missing variant.', 'assistant');
        return;
      }

      this.state.isCartUpdating = true;
      const button = document.querySelector(`[data-product-id="${productId}"][data-action="add-to-cart"]`);
      
      if (button) {
        button.textContent = 'Adding...';
        button.disabled = true;
      }

      try {
        console.log(`📞 Cart API: Adding ${variantId}`);

        const cartApiUrl = (window.shopChatConfig?.apiUrl || '/chat').replace('/chat', '/api/cart');
        
        const response = await fetch(cartApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId,
            quantity: 1,
            cartId: this.state.cartId,
            conversationId: this.state.conversationId
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('📥 Cart response:', data);

        if (data.status === 'success' && data.checkoutUrl && data.cartId) {
          // ✅ Update state ONLY for this product
          this.state.addedByProductId[productId] = true;
          sessionStorage.setItem('shopAiAddedByProductId', JSON.stringify(this.state.addedByProductId));

          // Update global checkout
          this.updateCheckoutState(data.checkoutUrl, data.cartId);

          // Update ONLY this button
          if (button) {
            button.textContent = 'Go to Cart';
            button.dataset.action = 'go-to-cart';
            button.disabled = false;
          }

          console.log(`✅ Product ${productId} added!`);
          this.addMessage('Added to cart! Ready to checkout?', 'assistant');
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

    // ✅ Handle Go to Cart button click
    handleGoToCart(e) {
      e.preventDefault();
      e.stopPropagation();
      this.openCheckout();
    },

    // ✅ Update checkout state
    updateCheckoutState(checkoutUrl, cartId) {
      if (checkoutUrl) {
        this.state.checkoutUrl = checkoutUrl;
        sessionStorage.setItem('shopAiCheckoutUrl', checkoutUrl);
      }
      if (cartId) {
        this.state.cartId = cartId;
        sessionStorage.setItem('shopAiCartId', cartId);
      }
    },

    // ✅ Open checkout with validation
    openCheckout() {
      const url = this.state.checkoutUrl;
      
      console.log(`🛒 Opening checkout: ${url}`);

      if (!url || typeof url !== 'string') {
        console.error('❌ No checkout URL');
        this.addMessage('Could not open cart. Please try again.', 'assistant');
        return;
      }

      const safeUrl = String(url).trim();

      // Validate
      if (!safeUrl.startsWith('https://') && !safeUrl.startsWith('http://')) {
        console.error('❌ Invalid URL:', safeUrl);
        this.addMessage('Invalid cart link.', 'assistant');
        return;
      }

      if (!safeUrl.includes('/cart') && !safeUrl.includes('/checkouts')) {
        console.error('❌ Not a cart URL:', safeUrl);
        this.addMessage('Invalid cart link.', 'assistant');
        return;
      }

      console.log(`✅ Opening: ${safeUrl}`);
      
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
      this.state.conversationId = null;
      this.state.productDataMap.clear();
      
      sessionStorage.clear();
      this.elements.messages.innerHTML = '';
      this.addMessage('Started new chat.', 'assistant');
    },

    restoreState() {
      // Restore from session storage
    },

    exposeAPI() {
      window.ShopAIChat = this;
    }
  };

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopAIChat.init());
  } else {
    ShopAIChat.init();
  }

  window.ShopAIChat = ShopAIChat;
})();
