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
      cartId: null,
      checkoutUrl: null,
      selectedProduct: null,
      isCartUpdating: false
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
      this.elements.closeBtn.addEventListener('click', () => this.close());
      this.elements.backdrop.addEventListener('click', () => this.close());

      // Menu toggle
      this.elements.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = this.elements.menuDropdown.classList.toggle('active');
        this.elements.menuBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });

      document.addEventListener('click', () => {
        this.elements.menuDropdown.classList.remove('active');
        this.elements.menuBtn.setAttribute('aria-expanded', 'false');
      });

      // Menu items
      this.elements.menuDropdown.querySelectorAll('.shop-ai-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
          const action = e.currentTarget.dataset.action;
          if (action === 'new') this.startNewChat();
          if (action === 'history') this.openHistory();
          if (action === 'end') this.endChat();
          this.elements.menuDropdown.classList.remove('active');
        });
      });

      // Input behaviors
      this.elements.input.addEventListener('input', (e) => {
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
        const hasText = e.target.value.trim().length > 0;
        this.elements.sendBtn.classList.toggle('active', hasText);
      });

      this.elements.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSubmit();
        }
        if (e.key === 'Escape') {
          this.close();
        }
      });

      this.elements.sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleSubmit();
      });

      // Email capture handlers
      this.elements.emailSubmit.addEventListener('click', () => this.submitEmail());
      this.elements.emailSkip.addEventListener('click', () => this.skipEmail());
      this.elements.emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submitEmail();
        }
      });

      // History handlers
      this.elements.backBtn.addEventListener('click', () => this.closeHistory());

      // Resize handling
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.adjustModalForContent(), 120);
      });
    },

    startPlaceholderRotation() {
      setInterval(() => {
        if (!this.state.isOpen || this.elements.input.value.trim().length > 0) return;
        
        this.state.placeholderIndex = (this.state.placeholderIndex + 1) % this.placeholders.length;
        
        // Smooth fade transition
        this.elements.input.style.opacity = '0.5';
        this.elements.input.style.transition = 'opacity 0.3s ease';
        
        setTimeout(() => {
          this.elements.input.placeholder = this.placeholders[this.state.placeholderIndex];
          this.elements.input.style.opacity = '1';
        }, 300);
      }, 4000);
    },

    exposeAPI() {
      window.ShopAIChat = this;
      if (!window.ShopAIChatAPI) window.ShopAIChatAPI = this;
    },

    restoreState() {
      if (this.elements.suggestions) {
        this.elements.suggestions.classList.add('visible');
      }
    },

    open() {
      document.body.classList.add('shop-ai-open');
      if (this.elements.floatingGroup) this.elements.floatingGroup.classList.add('hidden');
      this.state.isOpen = true;
      
      setTimeout(() => this.elements.input.focus(), 320);
      
      // Show email popup after 3 seconds if not captured yet.
      // It should only appear once per browser (even across sessions),
      // so we also gate it on a persistent "prompted ever" flag.
      const emailPromptedEver = localStorage.getItem('shopAiEmailPromptedEver') === 'true';
      if (!this.state.emailCaptured && !this.state.emailPopupShown && !emailPromptedEver) {
        setTimeout(() => {
          if (this.state.isOpen && this.elements.messages.children.length > 2) {
            this.showEmailPopup();
          }
        }, 3000);
      }
    },

    close() {
      document.body.classList.remove('shop-ai-open');
      if (this.elements.floatingGroup) this.elements.floatingGroup.classList.remove('hidden');
      this.state.isOpen = false;
    },

    showEmailPopup() {
      this.elements.emailOverlay.classList.add('active');
      this.state.emailPopupShown = true;
      sessionStorage.setItem('shopAiEmailPopupShown', 'true');
      localStorage.setItem('shopAiEmailPromptedEver', 'true');
    },

    hideEmailPopup() {
      this.elements.emailOverlay.classList.remove('active');
    },

    async submitEmail() {
      const email = this.elements.emailInput.value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!emailRegex.test(email)) {
        this.elements.emailError.classList.add('visible');
        return;
      }

      this.elements.emailError.classList.remove('visible');

      try {
        // Submit to backend
        await fetch(window.shopChatConfig.leadsUrl, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            email: email,
            visitor_id: this.state.visitorId,
            source: 'chat_popup'
          })
        });

        this.state.emailCaptured = true;
        localStorage.setItem('shopAiEmailCaptured', 'true');
        this.hideEmailPopup();
      } catch (err) {
        console.error('Email submission error:', err);
        this.hideEmailPopup();
      }
    },

    skipEmail() {
      this.hideEmailPopup();
    },

    startNewChat() {
      sessionStorage.removeItem('shopAiConversationId');
      this.state.conversationId = null;
      
      if (this.elements.messages) {
        this.elements.messages.querySelectorAll('.shop-ai-message, .shop-ai-thinking-container, .shop-ai-product-container').forEach(n => n.remove());
        
        if (this.elements.suggestions) {
          this.elements.messages.appendChild(this.elements.suggestions);
          this.elements.suggestions.classList.add('visible');
        }
      }
      
      window.dispatchEvent(new CustomEvent('shop-ai-new-chat', { detail: {} }));
      this.elements.input.focus();
    },

    openHistory() {
      this.elements.historyPanel.classList.add('active');
      this.renderHistory();
    },

    closeHistory() {
      this.elements.historyPanel.classList.remove('active');
    },

    renderHistory() {
      if (!this.state.chatHistory.length) {
        this.elements.historyList.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">No previous chats</p>';
        return;
      }

      this.elements.historyList.innerHTML = this.state.chatHistory
        .reverse()
        .map((chat, idx) => `
          <div class="shop-ai-history-item" onclick="ShopAIChat.loadChat(${idx})">
            <div class="shop-ai-history-item-title">${this.truncate(chat.title, 60)}</div>
            <div class="shop-ai-history-item-time">${this.formatTime(chat.timestamp)}</div>
          </div>
        `)
        .join('');
    },

    loadChat(index) {
      // Load chat from history
      const chat = this.state.chatHistory[this.state.chatHistory.length - 1 - index];
      if (!chat) return;

      this.startNewChat();
      
      // Re-render messages
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      messages.forEach((msg) => {
        if (!msg || typeof msg.content !== 'string') return;
        const role = msg.role === 'assistant' || msg.role === 'user' ? msg.role : 'assistant';
        this.addMessage(msg.content, role);
      });

      this.closeHistory();
    },

    endChat() {
      // Save to history before ending
      const messages = Array.from(this.elements.messages.querySelectorAll('.shop-ai-message'))
        .map(msg => ({
          role: msg.classList.contains('user') ? 'user' : 'assistant',
          content: msg.querySelector('.shop-ai-bubble').textContent
        }));

      if (messages.length > 0) {
        const chatRecord = {
          title: messages[0]?.content || 'Chat',
          timestamp: Date.now(),
          messages: messages
        };

        this.state.chatHistory.push(chatRecord);
        
        // Keep only last 20 chats
        if (this.state.chatHistory.length > 20) {
          this.state.chatHistory = this.state.chatHistory.slice(-20);
        }

        localStorage.setItem('shopAiChatHistory', JSON.stringify(this.state.chatHistory));
      }

      this.startNewChat();
    },

    handleSubmit() {
      const message = this.elements.input.value.trim();
      if (!message || this.state.isThinking) return;

      this.send(message);
      this.elements.input.value = '';
      this.elements.input.style.height = 'auto';
      this.elements.sendBtn.classList.remove('active');
    },

    send(message) {
      // Hide suggestions
      if (this.elements.suggestions) {
        this.elements.suggestions.classList.remove('visible');
        this.elements.suggestions.remove();
      }

      // Add user message
      this.addMessage(message, 'user');

      // Start streaming
      this.startStream(message);
    },

    addMessage(content, role) {
      // Clamp overly long assistant responses to keep UX tight.
      // We keep the first ~600 characters and drop the rest with an ellipsis.
      let safeContent = content || '';
      if (role === 'assistant' && typeof safeContent === 'string' && safeContent.length > 600) {
        safeContent = safeContent.slice(0, 600) + '…';
      }

      const msgDiv = document.createElement('div');
      msgDiv.className = `shop-ai-message ${role}`;

      const bubble = document.createElement('div');
      bubble.className = 'shop-ai-bubble';
      
      if (role === 'assistant') {
        bubble.innerHTML = this.parseMarkdown(safeContent);
      } else {
        bubble.textContent = content;
      }

      msgDiv.appendChild(bubble);
      this.elements.messages.appendChild(msgDiv);
      
      this.scrollToBottom();
      return msgDiv;
    },

    parseMarkdown(text) {
      if (!text || typeof text !== 'string') return '<p></p>';

      let cleaned = text;

      // Convert markdown links [text](url) into real anchors.
      cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });

      // Basic bold/italic handling.
      cleaned = cleaned
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');

      // Strip heading and bullet markdown characters at line starts.
      cleaned = cleaned
        .split('\n')
        .map((line) => line.replace(/^\s*[#>\-\*\/]+ ?/g, ''))
        .join('\n');

      // Paragraph / line-break handling.
      let html = cleaned
        .replace(/\n\n+/g, '</p><p>')
        .replace(/\n/g, '<br>');

      // Remove any remaining markdown noise.
      html = html.replace(/\*\*/g, '').replace(/\/\//g, '');

      return `<p>${html}</p>`;
    },

    showThinking() {
      if (this.state.isThinking) return;
      this.state.isThinking = true;

      const container = document.createElement('div');
      container.id = 'shop-ai-thinking-ui';
      container.className = 'shop-ai-thinking-container';

      container.innerHTML = `
        <div class="shop-ai-thinking-stages">
          <div class="shop-ai-stage active" data-stage="1"></div>
          <div class="shop-ai-stage" data-stage="2"></div>
          <div class="shop-ai-stage" data-stage="3"></div>
        </div>
        <div class="shop-ai-thinking-text">Thinking...</div>
      `;

      this.elements.messages.appendChild(container);
      this.scrollToBottom();
    },

    updateThinkingStage(stage, text) {
      const ui = document.getElementById('shop-ai-thinking-ui');
      if (!ui) return;

      const stages = ui.querySelectorAll('.shop-ai-stage');
      const textEl = ui.querySelector('.shop-ai-thinking-text');

      stages.forEach((s, idx) => {
        if (idx < stage) {
          s.classList.add('active');
        } else {
          s.classList.remove('active');
        }
      });

      if (text) textEl.textContent = text;
    },

    removeThinking() {
      const ui = document.getElementById('shop-ai-thinking-ui');
      if (ui) ui.remove();
      this.state.isThinking = false;
    },

    openProductModal(product) {
      if (!product) return;
      this.state.selectedProduct = product;

      const existing = document.getElementById('shop-ai-product-modal-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'shop-ai-product-modal-overlay';
      overlay.className = 'shop-ai-product-modal-overlay active';

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeProductModal();
        }
      });

      const modal = document.createElement('div');
      modal.className = 'shop-ai-product-modal';

      const left = document.createElement('div');
      left.className = 'shop-ai-product-modal-left';
      const img = document.createElement('img');
      img.alt = product.title || 'Product';
      img.src = product.image_url || '';
      img.loading = 'lazy';
      left.appendChild(img);

      const right = document.createElement('div');
      right.className = 'shop-ai-product-modal-right';

      const title = document.createElement('div');
      title.className = 'shop-ai-product-modal-title';
      title.textContent = product.title || 'Untitled product';

      const price = document.createElement('div');
      price.className = 'shop-ai-product-modal-price';
      price.textContent = product.price || '';

      const desc = document.createElement('div');
      desc.className = 'shop-ai-product-modal-description';
      if (product.description) {
        desc.textContent = product.description;
      }

      const actions = document.createElement('div');
      actions.className = 'shop-ai-product-modal-actions';

      const primary = document.createElement('button');
      primary.className = 'shop-ai-product-modal-primary';
      primary.textContent = this.state.checkoutUrl ? 'Go to Cart' : 'Add to Cart';
      primary.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this.state.checkoutUrl) {
          this.openCheckout();
        } else {
          await this.addProductToCart(product, primary);
        }
      });

      const secondary = document.createElement('button');
      secondary.className = 'shop-ai-product-modal-secondary';
      secondary.textContent = 'View product';
      secondary.addEventListener('click', (e) => {
        e.stopPropagation();
        if (product.url) {
          try {
            window.open(product.url, '_blank');
          } catch (err) {
            window.location.href = product.url;
          }
        }
      });

      actions.appendChild(primary);
      if (product.url) actions.appendChild(secondary);

      right.appendChild(title);
      if (product.price) right.appendChild(price);
      if (product.description) right.appendChild(desc);
      right.appendChild(actions);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'shop-ai-product-modal-close';
      closeBtn.setAttribute('aria-label', 'Close product details');
      closeBtn.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeProductModal();
      });

      modal.appendChild(left);
      modal.appendChild(right);
      modal.appendChild(closeBtn);

      overlay.appendChild(modal);

      // Attach inside the main modal so it inherits the same stacking context
      const host = this.elements.modal || document.body;
      host.appendChild(overlay);
    },

    closeProductModal() {
      const overlay = document.getElementById('shop-ai-product-modal-overlay');
      if (overlay) overlay.remove();
      this.state.selectedProduct = null;
    },

    async addProductToCart(product, primaryButton) {
      if (this.state.isCartUpdating) return;

      const variantId = product.variant_id || product.merchandise_id;
      if (!variantId) {
        console.warn('No variant_id/merchandise_id on product; cannot add to cart', product);
        this.addMessage('I could not find a valid variant for that item. Please use the product page to add it to your cart.', 'assistant');
        return;
      }

      this.state.isCartUpdating = true;
      const originalLabel = primaryButton.textContent;
      primaryButton.textContent = 'Adding…';

      try {
        const result = await this.callCartApi({
          variantId,
          quantity: 1
        });

        if (result && result.checkoutUrl) {
          this.state.cartId = result.cartId || null;
          this.state.checkoutUrl = result.checkoutUrl;
          primaryButton.textContent = 'Go to Cart';
        } else {
          primaryButton.textContent = originalLabel;
          this.addMessage('I could not update your cart just now. Please try again or use the product page.', 'assistant');
        }
      } catch (err) {
        console.error('Cart API error:', err);
        primaryButton.textContent = originalLabel;
        this.addMessage('I could not update your cart just now. Please try again or use the product page.', 'assistant');
      } finally {
        this.state.isCartUpdating = false;
      }
    },

    async callCartApi({ variantId, quantity }) {
      const cfg = window.shopChatConfig || {};
      const url = cfg.cartUrl || (cfg.apiUrl ? cfg.apiUrl.replace('/chat', '/api/cart') : null);

      if (!url) {
        throw new Error('Cart API URL is not configured');
      }

      const payload = {
        variantId,
        quantity: quantity || 1,
        cartId: this.state.cartId,
        conversationId: this.state.conversationId
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Cart API failed: ${resp.status} ${errBody}`);
      }

      const data = await resp.json();
      return {
        cartId: data.cartId || null,
        checkoutUrl: data.checkoutUrl || null
      };
    },

    openCheckout() {
      const url = this.state.checkoutUrl;
      if (!url || typeof url !== 'string') {
        console.warn('Missing checkoutUrl in state');
        this.addMessage('I could not open your cart link. Please try from the product page.', 'assistant');
        return;
      }

      const safeUrl = url.trim();
      if (!safeUrl.startsWith('http')) {
        console.warn('Invalid checkout URL format:', safeUrl);
        this.addMessage('I could not open your cart link. Please try from the product page.', 'assistant');
        return;
      }

      try {
        window.open(safeUrl, '_blank');
      } catch (err) {
        console.warn('Failed to open checkout in new tab, falling back to same window', err);
        window.location.href = safeUrl;
      }
    },

    renderProducts(products) {
      if (!products || !products.length) return;

      const container = document.createElement('div');
      container.className = 'shop-ai-product-container';

      products.forEach(prod => {
        const card = document.createElement('div');
        card.className = 'shop-ai-product-row';
        card.onclick = () => {
          this.openProductModal(prod);
        };

        const img = document.createElement('img');
        img.className = 'shop-ai-prod-img';
        img.alt = prod.title || 'Product';
        img.src = prod.image_url || '';
        img.loading = 'lazy';

        const info = document.createElement('div');
        info.className = 'shop-ai-prod-info';

        const title = document.createElement('div');
        title.className = 'shop-ai-prod-title';
        title.textContent = prod.title || 'Untitled';

        const price = document.createElement('div');
        price.className = 'shop-ai-prod-price';
        price.textContent = prod.price || (prod.price_range ? `${prod.price_range.min} ${prod.price_range.currency || ''}` : '');

        info.appendChild(title);
        info.appendChild(price);

        card.appendChild(img);
        card.appendChild(info);
        container.appendChild(card);
      });

      this.elements.messages.appendChild(container);
      setTimeout(() => this.scrollToBottom(), 100);
    },

    async startStream(userMessage) {
      this.showThinking();

      try {
        const resp = await fetch(window.shopChatConfig.apiUrl, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            message: userMessage,
            conversation_id: this.state.conversationId,
            prompt_type: window.shopChatConfig.promptType || 'standardAssistant'
          })
        });

        if (!resp.ok) throw new Error('Network error');

        const reader = resp.body.getReader();
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

            if (data.type === 'tool_use') {
              const toolMsg = data.tool_use_message || '';
              const short = toolMsg.includes('search') ? 'Searching products...' : 
                           toolMsg.includes('cart') ? 'Updating cart...' : 
                           'Scouting store...';
              this.updateThinkingStage(2, short);
            }

            if (data.type === 'product_results') {
              this.removeThinking();
              this.renderProducts(data.products || []);
            }

            if (data.type === 'cart_updated') {
              this.removeThinking();

              if (data.checkout_url) {
                // Persist latest cart info so UI buttons can switch to \"Go to Cart\"
                this.state.checkoutUrl = data.checkout_url;
                if (data.cart && data.cart.id) {
                  this.state.cartId = data.cart.id;
                }

                const msg = `Your cart is ready. You can [click here to proceed to checkout](${data.checkout_url}).`;
                this.addMessage(msg, 'assistant');
              }
            }

            if (data.type === 'chunk') {
              if (this.state.isThinking) {
                this.updateThinkingStage(3, 'Preparing response...');
                await new Promise(r => setTimeout(r, 300));
                this.removeThinking();
              }
              
              // Accumulate full text before displaying
              fullText += data.chunk;
              
              if (!currentAssistantMsg) {
                currentAssistantMsg = this.addMessage('', 'assistant');
              }
              
              const bubble = currentAssistantMsg.querySelector('.shop-ai-bubble');
              bubble.innerHTML = this.parseMarkdown(fullText);
              this.scrollToBottom();
            }

            if (data.type === 'message_complete' || data.type === 'end_turn') {
              this.removeThinking();
              currentAssistantMsg = null;
              fullText = '';
            }

            if (data.type === 'error' || data.type === 'auth_required') {
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

    adjustModalForContent() {
      // Ensure modal height accommodates content
      if (!this.elements.modal || !this.elements.messages) return;
      
      requestAnimationFrame(() => this.scrollToBottom());
    },

    scrollToBottom() {
      if (!this.elements.messages) return;
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight + 200;
    },

    truncate(text, length) {
      return text.length > length ? text.substring(0, length) + '...' : text;
    },

    formatTime(timestamp) {
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now - date;
      
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      
      if (minutes < 60) return `${minutes} minutes ago`;
      if (hours < 24) return `${hours} hours ago`;
      if (days < 7) return `${days} days ago`;
      return date.toLocaleDateString();
    }
  };

  // Expose global
  window.ShopAIChat = ShopAIChat;

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopAIChat.init());
  } else {
    ShopAIChat.init();
  }

  // Escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ShopAIChat && ShopAIChat.state && ShopAIChat.state.isOpen) {
      ShopAIChat.close();
    }
  });
})();
