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
      buffer: '',
      placeholderIndex: 0,
      chatHistory: JSON.parse(localStorage.getItem('shopAiChatHistory') || '[]'),
      cartId: sessionStorage.getItem('shopAiCartId') || null,
      checkoutUrl: sessionStorage.getItem('shopAiCheckoutUrl') || null,
      selectedProduct: null,
      isCartUpdating: false,
      // ✅ CRITICAL FIX: Track per-product state (not global)
      addedByProductId: JSON.parse(sessionStorage.getItem('shopAiAddedByProductId') || '{}'),
      // ✅ NEW: Map product display elements to their product data
      productElementMap: new Map()
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

      if (!this.elements.modal) return;

      this.bindEvents();
      this.startPlaceholderRotation();
      this.restoreState();
      this.exposeAPI();
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
      this.elements.closeBtn?.addEventListener('click', () => this.close());
      this.elements.backdrop?.addEventListener('click', () => this.close());

      // Menu toggle
      this.elements.menuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = this.elements.menuDropdown.classList.toggle('active');
        this.elements.menuBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });

      document.addEventListener('click', () => {
        this.elements.menuDropdown?.classList.remove('active');
        this.elements.menuBtn?.setAttribute('aria-expanded', 'false');
      });

      // Menu items
      this.elements.menuDropdown?.querySelectorAll('.shop-ai-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const action = e.currentTarget.dataset.action;
          if (action === 'new') this.startNewChat();
        });
      });

      // Input & send
      this.elements.sendBtn?.addEventListener('click', () => this.send());
      this.elements.input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });

      // Back button
      this.elements.backBtn?.addEventListener('click', () => this.showChat());

      // Email overlay
      this.elements.emailSubmit?.addEventListener('click', () => this.submitEmail());
      this.elements.emailSkip?.addEventListener('click', () => this.skipEmail());
      this.elements.emailInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.submitEmail();
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
        const response = await fetch(window.shopChatConfig?.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversation_id: this.state.conversationId,
            prompt_type: window.shopChatConfig?.promptType || 'standardAssistant'
          })
        });

        if (!response.ok) throw new Error('Network error');

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
            try { data = JSON.parse(jsonStr); } catch (err) { continue; }

            if (data.type === 'id') {
              if (data.conversation_id) {
                this.state.conversationId = data.conversation_id;
                sessionStorage.setItem('shopAiConversationId', data.conversation_id);
              }
            }

            if (data.type === 'product_results') {
              this.removeThinking();
              this.renderProducts(data.products || []);
            }

            if (data.type === 'cart_updated') {
              this.removeThinking();
              if (data.checkout_url) {
                this.state.checkoutUrl = data.checkout_url;
                if (data.cart && data.cart.id) {
                  this.state.cartId = data.cart.id;
                }
                sessionStorage.setItem('shopAiCartId', this.state.cartId || '');
                sessionStorage.setItem('shopAiCheckoutUrl', this.state.checkoutUrl || '');
                const msg = `Your cart is ready. You can [click here to proceed to checkout](${data.checkout_url}).`;
                this.addMessage(msg, 'assistant');
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

    // ✅ CRITICAL: Per-product button state handling
    renderProducts(products) {
      if (!products || !products.length) return;

      const container = document.createElement('div');
      container.className = 'shop-ai-product-container';

      products.forEach((prod, idx) => {
        const productId = String(prod.id || prod.variant_id || prod.merchandise_id || idx);
        
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

        // Info section
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

        // ✅ VIEW BUTTON - With proper URL handling
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'shop-ai-product-btn shop-ai-product-btn-secondary';
        viewBtn.textContent = 'View';
        viewBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const productUrl = prod.url || prod.product_url;
          
          console.log(`🔗 View button clicked. Product URL:`, productUrl);
          
          if (productUrl) {
            // Ensure absolute URL
            let finalUrl = productUrl;
            if (!finalUrl.startsWith('http')) {
              const shopDomain = window.shopChatConfig?.shopDomain || 'myshopify.com';
              finalUrl = `https://${shopDomain}${finalUrl.startsWith('/') ? '' : '/'}${finalUrl}`;
            }
            
            console.log(`✅ Opening:`, finalUrl);
            window.open(finalUrl, '_blank');
          } else {
            console.warn('❌ No product URL available');
            alert('Product page link not available');
          }
        };
        actions.appendChild(viewBtn);

        // ✅ ADD TO CART BUTTON - Per-product state
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'shop-ai-product-btn shop-ai-product-btn-primary';
        
        // Check if THIS product was added
        const isAlreadyAdded = this.state.addedByProductId[productId] === true;
        addBtn.textContent = isAlreadyAdded ? 'Go to Cart' : 'Add to Cart';
        addBtn.dataset.productId = productId;

        addBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          console.log(`🛒 Button clicked. Product:`, productId, 'Already added?', isAlreadyAdded);

          // If already added, open checkout
          if (this.state.addedByProductId[productId] === true) {
            console.log(`📦 Opening checkout for product:`, productId);
            this.openCheckout();
            return;
          }

          // Add to cart
          await this.addProductToCart(prod, addBtn, productId);
        };
        actions.appendChild(addBtn);

        info.appendChild(actions);
        card.appendChild(info);
        container.appendChild(card);

        // ✅ Store mapping for later updates
        this.state.productElementMap.set(productId, { card, addBtn, viewBtn });
      });

      this.elements.messages?.appendChild(container);
      this.scrollToBottom();
    },

    // ✅ CRITICAL: Add to cart with per-product button state update
    async addProductToCart(product, button, productId) {
      if (this.state.isCartUpdating) return;

      const variantId = product.variant_id || product.merchandise_id;
      if (!variantId) {
        console.error('❌ Missing variant ID:', product);
        this.addMessage('Cannot add this product - missing variant information.', 'assistant');
        return;
      }

      this.state.isCartUpdating = true;
      const originalText = button.textContent;
      button.textContent = 'Adding...';
      button.disabled = true;

      try {
        console.log(`📞 Cart API: Adding variant ${variantId}`);
        
        const response = await fetch(
          (window.shopChatConfig?.apiUrl || '/chat').replace('/chat', '/api/cart'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              variantId,
              quantity: 1,
              cartId: this.state.cartId,
              conversationId: this.state.conversationId
            })
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'success' && data.checkoutUrl && data.cartId) {
          // ✅ CRITICAL: Update only THIS product's button state
          this.state.addedByProductId[productId] = true;
          sessionStorage.setItem('shopAiAddedByProductId', JSON.stringify(this.state.addedByProductId));

          // Update global cart
          this.state.cartId = data.cartId;
          this.state.checkoutUrl = data.checkoutUrl;
          sessionStorage.setItem('shopAiCartId', this.state.cartId);
          sessionStorage.setItem('shopAiCheckoutUrl', this.state.checkoutUrl);

          // ✅ Update ONLY this button
          button.textContent = 'Go to Cart';
          button.disabled = false;

          console.log(`✅ Product ${productId} added! Checkout URL: ${this.state.checkoutUrl}`);
          this.addMessage(`Added! Ready to checkout?`, 'assistant');
        } else {
          throw new Error(data.message || 'Failed to add to cart');
        }
      } catch (err) {
        console.error('❌ Cart error:', err);
        button.textContent = originalText;
        button.disabled = false;
        this.addMessage('Could not add to cart. Please try again.', 'assistant');
      } finally {
        this.state.isCartUpdating = false;
      }
    },

    // ✅ CRITICAL: Proper checkout opening
    openCheckout() {
      const url = this.state.checkoutUrl;
      
      console.log(`🛒 Opening checkout. URL: ${url}`);

      if (!url || typeof url !== 'string') {
        console.error('❌ No checkout URL:', url);
        this.addMessage('Could not open cart. Please try again.', 'assistant');
        return;
      }

      const safeUrl = String(url).trim();

      // Validate it's a real Shopify cart/checkout URL
      if (!safeUrl.startsWith('https://') && !safeUrl.startsWith('http://')) {
        console.error('❌ Invalid URL format:', safeUrl);
        this.addMessage('Invalid cart link.', 'assistant');
        return;
      }

      if (!safeUrl.includes('/cart') && !safeUrl.includes('/checkouts')) {
        console.error('❌ Not a valid cart URL:', safeUrl);
        this.addMessage('Invalid cart link.', 'assistant');
        return;
      }

      console.log(`✅ Opening: ${safeUrl}`);
      
      try {
        window.open(safeUrl, '_blank');
      } catch (err) {
        console.warn('⚠️ Could not open in new tab, using same window');
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
      
      sessionStorage.removeItem('shopAiCartId');
      sessionStorage.removeItem('shopAiCheckoutUrl');
      sessionStorage.removeItem('shopAiAddedByProductId');
      sessionStorage.removeItem('shopAiConversationId');

      this.elements.messages.innerHTML = '';
      this.addMessage('Started new chat.', 'assistant');
    },

    showChat() {
      if (this.elements.historyPanel) {
        this.elements.historyPanel.classList.remove('active');
      }
    },

    submitEmail() {
      // Email submission logic
    },

    skipEmail() {
      if (this.elements.emailOverlay) {
        this.elements.emailOverlay.classList.remove('active');
      }
    },

    restoreState() {
      if (this.elements.modal?.classList.contains('active')) {
        // Already open
      }
    },

    exposeAPI() {
      window.ShopAIChat = this;
    }
  };

  // Initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopAIChat.init());
  } else {
    ShopAIChat.init();
  }

  window.ShopAIChat = ShopAIChat;
})();
